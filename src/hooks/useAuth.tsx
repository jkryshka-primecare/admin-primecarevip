import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "super_admin"
  | "admin"
  | "pharmacy"
  | "clinical"
  | "hr"
  | "billing"
  | "staff"
  | "pending";

/**
 * Roles that are allowed to view PHI dashboards (matches the server-side
 * is_staff() definition: super_admin, admin, clinical, pharmacy, billing).
 * HR and the generic "staff" role intentionally do NOT count here.
 */
const PHI_ROLES: AppRole[] = ["super_admin", "admin", "clinical", "pharmacy", "billing"];

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  isStaff: boolean;          // can hit PHI edge functions
  isAdmin: boolean;          // admin or super_admin
  isSuperAdmin: boolean;
  hasAnyRole: (allowed: AppRole[]) => boolean;
  phiAcknowledgedAt: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [phiAcknowledgedAt, setPhiAcknowledgedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string) {
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("phi_acknowledged_at").eq("user_id", uid).maybeSingle(),
    ]);
    setRoles((roleRows ?? []).map((r) => r.role as AppRole));
    setPhiAcknowledgedAt(profile?.phi_acknowledged_at ?? null);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => loadProfile(newSession.user.id), 0);
      } else {
        setRoles([]);
        setPhiAcknowledgedAt(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        loadProfile(existing.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const isAdmin = roles.includes("admin") || roles.includes("super_admin");
    const isSuperAdmin = roles.includes("super_admin");
    const isStaff = roles.some((r) => PHI_ROLES.includes(r));
    return {
      session,
      user,
      roles,
      isStaff,
      isAdmin,
      isSuperAdmin,
      hasAnyRole: (allowed) => roles.some((r) => allowed.includes(r)),
      phiAcknowledgedAt,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: async () => {
        if (user) await loadProfile(user.id);
      },
    };
  }, [session, user, roles, phiAcknowledgedAt, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
