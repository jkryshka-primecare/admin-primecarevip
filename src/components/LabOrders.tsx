import { useMemo, useState } from "react";
import { RefreshCw, FlaskConical, AlertTriangle, Clock, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type LabStage =
  | "ordered"
  | "collected"
  | "in-lab"
  | "resulted"
  | "reviewed"
  | "notified";

type LabOrder = {
  id: string;
  patient: string;
  panel: string;
  loinc: string;
  vendor: "Quest" | "Labcorp" | "In-House";
  priority: "routine" | "urgent" | "stat";
  stage: LabStage;
  orderedAt: string;
  collectedAt?: string;
  resultedAt?: string;
  reviewedAt?: string;
  notifiedAt?: string;
  abnormalFlag?: "H" | "L" | "C" | null;
  orderingProvider: string;
};

type LabsResult = {
  orders: LabOrder[];
  pipelineCounts: Record<LabStage, number>;
  source: string;
  generated: string;
};

const stages: { id: LabStage; label: string; hint: string }[] = [
  { id: "ordered", label: "Ordered", hint: "Awaiting collection" },
  { id: "collected", label: "Collected", hint: "Specimen taken" },
  { id: "in-lab", label: "In Lab", hint: "Vendor processing" },
  { id: "resulted", label: "Resulted", hint: "Result returned" },
  { id: "reviewed", label: "Reviewed", hint: "Clinician signed off" },
  { id: "notified", label: "Patient Notified", hint: "Closed loop" },
];

const stageStyle: Record<LabStage, string> = {
  ordered: "bg-muted text-muted-foreground border-border",
  collected: "bg-primary/10 text-primary border-primary/30",
  "in-lab": "bg-accent/15 text-accent border-accent/30",
  resulted: "bg-warning/15 text-warning-foreground border-warning/30",
  reviewed: "bg-success/10 text-success border-success/30",
  notified: "bg-success/15 text-success border-success/30",
};

const priorityStyle: Record<LabOrder["priority"], string> = {
  routine: "bg-muted text-muted-foreground border-border",
  urgent: "bg-accent/15 text-accent border-accent/30",
  stat: "bg-destructive/15 text-destructive border-destructive/30",
};

const flagLabel: Record<NonNullable<LabOrder["abnormalFlag"]>, string> = {
  H: "High",
  L: "Low",
  C: "Critical",
};

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function tatHours(o: LabOrder): number | null {
  if (!o.resultedAt) return null;
  const ms = new Date(o.resultedAt).getTime() - new Date(o.orderedAt).getTime();
  return Math.round(ms / (1000 * 60 * 60));
}

const LabOrders = () => {
  const [activeStage, setActiveStage] = useState<LabStage | "all">("all");
  const [vendor, setVendor] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [activeOrder, setActiveOrder] = useState<LabOrder | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<LabsResult>({
    queryKey: ["fhir-labs"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fhir-labs-sandbox", {
        method: "GET",
      });
      if (error) throw error;
      return data as LabsResult;
    },
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders.filter((o) => {
      if (activeStage !== "all" && o.stage !== activeStage) return false;
      if (vendor !== "All" && o.vendor !== vendor) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !o.patient.toLowerCase().includes(q) &&
          !o.panel.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data, activeStage, vendor, search]);

  const counts = data?.pipelineCounts;
  const abnormalCount = useMemo(
    () => (data?.orders ?? []).filter((o) => o.abnormalFlag).length,
    [data]
  );
  const statCount = useMemo(
    () => (data?.orders ?? []).filter((o) => o.priority === "stat").length,
    [data]
  );

  return (
    <div className="space-y-8">
      {/* Header summary */}
      <section className="grid grid-cols-4 gap-5">
        <SummaryTile
          icon={<FlaskConical className="size-4" />}
          label="Total Active Orders"
          value={data?.orders.length ?? 0}
          sub="Across pipeline"
        />
        <SummaryTile
          icon={<AlertTriangle className="size-4 text-destructive" />}
          label="Abnormal Flags"
          value={abnormalCount}
          sub="Awaiting review or callback"
          tone="destructive"
        />
        <SummaryTile
          icon={<Clock className="size-4 text-accent" />}
          label="STAT Orders"
          value={statCount}
          sub="High-priority turnaround"
          tone="accent"
        />
        <SummaryTile
          icon={<RefreshCw className={cn("size-4", isFetching && "animate-spin")} />}
          label="Data Source"
          value={data ? "FHIR Sandbox" : "—"}
          sub={data ? `Updated ${formatDate(data.generated)}` : "Loading…"}
        />
      </section>

      {/* Pipeline tiles */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-serif text-lg font-bold text-foreground">Order Pipeline</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click a stage to filter the queue · ServiceRequest → DiagnosticReport flow
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-full border border-border hover:bg-muted transition-colors"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-6 gap-3">
          <StageTile
            stage="all"
            label="All"
            hint="Full queue"
            count={data?.orders.length ?? 0}
            active={activeStage === "all"}
            onClick={() => setActiveStage("all")}
          />
          {stages.slice(0, 5).map((s) => (
            <StageTile
              key={s.id}
              stage={s.id}
              label={s.label}
              hint={s.hint}
              count={counts?.[s.id] ?? 0}
              active={activeStage === s.id}
              onClick={() => setActiveStage(s.id)}
            />
          ))}
        </div>
      </section>

      {/* Filters */}
      <section className="flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient or panel…"
          className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/50">
          {["All", "Quest", "Labcorp", "In-House"].map((v) => (
            <button
              key={v}
              onClick={() => setVendor(v)}
              className={cn(
                "px-3 py-1 text-xs rounded transition-colors",
                vendor === v
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </section>

      {/* Table */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-[10px] uppercase tracking-wider">Order</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Patient</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Panel</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Vendor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Priority</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Stage</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">TAT</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  Loading lab orders…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  No orders match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((o) => {
                const tat = tatHours(o);
                return (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer"
                    onClick={() => setActiveOrder(o)}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{o.id}</TableCell>
                    <TableCell className="font-medium">{o.patient}</TableCell>
                    <TableCell>
                      <div className="text-sm">{o.panel}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">LOINC {o.loinc}</div>
                    </TableCell>
                    <TableCell className="text-sm">{o.vendor}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold",
                        priorityStyle[o.priority]
                      )}>
                        {o.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold",
                        stageStyle[o.stage]
                      )}>
                        {o.stage.replace("-", " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {tat !== null ? `${tat}h` : "—"}
                    </TableCell>
                    <TableCell>
                      {o.abnormalFlag ? (
                        <span className={cn(
                          "px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold",
                          o.abnormalFlag === "C"
                            ? "bg-destructive/15 text-destructive border-destructive/30"
                            : "bg-accent/15 text-accent border-accent/30"
                        )}>
                          {flagLabel[o.abnormalFlag]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </section>

      {/* Detail drawer */}
      <Sheet open={!!activeOrder} onOpenChange={(o) => !o && setActiveOrder(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {activeOrder && (
            <>
              <SheetHeader>
                <SheetTitle className="font-serif">{activeOrder.panel}</SheetTitle>
                <p className="text-xs text-muted-foreground font-mono">
                  {activeOrder.id} · LOINC {activeOrder.loinc}
                </p>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <DetailRow label="Patient" value={activeOrder.patient} />
                  <DetailRow label="Provider" value={activeOrder.orderingProvider} />
                  <DetailRow label="Vendor" value={activeOrder.vendor} />
                  <DetailRow label="Priority" value={activeOrder.priority.toUpperCase()} />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                    Pipeline Timeline
                  </div>
                  <ol className="space-y-3">
                    <TimelineRow label="Ordered" at={activeOrder.orderedAt} done />
                    <TimelineRow label="Collected" at={activeOrder.collectedAt} done={!!activeOrder.collectedAt} />
                    <TimelineRow label="Resulted" at={activeOrder.resultedAt} done={!!activeOrder.resultedAt} />
                    <TimelineRow label="Reviewed" at={activeOrder.reviewedAt} done={!!activeOrder.reviewedAt} />
                    <TimelineRow label="Patient Notified" at={activeOrder.notifiedAt} done={!!activeOrder.notifiedAt} />
                  </ol>
                </div>

                {activeOrder.abnormalFlag && (
                  <div className={cn(
                    "p-3 rounded-lg border text-sm",
                    activeOrder.abnormalFlag === "C"
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-accent/10 border-accent/30 text-accent"
                  )}>
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="size-4" />
                      {flagLabel[activeOrder.abnormalFlag]} flag — clinician follow-up required
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

const SummaryTile = ({
  icon, label, value, sub, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  tone?: "destructive" | "accent";
}) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-center justify-between text-muted-foreground">
      <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      {icon}
    </div>
    <div className={cn(
      "font-serif text-3xl font-bold mt-2",
      tone === "destructive" && "text-destructive",
      tone === "accent" && "text-accent",
      !tone && "text-foreground"
    )}>
      {value}
    </div>
    <div className="text-xs text-muted-foreground mt-1">{sub}</div>
  </div>
);

const StageTile = ({
  label, hint, count, active, onClick,
}: {
  stage: LabStage | "all";
  label: string;
  hint: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "text-left bg-card border rounded-xl p-4 transition-all",
      active
        ? "border-accent shadow-sm ring-1 ring-accent/30"
        : "border-border hover:border-foreground/20"
    )}
  >
    <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
      {label}
    </div>
    <div className="font-serif text-2xl font-bold mt-1 text-foreground">{count}</div>
    <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
  </button>
);

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
      {label}
    </div>
    <div className="text-sm font-medium text-foreground mt-0.5">{value}</div>
  </div>
);

const TimelineRow = ({ label, at, done }: { label: string; at?: string; done: boolean }) => (
  <li className="flex items-start gap-3">
    <div className={cn(
      "size-2.5 rounded-full mt-1.5 shrink-0",
      done ? "bg-success" : "bg-muted border border-border"
    )} />
    <div className="flex-1 flex items-center justify-between">
      <span className={cn("text-sm", done ? "text-foreground font-medium" : "text-muted-foreground")}>
        {label}
      </span>
      <span className="text-xs text-muted-foreground font-mono">{formatDate(at)}</span>
    </div>
  </li>
);

export default LabOrders;
