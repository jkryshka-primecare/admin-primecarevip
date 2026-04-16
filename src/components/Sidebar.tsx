import { cn } from "@/lib/utils";

const navItems = [
  { label: "Executive Registry", id: "overview", active: true },
  { label: "Engagement & Utilization", id: "engagement" },
  { label: "Risk Stratification", id: "risk" },
  { label: "Cost Savings", id: "savings" },
  { label: "Claims Pipeline", id: "claims" },
  { label: "Messaging Analytics", id: "messaging" },
  { label: "Medication Stats", id: "medications" },
];

interface SidebarProps {
  activeSection: string;
  onSectionChange: (id: string) => void;
}

const Sidebar = ({ activeSection, onSectionChange }: SidebarProps) => {
  return (
    <aside className="w-64 titanium-border bg-slate-glass flex flex-col shrink-0">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="size-9 bg-sapphire rounded flex items-center justify-center font-mono text-sm font-bold tracking-tighter text-primary-foreground">
            P-VIP
          </div>
          <span className="font-medium tracking-tight text-lg text-foreground">PRIMECARE</span>
        </div>
      </div>

      <nav className="p-4 space-y-1 flex-1">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 mb-3">
          Diagnostic Suites
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-colors",
              activeSection === item.id
                ? "bg-sapphire/10 text-sapphire border border-sapphire/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <div
              className={cn(
                "size-2 rounded-full",
                activeSection === item.id ? "bg-sapphire" : "bg-muted"
              )}
            />
            <span className="text-sm font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 p-3 bg-secondary rounded border border-border">
          <div className="size-9 rounded-full bg-muted flex items-center justify-center border border-border text-xs font-mono text-muted-foreground">
            AD
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">Admin User</p>
            <p className="text-[10px] text-muted-foreground truncate uppercase tracking-tight">
              PrimeCare VIP
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
