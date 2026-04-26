import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const emailSchema = z.string().trim().email("Enter a valid email").max(255);
const passwordSchema = z.string().min(8, "Min 8 characters").max(128);

export default function Auth() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite");
  const { user, loading } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">(inviteToken ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  // Prefill from invitation token (public read by token policy)
  useEffect(() => {
    if (!inviteToken) return;
    supabase.from("invitations")
      .select("email, first_name, last_name, status")
      .eq("token", inviteToken)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) { toast.error("Invitation link is invalid"); return; }
        if (data.status !== "pending") { toast.error("This invitation has already been used"); return; }
        setEmail(data.email);
        setInviteEmail(data.email);
        setDisplayName(`${data.first_name ?? ""} ${data.last_name ?? ""}`.trim());
        setMode("signup");
      });
  }, [inviteToken]);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    const ev = emailSchema.safeParse(email);
    const pv = passwordSchema.safeParse(password);
    if (!ev.success) return toast.error(ev.error.issues[0].message);
    if (!pv.success) return toast.error(pv.error.issues[0].message);

    setSubmitting(true);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: ev.data,
        password: pv.data,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: { full_name: displayName || undefined },
        },
      });
      setSubmitting(false);
      if (error) {
        toast.error(error.message.toLowerCase().includes("already")
          ? "An account with this email already exists. Try signing in."
          : error.message);
        return;
      }
      toast.success("Check your email to confirm your account.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: ev.data, password: pv.data });
      setSubmitting(false);
      if (error) {
        toast.error(error.message.toLowerCase().includes("invalid")
          ? "Invalid email or password." : error.message);
        return;
      }
      navigate("/", { replace: true });
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) toast.error("Google sign-in failed");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground">
        <div className="font-serif text-2xl tracking-tight">PrimeCare OS</div>
        <div className="space-y-6 max-w-md">
          <div className="size-12 rounded-full bg-accent/20 text-accent-foreground flex items-center justify-center">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="font-serif text-4xl leading-tight">
            The master admin platform for PrimeCare VIP.
          </h1>
          <p className="text-sm leading-relaxed text-primary-foreground/80">
            Access is invite-only and audited. Sessions handle Protected Health
            Information under HIPAA — every record retrieval is logged.
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60 font-mono">PHI · Logged · Encrypted in transit</div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-8">
          <header className="space-y-2">
            <h2 className="font-serif text-3xl text-foreground">
              {mode === "signin" ? "Sign in" : inviteToken ? "Accept your invitation" : "Create account"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "signin"
                ? "Welcome back."
                : inviteToken
                  ? `You've been invited to PrimeCare OS as ${inviteEmail ?? ""}. Set a password to continue.`
                  : "Sign-up is invite-only. Ask an administrator for a link."}
            </p>
          </header>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@primecarevip.com" autoComplete="email" required readOnly={!!inviteEmail} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"} required />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          {!inviteToken && (
            <div className="text-center text-xs text-muted-foreground">
              {mode === "signin" ? (
                <>Don't have an account? Sign-up is invite-only — contact your administrator.</>
              ) : (
                <button onClick={() => setMode("signin")} className="underline hover:text-foreground">
                  Already have an account? Sign in
                </button>
              )}
            </div>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
              <span className="bg-background px-3 text-muted-foreground">or continue with</span>
            </div>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={handleGoogle}>
            <svg viewBox="0 0 24 24" className="size-4 mr-2" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" />
            </svg>
            Sign in with Google
          </Button>

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            Sessions time out after 15 minutes of inactivity.
          </p>
        </div>
      </div>
    </div>
  );
}
