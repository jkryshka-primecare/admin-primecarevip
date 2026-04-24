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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

type Props = {
  onInvited: () => void;
};

const INVITE_ROLES: AppRole[] = ["pending", "staff", "clinician", "admin"];

/**
 * Admin-only "Invite user" dialog. Calls the `admin-invite-user` edge function
 * which (1) verifies the caller is admin, (2) checks the email's domain is
 * allow-listed, (3) sends the Supabase invite email, and (4) assigns the
 * requested role so the new user lands with the correct access.
 */
export default function InviteUserDialog({ onInvited }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setDisplayName("");
    setRole("staff");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-invite-user", {
      body: {
        email: email.trim().toLowerCase(),
        role,
        display_name: displayName.trim() || undefined,
      },
    });
    setSubmitting(false);

    // The edge function returns { error } in the body even on non-2xx — the
    // supabase-js client surfaces that as `error` *and* still hands us `data`
    // on some failure modes. Prefer the body message when present.
    const bodyError = (data as { error?: string } | null)?.error;
    if (error || bodyError) {
      toast.error("Could not send invite", {
        description: bodyError ?? error?.message ?? "Unknown error",
      });
      return;
    }

    toast.success(`Invite sent to ${email}`, {
      description: `They'll get an email to set their password and land in as ${role}.`,
    });
    reset();
    setOpen(false);
    onInvited();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-3.5" />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Invite a new user</DialogTitle>
          <DialogDescription>
            They'll receive an email with a link to set their password.
            The email domain must be on the approved signup list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@primecarevip.com"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Display name (optional)</Label>
            <Input
              id="invite-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Initial role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as AppRole)}
              disabled={submitting}
            >
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITE_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-mono">staff</span> and{" "}
              <span className="font-mono">clinician</span> can view PHI dashboards.{" "}
              <span className="font-mono">admin</span> also gets user management.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
