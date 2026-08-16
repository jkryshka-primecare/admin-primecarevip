// functions/adminProvisionPatients.js
// Admin plane. Creates portal ROSTER RECORDS in bulk for active Hint members
// who have none. Release 2a of the portal data plane.
//
// What this does NOT do, by design:
//   - it never sends an invite or any email (that stays adminIssueInvite,
//     one patient at a time, after a human looks at the record)
//   - it never writes to Elation or Hint
//   - it never overwrites an existing roster doc — a collision is reported
//     back as `skipped`, never merged, so a bad batch cannot corrupt a
//     claimed member
//
// Caller: the Prime Care OS backend only, as portal-admin@prive-care-vip with
// a Google OIDC identity token. Prime Care OS enforces the admin role, the
// written reason, the 300-member cap and the test-fixture exclusion before it
// ever reaches here; everything is re-checked below anyway.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');

const MAX_BATCH = 300;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Test Kieffer — the Step 1 smoke-test fixture. Belt and braces: Prime Care OS
// filters this out too, but a bulk writer should never depend on its caller.
const FIXTURE_HINT_IDS = new Set([]);
const FIXTURE_ELATION_IDS = new Set(['816455979040769']);

/**
 * Optional Elation resolver. The doc id of a roster record IS the Elation
 * patient id, so a member with no Elation chart cannot be provisioned. If the
 * repo exposes a resolver we use it; if not, the batch still runs for members
 * whose Elation id Prime Care OS already supplied, and the rest come back as
 * `unresolved` rather than being invented.
 */
let resolveElationPatient = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ resolveElationPatient } = require('./core/services/elation/resolvePatient'));
} catch (e) {
  resolveElationPatient = null;
}

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

const norm = (v) => String(v == null ? '' : v).trim();
const lower = (v) => norm(v).toLowerCase();

async function audit(entry) {
  try {
    await admin.firestore().collection('portalAdminAudit').add({
      at: admin.firestore.Timestamp.now(),
      ...entry,
    });
  } catch (e) {
    logError('adminProvisionPatients', 'audit-write-failed', { message: e.message });
  }
}

/**
 * Existing-record guard. Families here share an email, so a match needs the
 * date of birth in the key — email alone would happily collide a child with
 * their parent and silently skip a real member.
 */
async function findExisting(db, member) {
  const col = db.collection('patients');

  if (member.elationPatientId) {
    const byId = await col.doc(member.elationPatientId).get();
    if (byId.exists) return byId;
  }

  if (member.email) {
    const snap = await col.where('email', '==', member.email).get();
    const hit = snap.docs.find((d) => lower((d.data() || {}).dob) === lower(member.dob));
    if (hit) return hit;
  }

  const snap = await col.where('dob', '==', member.dob).get();
  return (
    snap.docs.find((d) => {
      const data = d.data() || {};
      return (
        lower(data.firstName) === lower(member.firstName) &&
        lower(data.lastName) === lower(member.lastName)
      );
    }) || null
  );
}

exports.adminProvisionPatients = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminProvisionPatients'));
    if (!gate.ok) {
      log('adminProvisionPatients', 'caller-rejected', { reason: gate.reason });
      return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    const actor = lower(body.actor);
    const reason = norm(body.reason).slice(0, 500);
    const members = Array.isArray(body.members) ? body.members : null;

    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');
    if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
    if (!members || members.length === 0) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MEMBERS_REQUIRED');
    }
    if (members.length > MAX_BATCH) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'BATCH_TOO_LARGE');
    }
    // Creating a record is not an invitation. Refuse loudly rather than
    // quietly ignoring a caller that thinks this endpoint can send mail.
    if (body.sendInvite === true) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'INVITES_NOT_SUPPORTED_HERE');
    }

    const db = admin.firestore();
    const created = [];
    const skipped = [];
    const unresolved = [];

    for (const raw of members) {
      const member = {
        hintId: norm(raw.hintId),
        firstName: norm(raw.firstName),
        lastName: norm(raw.lastName),
        email: lower(raw.email) || null,
        dob: norm(raw.dob),
        phone: norm(raw.phone) || null,
        elationPatientId: norm(raw.elationPatientId) || null,
      };
      const name = `${member.firstName} ${member.lastName}`.trim();

      if (!member.hintId || !member.firstName || !member.lastName || !ISO_DATE.test(member.dob)) {
        unresolved.push({ hintId: member.hintId || null, name, reason: 'INCOMPLETE_IDENTITY' });
        continue;
      }
      if (
        FIXTURE_HINT_IDS.has(member.hintId) ||
        (member.elationPatientId && FIXTURE_ELATION_IDS.has(member.elationPatientId))
      ) {
        skipped.push({ hintId: member.hintId, reason: 'TEST_FIXTURE' });
        continue;
      }

      try {
        const existing = await findExisting(db, member);
        if (existing) {
          // Never merge into a record we did not create in this run. Attach the
          // Hint id if it is missing — that is additive and makes the next
          // reconciliation cheaper — but touch nothing else.
          const data = existing.data() || {};
          if (!data.hintPatientId) {
            await existing.ref.update({
              hintPatientId: member.hintId,
              updatedAt: admin.firestore.Timestamp.now(),
            });
          }
          skipped.push({ hintId: member.hintId, reason: 'ALREADY_EXISTS' });
          continue;
        }

        let elationPatientId = member.elationPatientId;
        if (!elationPatientId && resolveElationPatient) {
          const match = await resolveElationPatient({
            firstName: member.firstName,
            lastName: member.lastName,
            dob: member.dob,
            email: member.email,
          });
          // Only a single, unambiguous chart match may become a doc id. An
          // ambiguous match here would hand one member another's records.
          if (match && match.confident && match.id) elationPatientId = String(match.id);
        }

        if (!elationPatientId) {
          unresolved.push({
            hintId: member.hintId,
            name,
            reason: resolveElationPatient ? 'NO_CONFIDENT_ELATION_MATCH' : 'ELATION_RESOLVER_UNAVAILABLE',
          });
          continue;
        }

        const ref = db.collection('patients').doc(elationPatientId);
        // create() (not set()) so a concurrent run can never overwrite.
        await ref.create({
          elationPatientId,
          hintPatientId: member.hintId,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          dob: member.dob,
          phone: member.phone,
          status: 'not_invited',
          firebaseUid: null,
          provisionedAt: admin.firestore.Timestamp.now(),
          provisionedBy: actor,
          source: 'os.provision.2a',
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        created.push({ hintId: member.hintId, elationPatientId, name });
      } catch (e) {
        if (e && e.code === 6) {
          // ALREADY_EXISTS from create() — lost a race, which is the safe outcome.
          skipped.push({ hintId: member.hintId, reason: 'ALREADY_EXISTS' });
        } else {
          logError('adminProvisionPatients', 'member-failed', { message: e.message });
          unresolved.push({ hintId: member.hintId, name, reason: 'WRITE_FAILED' });
        }
      }
    }

    await audit({
      action: 'provisionPatients',
      actor,
      reason,
      requested: members.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      unresolvedCount: unresolved.length,
      // Ids only — no names, no email, no dates of birth in the audit line.
      createdIds: created.map((c) => c.elationPatientId),
    });

    log('adminProvisionPatients', 'batch-complete', {
      requested: members.length,
      created: created.length,
      skipped: skipped.length,
      unresolved: unresolved.length,
    });

    return res.status(200).json({ created, skipped, unresolved });
  });
