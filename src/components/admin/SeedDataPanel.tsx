import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FlaskConical, Pill, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type SeedStatus = "idle" | "loading" | "done" | "error";

function StatusIcon({ status }: { status: SeedStatus }) {
  if (status === "loading") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-destructive" />;
  return null;
}

function SeedLabCorp() {
  const [status, setStatus] = useState<SeedStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string>("");

  const runSeed = async () => {
    try {
      setStatus("loading");
      setResult("");
      setProgress(0);

      // 1. Fetch the XLSX from public/data
      const resp = await fetch("/data/Lab_Pricing_Labcorp.xlsx");
      if (!resp.ok) throw new Error("Lab_Pricing_Labcorp.xlsx not found in /public/data/");
      const ab = await resp.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(ab), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // 2. Find data start (skip headers)
      let startIdx = 0;
      for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
        const row = rawRows[i];
        if (row && row.length >= 3) {
          const first = String(row[0] || "").toUpperCase();
          if (first === "TEST_NUMBER" || first === "TEST NUMBER") {
            startIdx = i + 1;
            break;
          }
        }
      }
      if (startIdx === 0) {
        for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
          const row = rawRows[i];
          if (row && row.length >= 3 && /^\d{3,}/.test(String(row[0] || "").trim())) {
            startIdx = i;
            break;
          }
        }
      }

      // 3. Parse rows (dedup by test number)
      const allRows: [string, string, number][] = [];
      const seen = new Set<string>();
      for (let i = startIdx; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length < 3) continue;
        const testNumber = String(row[0] || "").trim();
        const testName = String(row[1] || "").trim();
        const priceStr = String(row[2] || "").replace(/[$,]/g, "").trim();
        if (!testNumber || !testName) continue;
        const price = parseFloat(priceStr);
        if (isNaN(price)) continue;
        if (seen.has(testNumber)) continue;
        seen.add(testNumber);
        allRows.push([testNumber, testName, price]);
      }

      setResult(`Parsed ${allRows.length} unique tests. Sending in batches…`);

      // 4. Setup call (creates specialty + provider)
      const { error: setupErr } = await supabase.functions.invoke("seed-labcorp", {
        body: { setup: true, rows: [] },
      });
      if (setupErr) throw new Error(`Setup failed: ${setupErr.message}`);

      // 5. Send data in batches of 500
      const BATCH_SIZE = 500;
      let totalInserted = 0;

      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.functions.invoke("seed-labcorp", {
          body: { rows: batch },
        });
        if (error) {
          console.error(`Batch ${i} failed:`, error);
          continue;
        }
        totalInserted += (data as any)?.services_inserted ?? 0;
        const pct = Math.round(((i + batch.length) / allRows.length) * 100);
        setProgress(pct);
        setResult(`Inserted ${totalInserted} / ${allRows.length} tests (${pct}%)`);
      }

      setStatus("done");
      setResult(`Done! Inserted ${totalInserted} LabCorp tests.`);
    } catch (err: any) {
      setStatus("error");
      setResult("Error: " + (err?.message ?? String(err)));
      console.error(err);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-accent/10 p-2">
            <FlaskConical className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-serif text-lg text-foreground">LabCorp Lab Tests</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Parses <code className="font-mono text-[10px]">Lab_Pricing_Labcorp.xlsx</code> and uploads ~16,000 lab tests with cash pricing.
            </p>
          </div>
        </div>
        <StatusIcon status={status} />
      </div>
      <Button onClick={runSeed} disabled={status === "loading"} size="sm" variant="outline">
        {status === "loading" ? "Seeding…" : status === "done" ? "Re-seed LabCorp" : "Run LabCorp Seed"}
      </Button>
      {status === "loading" && progress > 0 && <Progress value={progress} className="h-1.5" />}
      {result && (
        <p className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {result}
        </p>
      )}
    </div>
  );
}

function SeedRxValet() {
  const [status, setStatus] = useState<SeedStatus>("idle");
  const [result, setResult] = useState<string>("");

  const runSeed = async () => {
    try {
      setStatus("loading");
      setResult("Seeding RxValet $0 formulary (706 medications)…");

      const { data, error } = await supabase.functions.invoke("seed-rxvalet", {
        body: {},
      });
      if (error) throw new Error(error.message);

      const meds = (data as any)?.medications_inserted ?? (data as any)?.services_inserted ?? 0;
      const prices = (data as any)?.prices_inserted ?? 0;
      setStatus("done");
      setResult(`Done! Seeded ${meds} medications, ${prices} price entries.`);
    } catch (err: any) {
      setStatus("error");
      setResult("Error: " + (err?.message ?? String(err)));
      console.error(err);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-accent/10 p-2">
            <Pill className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-serif text-lg text-foreground">RxValet $0 Formulary</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seeds 706 medications across Retail and Mail Order components — all priced at $0 (member benefit).
            </p>
          </div>
        </div>
        <StatusIcon status={status} />
      </div>
      <Button onClick={runSeed} disabled={status === "loading"} size="sm" variant="outline">
        {status === "loading" ? "Seeding…" : status === "done" ? "Re-seed RxValet" : "Run RxValet Seed"}
      </Button>
      {result && (
        <p className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {result}
        </p>
      )}
    </div>
  );
}

export default function SeedDataPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-2xl text-foreground">Data Seeding</h2>
        <p className="text-sm text-muted-foreground mt-1">
          One-time seed jobs for partner pricing catalogs. Safe to re-run — all writes are idempotent upserts.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SeedLabCorp />
        <SeedRxValet />
      </div>
    </div>
  );
}
