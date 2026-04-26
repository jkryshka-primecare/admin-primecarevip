import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ClipboardList, Package, RefreshCw, Activity } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";

const subTabs = [
  {
    to: "/pharmacy/dispense",
    label: "Dispense Queue",
    icon: ClipboardList,
    description: "Today's fills, ready-for-pickup, in-flight scripts",
  },
  {
    to: "/pharmacy/inventory",
    label: "Inventory",
    icon: Package,
    description: "Stock on hand, expiring lots, controlled-substance ledger",
  },
  {
    to: "/pharmacy/refills",
    label: "Refill Requests",
    icon: RefreshCw,
    description: "Pending refills, prescriber outreach, due-soon tracker",
  },
  {
    to: "/pharmacy/adherence",
    label: "Adherence",
    icon: Activity,
    description: "PDC scores, gap-in-care alerts, intervention queue",
  },
] as const;

export default function PharmacyLayout() {
  const location = useLocation();
  const active =
    subTabs.find((t) => location.pathname.startsWith(t.to)) ?? subTabs[0];

  return (
    <AppLayout title={`Pharmacy · ${active.label}`}>
      <div className="space-y-6">
        <nav
          aria-label="Pharmacy sections"
          className="flex flex-wrap gap-1 bg-card border border-border rounded-full p-1 shadow-soft w-fit"
        >
          {subTabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <t.icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>

        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          {active.description}
        </p>

        <Outlet />
      </div>
    </AppLayout>
  );
}
