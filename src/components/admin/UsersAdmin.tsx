import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, ShieldAlert, RefreshCw, Search } from "lucide-react";
import InviteUserDialog from "./InviteUserDialog";

type ProfileRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  phi_acknowledged_at: string | null;
};

type UserRoleRow = {
  user_id: string;
  role: AppRole;
};

type UserRow = ProfileRow & { roles: AppRole[] };

const ROLE_OPTIONS: AppRole[] = ["pending", "staff", "clinician", "admin"];

const roleStyles: Record<AppRole, string> = {
  admin: "bg-destructive/10 text-destructive border-destructive/30",
  clinician: "bg-accent/15 text-accent border-accent/30",
  staff: "bg-success/15 text-success border-success/30",
  pending: "bg-muted text-muted-foreground border-border",
};

/**
 * Admin-only Users page. Reads all profiles + user_roles (RLS allows admins),
 * and lets admins promote/demote between pending / staff / clinician / admin
 * by inserting/deleting rows in user_roles. Roles are additive — assigning
 * a role replaces all other role rows for that user so each user holds
 * exactly one effective role at a time, matching how the UI presents it.
 */
export default function UsersAdmin() {
  const { user: me, roles: myRoles } = useAuth();
  const isAdmin = myRoles.includes("admin");

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, email, display_name, created_at, phi_acknowledged_at")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);

    if (pErr || rErr) {
      toast.error("Could not load users", {
        description: (pErr ?? rErr)?.message,
      });
      setLoading(false);
      return;
    }

    const rolesByUser = new Map<string, AppRole[]>();
    (roles as UserRoleRow[] | null)?.forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });

    const merged: UserRow[] = ((profiles as ProfileRow[] | null) ?? []).map(
      (p) => ({ ...p, roles: rolesByUser.get(p.user_id) ?? [] }),
    );
    setUsers(merged);
    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function setRole(userId: string, newRole: AppRole) {
    if (userId === me?.id && newRole !== "admin") {
      const ok = window.confirm(
        "You're about to remove your own admin role. You will lose access to this page immediately. Continue?",
      );
      if (!ok) return;
    }

    setSavingFor(userId);
    // Replace all existing roles with the single new role.
    const { error: delErr } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (delErr) {
      toast.error("Could not update role", { description: delErr.message });
      setSavingFor(null);
      return;
    }
    const { error: insErr } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, role: newRole });
    if (insErr) {
      toast.error("Could not assign new role", { description: insErr.message });
      setSavingFor(null);
      return;
    }
    toast.success(`Role updated to ${newRole}`);
    setSavingFor(null);
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.display_name?.toLowerCase().includes(q),
    );
  }, [users, search]);

  if (!isAdmin) {
    return (
      <div className="bg-card border border-border rounded-2xl p-10 text-center">
        <ShieldAlert className="size-8 text-destructive mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground">Admins only</h2>
        <p className="text-sm text-muted-foreground mt-2">
          You need the admin role to manage user access.
        </p>
      </div>
    );
  }

  const effectiveRole = (roles: AppRole[]): AppRole => {
    if (roles.includes("admin")) return "admin";
    if (roles.includes("clinician")) return "clinician";
    if (roles.includes("staff")) return "staff";
    return "pending";
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-serif text-xl text-foreground">User access</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider">
              {users.length} {users.length === 1 ? "account" : "accounts"} ·
              role changes are recorded in user_roles
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email or name…"
                className="pl-9 w-72"
              />
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin mr-2" />
            Loading users…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            No users match your search.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Current role</TableHead>
                  <TableHead>PHI acknowledged</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Set role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const current = effectiveRole(u.roles);
                  const isMe = u.user_id === me?.id;
                  const saving = savingFor === u.user_id;
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm text-foreground">
                            {u.display_name ?? "—"}
                            {isMe && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">
                            {u.email ?? "no email"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`uppercase text-[10px] tracking-wider ${roleStyles[current]}`}
                        >
                          {current}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.phi_acknowledged_at ? (
                          <span className="text-xs font-mono text-success">
                            {new Date(u.phi_acknowledged_at).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-mono text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {ROLE_OPTIONS.map((r) => {
                            const active = r === current;
                            return (
                              <Button
                                key={r}
                                size="sm"
                                variant={active ? "default" : "outline"}
                                disabled={saving || active}
                                onClick={() => setRole(u.user_id, r)}
                                className="h-7 px-2.5 text-[10px] uppercase tracking-wider"
                              >
                                {saving && !active ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  r
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg p-4 leading-relaxed">
        <strong className="text-foreground">Role meanings.</strong>{" "}
        <span className="font-mono">pending</span> — signed up, no PHI access.{" "}
        <span className="font-mono">staff</span> — can view PHI dashboards.{" "}
        <span className="font-mono">clinician</span> — same as staff (reserved for clinical separation).{" "}
        <span className="font-mono">admin</span> — full access plus this user-management page and the audit log.
      </div>
    </div>
  );
}
