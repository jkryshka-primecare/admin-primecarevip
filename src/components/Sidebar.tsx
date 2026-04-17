import { cn } from "@/lib/utils";
import logo from "@/assets/primecare-logo.jpg";

const navItems = [
  { label: "Executive Registry", id: "overview" },
  { label: "Engagement & Utilization", id: "engagement" },
  { label: "Risk Stratification", id: "risk" },
  { label: "Cost Savings", id: "savings" },
  { label: "Claims Pipeline", id: "claims" },
  { label: "Messaging Analytics", id: "messaging" },
  { label: "Medication Stats", id: "medications" },
  { label: "Hint Sandbox", id: "hint" },
];

interface SidebarProps {
  activeSection: string;
  onSectionChange: (id: string) => void;
}

const Sidebar = ({ activeSection, onSectionChange }: SidebarProps) => {
  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col shrink-0 border-r border-sidebar-border">
      <div className="p-6 border-b border-sidebar-border bg-white">
        <img src={logo} alt="Prime Care VIP" className="h-9 w-auto object-contain" />
      </div>

      <nav className="p-4 space-y-1 flex-1">
        <div className="text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-[0.18em] px-3 mb-3">
          Diagnostic Suites
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-all",
              activeSection === item.id
                ? "bg-pulse text-primary font-medium shadow-sm"
                : "text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <div
              className={cn(
                "size-1.5 rounded-full transition-colors",
                activeSection === item.id ? "bg-primary" : "bg-sidebar-foreground/30"
              )}
            />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-sidebar-accent">
          <div className="size-9 rounded-full bg-pulse flex items-center justify-center text-xs font-bold text-primary">
            AD
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">Admin User</p>
            <p className="text-[10px] text-sidebar-foreground/60 truncate uppercase tracking-wider">
              PrimeCare VIP
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
