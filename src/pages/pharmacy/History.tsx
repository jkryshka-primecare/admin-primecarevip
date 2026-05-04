import { useState, useEffect, useCallback } from "react";
import { ClipboardList, RotateCcw, Eye, Search, Filter, X, Receipt, Loader2, Undo2, Printer, DollarSign, TrendingUp, Download } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { incrementStock, MEDICATIONS_QUERY_KEY } from "@/lib/medications";
import { useQueryClient } from "@tanstack/react-query";
import { MedicationLabel, type LabelData } from "@/components/pharmacy/MedicationLabel";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { formatPrice } from "@/lib/pharmacy/format";

interface DbDispenseRecord {
  id: string;
  medication_id: string | null;
  medication_name: string;
  patient_name: string;
  patient_dob: string | null;
  patient_address: string | null;
  patient_phone: string | null;
  rx_number: string | null;
  prescriber: string | null;
  prescriber_dea: string | null;
  prescriber_npi: string | null;
  prescriber_phone: string | null;
  date_written: string | null;
  quantity: number;
  days_supply: number | null;
  directions: string | null;
  dea_schedule: string | null;
  lot_number: string | null;
  refills_authorized: number | null;
  refill_number: number | null;
  dispensed_by: string | null;
  pharmacist_license: string | null;
  notes: string | null;
  diagnosis_code: string | null;
  dispensed_at: string;
  hint_charge_id: string | null;
  hint_billed_at: string | null;
  hint_billing_status: string | null;
  hint_billing_error: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  unit_price: number | string | null;
  total_cost: number | string | null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-right max-w-[60%]">{value || "—"}</span>
    </div>
  );
}

export default function History() {
  const { user, profile, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const canReverse = hasRole("admin") || hasRole("pharmacist");

  const [records, setRecords] = useState<DbDispenseRecord[]>([]);
  const [costMap, setCostMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DbDispenseRecord | null>(null);
  const [showLabel, setShowLabel] = useState(false);
  const [labelData, setLabelData] = useState<LabelData | null>(null);
  const [billingId, setBillingId] = useState<string | null>(null);
  const [todayRevenue, setTodayRevenue] = useState<number>(0);
  const [todayMargin, setTodayMargin] = useState<number>(0);
  const [todayCount, setTodayCount] = useState<number>(0);
  const [trend, setTrend] = useState<{ day: string; label: string; revenue: number; margin: number }[]>([]);

  // Reversal dialog state
  const [reverseTarget, setReverseTarget] = useState<DbDispenseRecord | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversing, setReversing] = useState(false);

  // Search & filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [filterField, setFilterField] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "reversed">("active");

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("dispense_records")
      .select("*")
      .order("dispensed_at", { ascending: false });

    if (statusFilter === "active") query = query.is("reversed_at", null);
    if (statusFilter === "reversed") query = query.not("reversed_at", "is", null);

    if (dateFrom) {
      query = query.gte("dispensed_at", new Date(dateFrom).toISOString());
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.lte("dispensed_at", end.toISOString());
    }

    if (searchTerm.trim()) {
      const term = `%${searchTerm.trim()}%`;
      if (filterField === "patient") {
        query = query.ilike("patient_name", term);
      } else if (filterField === "medication") {
        query = query.ilike("medication_name", term);
      } else if (filterField === "rx") {
        query = query.ilike("rx_number", term);
      } else if (filterField === "prescriber") {
        query = query.ilike("prescriber", term);
      } else {
        query = query.or(
          `patient_name.ilike.${term},medication_name.ilike.${term},rx_number.ilike.${term},prescriber.ilike.${term}`
        );
      }
    }

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to load history");
    } else {
      const recs = (data as DbDispenseRecord[]) || [];
      setRecords(recs);
      // Fetch cost_per_unit for medications referenced by these records.
      // medication_id is stored as text — filter to valid UUIDs only since
      // legacy seed data may contain non-UUID values like "1" / "3".
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = Array.from(
        new Set(
          recs
            .map((r) => r.medication_id)
            .filter((v): v is string => !!v && UUID_RE.test(v)),
        ),
      );
      if (ids.length > 0) {
        const { data: meds, error: medsErr } = await supabase
          .from("medications")
          .select("id,cost_per_unit")
          .in("id", ids);
        if (!medsErr && meds) {
          const map: Record<string, number> = {};
          for (const m of meds as { id: string; cost_per_unit: number | string | null }[]) {
            map[m.id] = m.cost_per_unit != null ? Number(m.cost_per_unit) : 0;
          }
          setCostMap(map);
        }
      } else {
        setCostMap({});
      }
    }
    setLoading(false);
  }, [searchTerm, filterField, dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const fetchTodayRevenue = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const { data, error } = await supabase
      .from("dispense_records")
      .select("total_cost,unit_price,quantity,medication_id")
      .is("reversed_at", null)
      .gte("dispensed_at", start.toISOString())
      .lte("dispensed_at", end.toISOString());
    if (error) {
      console.error("Failed to load today's revenue", error);
      return;
    }
    const rows = (data ?? []) as {
      total_cost: number | string | null;
      unit_price: number | string | null;
      quantity: number;
      medication_id: string | null;
    }[];
    const sum = rows.reduce((acc, r) => acc + (r.total_cost != null ? Number(r.total_cost) : 0), 0);
    setTodayRevenue(sum);
    setTodayCount(rows.length);

    // Compute today's margin: (unit_price - cost_per_unit) * quantity per row.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = Array.from(
      new Set(
        rows
          .map((r) => r.medication_id)
          .filter((v): v is string => !!v && UUID_RE.test(v)),
      ),
    );
    const costs: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: meds, error: medsErr } = await supabase
        .from("medications")
        .select("id,cost_per_unit")
        .in("id", ids);
      if (!medsErr && meds) {
        for (const m of meds as { id: string; cost_per_unit: number | string | null }[]) {
          costs[m.id] = m.cost_per_unit != null ? Number(m.cost_per_unit) : 0;
        }
      }
    }
    const margin = rows.reduce((acc, r) => {
      if (r.unit_price == null || !r.medication_id) return acc;
      const cost = costs[r.medication_id];
      if (cost == null) return acc;
      return acc + (Number(r.unit_price) - cost) * r.quantity;
    }, 0);
    setTodayMargin(margin);
  }, []);

  const fetchTrend = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6); // include today => 7 days
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("dispense_records")
      .select("dispensed_at,total_cost,unit_price,quantity,medication_id")
      .is("reversed_at", null)
      .gte("dispensed_at", start.toISOString())
      .lte("dispensed_at", end.toISOString());

    if (error) {
      console.error("Failed to load revenue trend", error);
      return;
    }

    type Row = {
      dispensed_at: string;
      total_cost: number | string | null;
      unit_price: number | string | null;
      quantity: number;
      medication_id: string | null;
    };
    const rows = (data ?? []) as Row[];

    // Look up cost_per_unit for medications referenced in the window.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = Array.from(
      new Set(
        rows
          .map((r) => r.medication_id)
          .filter((v): v is string => !!v && UUID_RE.test(v)),
      ),
    );
    const costs: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: meds, error: medsErr } = await supabase
        .from("medications")
        .select("id,cost_per_unit")
        .in("id", ids);
      if (!medsErr && meds) {
        for (const m of meds as { id: string; cost_per_unit: number | string | null }[]) {
          costs[m.id] = m.cost_per_unit != null ? Number(m.cost_per_unit) : 0;
        }
      }
    }

    // Build 7 day buckets keyed by local YYYY-MM-DD
    const buckets = new Map<string, { label: string; revenue: number; margin: number }>();
    const fmtKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fmtLabel = (d: Date) =>
      d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      buckets.set(fmtKey(d), { label: fmtLabel(d), revenue: 0, margin: 0 });
    }

    for (const r of rows) {
      const d = new Date(r.dispensed_at);
      const key = fmtKey(d);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.revenue += r.total_cost != null ? Number(r.total_cost) : 0;
      if (r.unit_price != null && r.medication_id && costs[r.medication_id] != null) {
        bucket.margin += (Number(r.unit_price) - costs[r.medication_id]) * r.quantity;
      }
    }

    setTrend(
      Array.from(buckets.entries()).map(([day, v]) => ({
        day,
        label: v.label,
        revenue: v.revenue,
        margin: v.margin,
      })),
    );
  }, []);

  useEffect(() => {
    fetchTodayRevenue();
    fetchTrend();
  }, [fetchTodayRevenue, fetchTrend, records]);

  const openReverseDialog = (record: DbDispenseRecord, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (record.reversed_at) {
      toast.info("This dispense was already reversed");
      return;
    }
    if (!canReverse) {
      toast.error("Only pharmacists or admins can reverse a dispense");
      return;
    }
    setReversalReason("");
    setReverseTarget(record);
  };

  const handleConfirmReverse = async () => {
    if (!reverseTarget) return;
    const reason = reversalReason.trim();
    if (!reason) {
      toast.error("Please provide a reason for the reversal");
      return;
    }
    if (!user) {
      toast.error("You must be signed in");
      return;
    }
    setReversing(true);
    try {
      const reversedBy = profile?.display_name || user.email || user.id;
      const reversedAt = new Date().toISOString();

      // 1. Mark record reversed (preserve the original record for the audit trail)
      const { data: updated, error: updateErr } = await supabase
        .from("dispense_records")
        .update({
          reversed_at: reversedAt,
          reversed_by: reversedBy,
          reversal_reason: reason,
        })
        .eq("id", reverseTarget.id)
        .is("reversed_at", null) // guard against double reversal
        .select()
        .single();

      if (updateErr) throw updateErr;
      if (!updated) throw new Error("Record could not be reversed (may already be reversed)");

      // 2. Restore inventory in the database
      let inventoryRestored = false;
      if (reverseTarget.medication_id) {
        try {
          const restored = await incrementStock(
            reverseTarget.medication_id,
            reverseTarget.quantity,
          );
          inventoryRestored = restored !== null;
        } catch (e) {
          console.error("Inventory restore failed:", e);
        }
      }

      // 3. HIPAA audit log entry
      const newDataPayload = {
        ...(updated as Record<string, unknown>),
        reversal_reason: reason,
        reversed_by: reversedBy,
        inventory_restored: inventoryRestored,
        quantity_returned: reverseTarget.quantity,
      };
      const { error: auditErr } = await supabase.from("audit_log").insert([
        {
          user_id: user.id,
          action: "dispense_reversed",
          table_name: "dispense_records",
          record_id: reverseTarget.id,
          old_data: reverseTarget as unknown as Json,
          new_data: newDataPayload as unknown as Json,
        },
      ]);
      if (auditErr) {
        console.error("Audit log insert failed:", auditErr);
      }

      toast.success(
        `Reversed ${reverseTarget.quantity} × ${reverseTarget.medication_name}` +
          (inventoryRestored ? " — inventory restored" : ""),
      );
      setReverseTarget(null);
      setSelected(null);
      fetchRecords();
      queryClient.invalidateQueries({ queryKey: MEDICATIONS_QUERY_KEY });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reverse dispense";
      toast.error(message);
    } finally {
      setReversing(false);
    }
  };

  const handlePrintLabel = async (r: DbDispenseRecord) => {
    // HIPAA traceability: log every label reprint (user, record id, timestamp auto via created_at)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("audit_log").insert({
        user_id: user?.id ?? null,
        action: "REPRINT_LABEL",
        table_name: "dispense_records",
        record_id: r.id,
        new_data: {
          rx_number: r.rx_number,
          patient_name: r.patient_name,
          medication_name: r.medication_name,
          reprinted_by_email: user?.email ?? null,
          reprinted_at: new Date().toISOString(),
        } as Json,
      });
    } catch (err) {
      console.error("Failed to log reprint to audit log", err);
    }

    setLabelData({
      patientName: r.patient_name,
      rxNumber: r.rx_number || "",
      medicationName: r.medication_name,
      strength: "",
      quantity: r.quantity,
      directions: r.directions || "",
      prescriber: r.prescriber || "",
      dispensedBy: r.dispensed_by || "",
      dispensedDate: r.dispensed_at,
      lotNumber: r.lot_number || "",
      refillNumber: r.refill_number || 0,
      refillsAuthorized: r.refills_authorized || 0,
      expiryDate: "",
      manufacturer: "",
    });
    setShowLabel(true);
  };

  const handleBillToHint = async (record: DbDispenseRecord) => {
    if (record.hint_charge_id) {
      toast.info("Already billed to Hint");
      return;
    }
    setBillingId(record.id);
    try {
      const res = await supabase.functions.invoke("hint-create-charge", {
        body: { dispense_record_id: record.id },
      });
      if (res.error) throw new Error(res.error.message || "Billing failed");
      const result = res.data as { success?: boolean; charge_id?: string; error?: string; code?: string };
      if (result?.success === false) {
        toast.error(
          result.code === "patient_not_found"
            ? `${result.error}. Add this patient to the Hint sandbox, then retry.`
            : result.error ?? "Billing failed",
        );
        fetchRecords();
        return;
      }
      toast.success(`Billed to Hint — Charge ID: ${result.charge_id}`);
      if (selected?.id === record.id) {
        setSelected({ ...selected, hint_charge_id: result.charge_id, hint_billed_at: new Date().toISOString() });
      }
      fetchRecords();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to bill to Hint";
      toast.error(message);
    } finally {
      setBillingId(null);
    }
  };

  const clearFilters = () => {
    setSearchTerm("");
    setFilterField("all");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("active");
  };

  const hasFilters =
    searchTerm || dateFrom || dateTo || filterField !== "all" || statusFilter !== "active";

  const csvEscape = (val: unknown): string => {
    if (val == null) return "";
    const s = String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportCsv = () => {
    if (records.length === 0) {
      toast.info("No records to export");
      return;
    }
    const headers = [
      "Dispensed At", "Rx Number", "Patient Name", "Patient DOB", "Patient Phone",
      "Medication", "Quantity", "Unit Price", "Total Cost", "Margin",
      "Days Supply", "Directions", "DEA Schedule", "Lot Number",
      "Refill Number", "Refills Authorized",
      "Prescriber", "Prescriber NPI", "Prescriber DEA", "Prescriber Phone",
      "Date Written", "Diagnosis Code",
      "Dispensed By", "Pharmacist License", "Notes",
      "Hint Charge ID", "Hint Billed At",
      "Reversed At", "Reversed By", "Reversal Reason",
    ];
    const rows = records.map((r) => {
      const unit = r.unit_price != null ? Number(r.unit_price) : null;
      const cost = r.medication_id ? costMap[r.medication_id] : undefined;
      const margin = unit != null && cost != null ? (unit - cost) * r.quantity : null;
      return [
        r.dispensed_at,
        r.rx_number, r.patient_name, r.patient_dob, r.patient_phone,
        r.medication_name, r.quantity,
        r.unit_price != null ? formatPrice(Number(r.unit_price)) : "",
        r.total_cost != null ? formatPrice(Number(r.total_cost)) : "",
        margin != null ? formatPrice(margin) : "",
        r.days_supply, r.directions, r.dea_schedule, r.lot_number,
        r.refill_number, r.refills_authorized,
        r.prescriber, r.prescriber_npi, r.prescriber_dea, r.prescriber_phone,
        r.date_written, r.diagnosis_code,
        r.dispensed_by, r.pharmacist_license, r.notes,
        r.hint_charge_id, r.hint_billed_at,
        r.reversed_at, r.reversed_by, r.reversal_reason,
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `dispense-history-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${records.length} record${records.length === 1 ? "" : "s"} to CSV`);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dispensing History</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Search, filter, and review all dispensed medication records.
        </p>
      </div>

      {/* Today's Revenue + Today's Margin + 7-day Trend */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="animate-fade-in">
          <CardContent className="pt-5 pb-5 flex items-center justify-between gap-4 h-full">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2.5">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Today's Revenue
                </p>
                <p className="text-2xl font-bold tracking-tight">
                  ${formatPrice(todayRevenue)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Active dispenses</p>
              <p className="text-lg font-semibold">{todayCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardContent className="pt-5 pb-3 h-full flex flex-col">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="flex items-center gap-3">
                <div
                  className={`rounded-md p-2.5 ${
                    todayMargin >= 0 ? "bg-success/15" : "bg-destructive/15"
                  }`}
                >
                  <TrendingUp
                    className={`h-5 w-5 ${
                      todayMargin >= 0 ? "text-success" : "text-destructive"
                    }`}
                  />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Today's Margin
                  </p>
                  <p
                    className={`text-2xl font-bold tracking-tight ${
                      todayMargin >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {todayMargin >= 0 ? "+" : "−"}${formatPrice(Math.abs(todayMargin))}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Of revenue</p>
                <p className="text-lg font-semibold">
                  {todayRevenue > 0
                    ? `${((todayMargin / todayRevenue) * 100).toFixed(1)}%`
                    : "—"}
                </p>
              </div>
            </div>
            <div className="h-14 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="marginFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" hide />
                  <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                  <RTooltip
                    cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                      padding: "4px 8px",
                    }}
                    formatter={(v: number) => {
                      const n = Number(v);
                      const sign = n >= 0 ? "+" : "−";
                      return [`${sign}$${formatPrice(Math.abs(n))}`, "Margin"];
                    }}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
                  />
                  <Area
                    type="monotone"
                    dataKey="margin"
                    stroke="hsl(var(--success))"
                    strokeWidth={2}
                    fill="url(#marginFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardContent className="pt-5 pb-3 h-full flex flex-col">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2.5">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    7-Day Revenue
                  </p>
                  <p className="text-2xl font-bold tracking-tight">
                    ${formatPrice(trend.reduce((acc, d) => acc + d.revenue, 0))}
                  </p>
                </div>
              </div>
            </div>
            <div className="h-14 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" hide />
                  <YAxis hide domain={[0, "dataMax + 1"]} />
                  <RTooltip
                    cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                      padding: "4px 8px",
                    }}
                    formatter={(v: number) => [`$${formatPrice(Number(v))}`, "Revenue"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#revFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="flex-1 min-w-[180px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search records..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterField} onValueChange={setFilterField}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Filter by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Fields</SelectItem>
                <SelectItem value="patient">Patient Name</SelectItem>
                <SelectItem value="medication">Medication</SelectItem>
                <SelectItem value="rx">Rx Number</SelectItem>
                <SelectItem value="prescriber">Prescriber</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="reversed">Reversed only</SelectItem>
                <SelectItem value="all">All records</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full sm:w-[150px]"
              placeholder="From"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full sm:w-[150px]"
              placeholder="To"
            />
            {hasFilters && (
              <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear filters">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Records
            {records.length > 0 && (
              <Badge variant="secondary" className="ml-1">{records.length}</Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={loading || records.length === 0}
            title="Export current results to CSV"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{hasFilters ? "No records match your search." : "No dispensing records yet."}</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medication</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Unit Price</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Total</TableHead>
                    <TableHead className="hidden sm:table-cell">Dispensed By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Hint</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => {
                    const isReversed = !!r.reversed_at;
                    return (
                      <TableRow
                        key={r.id}
                        className={`cursor-pointer hover:bg-accent/50 ${isReversed ? "opacity-60" : ""}`}
                        onClick={() => setSelected(r)}
                      >
                        <TableCell className={`font-medium text-sm ${isReversed ? "line-through" : ""}`}>
                          {r.medication_name}
                        </TableCell>
                        <TableCell className="text-sm">{r.patient_name}</TableCell>
                        <TableCell className="text-right text-sm">{r.quantity}</TableCell>
                        <TableCell className="text-right text-sm hidden md:table-cell">
                          {r.unit_price != null ? `$${formatPrice(Number(r.unit_price))}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium hidden md:table-cell">
                          {r.total_cost != null ? `$${formatPrice(Number(r.total_cost))}` : "—"}
                          {(() => {
                            const unit = r.unit_price != null ? Number(r.unit_price) : null;
                            const cost = r.medication_id ? costMap[r.medication_id] : undefined;
                            if (unit == null || cost == null) return null;
                            const margin = (unit - cost) * r.quantity;
                            const positive = margin >= 0;
                            return (
                              <div className="mt-1 flex justify-end">
                                <Badge
                                  variant="outline"
                                  className={
                                    positive
                                      ? "border-transparent bg-success/15 text-success hover:bg-success/15"
                                      : "border-transparent bg-destructive/15 text-destructive hover:bg-destructive/15"
                                  }
                                  title={`Margin: (unit $${formatPrice(unit)} − cost $${formatPrice(cost)}) × ${r.quantity}`}
                                >
                                  {positive ? "+" : "−"}${formatPrice(Math.abs(margin))}
                                </Badge>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-sm hidden sm:table-cell">{r.dispensed_by || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.dispensed_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {isReversed ? (
                            <Badge variant="destructive" className="text-xs">Reversed</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {(() => {
                            const status = (r.hint_billing_status || "pending").toLowerCase();
                            const map: Record<string, { label: string; cls: string; title?: string }> = {
                              billed: {
                                label: "Billed",
                                cls: "border-transparent bg-success/15 text-success hover:bg-success/15",
                                title: r.hint_billed_at ? `Billed ${new Date(r.hint_billed_at).toLocaleString()}` : "Pended in Hint",
                              },
                              pending: {
                                label: "Pending",
                                cls: "border-transparent bg-muted text-muted-foreground hover:bg-muted",
                                title: "Awaiting Hint billing",
                              },
                              failed: {
                                label: "Failed",
                                cls: "border-transparent bg-destructive/15 text-destructive hover:bg-destructive/15",
                                title: r.hint_billing_error || "Hint billing failed",
                              },
                              voided: {
                                label: "Voided",
                                cls: "border-transparent bg-warning/15 text-warning hover:bg-warning/15",
                                title: "Hint invoice voided",
                              },
                            };
                            const cfg = map[status] ?? map.pending;
                            return (
                              <Badge variant="outline" className={`text-xs ${cfg.cls}`} title={cfg.title}>
                                {cfg.label}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <TooltipProvider>
                            <div className="flex items-center justify-end gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label="View details"
                                    onClick={(e) => { e.stopPropagation(); setSelected(r); }}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>View Details</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label="Reprint Label"
                                    onClick={(e) => { e.stopPropagation(); handlePrintLabel(r); }}
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reprint Label</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive disabled:opacity-30"
                                      aria-label={
                                        isReversed
                                          ? "Already reversed"
                                          : canReverse
                                            ? "Reverse / Restock"
                                            : "Only pharmacists or admins can reverse"
                                      }
                                      disabled={isReversed || !canReverse}
                                      onClick={(e) => openReverseDialog(r, e)}
                                    >
                                      <Undo2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isReversed
                                    ? "Already Reversed"
                                    : canReverse
                                      ? "Reverse / Restock"
                                      : "Only pharmacists or admins can reverse"}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              Dispense Record
              {selected?.reversed_at && (
                <Badge variant="destructive" className="text-xs">Reversed</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Patient</h4>
                <DetailRow label="Name" value={selected.patient_name} />
                <DetailRow label="DOB" value={selected.patient_dob || ""} />
                <DetailRow label="Address" value={selected.patient_address || ""} />
                <DetailRow label="Phone" value={selected.patient_phone || ""} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Prescription</h4>
                <DetailRow label="Rx #" value={selected.rx_number || ""} />
                <DetailRow label="Date Written" value={selected.date_written || ""} />
                <DetailRow label="DEA Schedule" value={selected.dea_schedule || ""} />
                <DetailRow label="ICD-10 Code" value={selected.diagnosis_code || ""} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Medication</h4>
                <DetailRow label="Medication" value={selected.medication_name} />
                <DetailRow label="Quantity" value={String(selected.quantity)} />
                <DetailRow label="Days Supply" value={String(selected.days_supply || "")} />
                <DetailRow label="Directions (Sig)" value={selected.directions || ""} />
                <DetailRow label="Lot #" value={selected.lot_number || ""} />
                <DetailRow label="Refills" value={`${selected.refill_number || 0} of ${selected.refills_authorized || 0}`} />
                <DetailRow
                  label="Unit Price"
                  value={selected.unit_price != null ? `$${formatPrice(Number(selected.unit_price))}` : ""}
                />
                <DetailRow
                  label="Total Cost"
                  value={selected.total_cost != null ? `$${formatPrice(Number(selected.total_cost))}` : ""}
                />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Prescriber</h4>
                <DetailRow label="Name" value={selected.prescriber || ""} />
                <DetailRow label="DEA #" value={selected.prescriber_dea || ""} />
                <DetailRow label="NPI #" value={selected.prescriber_npi || ""} />
                <DetailRow label="Phone" value={selected.prescriber_phone || ""} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Dispensing</h4>
                <DetailRow label="Dispensed By" value={selected.dispensed_by || ""} />
                <DetailRow label="License #" value={selected.pharmacist_license || ""} />
                <DetailRow label="Date" value={new Date(selected.dispensed_at).toLocaleString()} />
                <DetailRow label="Notes" value={selected.notes || ""} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Billing</h4>
                <DetailRow label="Hint Status" value={selected.hint_charge_id ? "Billed" : "Not billed"} />
                {selected.hint_charge_id && (
                  <DetailRow label="Hint Charge ID" value={selected.hint_charge_id} />
                )}
                {selected.hint_billed_at && (
                  <DetailRow label="Billed At" value={new Date(selected.hint_billed_at).toLocaleString()} />
                )}
              </div>
              {selected.reversed_at && (
                <div>
                  <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider mb-1">Reversal</h4>
                  <DetailRow label="Reversed At" value={new Date(selected.reversed_at).toLocaleString()} />
                  <DetailRow label="Reversed By" value={selected.reversed_by || ""} />
                  <DetailRow label="Reason" value={selected.reversal_reason || ""} />
                </div>
              )}
              <div className="flex gap-2 pt-2 flex-wrap">
                <Button
                  variant={selected.hint_charge_id ? "secondary" : "default"}
                  size="sm"
                  className="flex-1 min-w-[120px]"
                  disabled={!!selected.hint_charge_id || billingId === selected.id || !!selected.reversed_at}
                  onClick={() => handleBillToHint(selected)}
                >
                  {billingId === selected.id ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Billing…</>
                  ) : selected.hint_charge_id ? (
                    <><Receipt className="h-3.5 w-3.5 mr-1" /> Billed</>
                  ) : (
                    <><Receipt className="h-3.5 w-3.5 mr-1" /> Bill to Hint</>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1 min-w-[140px]"
                  disabled={!!selected.reversed_at || !canReverse}
                  onClick={() => openReverseDialog(selected)}
                  title={
                    selected.reversed_at
                      ? "Already reversed"
                      : !canReverse
                        ? "Only pharmacists or admins can reverse"
                        : "Reverse this dispense and restock"
                  }
                >
                  <Undo2 className="h-3.5 w-3.5 mr-1" />
                  {selected.reversed_at ? "Reversed" : "Reverse / Restock"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reversal Confirmation Dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={(open) => !open && !reversing && setReverseTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-destructive" />
              Reverse Dispense
            </DialogTitle>
            <DialogDescription>
              This action returns the medication to inventory and is permanently logged
              for HIPAA compliance. The original dispense record is preserved and marked as reversed.
            </DialogDescription>
          </DialogHeader>
          {reverseTarget && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div><span className="text-muted-foreground">Medication:</span> <span className="font-medium">{reverseTarget.medication_name}</span></div>
                <div><span className="text-muted-foreground">Patient:</span> <span className="font-medium">{reverseTarget.patient_name}</span></div>
                <div><span className="text-muted-foreground">Quantity to restock:</span> <span className="font-medium">{reverseTarget.quantity}</span></div>
                <div><span className="text-muted-foreground">Rx #:</span> <span className="font-medium">{reverseTarget.rx_number || "—"}</span></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reversal-reason">
                  Reason for reversal <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reversal-reason"
                  placeholder="e.g. Wrong medication dispensed, patient refused pickup, dispensing error…"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  rows={3}
                  disabled={reversing}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)} disabled={reversing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReverse}
              disabled={reversing || !reversalReason.trim()}
            >
              {reversing ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Reversing…</>
              ) : (
                <><Undo2 className="h-4 w-4 mr-1" /> Confirm Reversal</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showLabel && labelData && (
        <MedicationLabel data={labelData} onClose={() => setShowLabel(false)} />
      )}
    </div>
  );
}
