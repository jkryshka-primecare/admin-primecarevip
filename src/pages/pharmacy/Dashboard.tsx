import { Package, AlertTriangle, ArrowRightLeft, DollarSign, TrendingUp, Receipt } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/components/pharmacy/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  fetchMedications,
  selectLowStock,
  selectExpiring,
  MEDICATIONS_QUERY_KEY,
} from "@/lib/medications";
import { supabase } from "@/integrations/supabase/client";
import PrescriptionQueue from "@/components/pharmacy/PrescriptionQueue";
import PendingBillingPanel from "@/components/pharmacy/PendingBillingPanel";

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: medications = [] } = useQuery({
    queryKey: MEDICATIONS_QUERY_KEY,
    queryFn: fetchMedications,
  });

  // Today's dispense count from the database (so it survives reloads)
  const { data: dispensedToday = 0 } = useQuery({
    queryKey: ["dispenses", "today"],
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("dispense_records")
        .select("id", { count: "exact", head: true })
        .gte("dispensed_at", startOfDay.toISOString())
        .is("reversed_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Today's margin: sum of (unit_price - cost_per_unit) * quantity for non-reversed dispenses today.
  const { data: todayMarginData = { margin: 0, revenue: 0 } } = useQuery({
    queryKey: ["dispenses", "today", "margin"],
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data: rows, error } = await supabase
        .from("dispense_records")
        .select("unit_price,quantity,medication_id")
        .gte("dispensed_at", startOfDay.toISOString())
        .is("reversed_at", null);
      if (error) throw error;
      const records = (rows ?? []) as {
        unit_price: number | string | null;
        quantity: number;
        medication_id: string | null;
      }[];
      const medIds = Array.from(
        new Set(records.map((r) => r.medication_id).filter((id): id is string => !!id)),
      );
      const costs: Record<string, number> = {};
      if (medIds.length > 0) {
        const { data: meds, error: medErr } = await supabase
          .from("medications")
          .select("id,cost_per_unit")
          .in("id", medIds);
        if (medErr) throw medErr;
        for (const m of (meds ?? []) as { id: string; cost_per_unit: number | string | null }[]) {
          costs[m.id] = m.cost_per_unit != null ? Number(m.cost_per_unit) : 0;
        }
      }
      let margin = 0;
      let revenue = 0;
      for (const r of records) {
        if (r.unit_price == null) continue;
        revenue += Number(r.unit_price) * r.quantity;
        if (!r.medication_id) continue;
        const cost = costs[r.medication_id] ?? 0;
        margin += (Number(r.unit_price) - cost) * r.quantity;
      }
      return { margin, revenue };
    },
  });
  const todayMargin = todayMarginData.margin;
  const todayRevenue = todayMarginData.revenue;
  const marginPct = todayRevenue > 0 ? (todayMargin / todayRevenue) * 100 : null;

  const lowStock = selectLowStock(medications);
  const expiring = selectExpiring(medications);
  const totalCost = medications.reduce((s, m) => s + m.quantity * m.costPerUnit, 0);
  const totalRetail = medications.reduce((s, m) => s + m.quantity * m.dispensePricePerUnit, 0);
  const totalUnits = medications.reduce((s, m) => s + m.quantity, 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Overview of your pharmacy inventory
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div onClick={() => navigate("/inventory")} className="cursor-pointer transition-transform hover:scale-[1.02]">
          <StatCard title="Total Medications" value={medications.length} subtitle={`${totalUnits} units in stock`} icon={Package} variant="info" />
        </div>
        <div onClick={() => navigate("/inventory")} className="cursor-pointer transition-transform hover:scale-[1.02]">
          <StatCard title="Low Stock Alerts" value={lowStock.length} subtitle="Need reordering" icon={AlertTriangle} variant="warning" />
        </div>
        <div onClick={() => navigate("/history")} className="cursor-pointer transition-transform hover:scale-[1.02]">
          <StatCard title="Dispensed Today" value={dispensedToday} subtitle="Transactions" icon={ArrowRightLeft} variant="success" />
        </div>
        <div onClick={() => navigate("/history")} className="cursor-pointer transition-transform hover:scale-[1.02]">
          <StatCard
            title="Today's Revenue"
            value={`$${todayRevenue.toFixed(2)}`}
            subtitle="Gross sales today"
            icon={Receipt}
            variant="info"
          />
        </div>
        <div onClick={() => navigate("/history")} className="cursor-pointer transition-transform hover:scale-[1.02]">
          <StatCard
            title="Today's Margin"
            value={`${todayMargin >= 0 ? "+" : "−"}$${Math.abs(todayMargin).toFixed(2)}`}
            subtitle={marginPct != null ? `${marginPct.toFixed(1)}% of revenue` : "Profit on today's dispenses"}
            subtitleClassName={
              marginPct == null
                ? "text-xs text-muted-foreground"
                : marginPct < 10
                  ? "text-xs font-medium text-destructive"
                  : marginPct <= 30
                    ? "text-xs font-medium text-warning"
                    : "text-xs font-medium text-success"
            }
            icon={TrendingUp}
            variant={todayMargin >= 0 ? "success" : "warning"}
          />
        </div>
        <div onClick={() => navigate("/inventory")} className="cursor-pointer transition-transform hover:scale-[1.02]">
          <StatCard title="Inventory Value" value={`$${totalRetail.toFixed(2)}`} subtitle={`Cost: $${totalCost.toFixed(2)}`} icon={DollarSign} />
        </div>
      </div>

      <PrescriptionQueue onFillPrescription={(rx) => navigate("/dispense", { state: { prescription: rx } })} />

      <PendingBillingPanel />

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card className="animate-fade-in cursor-pointer transition-transform hover:scale-[1.01]" onClick={() => navigate("/inventory")}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Low Stock Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">All items are well-stocked.</p>
            ) : (
              <div className="space-y-3">
                {lowStock.map((med) => (
                  <div key={med.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{med.name}</p>
                      <p className="text-xs text-muted-foreground">{med.strength} · {med.dosageForm}</p>
                    </div>
                    <Badge variant={med.quantity <= med.reorderLevel / 2 ? "destructive" : "outline"}>
                      {med.quantity} left
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in cursor-pointer transition-transform hover:scale-[1.01]" onClick={() => navigate("/inventory")}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-info" />
              Expiring Soon (90 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground">No medications expiring soon.</p>
            ) : (
              <div className="space-y-3">
                {expiring.map((med) => (
                  <div key={med.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{med.name}</p>
                      <p className="text-xs text-muted-foreground">NDC: {med.ndcNumber}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{med.expiryDate}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
