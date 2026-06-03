import { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Phone, MapPin, ChevronDown, ChevronUp, Copy, Check, Plus, CheckCheck,
  Pencil, X, Save,
} from "lucide-react";
import { SortControls, type SortMode } from "@/components/estimator/SortControls";
import { useProviderTotals } from "@/hooks/useProviderTotals";
import {
  useProviders,
  useServicePrices,
  useUpdateServicePrice,
} from "@/hooks/useEstimatorDb";
import { useEstimate } from "@/contexts/EstimateContext";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ManualPricingDialog } from "@/components/estimator/ManualPricingDialog";
import type { Database } from "@/integrations/supabase/types";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Provider = Database["public"]["Tables"]["providers"]["Row"];
type ServicePrice = Database["public"]["Tables"]["service_prices"]["Row"];

interface ServiceTableProps {
  services: Service[];
  specialty: string;
  locationFilter?: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

function ProviderRow({ provider, service }: { provider: Provider; service: Service }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<ServicePrice | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: breakdown = [] } = useServicePrices(provider.id, service.id);
  const { addItem, removeItem, hasItem } = useEstimate();
  const { user, isAdmin } = useAuth();
  const updatePrice = useUpdateServicePrice();

  const total = breakdown.reduce((sum, sp) => sum + Number(sp.price), 0);
  const inEstimate = hasItem(provider.id, service.id);

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  const confirmEdit = () => {
    if (!pendingEdit) return;
    setEditValue(String(Number(pendingEdit.price)));
    setEditingId(pendingEdit.id);
    setPendingEdit(null);
  };

  const saveEdit = (bp: ServicePrice) => {
    const newPrice = parseFloat(editValue);
    if (isNaN(newPrice) || newPrice < 0) return;
    updatePrice.mutate(
      {
        id: bp.id,
        price: newPrice,
        providerId: provider.id,
        serviceId: service.id,
        component: bp.component,
        oldPrice: Number(bp.price),
        changedByName: user?.email ?? null,
      },
      { onSuccess: () => setEditingId(null) }
    );
  };

  const toggleEstimate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inEstimate) {
      removeItem(`${provider.id}-${service.id}`);
    } else {
      addItem({
        serviceId: service.id,
        serviceName: service.name,
        providerId: provider.id,
        providerName: provider.name,
        price: total,
      });
    }
  };

  const copyPhone = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(provider.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (total === 0 && breakdown.length === 0) return null;

  return (
    <div className="border-b border-border last:border-b-0">
      <motion.button
        onClick={() => setExpanded(!expanded)}
        className="w-full grid grid-cols-[1fr_120px_40px_100px_160px] items-center py-3 px-4 hover:bg-muted/40 transition-colors duration-150 text-left"
        whileTap={{ scale: 0.998 }}
      >
        <div>
          <p className="text-sm font-medium text-foreground">{provider.name}</p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {provider.city}, {provider.state}
            </span>
            {provider.distance && (
              <span className="text-xs text-muted-foreground tabular-nums font-mono">
                {provider.distance} mi
              </span>
            )}
          </div>
        </div>

        <div className="text-right">
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium tabular-nums bg-accent/10 text-accent font-mono">
            ${total.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center justify-center">
          <button
            onClick={toggleEstimate}
            className={`p-1 rounded transition-colors ${
              inEstimate
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-primary hover:bg-primary/10"
            }`}
            title={inEstimate ? "Remove from estimate" : "Add to estimate"}
          >
            {inEstimate ? <CheckCheck className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="flex items-center justify-end gap-1">
          <button
            onClick={copyPhone}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            title="Copy phone number"
          >
            <Phone className="h-3 w-3" />
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          <a
            href={`tel:${provider.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-mono text-primary hover:underline tabular-nums"
          >
            {provider.phone}
          </a>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </motion.button>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="bg-muted/30 px-4 pb-3"
        >
          <div className="grid grid-cols-[1fr_120px_32px] gap-1 pt-2 pl-4">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider font-mono">
              Component
            </span>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right font-mono">
              Cost
            </span>
            <span />
            {breakdown.map((bp) => (
              <div key={bp.id} className="contents group/row">
                <span className="text-xs text-foreground/80">{bp.component}</span>
                {editingId === bp.id ? (
                  <>
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        ref={inputRef}
                        type="number"
                        min="0"
                        step="0.01"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(bp);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-20 h-5 px-1 text-xs text-right tabular-nums rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => saveEdit(bp)}
                        className="p-0.5 text-primary hover:text-primary/80"
                        title="Save"
                      >
                        <Save className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        title="Cancel"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-right tabular-nums text-foreground/80 font-mono">
                      ${Number(bp.price).toLocaleString()}
                    </span>
                    {isAdmin ? (
                      <button
                        onClick={() => setPendingEdit(bp)}
                        className="p-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                        title="Edit price"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </>
                )}
              </div>
            ))}
            <div className="contents">
              <span className="text-xs font-medium text-foreground pt-1 border-t border-border">
                Total
              </span>
              <span className="text-xs font-medium text-right tabular-nums text-foreground pt-1 border-t border-border font-mono">
                ${total.toLocaleString()}
              </span>
              <span />
            </div>
          </div>
          <div className="mt-2 pl-4 flex items-center gap-2">
            <MapPin className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {provider.address}, {provider.city}, {provider.state} {provider.zip}
            </span>
          </div>

          <AlertDialog
            open={!!pendingEdit}
            onOpenChange={(open) => !open && setPendingEdit(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Edit Price</AlertDialogTitle>
                <AlertDialogDescription>
                  Change the price for <strong>{pendingEdit?.component}</strong> at{" "}
                  <strong>{provider.name}</strong>? Current price:{" "}
                  <strong>
                    ${pendingEdit ? Number(pendingEdit.price).toLocaleString() : ""}
                  </strong>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmEdit}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>
      )}
    </div>
  );
}

function SortableServiceCard({
  service,
  providers,
  sortMode,
}: {
  service: Service;
  providers: Provider[];
  sortMode: SortMode;
}) {
  const { isAdmin } = useAuth();
  const [addPriceOpen, setAddPriceOpen] = useState(false);
  const providerIds = useMemo(() => providers.map((p) => p.id), [providers]);
  const { data: totals = {} } = useProviderTotals(service.id, providerIds);

  const sortedProviders = useMemo(() => {
    const list = [...providers];
    switch (sortMode) {
      case "distance":
        list.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
        break;
      case "price":
        list.sort((a, b) => (totals[a.id] ?? 9999999) - (totals[b.id] ?? 9999999));
        break;
      case "combined":
        list.sort((a, b) => {
          const distA = a.distance ?? 9999;
          const distB = b.distance ?? 9999;
          if (distA !== distB) return distA - distB;
          return (totals[a.id] ?? 9999999) - (totals[b.id] ?? 9999999);
        });
        break;
    }
    return list;
  }, [providers, sortMode, totals]);

  const activeProviders = useMemo(
    () => sortedProviders.filter((p) => (totals[p.id] ?? 0) > 0),
    [sortedProviders, totals]
  );

  return (
    <motion.div
      variants={itemVariants}
      className="bg-card rounded-lg border border-border overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-baseline gap-3 flex-wrap min-w-0">
            <h3 className="text-sm font-semibold text-foreground font-serif">{service.name}</h3>
            {service.cpt_code && (
              <span className="inline-flex px-1.5 py-0.5 rounded bg-primary/10 text-[11px] font-mono text-primary tabular-nums">
                CPT {service.cpt_code}
              </span>
            )}
            {service.nhsn_category && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-[11px] font-mono text-accent"
                title="NHSN-approved operative procedure"
              >
                ✓ NHSN · {service.nhsn_category}
              </span>
            )}
            {service.id.startsWith("lab-") && (
              <span className="inline-flex px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono text-muted-foreground">
                #{service.id.replace("lab-", "")}
              </span>
            )}
            {service.description && !service.description.startsWith("LabCorp Test") && (
              <span className="text-xs text-muted-foreground">{service.description}</span>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => setAddPriceOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
              title="Add a provider price for this service"
            >
              <Plus className="h-3 w-3" />
              Add price
            </button>
          )}
        </div>
        <div className="flex gap-1.5 mt-1.5 flex-wrap">
          {service.icd10_codes.map((code: string) => (
            <span
              key={code}
              className="inline-flex px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono text-muted-foreground"
            >
              {code}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_120px_40px_100px_160px] items-center py-1.5 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border font-mono">
        <span>Provider</span>
        <span className="text-right">Total Price</span>
        <span className="text-center">Est.</span>
        <span className="text-right">Contact</span>
        <span className="text-right">Phone</span>
      </div>

      {activeProviders.length > 0 ? (
        activeProviders.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} service={service} />
        ))
      ) : (
        <div className="py-4 px-4 text-xs text-muted-foreground">
          No providers with pricing for this service yet.
        </div>
      )}
    </motion.div>
  );
}

export function ServiceTable({
  services: filteredServices,
  specialty,
  locationFilter,
}: ServiceTableProps) {
  const [sortMode, setSortMode] = useState<SortMode>("distance");
  const [displayCount, setDisplayCount] = useState(25);
  const { data: specialtyProviders = [] } = useProviders(specialty, locationFilter);

  if (filteredServices.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No services found matching your search.</p>
      </div>
    );
  }

  const displayed = filteredServices.slice(0, displayCount);
  const hasMore = filteredServices.length > displayCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <SortControls value={sortMode} onChange={setSortMode} />
      </div>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="space-y-4"
      >
        {displayed.map((service) => (
          <SortableServiceCard
            key={service.id}
            service={service}
            providers={specialtyProviders}
            sortMode={sortMode}
          />
        ))}
      </motion.div>
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setDisplayCount((c) => c + 25)}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Show more ({filteredServices.length - displayCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
