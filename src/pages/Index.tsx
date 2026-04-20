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
import LabOrders from "@/components/LabOrders";
import UsersAdmin from "@/components/admin/UsersAdmin";
import PhiAuditLog from "@/components/admin/PhiAuditLog";
import ThemeToggle from "@/components/ThemeToggle";
import { LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { toast } from "sonner";

const sectionTitles: Record<string, string> = {
  overview: "Executive Registry",
  engagement: "Engagement & Utilization",
  risk: "Risk Stratification (HCC)",
  savings: "Cost Savings Analysis",
  claims: "Claims Pipeline",
  messaging: "Messaging Analytics",
  medications: "Medication Statistics",
  labs: "Laboratory Orders · Pipeline",
  hint: "Hint Health · Sandbox API",
  "admin-users": "Administration · Users",
};

const Index = () => {
  const [activeSection, setActiveSection] = useState("overview");
  const { user, signOut } = useAuth();

  // HIPAA-style 15-minute idle auto-logout for PHI workstations.
  useIdleTimeout(15 * 60 * 1000, async () => {
    toast.info("Signed out for inactivity (15 min).");
    await signOut();
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <header className="h-20 border-b border-border flex items-center justify-between px-10 sticky top-0 bg-background/85 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
              {sectionTitles[activeSection]}
            </h1>
            <span className="px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/20 text-[10px] font-semibold tracking-wider uppercase inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
              Live
            </span>
          </div>
          <div className="flex items-center gap-5">
            <div className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 text-[10px] font-semibold tracking-wider uppercase">
              <ShieldCheck className="size-3" />
              PHI · Logged
            </div>
            <div className="hidden lg:flex flex-col items-end">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Signed in</span>
              <span className="text-sm font-mono text-primary truncate max-w-[180px]" title={user?.email ?? ""}>
                {user?.email ?? ""}
              </span>
            </div>
            <ThemeToggle />
            <button
              onClick={() => signOut()}
              className="px-4 py-2.5 border border-border text-foreground text-xs font-semibold uppercase tracking-wider rounded-full hover:bg-muted transition-colors inline-flex items-center gap-2"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </header>

        <div className="p-10 max-w-7xl mx-auto space-y-8">
          {activeSection === "overview" && (
            <>
              <section className="grid grid-cols-4 gap-5">
                <KPICard label="Weighted HCC Risk" value="1.84" delta="+0.024 Δ" deltaType="negative" progress={84} progressColor="bg-destructive" />
                <KPICard label="Engagement Rate" value="64.8%" delta="Normal" deltaType="positive" progress={64.8} progressColor="bg-success" />
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
          {activeSection === "labs" && <LabOrders />}
          {activeSection === "hint" && (
            <>
              <ElationStatusCard />
              <HintSandbox />
            </>
          )}
          {activeSection === "admin-users" && <UsersAdmin />}
        </div>
      </main>
    </div>
  );
};

export default Index;
