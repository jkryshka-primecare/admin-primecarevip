import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import KPICard from "@/components/KPICard";
import RiskTable from "@/components/RiskTable";
import EngagementPanel from "@/components/EngagementPanel";
import CostSavingsPanel from "@/components/CostSavingsPanel";
import ClaimsPipeline from "@/components/ClaimsPipeline";
import MessagingAnalytics from "@/components/MessagingAnalytics";
import MedicationStats from "@/components/MedicationStats";
import HintSandbox from "@/components/HintSandbox";
import ElationStatusCard from "@/components/ElationStatusCard";

const sectionTitles: Record<string, string> = {
  overview: "Executive Registry",
  engagement: "Engagement & Utilization",
  risk: "Risk Stratification (HCC)",
  savings: "Cost Savings Analysis",
  claims: "Claims Pipeline",
  messaging: "Messaging Analytics",
  medications: "Medication Statistics",
  hint: "Hint Health · Sandbox API",
};

const Index = () => {
  const [activeSection, setActiveSection] = useState("overview");

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <header className="h-16 border-b border-border flex items-center justify-between px-8 sticky top-0 bg-background/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-light tracking-tight text-foreground">
              {sectionTitles[activeSection]}
            </h1>
            <span className="px-3 py-1 rounded bg-cyan-clinical/10 text-cyan-clinical border border-cyan-clinical/20 text-[10px] font-bold tracking-widest uppercase">
              Live
            </span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Data Sources</span>
              <span className="text-sm font-mono text-cyan-clinical">Elation • Hint • Messaging</span>
            </div>
            <button className="px-6 py-3 bg-foreground text-background text-xs font-bold rounded hover:opacity-90 transition-opacity">
              Generate Report
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto space-y-8">
          {activeSection === "overview" && (
            <>
              <section className="grid grid-cols-4 gap-6">
                <KPICard label="Weighted HCC Risk" value="1.84" delta="+0.024 Δ" deltaType="negative" progress={84} progressColor="bg-hcc-alert" />
                <KPICard label="Engagement Rate" value="64.8%" delta="Normal" deltaType="positive" progress={64.8} progressColor="bg-cyan-clinical" />
                <KPICard label="Annualized Savings" value="$3.55M" subtitle="Combined PrimeCare VIP + Hero" />
                <KPICard label="Claims Accuracy" value="99.1%" subtitle="14,102 claims processed" />
              </section>
              <RiskTable />
            </>
          )}

          {activeSection === "engagement" && <EngagementPanel />}
          {activeSection === "risk" && <RiskTable />}
          {activeSection === "savings" && <CostSavingsPanel />}
          {activeSection === "claims" && <ClaimsPipeline />}
          {activeSection === "messaging" && <MessagingAnalytics />}
          {activeSection === "medications" && <MedicationStats />}
          {activeSection === "hint" && (
            <>
              <ElationStatusCard />
              <HintSandbox />
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
