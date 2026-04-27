import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";

const PORTAL_ROLES: AppRole[] = ["staff", "hr", "billing", "pharmacy", "clinical"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    user_id: string | null;
  };
}

/**
 * Sends a portal invitation for an HR employee record.
 * On signup, the auth.users trigger auto-links hr_employees.user_id by email.
 */
export default function InviteToPortalDialog({ open, onOpenChange, employee }: Props) {
  const [role, setRole] = useState<AppRole>("staff");
  const [submitting, setSubmitting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-invite-user", {
      body: {
        email: employee.email.trim().toLowerCase(),
        first_name: employee.first_name,
        last_name: employee.last_name,
        role,
      },
    });
    setSubmitting(false);

    const bodyError = (data as { error?: string } | null)?.error;
    if (error || bodyError) {
      toast.error("Could not create invite", {
        description: bodyError ?? error?.message ?? "Unknown error",
      });
      return;
    }

    const url = (data as { invite_url?: string } | null)?.invite_url ?? null;
    setInviteUrl(url);
    toast.success(`Invitation created for ${employee.email}`);
  }

  function copy() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  }

  function handleClose(o: boolean) {
    if (!o) {
      setInviteUrl(null);
      setRole("staff");
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Invite to Portal</DialogTitle>
          <DialogDescription>
            Send {employee.first_name} {employee.last_name} a sign-up link. Their account
            will auto-link to this employee record on first login.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">Invitation link:</p>
            <div className="flex gap-2">
              <Input value={inviteUrl} readOnly className="font-mono text-xs" />
              <Button type="button" onClick={copy}>
                <Copy className="size-3.5" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={employee.email} readOnly className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portal-role" className="text-xs">Portal Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)} disabled={submitting}>
                <SelectTrigger id="portal-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTAL_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-3.5 animate-spin" />} Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
