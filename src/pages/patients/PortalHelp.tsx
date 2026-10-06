import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, CircleAlert, History, LifeBuoy, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { PortalAccessSnapshot } from "@/hooks/usePortalAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Check = { ok: boolean; label: string; hint?: string };

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Plain-language "why can't they log in?" checklist built from the portal record. */
export function LoginChecklist({ snapshot }: { snapshot: PortalAccessSnapshot }) {
  const suspended = snapshot.access?.status === "suspended";
  const expires = toDate(snapshot.inviteExpiresAt);
  const sent = toDate(snapshot.inviteSentAt);
  const expired = !!expires && expires.getTime() < Date.now();

  const checks: Check[] = [
    {
      ok: !!snapshot.email,
      label: snapshot.email ? `Portal email on file: ${snapshot.email}` : "No portal email on file",
      hint: "Use “Refresh email from chart” after the chart email is updated.",
    },
    {
      ok: !suspended,
      label: suspended ? "Portal access is suspended" : "Portal access is active",
      hint: "An administrator must restore access.",
    },
    snapshot.claimed
      ? {
          ok: !!snapshot.webAccessVerifiedAt,
          label: snapshot.webAccessVerifiedAt
            ? "Account is set up and has signed in"
            : "Account was set up but never finished signing in",
          hint: "Ask the member to sign in with their portal email, or contact an administrator.",
        }
      : snapshot.inviteStatus === "pending" && !expired
        ? {
            ok: true,
            label: `Invite sent${sent ? ` ${format(sent, "MMM d")}` : ""}${expires ? `, valid until ${format(expires, "MMM d")}` : ""}`,
            hint: "Ask the member to use the newest invite email and check spam.",
          }
        : {
            ok: false,
            label: expired ? "Invite link has expired" : "No active invite",
            hint: "Send a new invite below.",
          },
    {
      ok: true,
      label: "Email matches the chart?",
      hint: "Tap “Refresh email from chart” to compare — nothing changes without your OK.",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <LifeBuoy className="h-4 w-4" /> Why can't they log in?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {checks.map((c) => (
          <div key={c.label} className="flex items-start gap-2 text-sm">
            {c.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success mt-0.5" />
            ) : (
              <CircleAlert className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
            )}
            <div>
              <div>{c.label}</div>
              {!c.ok && c.hint && <div className="text-xs text-muted-foreground">{c.hint}</div>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type HistoryRow = {
  id: string;
  created_at: string;
  action: string;
  reason: string | null;
  ok: boolean;
  error_message: string | null;
  actor_email: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  invite: "Invite sent",
  syncEmail: "Email refreshed from chart",
  revoke: "Invite revoked",
  setAccess: "Portal access changed",
};

/** Who helped this member with the portal, when, and why. */
export function PortalHelpHistory({ elationId }: { elationId: string }) {
  const q = useQuery({
    queryKey: ["portal-admin", "history", elationId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; data: HistoryRow[]; error?: string }>(
        "portal-admin",
        { body: { action: "history", elationPatientId: elationId } },
      );
      if (error && !data) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "Could not load history");
      return data.data ?? [];
    },
    staleTime: 30_000,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" /> Portal help history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : q.error ? (
          <p className="text-xs text-muted-foreground">History isn't available right now.</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No portal help recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {q.data!.map((r) => (
              <li key={r.id} className="border-b pb-2 text-sm last:border-0">
                <div className="flex justify-between gap-2">
                  <span className={r.ok ? "" : "text-destructive"}>
                    {ACTION_LABEL[r.action] ?? r.action}
                    {!r.ok && " — failed"}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {format(new Date(r.created_at), "MMM d, p")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.actor_email ?? "Unknown"}
                  {r.reason ? ` · ${r.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
