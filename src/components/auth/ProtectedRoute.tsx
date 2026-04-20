import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/**
 * Route guard for PHI-bearing screens.
 * - Redirects to /auth if not signed in.
 * - Shows a "pending approval" notice if signed in but without staff role.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isStaff, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground font-mono">Verifying access…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <h1 className="font-serif text-2xl text-foreground">Access pending approval</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your account was created but has not yet been authorized to view
            protected health information. An administrator must promote your
            role before you can continue.
          </p>
          <div className="text-xs text-muted-foreground font-mono">
            Contact your Prime Care VIP administrator.
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
