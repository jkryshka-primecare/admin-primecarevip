import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { X } from "lucide-react";
import type { DrilldownContext } from "./types";

interface Props {
  context: DrilldownContext | null;
  onClose: () => void;
}

const PatientDrilldownDrawer = ({ context, onClose }: Props) => {
  return (
    <Sheet open={!!context} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-card border-l border-border p-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-5 border-b border-border space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                {context?.metric}
              </p>
              <SheetTitle className="font-serif text-xl tracking-tight text-foreground">
                {context?.title}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {context?.description}
              </SheetDescription>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center shrink-0"
              aria-label="Close drilldown"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="px-2 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider border border-accent/20">
              {context?.patients.length ?? 0} patients
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Click any row to open chart
            </span>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-6 py-3">Patient</th>
                <th className="text-left px-3 py-3">Employer</th>
                <th className="text-left px-3 py-3">Physician</th>
                <th className="text-right px-3 py-3">Enc</th>
                <th className="text-right px-3 py-3">Rx</th>
                <th className="text-right px-3 py-3">Msg</th>
                <th className="text-left px-6 py-3">Last Visit</th>
              </tr>
            </thead>
            <tbody>
              {context?.patients.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border hover:bg-accent/10 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs text-accent">{p.id}</span>
                      <span className="text-foreground">{p.name}</span>
                      {p.flag && (
                        <span className="mt-1 text-[10px] uppercase tracking-wider text-destructive font-semibold">
                          {p.flag}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-foreground/80">{p.employer}</td>
                  <td className="px-3 py-3 text-xs text-foreground/80">{p.physician}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{p.encounters}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{p.rxOrders}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{p.messages}</td>
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{p.lastEncounter}</td>
                </tr>
              ))}
              {context && context.patients.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-muted-foreground">
                    No patients match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PatientDrilldownDrawer;
