import { Users, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { patients } from "./mockData";

export default function Patients() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {patients.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-border bg-card p-5 shadow-soft"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-serif text-lg text-foreground">
                  {p.lastName}, {p.firstName}
                </p>
                <p className="text-xs text-muted-foreground font-mono mt-1">{p.mrn}</p>
                <p className="text-xs text-muted-foreground font-mono">DOB: {p.dob}</p>
              </div>
              <div className="rounded-lg bg-accent/10 p-2">
                <Users className="h-4 w-4 text-accent" />
              </div>
            </div>
            {p.allergies.length > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-xs font-medium text-destructive">
                  {p.allergies.join(", ")}
                </span>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
