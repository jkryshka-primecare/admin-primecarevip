import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { ContactOfficeCard, EmptyState } from "@/components/portal-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { usePatientRecord } from "@/hooks/use-portal-query";
import { usePatientScope } from "@/hooks/use-patient-context";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { PortalError } from "@/lib/api/errors";
import { logPhiAcknowledgment } from "@/lib/api/portal";
import logo from "@/assets/prime-care-logo.png";

/** Routes rendered without the authenticated shell. */
const PUBLIC_PATHS = ["/login", "/claim"];

function Splash({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src={logo} alt="" className="h-10 w-10" />
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function BlockingScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

const PHI_ACK_KEY = "pcv.portal.phiAckedSession";

function hasAcknowledgedThisSession(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(PHI_ACK_KEY) === "1";
  } catch {
    return false;
  }
}

function markAcknowledgedThisSession(): void {
  try {
    window.sessionStorage.setItem(PHI_ACK_KEY, "1");
  } catch {
    /* storage unavailable — the notice simply shows again */
  }
}

/**
 * PHI notice — session-scoped, shown once per browser session and recorded
 * server-side via the logPhiAcknowledgment callable. A callable failure (e.g.
 * NO_ROLE on a synthetic test account) must never block the member.
 */
function PhiAcknowledgment({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <BlockingScreen>
      <Card>
        <CardContent className="space-y-4 py-8">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="font-display text-2xl text-midnight">Your health information</h1>
          <p className="text-sm text-muted-foreground">
            This portal shows protected health information from your Prime Care VIP chart. Access is
            logged. Please keep your device secure and sign out when you're finished, especially on
            a shared computer.
          </p>
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await logPhiAcknowledgment();
              } catch {
                /* callable failed (e.g. role gate) — never block the member */
              }
              markAcknowledgedThisSession();
              onDone();
            }}
          >
            I understand — continue
          </Button>
        </CardContent>
      </Card>
    </BlockingScreen>
  );
}

/** Ongoing hydration does not expire into an activation error. */
function RecordsLoading({ onPoll }: { onPoll: () => void }) {
  useEffect(() => {
    const id = setInterval(onPoll, 5_000);
    return () => clearInterval(id);
  }, [onPoll]);
  return (
    <section className="px-4 py-8" aria-live="polite">
      <h1 className="font-display text-2xl text-primary">Your records are still loading</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your account is ready. We’re bringing in your reports and letters; this page updates as they arrive.
      </p>
      <Loader2 className="mt-4 h-5 w-5 animate-spin text-primary motion-reduce:animate-none" />
    </section>
  );
}

export function PortalGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { ready, user, configured, signOut } = usePortalAuth();
  const record = usePatientRecord();
  const { childElationId, setChildElationId } = usePatientScope();
  const [acknowledged, setAcknowledged] = useState(() => hasAcknowledgedThisSession());

  // Sign-out and idle timeout always return to the member's own chart.
  useEffect(() => {
    if (!user && childElationId) setChildElationId(undefined);
  }, [user, childElationId, setChildElationId]);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useIdleTimeout(Boolean(user) && !isPublic, () => {
    void signOut().then(() => navigate({ to: "/login", search: { timeout: true } }));
  });

  useEffect(() => {
    if (ready && !user && !isPublic) {
      void navigate({ to: "/login" });
    }
  }, [ready, user, isPublic, navigate]);

  if (isPublic) return <>{children}</>;
  if (!ready) return <Splash label="Checking your session…" />;
  if (!configured) {
    return (
      <BlockingScreen>
        <ContactOfficeCard
          title="Portal is being connected"
          description="Secure sign-in isn't available on this address yet. Please contact our office if you need your records today."
        />
      </BlockingScreen>
    );
  }
  if (!user) return <Splash label="Redirecting to sign in…" />;

  if (record.isPending) return <Splash label="Loading your chart…" />;

  if (record.isError) {
    const err = record.error instanceof PortalError ? record.error : new PortalError(0, "UNKNOWN");

    if (err.outcome === "sign-out") {
      void signOut();
      return <Splash label="Signing you out…" />;
    }
    if (err.outcome === "no-binding") {
      return (
        <BlockingScreen>
          <ContactOfficeCard
            title="We couldn't find your records"
            description="We couldn't find records linked to your account. Please contact our office and we'll get this connected."
          />
        </BlockingScreen>
      );
    }
    if (err.outcome === "access-paused") {
      return (
        <BlockingScreen>
          <ContactOfficeCard
            title="Portal access is paused"
            description="Please contact our office and we'll get you back in."
          />
        </BlockingScreen>
      );
    }
    if (err.outcome === "guardian-denied") {
      // The link was revoked or aged out mid-session — offer the way back.
      return (
        <BlockingScreen>
          <div className="space-y-4">
            <ContactOfficeCard
              title="Access not available"
              description="You don't have access to this dependent's records. Please contact our office."
            />
            {childElationId ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setChildElationId(undefined)}
              >
                Back to my records
              </Button>
            ) : null}
          </div>
        </BlockingScreen>
      );
    }
    // Fail-closed: the chart that came back did not positively identify the
    // selected subject (stale switch, wrong child, or wrong mode).
    if (err.outcome === "subject-mismatch") {
      return (
        <BlockingScreen>
          <div className="space-y-4">
            <ContactOfficeCard
              title="We couldn't confirm whose records these are"
              description="To keep records from being mixed up, we've stopped here. Please try again, or contact our office."
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setChildElationId(undefined)}
            >
              Back to my records
            </Button>
          </div>
        </BlockingScreen>
      );
    }
    if (err.outcome === "records-not-ready") {
      return (
        <BlockingScreen>
          <EmptyState
            title="Records access isn't enabled yet"
            description="Records access isn't enabled for your account yet. Our concierge team can help in the meantime."
          />
        </BlockingScreen>
      );
    }
    return (
      <BlockingScreen>
        <EmptyState
          title="We couldn't load your chart"
          description="Please check your connection and try again."
        />
      </BlockingScreen>
    );
  }

  // SAFETY: while viewing a dependent, the chart that came back must BE that
  // dependent's. A mismatch (stale cache, ignored scope param, backend change)
  // could show one person's records under another's name — refuse instead.
  // Fails CLOSED: a chart that doesn't positively identify itself as the
  // selected dependent is never rendered under that dependent's name.
  const returnedId = record.data?.elationPatientId;
  if (childElationId && String(returnedId ?? "") !== String(childElationId)) {
    return (
      <BlockingScreen>
        <div className="space-y-4">
          <ContactOfficeCard
            title="We couldn't confirm whose records these are"
            description="To keep records from being mixed up, we've stopped here. Please try again, or contact our office."
          />
          <Button variant="outline" className="w-full" onClick={() => setChildElationId(undefined)}>
            Back to my records
          </Button>
        </div>
      </BlockingScreen>
    );
  }

  const hydration = String(record.data?.hydrationStatus ?? "").toLowerCase();

  if (hydration === "failed") {
    return (
      <BlockingScreen>
        <EmptyState
          title="Records access isn't enabled yet"
          description="Records access isn't enabled for your account yet. Our concierge team can help in the meantime."
        />
      </BlockingScreen>
    );
  }
  if (!acknowledged) {
    return <PhiAcknowledgment onDone={() => setAcknowledged(true)} />;
  }

  return (
    <PortalLayout>
      {hydration === "pending" || hydration === "deferred"
        ? <RecordsLoading onPoll={() => void record.refetch()} />
        : children}
    </PortalLayout>
  );
}
