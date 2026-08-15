# Workload Identity Federation — keyless caller setup

Decision confirmed: **WIF up front. No service-account key is ever downloaded.**

The reviewer's precondition is satisfied. Prime Care OS's auth issuer publishes
OIDC discovery and an asymmetric public JWKS:

```
issuer:   https://imewkweatgvqledptdna.supabase.co/auth/v1
jwks_uri: https://imewkweatgvqledptdna.supabase.co/auth/v1/.well-known/jwks.json
alg:      ES256
```

Verified live. These are not HS256 shared-secret tokens, so GCP STS can
validate them directly. No token broker and no interim key are needed.

## What identity actually federates

Not a staff member's session — a **dedicated bridge account** that exists only
for this purpose:

- It is a normal account in the Prime Care OS backend with **no staff role**,
  so it can read nothing in this app and every RLS policy denies it.
- Its only capability is to be a stable, verifiable `sub` claim.
- The WIF provider condition pins that exact `sub`, so no other account's token
  — including a real staff member's — can be exchanged.

The human staff identity is still enforced separately and earlier: the
`portal-admin` edge function requires a real staff session and an admin role
before it ever reaches for a Google token, and it writes the acting person to
`portal_admin_actions`.

## Google-side commands

Run in Cloud Shell on `prive-care-vip`. Substitute `<BRIDGE_SUB>` with the
bridge account's user id (Prime Care OS will provide it).

```bash
PROJECT=prive-care-vip
PROJNUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
ISSUER=https://imewkweatgvqledptdna.supabase.co/auth/v1

# 1. Keyless service account — no key is ever created for this SA.
gcloud iam service-accounts create portal-admin \
  --display-name="Prime Care OS portal admin" --project=$PROJECT

# 2. Pool + OIDC provider, locked to one subject.
gcloud iam workload-identity-pools create prime-care-os \
  --location=global --display-name="Prime Care OS" --project=$PROJECT

gcloud iam workload-identity-pools providers create-oidc supabase-bridge \
  --location=global --workload-identity-pool=prime-care-os --project=$PROJECT \
  --issuer-uri="$ISSUER" \
  --allowed-audiences="authenticated" \
  --attribute-mapping="google.subject=assertion.sub,attribute.role=assertion.role" \
  --attribute-condition="assertion.sub=='<BRIDGE_SUB>'"

# 3. Let only that subject impersonate portal-admin.
POOL=principal://iam.googleapis.com/projects/$PROJNUM/locations/global/workloadIdentityPools/prime-care-os/subject/<BRIDGE_SUB>
gcloud iam service-accounts add-iam-policy-binding \
  portal-admin@$PROJECT.iam.gserviceaccount.com --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser --member="$POOL"

# 4. Invoker on exactly the four admin functions — nothing else.
for FN in adminIssueInvite adminRevokeInvite adminSetPortalAccess adminGetPortalAccess; do
  gcloud functions add-iam-policy-binding "$FN" \
    --region=us-central1 --project=$PROJECT \
    --member="serviceAccount:portal-admin@$PROJECT.iam.gserviceaccount.com" \
    --role="roles/cloudfunctions.invoker"
done
```

Then report back this one string, which goes into Prime Care OS as
`GCP_WIF_AUDIENCE`:

```
//iam.googleapis.com/projects/$PROJNUM/locations/global/workloadIdentityPools/prime-care-os/providers/supabase-bridge
```

## Prime Care OS side

Four settings, none of them a Google key:

| Name | Value |
| --- | --- |
| `GCP_WIF_AUDIENCE` | the audience string above |
| `GCP_IMPERSONATE_SERVICE_ACCOUNT` | `portal-admin@prive-care-vip.iam.gserviceaccount.com` |
| `PORTAL_BRIDGE_EMAIL` | the bridge account's email |
| `PORTAL_BRIDGE_PASSWORD` | the bridge account's password |

The `portal-admin` edge function already prefers this path whenever all four
are present, and falls back to a key only if one was previously configured.
The flow it runs per call:

```
bridge sign-in (ES256 OIDC) -> STS token exchange -> impersonate portal-admin
  -> generateIdToken(audience = the exact function URL) -> call the function
```

The resulting token has `iss=accounts.google.com`,
`email=portal-admin@prive-care-vip.iam.gserviceaccount.com`, and `aud` equal to
the function URL — exactly what `requireAdminCaller` already checks, so the
Cloud Functions need no change for WIF.

## Also required before the first invite

Grant the functions' **runtime** service account read on the SendGrid secret,
or `adminIssueInvite` 500s on send:

```bash
gcloud secrets add-iam-policy-binding SENDGRID_API_KEY --project=$PROJECT \
  --member="serviceAccount:$PROJECT@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Rollback

Remove the `roles/iam.workloadIdentityUser` binding in step 3. Every call from
Prime Care OS then fails at the exchange, the Portal tab reports not
configured, and nothing else in either system is affected. There is no key to
revoke, rotate, or hunt for.
