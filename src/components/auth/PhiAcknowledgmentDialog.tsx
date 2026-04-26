import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * PHI acknowledgment modal — only triggered on routes that touch PHI:
 * /pharmacy/*, /care/*, /insights/*, /patients/*. HR + Admin pages
 * never trigger it.
 */
const PHI_ROUTE_PREFIXES = ["/pharmacy", "/care", "/insights", "/patients"];

function isPhiRoute(pathname: string): boolean {
  return PHI_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default function PhiAcknowledgmentDialog() {
  const { user, phiAcknowledgedAt, refreshProfile, signOut } = useAuth();
  const location = useLocation();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const open = !!user && !phiAcknowledgedAt && isPhiRoute(location.pathname);

  async function handleAccept() {
    if (!user || !agreed) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("profiles")
      .update({ phi_acknowledged_at: new Date().toISOString() })
      .eq("user_id", user.id);
    setSubmitting(false);
    if (error) {
      toast.error("Could not record acknowledgment", { description: error.message });
      return;
    }
    await refreshProfile();
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
              <ShieldAlert className="size-5" />
            </div>
            <DialogTitle className="font-serif text-xl">
              Protected Health Information
            </DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-sm leading-relaxed">
            This area contains Protected Health Information under HIPAA.
            Access is restricted to authorized PrimeCare VIP staff and is
            logged for audit. Misuse, disclosure, or unauthorized sharing
            may result in disciplinary action and civil or criminal penalties.
          </DialogDescription>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
          <li>Every record you view is recorded with your identity, time, and resource.</li>
          <li>Do not download, screenshot, or share PHI outside approved workflows.</li>
          <li>Sessions automatically time out after 15 minutes of inactivity.</li>
          <li>Report any suspected unauthorized access immediately.</li>
        </ul>

        <label className="flex items-start gap-3 mt-2 cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            id="phi-ack"
          />
          <span className="text-sm text-foreground leading-snug">
            I acknowledge I am authorized to access PHI and I will comply with
            all applicable privacy and security policies.
          </span>
        </label>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
          <Button onClick={handleAccept} disabled={!agreed || submitting}>
            {submitting ? "Saving…" : "Acknowledge & continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
