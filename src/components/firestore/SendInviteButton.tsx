import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { usePortalMutations } from "@/hooks/usePortalAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  elationPatientId: string;
  name: string;
  email: string | null;
  onDone?: () => void;
};

/**
 * Per-member "Send invite" action for the membership roster.
 * The claim email is minted and sent by the portal control plane to the
 * address on the patient's roster record — the recipient can never be
 * overridden from here, so a wrong address must be fixed on the roster first.
 */
export default function SendInviteButton({ elationPatientId, name, email, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reissue, setReissue] = useState(false);
  const { issueInvite } = usePortalMutations(elationPatientId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) {
      toast.error("A short reason is required — it is written to the audit trail.");
      return;
    }
    try {
      await issueInvite.mutateAsync({ reason: reason.trim(), reissue });
      toast.success(`Invitation emailed to ${email ?? name}`);
      setOpen(false);
      setReason("");
      setReissue(false);
      onDone?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Could not send the invitation", {
        description: /already exists/i.test(message)
          ? "A live link already exists. Tick “Replace the existing link” and try again."
          : message,
      });
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px]"
        disabled={!email}
        title={email ? `Email a portal invite to ${email}` : "No email on the roster record"}
        onClick={() => setOpen(true)}
      >
        <Mail className="mr-1 h-3 w-3" />
        Invite
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Send portal invite</DialogTitle>
            <DialogDescription>
              {name} will receive a single-use claim link at{" "}
              <span className="font-mono">{email}</span>. The link expires in 30 days and the
              action is recorded in the portal audit trail.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-reason" className="text-xs">
                Reason
              </Label>
              <Input
                id="invite-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Member requested portal access by email"
                disabled={issueInvite.isPending}
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={reissue}
                onCheckedChange={(v) => setReissue(v === true)}
                disabled={issueInvite.isPending}
              />
              <span>
                Replace the existing link — revokes any live invitation so only the new link works.
              </span>
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={issueInvite.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={issueInvite.isPending}>
                {issueInvite.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
