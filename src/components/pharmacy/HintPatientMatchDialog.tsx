import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, UserCheck, Send } from "lucide-react";

export interface HintPatientResult {
  id: string | null;
  head_member_id: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  membership_status: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial first name to seed the search (e.g. patient on the dispense). */
  initialFirstName?: string;
  /** Initial last name to seed the search. */
  initialLastName?: string;
  /** Patient label shown in header for context. */
  patientLabel?: string;
  /** Called after the user picks a patient. Passed the chosen Hint patient ID. */
  onSelect: (hintPatientId: string, patient: HintPatientResult) => void | Promise<void>;
  /** When true, disables the action button (e.g. while billing). */
  busy?: boolean;
  /** Label for the confirm button. Defaults to "Use this patient". */
  selectLabel?: string;
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export default function HintPatientMatchDialog({
  open,
  onOpenChange,
  initialFirstName,
  initialLastName,
  patientLabel,
  onSelect,
  busy,
  selectLabel = "Use this patient",
}: Props) {
  const [firstName, setFirstName] = useState(initialFirstName ?? "");
  const [lastName, setLastName] = useState(initialLastName ?? "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<HintPatientResult[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Reset / seed when dialog opens
  useEffect(() => {
    if (open) {
      const seedFirst = initialFirstName ?? "";
      const seedLast = initialLastName ?? "";
      setFirstName(seedFirst);
      setLastName(seedLast);
      setResults(null);
      setSelectedId(null);
      setHasSearched(false);
      // Auto-search if we have a seed
      if (seedFirst || seedLast) {
        runSearch(seedFirst, seedLast);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runSearch = async (first: string, last: string) => {
    if (!first.trim() && !last.trim()) {
      toast.error("Enter a first or last name to search");
      return;
    }
    setSearching(true);
    setResults(null);
    setSelectedId(null);
    setHasSearched(true);
    try {
      const res = await supabase.functions.invoke("hint-search-patients", {
        body: { first_name: first.trim() || undefined, last_name: last.trim() || undefined },
      });
      if (res.error) throw new Error(res.error.message);
      const data = res.data as { success?: boolean; patients?: HintPatientResult[]; error?: string };
      if (data?.error) throw new Error(data.error);
      setResults(data?.patients ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed";
      toast.error(msg);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedId || !results) return;
    const chosen = results.find((p) => String(p.head_member_id ?? p.id) === selectedId);
    if (!chosen) return;
    const billingId = String(chosen.head_member_id ?? chosen.id ?? "");
    if (!billingId) {
      toast.error("Selected patient is missing a Hint ID");
      return;
    }
    await onSelect(billingId, chosen);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-info" />
            Match Hint patient
          </DialogTitle>
          <DialogDescription>
            {patientLabel
              ? `Search the Hint sandbox to link the correct patient for ${patientLabel}.`
              : "Search the Hint sandbox to link the correct patient before billing."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div>
            <Label htmlFor="hint-first">First name</Label>
            <Input
              id="hint-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch(firstName, lastName);
              }}
            />
          </div>
          <div>
            <Label htmlFor="hint-last">Last name</Label>
            <Input
              id="hint-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch(firstName, lastName);
              }}
            />
          </div>
          <Button
            type="button"
            onClick={() => runSearch(firstName, lastName)}
            disabled={searching}
          >
            {searching ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Searching…</>
            ) : (
              <><Search className="h-4 w-4 mr-1" /> Search</>
            )}
          </Button>
        </div>

        <div className="max-h-[320px] overflow-y-auto rounded-md border">
          {searching ? (
            <div className="p-6 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching Hint sandbox…
            </div>
          ) : !hasSearched ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Enter a name and search the Hint sandbox.
            </div>
          ) : results && results.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No patients found. Try a different spelling or first/last name only.
            </div>
          ) : (
            <ul className="divide-y">
              {results?.map((p) => {
                const id = String(p.head_member_id ?? p.id ?? "");
                if (!id) return null;
                const isSelected = id === selectedId;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                        isSelected ? "bg-accent" : "hover:bg-accent/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {p.first_name ?? ""} {p.last_name ?? ""}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[
                            p.date_of_birth && `DOB ${p.date_of_birth}`,
                            p.email,
                            p.phone,
                            p.membership_status,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No additional info"}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          ID: {id}
                        </p>
                      </div>
                      {isSelected && <UserCheck className="h-4 w-4 text-success shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedId || busy}>
            {busy ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Working…</>
            ) : (
              <><Send className="h-4 w-4 mr-1" /> {selectLabel}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
