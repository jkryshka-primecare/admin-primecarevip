import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Apple, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { SocialFlow, type Challenge, type ProviderIdentity } from "@/lib/social-flow";
import { socialConfig } from "@/lib/social-config";
import { callSocial } from "@/lib/social-callable";
import { acquireApple, mountGoogle } from "@/lib/social-providers";

export function SocialSignIn() {
  const { signInWithToken } = usePortalAuth();
  const flow = useMemo(() => new SocialFlow(socialConfig.displayEnabled, callSocial, signInWithToken), [signInWithToken]);
  const google = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"provider" | "identity" | "code" | "contact">("provider");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [code, setCode] = useState("");

  const run = useCallback(async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch { setError("We couldn't complete sign-in. Please try again or contact the practice."); }
    finally { lock.current = false; setBusy(false); }
  }, []);
  const start = useCallback((identity: ProviderIdentity) => {
    void run(async () => {
      const outcome = await flow.start(identity);
      if (outcome === "identity-required") setStep("identity");
      if (outcome === "contact-practice") setStep("contact");
    });
  }, [flow, run]);

  useEffect(() => {
    if (!socialConfig.displayEnabled || step !== "provider" || !google.current) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void mountGoogle(google.current, start).then((dispose) => {
      if (cancelled) dispose(); else cleanup = dispose;
    }).catch(() => { if (!cancelled) setError("Google sign-in isn't available right now."); });
    return () => { cancelled = true; cleanup?.(); };
  }, [step, start]);
  useEffect(() => () => flow.clear(), [flow]);

  if (!socialConfig.displayEnabled) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (step === "identity") {
        const next = await flow.verify({ firstName, lastName, dob });
        setChallenge(next); setStep("code");
      } else if (step === "code") await flow.confirm(code);
    });
  };
  const restart = () => {
    flow.clear(); setChallenge(null); setCode(""); setDob(""); setFirstName(""); setLastName(""); setError(null); setStep("provider");
  };
  return <section className="mt-6 space-y-4" aria-label="Social sign-in" aria-busy={busy}>
    {step === "provider" ? <>
      <div className={busy ? "pointer-events-none opacity-50" : ""} inert={busy ? true : undefined}><div ref={google} className="min-h-11 w-full" /></div>
      <Button type="button" variant="outline" className="w-full" disabled={busy || !socialConfig.appleRedirectUri}
        onClick={() => void run(async () => { const identity = await acquireApple(); const outcome = await flow.start(identity); if (outcome === "identity-required") setStep("identity"); if (outcome === "contact-practice") setStep("contact"); })}>
        <Apple className="mr-2 h-4 w-4" />Continue with Apple
      </Button>
    </> : step === "contact" ? <p role="status" className="text-sm text-muted-foreground">Please contact the practice to complete sign-in.</p> :
      <form onSubmit={submit} className="space-y-4">
        {step === "identity" ? <>
          <div><Label htmlFor="social-first">First name</Label><Input id="social-first" autoComplete="given-name" required value={firstName} onChange={e => setFirstName(e.target.value)} /></div>
          <div><Label htmlFor="social-last">Last name</Label><Input id="social-last" autoComplete="family-name" required value={lastName} onChange={e => setLastName(e.target.value)} /></div>
          <div><Label htmlFor="social-dob">Date of birth</Label><Input id="social-dob" type="date" autoComplete="bday" required value={dob} onChange={e => setDob(e.target.value)} /></div>
        </> : <>
          <p role="status" className="text-sm text-muted-foreground">Code sent to {challenge?.destination}</p>
          <Label htmlFor="social-code">Verification code</Label><Input id="social-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} />
        </>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{step === "identity" ? "Send code" : "Verify and sign in"}</Button>
      </form>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {step !== "provider" ? <Button type="button" variant="ghost" disabled={busy} onClick={restart}>Back</Button> : null}
  </section>;
}