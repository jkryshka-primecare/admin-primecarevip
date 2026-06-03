import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Loader2, ClipboardPaste, ListPlus, PencilLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProviders, useSpecialties } from "@/hooks/useEstimatorDb";
import {
  useManualPricing,
  parsePastedRows,
  type ManualPricingRow,
} from "@/hooks/useManualPricing";

interface InitialState {
  providerId?: string;
  cptCode?: string;
  serviceName?: string;
  lockCpt?: boolean;
}

interface ManualPricingFormProps {
  initial?: InitialState;
  onDone?: () => void;
  /** Hide internal header (used when embedded in another dialog tab). */
  embedded?: boolean;
}

const COMPONENTS = ["cash", "gross", "negotiated", "min", "max"];

function emptyRow(initial?: InitialState): ManualPricingRow {
  return {
    cptCode: initial?.cptCode ?? "",
    serviceName: initial?.serviceName ?? "",
    component: "cash",
    price: "",
  };
}

export function ManualPricingForm({ initial, onDone, embedded }: ManualPricingFormProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: providers = [] } = useProviders("all");
  const { data: specialties = [] } = useSpecialties();
  const submit = useManualPricing();

  // Provider section
  const [providerId, setProviderId] = useState<string>(initial?.providerId ?? "");
  const [providerName, setProviderName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState("");
  const [fax, setFax] = useState("");
  const [categories, setCategories] = useState<string[]>([]);

  // Mode
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");

  // Rows
  const [rows, setRows] = useState<ManualPricingRow[]>([emptyRow(initial)]);

  // Hydrate fields when an existing provider is chosen
  useEffect(() => {
    if (!providerId) {
      setProviderName("");
      setAddress("");
      setCity("");
      setState("");
      setZip("");
      setPhone("");
      setFax("");
      setCategories([]);
      return;
    }
    const p = providers.find((pr) => pr.id === providerId);
    if (p) {
      setProviderName(p.name ?? "");
      setAddress((p as any).address ?? "");
      setCity(p.city ?? "");
      setState(p.state ?? "");
      setZip((p as any).zip ?? "");
      setPhone(p.phone ?? "");
      setFax((p as any).fax ?? "");
      const cats: string[] = (p as any).categories ?? [];
      setCategories(
        cats.length > 0 ? cats : p.specialty_id ? [p.specialty_id] : []
      );
    }
  }, [providerId, providers]);

  const updateRow = (i: number, patch: Partial<ManualPricingRow>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)));

  const validRowCount = useMemo(() => {
    const source = pasteMode ? parsePastedRows(pasted) : rows;
    return source.filter((r) => {
      const cpt = r.cptCode.trim();
      const price = parseFloat(r.price);
      return cpt.length > 0 && !isNaN(price) && price > 0;
    }).length;
  }, [rows, pasted, pasteMode]);

  const handleSubmit = async () => {
    if (!providerName.trim()) {
      toast({
        title: "Provider name required",
        description: "Enter a provider name to save.",
        variant: "destructive",
      });
      return;
    }

    const rowsToSend = pasteMode ? parsePastedRows(pasted) : rows;

    try {
      const result = await submit.mutateAsync({
        providerId: providerId || null,
        providerName,
        address,
        city,
        state,
        zip,
        phone,
        fax,
        categories,
        rows: rowsToSend,
        changedByName: user?.email ?? null,
      });

      toast({
        title: providerId ? "Provider updated" : "Provider created",
        description: `${result.pricesWritten} price${result.pricesWritten === 1 ? "" : "s"} saved${
          result.servicesCreated > 0
            ? `, ${result.servicesCreated} new service${result.servicesCreated === 1 ? "" : "s"} added`
            : ""
        }.`,
      });

      onDone?.();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  const toggleCategory = (id: string) => {
    setCategories((cs) =>
      cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]
    );
  };

  return (
    <div className="space-y-5">
      {!embedded && (
        <p className="text-xs text-muted-foreground">
          Only <span className="font-medium text-foreground">Provider name</span> is required.
          Add as much or as little pricing as you have on hand.
        </p>
      )}

      {/* Existing provider picker */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Existing provider{" "}
          <span className="text-muted-foreground font-normal">(optional — to append/update)</span>
        </label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          <option value="">+ Create new provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.city ? ` — ${p.city}, ${p.state}` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Provider details */}
      <div className="space-y-2 rounded-md border border-input p-3">
        <label className="text-xs font-medium text-foreground">Provider details</label>
        <Input
          placeholder="Provider name *"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
        />
        <Input
          placeholder="Street address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="ST"
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
            className="w-16"
            maxLength={2}
          />
          <Input
            placeholder="ZIP"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className="w-24"
          />
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Fax"
            value={fax}
            onChange={(e) => setFax(e.target.value)}
            className="flex-1"
          />
        </div>

        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            Categories / specialties (first is the primary)
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {specialties.map((s) => {
              const active = categories.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleCategory(s.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:border-primary/50"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          Pricing rows{" "}
          <span className="text-muted-foreground font-normal">
            ({validRowCount} valid)
          </span>
        </label>
        <div className="flex rounded-md border border-input overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setPasteMode(false)}
            className={`flex items-center gap-1 px-2 py-1 transition-colors ${
              !pasteMode
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <PencilLine className="h-3 w-3" />
            Rows
          </button>
          <button
            type="button"
            onClick={() => setPasteMode(true)}
            className={`flex items-center gap-1 px-2 py-1 transition-colors ${
              pasteMode
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardPaste className="h-3 w-3" />
            Paste
          </button>
        </div>
      </div>

      {/* Pricing input */}
      {pasteMode ? (
        <div className="space-y-1.5">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={
              "Paste rows. One per line. Formats:\n  CPT, price\n  CPT, component, price\n  CPT, service name, component, price\nExample:\n  99213, cash, 125\n  J3490, gross, 88.50"
            }
            rows={8}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Tab or comma separated. Component defaults to <code>cash</code> if omitted.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-[90px_1fr_110px_100px_28px] gap-1.5 items-center"
            >
              <Input
                placeholder="CPT"
                value={row.cptCode}
                onChange={(e) => updateRow(i, { cptCode: e.target.value.toUpperCase() })}
                disabled={initial?.lockCpt && i === 0}
                className="font-mono text-xs h-9"
              />
              <Input
                placeholder="Service name (optional)"
                value={row.serviceName}
                onChange={(e) => updateRow(i, { serviceName: e.target.value })}
                className="text-xs h-9"
              />
              <select
                value={row.component}
                onChange={(e) => updateRow(i, { component: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                {COMPONENTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Input
                placeholder="$ price"
                value={row.price}
                onChange={(e) => updateRow(i, { price: e.target.value })}
                inputMode="decimal"
                className="text-xs h-9 font-mono"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-muted-foreground hover:text-destructive p-1"
                title="Remove row"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            <Plus className="h-3 w-3" />
            Add another CPT row
          </button>
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={submit.isPending}
        className="w-full"
      >
        {submit.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <ListPlus className="h-4 w-4 mr-2" />
            Save provider {validRowCount > 0 ? `+ ${validRowCount} price${validRowCount === 1 ? "" : "s"}` : ""}
          </>
        )}
      </Button>
    </div>
  );
}

interface ManualPricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: InitialState;
}

export function ManualPricingDialog({
  open,
  onOpenChange,
  initial,
}: ManualPricingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Pricing Manually</DialogTitle>
          <DialogDescription>
            Create or update a provider and (optionally) add CPT/HCPCS prices.
          </DialogDescription>
        </DialogHeader>
        <ManualPricingForm
          initial={initial}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
