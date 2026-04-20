import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

type DomainRow = {
  id: string;
  domain: string;
  notes: string | null;
  created_at: string;
};

/**
 * Admin-only management for the email-domain allow-list that gates new
 * signups. The auth.users trigger reads from this table — adding/removing
 * a row immediately changes who can register an account.
 */
export default function AllowedDomainsAdmin() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");

  const [rows, setRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("allowed_signup_domains")
      .select("id, domain, notes, created_at")
      .order("domain");
    if (error) {
      toast.error("Could not load allowed domains", { description: error.message });
      setLoading(false);
      return;
    }
    setRows((data as DomainRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    const value = newDomain.trim().toLowerCase();
    if (!value || !value.includes(".")) {
      toast.error("Enter a valid domain like primecarevip.com");
      return;
    }
    setAdding(true);
    const { error } = await supabase
      .from("allowed_signup_domains")
      .insert({ domain: value, notes: newNotes.trim() || null });
    setAdding(false);
    if (error) {
      toast.error("Could not add domain", { description: error.message });
      return;
    }
    toast.success(`Added ${value}`);
    setNewDomain("");
    setNewNotes("");
    await load();
  }

  async function removeDomain(row: DomainRow) {
    const ok = window.confirm(
      `Remove "${row.domain}" from the signup allow-list?\n\nNew accounts using this domain will be rejected. Existing users keep their access.`,
    );
    if (!ok) return;
    setDeletingId(row.id);
    const { error } = await supabase
      .from("allowed_signup_domains")
      .delete()
      .eq("id", row.id);
    setDeletingId(null);
    if (error) {
      toast.error("Could not remove domain", { description: error.message });
      return;
    }
    toast.success(`Removed ${row.domain}`);
    await load();
  }

  if (!isAdmin) {
    return (
      <div className="bg-card border border-border rounded-2xl p-10 text-center">
        <ShieldAlert className="size-8 text-destructive mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground">Admins only</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Only administrators can manage the signup domain allow-list.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="size-10 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-xl text-foreground">Approved signup domains</h2>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              New accounts can only be created with an email address whose domain appears in this list.
              Enforcement runs as a database trigger on the auth users table — removing a domain takes
              effect immediately for new signups but never affects existing accounts.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        </div>

        <form onSubmit={addDomain} className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg bg-muted/40 border border-border">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Domain
            </label>
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="primecarevip.com"
              className="w-64 font-mono text-sm"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </label>
            <Input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="e.g. Clinical staff, contractor partner"
            />
          </div>
          <Button type="submit" disabled={adding || !newDomain.trim()}>
            {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add domain
          </Button>
        </form>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            Loading allow-list…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-sm text-destructive">
            No domains configured — every signup will be rejected. Add at least one domain above.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm text-foreground">
                      @{r.domain}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDomain(r)}
                        disabled={deletingId === r.id}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg p-4 leading-relaxed">
        <strong className="text-foreground">How rejection looks to users.</strong>{" "}
        A blocked signup attempt sees the message:
        {" "}
        <span className="font-mono text-foreground">
          "Sign-ups are restricted to approved Prime Care VIP email domains…"
        </span>
        {" "}— surfaced as a toast on the signup page.
      </div>
    </div>
  );
}
