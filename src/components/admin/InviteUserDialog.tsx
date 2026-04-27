import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

type Props = { onInvited: () => void };

const INVITE_ROLES: AppRole[] = [
  "pending", "staff", "hr", "billing", "pharmacy", "clinical", "admin", "super_admin",
];

/**
 * Admin "Invite user" dialog. Calls admin-invite-user which creates an
 * invitations row and (if email infra is configured) emails the link.
 * Always returns the link so admins can copy and share it manually.
 */
export default function InviteUserDialog({ onInvited }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [submitting, setSubmitting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  function reset() {
    setEmail(""); setFirstName(""); setLastName(""); setRole("staff"); setInviteUrl(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !firstName.trim() || !lastName.trim()) {
      toast.error("Email, first name, and last name are required");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-invite-user", {
      body: {
        email: email.trim().toLowerCase(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
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
    if (url) {
      try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    }
    toast.success(`Invitation sent to ${email}`, {
      description: url ? "Invite link copied to clipboard." : undefined,
    });
    onInvited();
    reset();
    setOpen(false);
  }

  function copy() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-3.5" /> Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Invite a new user</DialogTitle>
          <DialogDescription>
            Creates an invitation. Share the link or, once email is configured, it will be emailed automatically.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">Invitation link:</p>
            <div className="flex gap-2">
              <Input value={inviteUrl} readOnly className="font-mono text-xs" />
              <Button type="button" onClick={copy}><Copy className="size-3.5" /></Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { reset(); }}>Invite another</Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="invite-first">First name</Label>
                <Input id="invite-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required disabled={submitting} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-last">Last name</Label>
                <Input id="invite-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required disabled={submitting} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@primecarevip.com" disabled={submitting} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)} disabled={submitting}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-3.5 animate-spin" />} Create invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
