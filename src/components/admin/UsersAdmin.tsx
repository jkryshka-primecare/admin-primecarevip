import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, ShieldAlert, RefreshCw, Search, Copy, X } from "lucide-react";
import InviteUserDialog from "./InviteUserDialog";

type ProfileRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  phi_acknowledged_at: string | null;
};
type UserRoleRow = { user_id: string; role: AppRole };
type UserRow = ProfileRow & { roles: AppRole[] };

type InvitationRow = {
  id: string;
  token: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AppRole;
  status: string;
  created_at: string;
};

const ROLE_OPTIONS: AppRole[] = [
  "pending", "staff", "hr", "billing", "pharmacy", "clinical", "admin", "super_admin",
];

const PRIVILEGED_ROLES: AppRole[] = ["admin", "super_admin"];


const roleStyles: Record<AppRole, string> = {
  super_admin: "bg-destructive/10 text-destructive border-destructive/30",
  admin: "bg-destructive/10 text-destructive border-destructive/30",
  pharmacy: "bg-accent/15 text-accent border-accent/30",
  clinical: "bg-accent/15 text-accent border-accent/30",
  hr: "bg-warning/15 text-warning border-warning/30",
  billing: "bg-warning/15 text-warning border-warning/30",
  staff: "bg-success/15 text-success border-success/30",
  pending: "bg-muted text-muted-foreground border-border",
};

function effectiveRole(roles: AppRole[]): AppRole {
  const order: AppRole[] = ["super_admin", "admin", "clinical", "pharmacy", "billing", "hr", "staff", "pending"];
  for (const r of order) if (roles.includes(r)) return r;
  return "pending";
}

export default function UsersAdmin() {
  const { user: me, isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingGrant, setPendingGrant] = useState<{ userId: string; role: AppRole } | null>(null);
  const [reason, setReason] = useState("");


  async function load() {
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }, { data: inv, error: iErr }] =
      await Promise.all([
        supabase.from("profiles").select("user_id, email, display_name, created_at, phi_acknowledged_at").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("invitations").select("id, token, email, first_name, last_name, role, status, created_at").order("created_at", { ascending: false }),
      ]);

    if (pErr || rErr || iErr) {
      toast.error("Could not load users", { description: (pErr ?? rErr ?? iErr)?.message });
      setLoading(false);
      return;
    }

    const rolesByUser = new Map<string, AppRole[]>();
    (roles as UserRoleRow[] | null)?.forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });

    setUsers(((profiles as ProfileRow[] | null) ?? []).map((p) => ({
      ...p, roles: rolesByUser.get(p.user_id) ?? [],
    })));
    setInvites((inv as InvitationRow[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  async function setRole(userId: string, newRole: AppRole, reason?: string) {
    if (userId === me?.id) {
      toast.error("You cannot change your own role", {
        description: "Self-mutation is blocked. Ask another super admin.",
      });
      return;
    }
    if (PRIVILEGED_ROLES.includes(newRole) && !reason?.trim()) {
      toast.error("A reason is required when granting a privileged role");
      return;
    }
    setSavingFor(userId);
    const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (delErr) { toast.error("Could not update role", { description: delErr.message }); setSavingFor(null); return; }
    const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (insErr) { toast.error("Could not assign new role", { description: insErr.message }); setSavingFor(null); return; }
    toast.success(`Role updated to ${newRole}`);
    setSavingFor(null);
    await load();
  }

  function requestRole(userId: string, newRole: AppRole) {
    if (PRIVILEGED_ROLES.includes(newRole)) {
      setPendingGrant({ userId, role: newRole });
      setReason("");
      return;
    }
    void setRole(userId, newRole);
  }


  async function revokeInvite(id: string) {
    const { error } = await supabase.from("invitations").delete().eq("id", id);
    if (error) { toast.error("Could not revoke", { description: error.message }); return; }
    toast.success("Invitation revoked");
    await load();
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/auth?invite=${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email?.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q));
  }, [users, search]);

  const pendingInvites = invites.filter((i) => i.status === "pending");

  if (!isAdmin) {
    return (
      <div className="bg-card border border-border rounded-2xl p-10 text-center">
        <ShieldAlert className="size-8 text-destructive mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground">Admins only</h2>
        <p className="text-sm text-muted-foreground mt-2">You need an admin role to manage users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-serif text-xl text-foreground">User access</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider">
              {users.length} {users.length === 1 ? "account" : "accounts"} · invite-only signups
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-9 w-72" />
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
              Refresh
            </Button>
            <InviteUserDialog onInvited={load} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin mr-2" /> Loading users…
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>PHI ack</TableHead>
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
                            {isMe && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">(you)</span>}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">{u.email ?? "no email"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`uppercase text-[10px] tracking-wider ${roleStyles[current]}`}>
                          {current.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.phi_acknowledged_at
                          ? <span className="text-xs font-mono text-success">{new Date(u.phi_acknowledged_at).toLocaleDateString()}</span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-mono text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Select value={current} onValueChange={(v) => requestRole(u.user_id, v as AppRole)} disabled={saving || isMe}>
                          <SelectTrigger className="h-8 w-36 ml-auto text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r} className="capitalize text-xs">
                                {r.replace("_", " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {pendingInvites.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
          <h3 className="font-serif text-lg text-foreground mb-4">
            Pending invitations ({pendingInvites.length})
          </h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-sm font-mono">{i.email}</TableCell>
                    <TableCell className="text-sm">{i.first_name} {i.last_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase text-[10px] tracking-wider ${roleStyles[i.role]}`}>
                        {i.role.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => copyInviteLink(i.token)} className="mr-2">
                        <Copy className="size-3" /> Copy link
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => revokeInvite(i.id)}>
                        <X className="size-3" /> Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
