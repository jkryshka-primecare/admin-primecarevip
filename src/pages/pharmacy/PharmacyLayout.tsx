import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, ArrowRightLeft, ClipboardList, ScanLine } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const sections = [
  { to: "/pharmacy", label: "Dashboard", icon: LayoutDashboard, description: "Overview, alerts, and pending billing" },
  { to: "/pharmacy/inventory", label: "Inventory", icon: Package, description: "Stock on hand, expiring lots, NDC lookup" },
  { to: "/pharmacy/dispense", label: "Dispense", icon: ArrowRightLeft, description: "Fill prescriptions and print labels" },
  { to: "/pharmacy/history", label: "History", icon: ClipboardList, description: "Dispensing history, reversals, and reports" },
  { to: "/pharmacy/scanner", label: "Scanner", icon: ScanLine, description: "Barcode / NDC scanner lookup" },
] as const;

export default function PharmacyLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const active =
    [...sections]
      .sort((a, b) => b.to.length - a.to.length)
      .find((t) =>
        t.to === "/pharmacy"
          ? location.pathname === "/pharmacy"
          : location.pathname.startsWith(t.to),
      ) ?? sections[0];

  return (
    <AppLayout title={`Primecare VIP RX · ${active.label}`}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Section
          </label>
          <Select value={active.to} onValueChange={(v) => navigate(v)}>
            <SelectTrigger className="w-full sm:w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.to} value={s.to}>
                  <span className="inline-flex items-center gap-2">
                    <s.icon className="h-3.5 w-3.5" />
                    {s.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider sm:ml-2">
            {active.description}
          </p>
        </div>

        <Outlet />
      </div>
    </AppLayout>
  );
}
