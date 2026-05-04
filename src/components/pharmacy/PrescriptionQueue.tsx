import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Bell, Check, X, Loader2, Ban, Archive } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { z } from "zod";

export interface QueuedPrescription {
  id: string;
  elation_prescription_id: string | null;
  status: string;
  patient_name: string | null;
  patient_dob: string | null;
  patient_address: string | null;
  patient_phone: string | null;
  prescriber_name: string | null;
  prescriber_dea: string | null;
  prescriber_npi: string | null;
  prescriber_phone: string | null;
  medication_name: string | null;
  medication_strength: string | null;
  medication_ndc: string | null;
  medication_manufacturer: string | null;
  quantity: number | null;
  days_supply: number | null;
  directions: string | null;
  dea_schedule: string | null;
  refills_authorized: number | null;
  diagnosis_code: string | null;
  lot_number: string | null;
  date_written: string | null;
  note_to_pharmacy: string | null;
  created_at: string;
}

interface PrescriptionQueueProps {
  onFillPrescription: (rx: QueuedPrescription) => void;
}

const reasonSchema = z
  .string()
  .trim()
  .min(3, "Please enter at least 3 characters")
  .max(500, "Reason must be 500 characters or less");

export default function PrescriptionQueue({ onFillPrescription }: PrescriptionQueueProps) {
  const [queue, setQueue] = useState<QueuedPrescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [dnfTarget, setDnfTarget] = useState<QueuedPrescription | null>(null);
  const [dnfReason, setDnfReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchQueue = async () => {
    const { data, error } = await supabase
      .from("prescription_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch queue:", error);
    } else {
      setQueue((data as unknown as QueuedPrescription[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchQueue();

    const channel = supabase
      .channel("prescription_queue_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prescription_queue" },
        () => {
          fetchQueue();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateStatus = async (
    id: string,
    status: "dismissed" | "do_not_fill" | "archived",
    successMessage: string,
    reason?: string,
  ) => {
    const updatePayload: { status: string; status_reason?: string } = { status };
    if (reason !== undefined) updatePayload.status_reason = reason;

    const { data: updated, error } = await supabase
      .from("prescription_queue")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      toast.error("Failed to update prescription");
      return false;
    }

    // Audit log entry (HIPAA compliance) — especially important for Do Not Fill
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      user_id: auth.user?.id ?? null,
      action: `prescription_${status}`,
      table_name: "prescription_queue",
      record_id: id,
      new_data: {
        status,
        status_reason: reason ?? null,
        patient_name: updated?.patient_name ?? null,
        medication_name: updated?.medication_name ?? null,
        elation_prescription_id: updated?.elation_prescription_id ?? null,
      },
    });

    toast.info(successMessage);
    fetchQueue();
    return true;
  };

  const confirmDoNotFill = async () => {
    if (!dnfTarget) return;
    const parsed = reasonSchema.safeParse(dnfReason);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const ok = await updateStatus(
      dnfTarget.id,
      "do_not_fill",
      "Marked as do not fill",
      parsed.data,
    );
    setSubmitting(false);
    if (ok) {
      setDnfTarget(null);
      setDnfReason("");
    }
  };

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (queue.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-primary/30 bg-primary/5 animate-fade-in">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary animate-pulse" />
            Pending EMR Prescriptions
            <Badge variant="secondary" className="ml-auto">
              {queue.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.map((rx) => (
            <div
              key={rx.id}
              className="flex items-start justify-between gap-4 rounded-lg border bg-background p-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium text-sm truncate">
                  {rx.patient_name || "Unknown Patient"} —{" "}
                  {rx.medication_name || "Unknown Medication"}{" "}
                  {rx.medication_strength && `(${rx.medication_strength})`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Prescriber: {rx.prescriber_name || "N/A"} · Qty: {rx.quantity ?? "N/A"} ·
                  Refills: {rx.refills_authorized ?? 0}
                </p>
                {rx.directions && (
                  <p className="text-xs text-muted-foreground italic truncate">
                    Sig: {rx.directions}
                  </p>
                )}
              </div>
              <TooltipProvider delayDuration={200}>
                <div className="flex flex-wrap items-center gap-2 shrink-0 justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(rx.id, "dismissed", "Prescription dismissed")}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Dismiss
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Hide from queue (no action taken)</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setDnfTarget(rx);
                          setDnfReason("");
                        }}
                      >
                        <Ban className="h-3 w-3 mr-1" />
                        Do Not Fill
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refuse to fill — requires a documented reason</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(rx.id, "archived", "Prescription archived")}
                      >
                        <Archive className="h-3 w-3 mr-1" />
                        Archive
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move to archive for later reference</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" onClick={() => onFillPrescription(rx)}>
                        <Check className="h-3 w-3 mr-1" />
                        Fill
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Begin dispensing this prescription</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog
        open={!!dnfTarget}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setDnfTarget(null);
            setDnfReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Do Not Fill — Reason Required
            </DialogTitle>
            <DialogDescription>
              {dnfTarget && (
                <span className="block mb-1">
                  <strong>{dnfTarget.patient_name}</strong> —{" "}
                  {dnfTarget.medication_name}
                  {dnfTarget.medication_strength && ` (${dnfTarget.medication_strength})`}
                </span>
              )}
              For compliance, document why this prescription will not be filled.
              This will be recorded to the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dnf-reason">Reason</Label>
            <Textarea
              id="dnf-reason"
              value={dnfReason}
              onChange={(e) => setDnfReason(e.target.value)}
              placeholder="e.g., Patient already has active fill, drug interaction, prescriber clarification needed…"
              rows={4}
              maxLength={500}
              autoFocus
            />
            <p className="text-xs text-muted-foreground text-right">
              {dnfReason.length}/500
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDnfTarget(null);
                setDnfReason("");
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDoNotFill}
              disabled={submitting || dnfReason.trim().length < 3}
            >
              {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Confirm Do Not Fill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
