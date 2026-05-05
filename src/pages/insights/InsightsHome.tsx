import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import KPICard from "@/components/KPICard";
import RiskTable from "@/components/RiskTable";
import UtilizationGapsPanel from "@/components/UtilizationGapsPanel";
import ClaimsUtilizationPanel from "@/components/ClaimsUtilizationPanel";
import ChronicRiskPanel from "@/components/ChronicRiskPanel";
import EngagementPanel from "@/components/EngagementPanel";
import CostSavingsPanel from "@/components/CostSavingsPanel";
import ClaimsPipeline from "@/components/ClaimsPipeline";
import MessagingAnalytics from "@/components/MessagingAnalytics";
import MedicationStats from "@/components/MedicationStats";
import HintSandbox from "@/components/HintSandbox";
import ElationStatusCard from "@/components/ElationStatusCard";
import ElationLivePanel from "@/components/ElationLivePanel";
import LabOrders from "@/components/LabOrders";
import ElationOverviewKPIs from "@/components/elation-live/ElationOverviewKPIs";
import ElationLiveMedications from "@/components/elation-live/ElationLiveMedications";
import ElationLiveLabs from "@/components/elation-live/ElationLiveLabs";
import ElationLiveChronicRisk from "@/components/elation-live/ElationLiveChronicRisk";
import ElationLiveAppointments from "@/components/elation-live/ElationLiveAppointments";
import ElationLiveVitals from "@/components/elation-live/ElationLiveVitals";
import HintLiveEngagement from "@/components/hint-live/HintLiveEngagement";
import HintLiveCostSavings from "@/components/hint-live/HintLiveCostSavings";
import HintLiveClaimsPipeline from "@/components/hint-live/HintLiveClaimsPipeline";
import HintLiveMessaging from "@/components/hint-live/HintLiveMessaging";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "overview", label: "Executive Registry" },
  { id: "engagement", label: "Engagement & Utilization" },
  { id: "risk", label: "Utilization Gaps" },
  { id: "chronic", label: "Chronic Risk" },
  { id: "savings", label: "Cost Savings" },
  { id: "claims-util", label: "Claims Utilization" },
  { id: "claims", label: "Claims Pipeline" },
  { id: "messaging", label: "Messaging" },
  { id: "medications", label: "Medications" },
  { id: "labs", label: "Lab Orders" },
  { id: "elation", label: "Elation Live" },
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
            <ElationOverviewKPIs />
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <KPICard label="Weighted HCC Risk" value="1.84" delta="+0.024 Δ" deltaType="negative" progress={84} progressColor="bg-destructive" />
              <KPICard label="Engagement Rate" value="64.8%" delta="Normal" deltaType="positive" progress={64.8} progressColor="bg-success" />
              <KPICard label="Annualized Savings" value="$3.55M" subtitle="Combined PrimeCare VIP + Hero" />
              <KPICard label="Claims Accuracy" value="99.1%" subtitle="14,102 claims processed" />
            </section>
            <RiskTable />
            <ElationLiveAppointments limit={25} />
          </>
        )}

        {tab === "engagement" && (
          <>
            <HintLiveEngagement />
            <EngagementPanel />
          </>
        )}
        {tab === "risk" && (
          <>
            <ElationLiveAppointments limit={50} />
            <UtilizationGapsPanel />
          </>
        )}
        {tab === "chronic" && (
          <>
            <ElationLiveChronicRisk limit={100} />
            <ElationLiveVitals limit={50} />
            <ChronicRiskPanel />
          </>
        )}
        {tab === "savings" && (
          <>
            <HintLiveCostSavings />
            <CostSavingsPanel />
          </>
        )}
        {tab === "claims-util" && <ClaimsUtilizationPanel />}
        {tab === "claims" && (
          <>
            <HintLiveClaimsPipeline />
            <ClaimsPipeline />
          </>
        )}
        {tab === "messaging" && (
          <>
            <HintLiveMessaging />
            <MessagingAnalytics />
          </>
        )}
        {tab === "medications" && (
          <>
            <ElationLiveMedications limit={50} />
            <MedicationStats />
          </>
        )}
        {tab === "labs" && (
          <>
            <ElationLiveLabs limit={50} />
            <LabOrders />
          </>
        )}
        {tab === "elation" && (
          <>
            <ElationStatusCard />
            <ElationLivePanel />
          </>
        )}
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
