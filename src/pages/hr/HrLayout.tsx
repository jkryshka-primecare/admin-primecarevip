import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Network,
  UserPlus,
  DollarSign,
  Calendar,
  Clock,
  Wallet,
  AlertTriangle,
  FileText,
  Bell,
  BarChart3,
  Star,
  Briefcase,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type Tab = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

const TABS: Tab[] = [
  { to: "/hr", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/hr/employees", label: "Employees", icon: Users },
  { to: "/hr/contractors", label: "Contractors", icon: Briefcase },
  { to: "/hr/org-chart", label: "Org Chart", icon: Network },
  { to: "/hr/onboarding", label: "Onboarding", icon: UserPlus },
  { to: "/hr/payroll", label: "Payroll", icon: DollarSign },
  { to: "/hr/time-off", label: "Time Off", icon: Calendar },
  { to: "/hr/attendance", label: "Attendance", icon: Clock },
  { to: "/hr/pto-balances", label: "PTO Balances", icon: Wallet },
  { to: "/hr/grievances", label: "Grievances", icon: AlertTriangle },
  { to: "/hr/documents", label: "Documents", icon: FileText },
  { to: "/hr/notifications", label: "Notifications", icon: Bell },
  { to: "/hr/performance", label: "Performance", icon: Star },
  { to: "/hr/reports", label: "Reports", icon: BarChart3 },
];

export default function HrLayout() {
  const location = useLocation();
  useAuth();

  return (
    <AppLayout title="HR">
      <div className="space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-border pb-px -mx-2 px-2">
          {TABS.map((tab) => {
            const active =
              tab.end
                ? location.pathname === tab.to
                : location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-xs font-semibold tracking-wide uppercase transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>

        <Outlet />
      </div>
    </AppLayout>
  );
}
