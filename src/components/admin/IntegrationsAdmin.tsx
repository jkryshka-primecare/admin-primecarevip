import { Activity, Link2, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import ConnectionHealth from "@/components/admin/ConnectionHealth";
import ArtifactCoveragePanel from "@/components/admin/ArtifactCoveragePanel";



type IntegrationStatus = "ready" | "planned" | "live";

interface IntegrationModule {
  name: string;
  status: IntegrationStatus;
  description: string;
}

const emrModules: IntegrationModule[] = [
  { name: "Patient Demographics (ADT)", status: "ready", description: "Receive patient admit/discharge/transfer events from Elation." },
  { name: "Medication Orders (CPOE)", status: "ready", description: "Pull medication orders from EMR prescriptions into the dispense queue." },
  { name: "Allergy & Problem List (CCD)", status: "planned", description: "Sync allergy and diagnosis data bidirectionally." },
  { name: "Dispense Verification (eMAR)", status: "planned", description: "Send dispense confirmations back to EMR." },
  { name: "Insurance & Formulary", status: "planned", description: "Real-time formulary and coverage checks." },
];

const directoryModules: IntegrationModule[] = [
  { name: "Hint Health — Membership Directory", status: "live", description: "Read patient roster, plan tiers, and billing status from Hint sandbox." },
  { name: "FHIR Labs (Sandbox)", status: "live", description: "Pull lab orders and results via FHIR sandbox endpoint." },
  { name: "FHIR Medications (Sandbox)", status: "live", description: "Read prescription data via FHIR sandbox endpoint." },
];

function StatusPill({ status }: { status: IntegrationStatus }) {
  if (status === "live")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="h-3 w-3" /> Live
      </span>
    );
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
      <Clock className="h-3 w-3" /> Planned
    </span>
  );
}

function ModuleRow({ item, i }: { item: IntegrationModule; i: number }) {
  const ready = item.status === "ready" || item.status === "live";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }}
      className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4 shadow-soft"
    >
      <div className="flex items-center gap-4">
        <div className={`rounded-lg p-2 ${ready ? "bg-success/10" : "bg-muted"}`}>
          <Activity className={`h-4 w-4 ${ready ? "text-success" : "text-muted-foreground"}`} />
        </div>
        <div>
          <p className="text-sm font-medium text-card-foreground">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.description}</p>
        </div>
      </div>
      <StatusPill status={item.status} />
    </motion.div>
  );
}

export default function IntegrationsAdmin() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          API connection status and configuration for EMR, membership, and clinical data sources.
        </p>
      </div>

      <ConnectionHealth />

      <ArtifactCoveragePanel />




      {/* EMR Connection card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Link2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-lg text-card-foreground">Elation EMR Connection</h2>
            <p className="text-sm text-muted-foreground">
              Configure your HL7 FHIR / Elation API endpoint to sync patients, orders, and dispenses.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
            <Clock className="h-3 w-3" /> Sandbox · Awaiting Live Credentials
          </span>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            <ExternalLink className="h-3 w-3" /> Configure Endpoint
          </button>
        </div>
      </motion.div>

      {/* EMR Modules */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">EMR Modules</h2>
        {emrModules.map((item, i) => (
          <ModuleRow key={item.name} item={item} i={i} />
        ))}
      </div>

      {/* Directory & Clinical Sandbox */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Membership & Clinical Data
        </h2>
        {directoryModules.map((item, i) => (
          <ModuleRow key={item.name} item={item} i={i} />
        ))}
      </div>
    </div>
  );
}
