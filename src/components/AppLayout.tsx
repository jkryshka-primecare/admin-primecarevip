import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Pill,
  HeartPulse,
  Users2,
  BarChart3,
  UserSquare2,
  Settings,
  LogOut,
  ShieldCheck,
  Calculator,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import logo from "@/assets/primecare-logo.jpg";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import ThemeToggle from "@/components/ThemeToggle";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ModuleItem = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  /** Roles allowed to see this entry. Empty array = all signed-in users. */
  roles: AppRole[];
};

const MODULES: ModuleItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: [] },
  { title: "Pharmacy", url: "/pharmacy", icon: Pill, roles: ["super_admin", "admin", "pharmacy"] },
  { title: "Care Connect", url: "/care", icon: HeartPulse, roles: ["super_admin", "admin", "clinical", "billing"] },
  { title: "HR", url: "/hr", icon: Users2, roles: ["super_admin", "admin", "hr", "billing"] },
  { title: "Insights", url: "/insights", icon: BarChart3, roles: ["super_admin", "admin", "clinical"] },
  { title: "Patients", url: "/patients", icon: UserSquare2, roles: ["super_admin", "admin", "pharmacy", "clinical"] },
  { title: "Cost Estimator", url: "/estimator", icon: Calculator, roles: ["super_admin", "admin", "pharmacy", "clinical", "billing"] },
  { title: "Admin", url: "/admin", icon: Settings, roles: ["super_admin", "admin"] },
];

function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { roles, hasAnyRole, user, signOut } = useAuth();

  const visible = MODULES.filter((m) => m.roles.length === 0 || hasAnyRole(m.roles));

  const isActive = (url: string) => {
    if (url === "/") return location.pathname === "/";
    return location.pathname === url || location.pathname.startsWith(`${url}/`);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border bg-white p-3">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <img
            src={logo}
            alt="PrimeCare OS"
            className={cn("object-contain", collapsed ? "h-8 w-8" : "h-9 w-auto")}
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-serif text-sm text-primary">PrimeCare OS</span>
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">
                Master Admin
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Modules</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((m) => (
                <SidebarMenuItem key={m.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(m.url)}
                    tooltip={collapsed ? m.title : undefined}
                  >
                    <NavLink to={m.url} end={m.url === "/"}>
                      <m.icon className="h-4 w-4" />
                      <span>{m.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-sidebar-foreground/60 truncate">
            {user?.email ?? ""}
          </div>
        )}
        {!collapsed && roles.length > 0 && (
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {roles.map((r) => (
              <span
                key={r}
                className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sidebar-accent text-sidebar-accent-foreground"
              >
                {r.replace("_", " ")}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={() => signOut()}
          className={cn(
            "mx-2 mb-2 flex items-center gap-2 rounded-md px-2 py-2 text-xs text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            collapsed && "justify-center",
          )}
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

export default function AppLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { signOut, user } = useAuth();

  // HIPAA-style 15-minute idle auto-logout.
  useIdleTimeout(15 * 60 * 1000, async () => {
    toast.info("Signed out for inactivity (15 min).");
    await signOut();
  });

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border px-4 sticky top-0 bg-background/85 backdrop-blur-md z-10">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger />
              <h1 className="font-serif text-lg text-foreground truncate">{title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 text-[10px] font-semibold tracking-wider uppercase">
                <ShieldCheck className="size-3" />
                PHI · Logged
              </div>
              <span
                className="hidden lg:inline text-xs font-mono text-muted-foreground truncate max-w-[200px]"
                title={user?.email ?? ""}
              >
                {user?.email ?? ""}
              </span>
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <div className="p-6 lg:p-10 max-w-7xl mx-auto">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
