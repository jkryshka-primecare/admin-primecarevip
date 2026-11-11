import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import logo from "@/assets/prime-care-logo.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { claimAccount } from "@/lib/api/portal";
import {
  classifyClaimError,
  readClaimEmail,
  readCustomToken,
} from "@/lib/api/claim-messages";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import {
  PASSWORD_POLICY_HELP,
  meetsPasswordPolicy,
  validatePassword,
} from "@/lib/password-policy";


type ClaimSearch = { token?: string; t?: string };

/** Invitation emails send `?t=`; older links use `?token=`. Accept both. */
function readToken(search: Record<string, unknown>): string | undefined {
  for (const key of ["token", "t"]) {
    const raw = search[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) return value;
  }
  return undefined;
}

export const Route = createFileRoute("/claim")({
  validateSearch: (search: Record<string, unknown>): ClaimSearch => ({
    // Keep the raw `t` so the URL isn't rewritten; `token` is what we use.
    ...(typeof search["t"] === "string" ? { t: search["t"] } : {}),
    token: readToken(search),
  }),
  head: () => ({
    meta: [
      { title: "Activate your account — Prime Care VIP Member Portal" },
      {
        name: "description",
        content:
          "Use your invitation link to activate your Prime Care VIP member portal account.",
      },
      { property: "og:title", content: "Activate your account — Prime Care VIP" },
      {
        property: "og:description",
        content: "Set your password and unlock your health records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClaimPage,
});

/** A finished activation: the account exists and the member can sign in. */
type ClaimDone = { message: string; email?: string };


function ClaimPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const { signInWithToken } = usePortalAuth();
  const [dob, setDob] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ClaimDone | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // A claim in flight (or already finished) must never be sent twice.
  const inFlight = useRef(false);


  const matches = password === confirm;
  const meetsRules = meetsPasswordPolicy(password);
  const dobValid = /^\d{4}-\d{2}-\d{2}$/.test(dob);
  const canSubmit =
    dobValid && password.length > 0 && confirm.length > 0 && matches && meetsRules;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || inFlight.current) return;
    // Password managers can autofill without firing React's change event, which
    // would leave the state values stale. Read the live DOM values on submit.
    const form = new FormData(e.currentTarget);
    const dob = String(form.get("dob") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    setDob(dob);
    setPassword(password);
    setConfirm(confirm);
    // All validation happens here on the submitted values — nothing is gated on
    // field state, so a blank or malformed submit never reaches the backend.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setError("Please enter your date of birth.");
      return;
    }
    if (password.length === 0 || confirm.length === 0) {
      setError("Please enter and confirm a password.");
      return;
    }
    const policyError = validatePassword(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);

    // Two-step fallback: the account EXISTS, so this is never an error state.
    const finish = (message: string, email?: string) => {
      setDone({ message, ...(email ? { email } : {}) });
      setTimeout(
        () => void navigate({ to: "/login", search: email ? { email } : {} }),
        1800,
      );
    };

    try {
      const body = await claimAccount(token, password, dob);
      const email = readClaimEmail(body);
      // Bind is complete; only the server-issued custom token may start a session.
      const customToken = readCustomToken(body);
      if (customToken) {
        // One-step handoff: exchange the claim's custom token for a session and
        // land the member straight in the dashboard.
        setDone({ message: "Account created — signing you in…", ...(email ? { email } : {}) });
        try {
          await signInWithToken(customToken);
          void navigate({ to: "/" });
          return;
        } catch (handoffError) {
          // The account exists — never an error. Fall back to sign-in.
          console.error("[claim] sign-in handoff failed after a successful claim", handoffError);
        }
      }
      finish("Your account is ready. Taking you to sign in…", email);
    } catch (err) {
      const outcome = classifyClaimError(err);
      if (outcome.kind === "unknown") {
        // Log the raw token so the next unmapped reason is identifiable.
        console.error("[claim] unmapped activation failure", {
          reason: outcome.reason,
          status: outcome.status,
        });
      }
      if (outcome.kind === "already-active") {
        // The account EXISTS — a reopened or resubmitted link is a success,
        // never an error. Send the member to sign in.
        finish(outcome.message);
        return;
      }
      // A real failure: the member can correct and retry.
      inFlight.current = false;
      setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src={logo} alt="Prime Care VIP" className="h-12 w-12" />
          <h1 className="font-display text-3xl text-midnight">Activate your account</h1>
          <p className="text-sm text-muted-foreground">
            Choose a password to finish setting up your member portal.
          </p>
        </div>

        <Card>
          <CardContent className="py-6">
            {!token ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  This activation link is incomplete. Please open the link from your
                  invitation email, or contact our office for a new one.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </div>
            ) : done ? (
              <div className="space-y-4 py-2 text-center">
                <p
                  className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {done.message}
                </p>
                {busy ? null : (
                  <Button asChild className="w-full">
                    <Link to="/login" search={done.email ? { email: done.email } : {}}>
                      Go to sign in
                    </Link>
                  </Button>
                )}
              </div>

            ) : (
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="dob">Date of birth</Label>
                  <Input
                    id="dob"
                    name="dob"
                    type="date"
                    required
                    autoComplete="bday"
                    aria-describedby="dob-hint"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                  <p id="dob-hint" className="text-xs text-muted-foreground">
                    Format: YYYY-MM-DD (for example 1980-04-27). This must match the date
                    of birth on your chart.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Create password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      className="pr-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HELP}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <div className="relative">
                    <Input
                      id="confirm"
                      name="confirm"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      className="pr-11"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      aria-pressed={showConfirm}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showConfirm ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {confirm.length > 0 && password.length > 0 ? (
                    <p
                      className={`text-xs ${matches ? "text-accent" : "text-destructive"}`}
                      role="status"
                      aria-live="polite"
                    >
                      {matches ? "Passwords match" : "Passwords don't match"}
                    </p>
                  ) : null}
                </div>
                {error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button type="submit" className="w-full" disabled={busy || !canSubmit}>
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Activate account
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
