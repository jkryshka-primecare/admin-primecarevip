import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type AppRole } from "@/hooks/useAuth";

type Props = {
  children: ReactNode;
  /**
   * If provided, only users with one of these roles may enter. Otherwise
   * any signed-in account is allowed (still subject to the "pending"
   * fallback screen below).
   */
  allowedRoles?: AppRole[];
};

/**
 * Route guard. Two layers:
 *  - Must be signed in (else redirect to /auth)
 *  - If allowedRoles is set, user must hold one of them (else "no access" screen)
 *  - If signed in but holds only the 'pending' role, show pending-approval screen
 */
export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, roles, hasAnyRole, loading } = useAuth();

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

  // Pending-only users see the same pending screen everywhere.
  const onlyPending = roles.length > 0 && roles.every((r) => r === "pending");
  if (onlyPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4 shadow-card">
          <h1 className="font-serif text-2xl text-foreground">Access pending approval</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your account was created but has not yet been authorized. An
            administrator must assign you a role before you can continue.
          </p>
          <div className="text-xs text-muted-foreground font-mono">
            Contact your PrimeCare VIP administrator.
          </div>
        </div>
      </div>
    );
  }

  if (allowedRoles && !hasAnyRole(allowedRoles)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4 shadow-card">
          <h1 className="font-serif text-2xl text-foreground">No access to this module</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You're signed in, but your role does not include access to this
            section of PrimeCare OS.
          </p>
          <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
            Required: {allowedRoles.join(" · ")}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
