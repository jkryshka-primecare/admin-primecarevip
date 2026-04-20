import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "clinician" | "staff" | "pending";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  isStaff: boolean;        // any of admin/clinician/staff
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
    // 1. Subscribe FIRST to avoid missing the initial event
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        // defer to avoid deadlock with onAuthStateChange callback
        setTimeout(() => loadProfile(newSession.user.id), 0);
      } else {
        setRoles([]);
        setPhiAcknowledgedAt(null);
      }
    });

    // 2. Then load existing session
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

  const isStaff = roles.some((r) => r === "admin" || r === "clinician" || r === "staff");

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        roles,
        isStaff,
        phiAcknowledgedAt,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
        refreshProfile: async () => {
          if (user) await loadProfile(user.id);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
