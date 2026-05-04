import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Undo2,
  CheckCircle2,
  Eye,
  Send,
  ExternalLink,
  UserCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MEDICATIONS_QUERY_KEY } from "@/lib/medications";
import HintPatientMatchDialog from "@/components/HintPatientMatchDialog";

interface DispenseBillingRow {
  id: string;
  patient_name: string;
  medication_name: string;
  medication_id: string | null;
  quantity: number;
  rx_number: string | null;
  dispensed_at: string;
  unit_price: number | string | null;
  total_cost: number | string | null;
  hint_charge_id: string | null;
  hint_patient_id: string | null;
  hint_billing_status: string | null;
  hint_billing_error: string | null;
  hint_billed_at: string | null;
}

const PENDING_BILLING_KEY = ["dispenses", "hint-billing-panel"];
const HINT_ADMIN_BASE = "https://app.staging.hint.com/admin";

async function fetchBillingRows(): Promise<DispenseBillingRow[]> {
  const { data, error } = await supabase
    .from("dispense_records")
    .select(
      "id,patient_name,medication_name,medication_id,quantity,rx_number,dispensed_at,unit_price,total_cost,hint_charge_id,hint_patient_id,hint_billing_status,hint_billing_error,hint_billed_at",
    )
    .is("reversed_at", null)
    .in("hint_billing_status", ["pending", "billed", "failed"])
    .order("dispensed_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as DispenseBillingRow[];
}

function formatCurrency(v: number | string | null) {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hintInvoiceUrl(row: DispenseBillingRow): string | null {
  if (row.hint_patient_id) {
    return `${HINT_ADMIN_BASE}/patients/${row.hint_patient_id}/invoices`;
  }
  return null;
}

export default function PendingBillingPanel() {
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [retractTarget, setRetractTarget] = useState<DispenseBillingRow | null>(null);
  const [retractReason, setRetractReason] = useState("");
  const [viewTarget, setViewTarget] = useState<DispenseBillingRow | null>(null);
  const [matchTarget, setMatchTarget] = useState<DispenseBillingRow | null>(null);
  const autoRetriedRef = useRef<Set<string>>(new Set());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: PENDING_BILLING_KEY,
    queryFn: fetchBillingRows,
    refetchInterval: 15000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: PENDING_BILLING_KEY });
    queryClient.invalidateQueries({ queryKey: MEDICATIONS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ["dispenses", "today"] });
    queryClient.invalidateQueries({ queryKey: ["dispenses", "today", "margin"] });
  };

  const billNow = async (
    record: DispenseBillingRow,
    opts?: { silent?: boolean; hintPatientIdOverride?: string },
  ) => {
    setActingId(record.id);
    try {
      const res = await supabase.functions.invoke("hint-create-charge", {
        body: {
          dispense_record_id: record.id,
          ...(opts?.hintPatientIdOverride
            ? { hint_patient_id_override: opts.hintPatientIdOverride }
            : {}),
        },
      });
      if (res.error) throw new Error(res.error.message);
      const result = res.data as {
        success?: boolean;
        charge_id?: string;
        error?: string;
        code?: string;
      };

      if (result?.success === false) {
        refresh();
        if (!opts?.silent) {
          toast.error(
            result.code === "patient_not_found"
              ? `${result.error}. Use "Match patient" to link a Hint patient manually.`
              : result.error ?? "Failed to bill to Hint",
          );
        }
        return false;
      }

      if (!opts?.silent) toast.success(`Pended in Hint — Charge ${result.charge_id ?? "ok"}`);
      refresh();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to bill to Hint";
      if (!opts?.silent) toast.error(message);
      return false;
    } finally {
      setActingId((cur) => (cur === record.id ? null : cur));
    }
  };

  const handleMatchSelected = async (hintPatientId: string) => {
    if (!matchTarget) return;
    const ok = await billNow(matchTarget, { hintPatientIdOverride: hintPatientId });
    if (ok) {
      setMatchTarget(null);
      setViewTarget(null);
    }
  };

  // Auto-retry stale pending rows (older than 30s, never billed) once per session.
  useEffect(() => {
    if (!rows.length) return;
    const now = Date.now();
    const stale = rows.filter(
      (r) =>
        r.hint_billing_status === "pending" &&
        !r.hint_charge_id &&
        !autoRetriedRef.current.has(r.id) &&
        now - new Date(r.dispensed_at).getTime() > 30_000,
    );
    if (!stale.length) return;
    stale.forEach((r) => autoRetriedRef.current.add(r.id));
    // Sequential to avoid hammering Hint
    (async () => {
      for (const r of stale) {
        await billNow(r, { silent: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const handleConfirmRetract = async () => {
    if (!retractTarget) return;
    if (retractReason.trim().length < 3) {
      toast.error("Please enter a reason (min 3 characters)");
      return;
    }
    setActingId(retractTarget.id);
    try {
      const res = await supabase.functions.invoke("hint-void-charge", {
        body: { dispense_record_id: retractTarget.id, reason: retractReason.trim() },
      });
      if (res.error) throw new Error(res.error.message);
      const result = res.data as { error?: string; stock_returned?: boolean };
      if (result?.error) throw new Error(result.error);
      toast.success(
        result?.stock_returned
          ? "Invoice retracted, dispense reversed, stock returned"
          : "Invoice retracted and dispense reversed",
      );
      setRetractTarget(null);
      setRetractReason("");
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to retract invoice";
      toast.error(message);
    } finally {
      setActingId(null);
    }
  };

  const statusBadge = (row: DispenseBillingRow) => {
    if (row.hint_billing_status === "billed") {
      return (
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="h-3 w-3 text-success" /> Pended in Hint
        </Badge>
      );
    }
    if (row.hint_billing_status === "failed") {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> Billing failed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Sending…
      </Badge>
    );
  };

  return (
    <>
      <Card className="animate-fade-in">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-info" />
            Hint Invoices
            {rows.length > 0 && (
              <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active dispenses to bill.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const isPending = r.hint_billing_status === "pending" && !r.hint_charge_id;
                const isFailed = r.hint_billing_status === "failed";
                const isBilled = r.hint_billing_status === "billed";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setViewTarget(r)}
                    className="w-full text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 px-3 rounded-md border bg-card hover:bg-accent/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{r.patient_name}</p>
                        {r.rx_number && (
                          <span className="text-xs text-muted-foreground">Rx #{r.rx_number}</span>
                        )}
                        {statusBadge(r)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.medication_name} · Qty {r.quantity} · {formatCurrency(r.total_cost)} · {formatDate(r.dispensed_at)}
                      </p>
                      {isFailed && r.hint_billing_error && (
                        <p className="text-xs text-destructive truncate mt-0.5" title={r.hint_billing_error}>
                          {r.hint_billing_error}
                        </p>
                      )}
                    </div>
                    <div
                      className="flex gap-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isPending && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => billNow(r)}
                          disabled={actingId === r.id}
                        >
                          {actingId === r.id ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
                          ) : (
                            <><Send className="h-3.5 w-3.5 mr-1" /> Bill now</>
                          )}
                        </Button>
                      )}
                      {isFailed && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => billNow(r)}
                          disabled={actingId === r.id}
                        >
                          {actingId === r.id ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Retrying…</>
                          ) : (
                            <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry</>
                          )}
                        </Button>
                      )}
                      {!isBilled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setMatchTarget(r)}
                          disabled={actingId === r.id}
                          title="Search Hint and link the correct patient"
                        >
                          <UserCheck className="h-3.5 w-3.5 mr-1" /> Match
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setViewTarget(r)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                      {isBilled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRetractTarget(r);
                            setRetractReason("");
                          }}
                          disabled={actingId === r.id}
                        >
                          <Undo2 className="h-3.5 w-3.5 mr-1" /> Retract
                        </Button>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* View details dialog */}
      <Dialog
        open={!!viewTarget}
        onOpenChange={(open) => {
          if (!open) setViewTarget(null);
        }}
      >
        <DialogContent>
          {viewTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-info" />
                  Invoice details
                </DialogTitle>
                <DialogDescription>
                  Hint billing record for this dispense.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">Patient</span>
                  <span className="col-span-2 font-medium">{viewTarget.patient_name}</span>

                  <span className="text-muted-foreground">Medication</span>
                  <span className="col-span-2">{viewTarget.medication_name}</span>

                  <span className="text-muted-foreground">Quantity</span>
                  <span className="col-span-2">{viewTarget.quantity}</span>

                  <span className="text-muted-foreground">Total</span>
                  <span className="col-span-2">{formatCurrency(viewTarget.total_cost)}</span>

                  {viewTarget.rx_number && (
                    <>
                      <span className="text-muted-foreground">Rx #</span>
                      <span className="col-span-2">{viewTarget.rx_number}</span>
                    </>
                  )}

                  <span className="text-muted-foreground">Dispensed</span>
                  <span className="col-span-2">{formatDate(viewTarget.dispensed_at)}</span>

                  <span className="text-muted-foreground">Status</span>
                  <span className="col-span-2">{statusBadge(viewTarget)}</span>

                  {viewTarget.hint_billed_at && (
                    <>
                      <span className="text-muted-foreground">Billed at</span>
                      <span className="col-span-2">{formatDate(viewTarget.hint_billed_at)}</span>
                    </>
                  )}

                  {viewTarget.hint_charge_id && (
                    <>
                      <span className="text-muted-foreground">Charge ID</span>
                      <span className="col-span-2 font-mono text-xs break-all">
                        {viewTarget.hint_charge_id}
                      </span>
                    </>
                  )}

                  {viewTarget.hint_patient_id && (
                    <>
                      <span className="text-muted-foreground">Hint patient</span>
                      <span className="col-span-2 font-mono text-xs break-all">
                        {viewTarget.hint_patient_id}
                      </span>
                    </>
                  )}
                </div>

                {viewTarget.hint_billing_error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    <p className="font-medium mb-1">Last error</p>
                    <p className="whitespace-pre-wrap break-words">{viewTarget.hint_billing_error}</p>
                  </div>
                )}
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                {hintInvoiceUrl(viewTarget) ? (
                  <Button asChild variant="default">
                    <a
                      href={hintInvoiceUrl(viewTarget)!}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open in Hint
                    </a>
                  </Button>
                ) : (
                  <Button variant="default" disabled title="Hint patient not linked yet">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open in Hint
                  </Button>
                )}
                {viewTarget.hint_billing_status !== "billed" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setMatchTarget(viewTarget)}
                      disabled={actingId === viewTarget.id}
                    >
                      <UserCheck className="h-3.5 w-3.5 mr-1" /> Match patient
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => billNow(viewTarget)}
                      disabled={actingId === viewTarget.id}
                    >
                      {actingId === viewTarget.id ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
                      ) : (
                        <><Send className="h-3.5 w-3.5 mr-1" /> Bill now</>
                      )}
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setViewTarget(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Retract dialog */}
      <Dialog
        open={!!retractTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRetractTarget(null);
            setRetractReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retract Hint invoice</DialogTitle>
            <DialogDescription>
              {retractTarget && (
                <>
                  This will <strong>void the pended Hint invoice</strong>, mark this dispense as
                  reversed, and <strong>return {retractTarget.quantity} unit(s) of {retractTarget.medication_name}</strong> to inventory.
                  This action is logged and cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="retract-reason">Reason (required)</Label>
            <Textarea
              id="retract-reason"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder="e.g. wrong patient, prescription cancelled, billing error"
              maxLength={500}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRetractTarget(null);
                setRetractReason("");
              }}
              disabled={!!actingId}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRetract}
              disabled={!!actingId || retractReason.trim().length < 3}
            >
              {actingId ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Retracting…</>
              ) : (
                <><Undo2 className="h-3.5 w-3.5 mr-1" /> Retract & Return Stock</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Hint patient match dialog */}
      <HintPatientMatchDialog
        open={!!matchTarget}
        onOpenChange={(open) => {
          if (!open) setMatchTarget(null);
        }}
        initialFirstName={matchTarget?.patient_name?.split(/\s+/)[0]}
        initialLastName={matchTarget?.patient_name?.split(/\s+/).slice(1).join(" ")}
        patientLabel={matchTarget?.patient_name}
        onSelect={handleMatchSelected}
        busy={!!actingId}
        selectLabel="Bill with this patient"
      />
    </>
  );
}
