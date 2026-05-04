import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import KPICard from "@/components/KPICard";
import RiskTable from "@/components/RiskTable";
import UtilizationGapsPanel from "@/components/UtilizationGapsPanel";
import ChronicRiskPanel from "@/components/ChronicRiskPanel";
import EngagementPanel from "@/components/EngagementPanel";
import CostSavingsPanel from "@/components/CostSavingsPanel";
import ClaimsPipeline from "@/components/ClaimsPipeline";
import MessagingAnalytics from "@/components/MessagingAnalytics";
import MedicationStats from "@/components/MedicationStats";
import HintSandbox from "@/components/HintSandbox";
import ElationStatusCard from "@/components/ElationStatusCard";
import LabOrders from "@/components/LabOrders";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "overview", label: "Executive Registry" },
  { id: "engagement", label: "Engagement & Utilization" },
  { id: "risk", label: "Utilization Gaps" },
  { id: "chronic", label: "Chronic Risk" },
  { id: "savings", label: "Cost Savings" },
  { id: "claims", label: "Claims Pipeline" },
  { id: "messaging", label: "Messaging" },
  { id: "medications", label: "Medications" },
  { id: "labs", label: "Lab Orders" },
  { id: "hint", label: "Hint Sandbox" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function InsightsHome() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <AppLayout title="Insights">
      <div className="space-y-6">
        <nav className="flex flex-wrap gap-1 bg-card border border-border rounded-full p-1 shadow-soft">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "overview" && (
          <>
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <KPICard label="Weighted HCC Risk" value="1.84" delta="+0.024 Δ" deltaType="negative" progress={84} progressColor="bg-destructive" />
              <KPICard label="Engagement Rate" value="64.8%" delta="Normal" deltaType="positive" progress={64.8} progressColor="bg-success" />
              <KPICard label="Annualized Savings" value="$3.55M" subtitle="Combined PrimeCare VIP + Hero" />
              <KPICard label="Claims Accuracy" value="99.1%" subtitle="14,102 claims processed" />
            </section>
            <RiskTable />
          </>
        )}

        {tab === "engagement" && <EngagementPanel />}
        {tab === "risk" && <UtilizationGapsPanel />}
        {tab === "chronic" && <ChronicRiskPanel />}
        {tab === "savings" && <CostSavingsPanel />}
        {tab === "claims" && <ClaimsPipeline />}
        {tab === "messaging" && <MessagingAnalytics />}
        {tab === "medications" && <MedicationStats />}
        {tab === "labs" && <LabOrders />}
        {tab === "hint" && (
          <>
            <ElationStatusCard />
            <HintSandbox />
          </>
        )}
      </div>
    </AppLayout>
  );
}
