import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import UsersAdmin from "@/components/admin/UsersAdmin";
import PhiAuditLog from "@/components/admin/PhiAuditLog";
import IntegrationsAdmin from "@/components/admin/IntegrationsAdmin";
import SeedDataPanel from "@/components/admin/SeedDataPanel";
import MemberBillingPanel from "@/components/firestore/MemberBillingPanel";
import MemberAppExplorer from "@/components/firestore/MemberAppExplorer";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "users", label: "Users & Invitations" },
  { id: "integrations", label: "Integrations" },
  { id: "member-billing", label: "Member Billing" },
  { id: "member-data", label: "Member App Data" },
  { id: "seed", label: "Data Seeding" },
  { id: "audit", label: "PHI Audit Log" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function AdminHome() {
  const [tab, setTab] = useState<TabId>("users");

  return (
    <AppLayout title="Administration">
      <div className="space-y-6">
        <nav className="flex flex-wrap gap-1 bg-card border border-border rounded-full p-1 shadow-soft w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "users" && <UsersAdmin />}
        {tab === "integrations" && <IntegrationsAdmin />}
        {tab === "member-billing" && <MemberBillingPanel />}
        {tab === "member-data" && <MemberAppExplorer />}
        {tab === "seed" && <SeedDataPanel />}
        {tab === "audit" && <PhiAuditLog />}
      </div>
    </AppLayout>
  );
}
