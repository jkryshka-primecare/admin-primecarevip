import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Loader2,
  Search,
  AlertCircle,
  RefreshCw,
  User,
  Calendar,
  Pill,
  ShieldAlert,
  Activity,
  Stethoscope,
} from "lucide-react";
import {
  useElationPatients,
  useElationResource,
  type ElationPatient,
} from "@/hooks/useElation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

function formatPatientName(p: ElationPatient) {
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ").trim() || `Patient ${p.id}`;
}

function ageFromDob(dob?: string) {
  if (!dob) return null;
  try {
    const d = parseISO(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  } catch {
    return null;
  }
}

export default function PatientsHome() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const { patients, loading, error, total, meta, refetch } = useElationPatients({
    search,
    limit: 50,
  });

  const selected = useMemo(
    () => patients.find((p) => String(p.id) === String(selectedId)) ?? null,
    [patients, selectedId],
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="font-serif text-3xl text-foreground">Patients</h1>
        <p className="text-sm text-muted-foreground">
          Live patient registry from Elation. Read-only — analytics &amp; lookup only.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Patient directory</CardTitle>
            {meta?.generated && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Synced {format(parseISO(meta.generated), "p")} · {meta.elapsedMs}ms
                {total != null && ` · ${total} total`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search last name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
            <Button variant="outline" size="icon" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : loading && patients.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading patients…
            </div>
          ) : patients.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No patients found{search && ` for "${search}"`}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>DOB / Age</TableHead>
                  <TableHead>Sex</TableHead>
                  <TableHead>MRN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.map((p) => {
                  const age = ageFromDob(p.dob);
                  return (
                    <TableRow
                      key={String(p.id)}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(p.id)}
                    >
                      <TableCell className="font-medium">{formatPatientName(p)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDate(p.dob)}
                        {age != null && (
                          <span className="text-muted-foreground"> · {age}y</span>
                        )}
                      </TableCell>
                      <TableCell>{p.sex ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{String(p.id)}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "default" : "secondary"}>
                          {p.status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.cell_phone ?? p.home_phone ?? p.email ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PatientDetailDrawer
        patient={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}

function PatientDetailDrawer({
  patient,
  open,
  onOpenChange,
}: {
  patient: ElationPatient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = patient?.id ? String(patient.id) : null;
  const enabled = !!id;

  const probs = useElationResource<{ results?: any[] }>(
    "problems",
    id ? { patient: id, limit: 50 } : undefined,
    enabled,
  );
  const meds = useElationResource<{ results?: any[] }>(
    "medications",
    id ? { patient: id, limit: 50 } : undefined,
    enabled,
  );
  const allergies = useElationResource<{ results?: any[] }>(
    "allergies",
    id ? { patient: id, limit: 50 } : undefined,
    enabled,
  );
  const vitals = useElationResource<{ results?: any[] }>(
    "vitals",
    id ? { patient: id, limit: 20 } : undefined,
    enabled,
  );
  const appts = useElationResource<{ results?: any[] }>(
    "appointments",
    id ? { patient: id, limit: 20 } : undefined,
    enabled,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col p-0">
        {patient && (
          <>
            <SheetHeader className="p-6 pb-4 border-b">
              <SheetTitle className="font-serif text-2xl flex items-center gap-2">
                <User className="h-5 w-5" />
                {formatPatientName(patient)}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                MRN {String(patient.id)} · DOB {formatDate(patient.dob)}
                {ageFromDob(patient.dob) != null && ` · ${ageFromDob(patient.dob)}y`}
                {patient.sex && ` · ${patient.sex}`}
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="p-6">
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="grid grid-cols-5 w-full">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="problems">
                      <Stethoscope className="h-3 w-3 mr-1" /> Problems
                    </TabsTrigger>
                    <TabsTrigger value="meds">
                      <Pill className="h-3 w-3 mr-1" /> Meds
                    </TabsTrigger>
                    <TabsTrigger value="allergies">
                      <ShieldAlert className="h-3 w-3 mr-1" /> Allergies
                    </TabsTrigger>
                    <TabsTrigger value="vitals">
                      <Activity className="h-3 w-3 mr-1" /> Vitals
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4 mt-4">
                    <DemographicsCard patient={patient} />
                    <AppointmentsCard
                      appts={appts.data?.results ?? []}
                      loading={appts.loading}
                      error={appts.error}
                    />
                  </TabsContent>

                  <TabsContent value="problems" className="mt-4">
                    <ResourceList
                      title="Active problems"
                      icon={Stethoscope}
                      items={probs.data?.results ?? []}
                      loading={probs.loading}
                      error={probs.error}
                      render={(p: any) => ({
                        primary: p.description ?? p.dx?.[0]?.icd10_code ?? "Problem",
                        secondary: p.status ?? "",
                        meta: p.start_date ? formatDate(p.start_date) : "",
                      })}
                    />
                  </TabsContent>

                  <TabsContent value="meds" className="mt-4">
                    <ResourceList
                      title="Medications"
                      icon={Pill}
                      items={meds.data?.results ?? []}
                      loading={meds.loading}
                      error={meds.error}
                      render={(m: any) => ({
                        primary: m.medication_title ?? m.qualifier ?? "Medication",
                        secondary: [m.dosage, m.frequency].filter(Boolean).join(" · "),
                        meta: m.start_date ? formatDate(m.start_date) : "",
                      })}
                    />
                  </TabsContent>

                  <TabsContent value="allergies" className="mt-4">
                    <ResourceList
                      title="Allergies"
                      icon={ShieldAlert}
                      items={allergies.data?.results ?? []}
                      loading={allergies.loading}
                      error={allergies.error}
                      render={(a: any) => ({
                        primary: a.name ?? a.allergen ?? "Allergen",
                        secondary: a.reaction ?? "",
                        meta: a.severity ?? "",
                      })}
                    />
                  </TabsContent>

                  <TabsContent value="vitals" className="mt-4">
                    <ResourceList
                      title="Recent vitals"
                      icon={Activity}
                      items={vitals.data?.results ?? []}
                      loading={vitals.loading}
                      error={vitals.error}
                      render={(v: any) => ({
                        primary: [
                          v.bp_systolic && v.bp_diastolic && `BP ${v.bp_systolic}/${v.bp_diastolic}`,
                          v.heart_rate && `HR ${v.heart_rate}`,
                          v.weight && `Wt ${v.weight}`,
                          v.temperature && `T ${v.temperature}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Vitals reading",
                        secondary: "",
                        meta: v.recorded_date ? formatDate(v.recorded_date) : "",
                      })}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DemographicsCard({ patient }: { patient: ElationPatient }) {
  const a = patient.address;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Demographics</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Sex" value={patient.sex} />
        <Field label="Gender identity" value={patient.gender_identity as string} />
        <Field label="Language" value={patient.preferred_language as string} />
        <Field label="Status" value={patient.status} />
        <Field label="Email" value={patient.email} />
        <Field label="Cell" value={patient.cell_phone} />
        <Field label="Home" value={patient.home_phone} />
        <Field
          label="Address"
          value={
            a
              ? [a.address_line1, a.address_line2, [a.city, a.state, a.zip].filter(Boolean).join(", ")]
                  .filter(Boolean)
                  .join("\n")
              : "—"
          }
        />
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm whitespace-pre-line">{value || "—"}</div>
    </div>
  );
}

function AppointmentsCard({
  appts,
  loading,
  error,
}: {
  appts: any[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" /> Appointments
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : appts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No appointments.</p>
        ) : (
          <ul className="space-y-2">
            {appts.slice(0, 8).map((appt: any, i: number) => (
              <li
                key={appt.id ?? i}
                className="flex justify-between text-xs border-b pb-2 last:border-0"
              >
                <span>{appt.reason ?? appt.description ?? "Visit"}</span>
                <span className="font-mono text-muted-foreground">
                  {formatDate(appt.scheduled_date ?? appt.start_date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ResourceList({
  title,
  icon: Icon,
  items,
  loading,
  error,
  render,
}: {
  title: string;
  icon: typeof Pill;
  items: any[];
  loading: boolean;
  error: string | null;
  render: (item: any) => { primary: string; secondary?: string; meta?: string };
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No records.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item: any, i: number) => {
              const { primary, secondary, meta } = render(item);
              return (
                <li
                  key={item.id ?? i}
                  className="flex justify-between gap-3 text-sm border-b pb-3 last:border-0"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium">{primary}</div>
                    {secondary && (
                      <div className="text-xs text-muted-foreground">{secondary}</div>
                    )}
                  </div>
                  {meta && (
                    <div className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {meta}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
