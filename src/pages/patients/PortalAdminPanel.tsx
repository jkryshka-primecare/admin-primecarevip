import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  Loader2,
  Mail,
  MailX,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  EyeOff,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import {
  PORTAL_MODULES,
  usePortalAccess,
  usePortalMutations,
  type PortalModule,
} from "@/hooks/usePortalAdmin";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";


type HiddenEntry = { collection: string; id: string; label?: string; hiddenAt?: string };

/**
 * The control plane returns hiddenItems either as a flat array or as an object
 * keyed by module ({ labs: [...], imaging: [...] }). Normalize both, and never
 * throw on an absent/odd shape.
 */
function normalizeHidden(raw: unknown): HiddenEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map((h: Record<string, unknown> | string) =>
      typeof h === "string"
        ? { collection: "unknown", id: h }
        : {
            collection: String(h.collection ?? h.module ?? "unknown"),
            id: String(h.id ?? ""),
            label: h.label ? String(h.label) : undefined,
            hiddenAt: h.hiddenAt ? String(h.hiddenAt) : undefined,
          },
    );
  }
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).flatMap(([collection, items]) => {
      if (!Array.isArray(items)) return [];
      return items.filter(Boolean).map((it: Record<string, unknown> | string) =>
        typeof it === "string"
          ? { collection, id: it }
          : {
              collection: String(it.collection ?? collection),
              id: String(it.id ?? ""),
              label: it.label ? String(it.label) : undefined,
              hiddenAt: it.hiddenAt ? String(it.hiddenAt) : undefined,
            },
      );
    });
  }
  return [];
}

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy p");
  } catch {
    return iso;
  }
}

/**
 * Portal control plane for a single member.
 *
 * Every action here changes only what the member sees in the patient portal.
 * Demographics and clinical records stay read-only: Elation remains the single
 * source of truth and nothing on this screen writes to it.
 */
export default function PortalAdminPanel({ elationId }: { elationId: string | null }) {
  const { isAdmin } = useAuth();
  const { snapshot, loading, error, refetch } = usePortalAccess(elationId);
  const { issueInvite, revokeInvite, setAccess } = usePortalMutations(elationId);
  const [reason, setReason] = useState("");
  const [hideCollection, setHideCollection] = useState<PortalModule>("labs");
  const [hideId, setHideId] = useState("");
  const [hideLabel, setHideLabel] = useState("");


  const busy =
    issueInvite.isPending || revokeInvite.isPending || setAccess.isPending;

  const access = snapshot?.access ?? {};
  const suspended = access.status === "suspended";
  const modules = access.modules ?? {};
  const hidden = normalizeHidden(access.hiddenItems);

  function guard(): boolean {
    if (!isAdmin) {
      toast({
        title: "Administrator access required",
        description: "Only admins can change a member's portal access.",
        variant: "destructive",
      });
      return false;
    }
    if (reason.trim().length < 3) {
      toast({
        title: "Reason required",
        description: "Note why you are making this change — it is written to the audit log.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  }

  function run(promise: Promise<unknown>, success: string) {
    promise
      .then(() => {
        toast({ title: success });
        setReason("");
      })
      .catch((e: unknown) => {
        toast({
          title: "Change not applied",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      });
  }

  if (!elationId) {
    return <p className="text-xs text-muted-foreground">Select a patient first.</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Portal access
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Account
                  </div>
                  <Badge variant={snapshot?.claimed ? "default" : "secondary"}>
                    {snapshot?.claimed ? "Claimed" : "Not claimed"}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Status
                  </div>
                  <Badge variant={suspended ? "destructive" : "default"}>
                    {suspended ? "Suspended" : "Active"}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Invite
                  </div>
                  <div className="text-sm">{snapshot?.inviteStatus ?? "none"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Invite sent
                  </div>
                  <div className="text-sm font-mono">{fmt(snapshot?.inviteSentAt)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Portal email
                  </div>
                  <div className="text-sm">{snapshot?.email ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Last change
                  </div>
                  <div className="text-sm font-mono">{fmt(access.updatedAt)}</div>
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Reason for change (audited)
                </label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Member requested portal access be paused"
                  rows={2}
                  disabled={!isAdmin}
                />
                {!isAdmin && (
                  <p className="text-xs text-muted-foreground">
                    View only — an administrator must make portal changes.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!isAdmin || busy}
                  onClick={() =>
                    guard() &&
                    run(
                      issueInvite.mutateAsync({
                        reason,
                        reissue: snapshot?.inviteStatus === "pending",
                      }),
                      snapshot?.inviteStatus === "pending"
                        ? "Invite re-sent"
                        : "Invite sent",
                    )
                  }
                >
                  {issueInvite.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Mail className="h-3.5 w-3.5 mr-1" />
                  )}
                  {snapshot?.inviteStatus === "pending" ? "Resend invite" : "Send invite"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isAdmin || busy || snapshot?.inviteStatus !== "pending"}
                  onClick={() =>
                    guard() && run(revokeInvite.mutateAsync({ reason }), "Invite revoked")
                  }
                >
                  <MailX className="h-3.5 w-3.5 mr-1" /> Revoke invite
                </Button>

                <Button
                  size="sm"
                  variant={suspended ? "default" : "destructive"}
                  disabled={!isAdmin || busy}
                  onClick={() =>
                    guard() &&
                    run(
                      setAccess.mutateAsync({
                        reason,
                        patch: { status: suspended ? "active" : "suspended" },
                      }),
                      suspended ? "Portal access restored" : "Portal access suspended",
                    )
                  }
                >
                  <ShieldOff className="h-3.5 w-3.5 mr-1" />
                  {suspended ? "Restore access" : "Suspend access"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Visible modules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {PORTAL_MODULES.map((m) => {
            const on = modules[m.key as PortalModule] !== false;
            return (
              <div key={m.key} className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                </div>
                <Switch
                  checked={on}
                  disabled={!isAdmin || busy || loading}
                  onCheckedChange={(next) => {
                    if (!guard()) return;
                    run(
                      setAccess.mutateAsync({
                        reason,
                        patch: { modules: { [m.key]: next } },
                      }),
                      `${m.label} ${next ? "shown" : "hidden"} in the portal`,
                    );
                  }}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <EyeOff className="h-4 w-4" /> Hidden individual items
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Hide a specific item
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select
                value={hideCollection}
                onValueChange={(v) => setHideCollection(v as PortalModule)}
                disabled={!isAdmin || busy}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>
                  {PORTAL_MODULES.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={hideId}
                onChange={(e) => setHideId(e.target.value)}
                placeholder="Item id"
                className="font-mono text-sm"
                disabled={!isAdmin || busy}
              />
              <Input
                value={hideLabel}
                onChange={(e) => setHideLabel(e.target.value)}
                placeholder="Label (optional)"
                className="text-sm"
                disabled={!isAdmin || busy}
              />
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={!isAdmin || busy || !hideId.trim()}
              onClick={() => {
                if (!guard()) return;
                run(
                  setAccess
                    .mutateAsync({
                      reason,
                      patch: {
                        hideItem: {
                          collection: hideCollection,
                          id: hideId.trim(),
                          label: hideLabel.trim() || undefined,
                        },
                      },
                    })
                    .then((r) => {
                      setHideId("");
                      setHideLabel("");
                      return r;
                    }),
                  "Item hidden from the member's portal",
                );
              }}
            >
              <EyeOff className="h-3.5 w-3.5 mr-1" /> Hide item
            </Button>
            <p className="text-xs text-muted-foreground">
              Use the item's id exactly as it appears in the portal. The member sees the
              rest of the section unchanged, and the item's document returns "not
              available".
            </p>
          </div>

          {hidden.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing is individually hidden.</p>
          ) : (

            <ul className="space-y-2">
              {hidden.map((h) => (
                <li
                  key={`${h.collection}:${h.id}`}
                  className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0"
                >
                  <div>
                    <div className="font-medium">{h.label ?? h.id}</div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {h.collection} · hidden {fmt(h.hiddenAt)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!isAdmin || busy}
                    onClick={() =>
                      guard() &&
                      run(
                        setAccess.mutateAsync({
                          reason,
                          patch: { unhideItem: { collection: h.collection, id: h.id } },
                        }),
                        "Item restored",
                      )
                    }
                  >
                    Unhide
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
