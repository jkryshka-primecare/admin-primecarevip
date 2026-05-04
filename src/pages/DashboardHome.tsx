import AppLayout from "@/components/AppLayout";
import KPICard from "@/components/KPICard";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";
import { useAuth } from "@/hooks/useAuth";

export default function DashboardHome() {
  const { user, roles } = useAuth();
  const greeting = user?.email?.split("@")[0] ?? "there";

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-8">
        <section className="bg-card border border-border rounded-2xl shadow-card p-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground font-mono">
            PrimeCare OS · Master Admin
          </p>
          <h2 className="font-serif text-3xl text-foreground mt-2">
            Welcome back, {greeting}.
          </h2>
          <p className="text-sm text-muted-foreground mt-3 max-w-xl leading-relaxed">
            Use the sidebar to navigate to the modules you have access to. Each
            module is being built out in phases — the shell is in place, and
            content lands one section at a time.
          </p>
          {roles.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {roles.map((r) => (
                <span
                  key={r}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/10 text-accent border border-accent/20"
                >
                  {r.replace("_", " ")}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Link to="/admin" className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/40">
            <KPICard label="Modules Online" value="1 / 7" subtitle="Phase 1 · shell only" />
          </Link>
          <Link to="/admin" className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/40">
            <KPICard label="Pending Invites" value="—" subtitle="Manage in Admin" />
          </Link>
          <Link to="/admin" className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/40">
            <KPICard label="Audit Events (24h)" value="—" subtitle="Coming with module rollout" />
          </Link>
          <Link to="/admin" className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/40">
            <KPICard label="Backend" value="Healthy" subtitle="Lovable Cloud" />
          </Link>
        </section>

        <DashboardWidgets />
      </div>
    </AppLayout>
  );
}
