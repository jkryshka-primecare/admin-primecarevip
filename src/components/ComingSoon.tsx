import AppLayout from "@/components/AppLayout";
import { Construction } from "lucide-react";

type Props = {
  module: string;
  description?: string;
};

/**
 * Generic "coming soon" placeholder used by every empty module page during
 * Phase 1 of the merge. Phases 2–6 will populate each section.
 */
export default function ComingSoon({ module, description }: Props) {
  return (
    <AppLayout title={module}>
      <div className="bg-card border border-border rounded-2xl shadow-card p-12 flex flex-col items-center text-center max-w-2xl mx-auto">
        <div className="size-14 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-5">
          <Construction className="size-6" />
        </div>
        <h2 className="font-serif text-2xl text-foreground">{module}</h2>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-md">
          {description ??
            `The ${module} module is part of the PrimeCare OS consolidation. The shell is in place — content lands in an upcoming phase.`}
        </p>
        <span className="mt-6 px-3 py-1 rounded-full bg-warning/15 text-warning border border-warning/30 text-[10px] font-bold uppercase tracking-widest font-mono">
          Coming soon · Phase 2+
        </span>
      </div>
    </AppLayout>
  );
}
