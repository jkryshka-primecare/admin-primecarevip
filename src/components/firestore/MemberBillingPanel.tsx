import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertCircle, CreditCard, Loader2, RefreshCw, Search } from "lucide-react";
import { useFirestoreList } from "@/hooks/useFirestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function money(cents?: number | null) {
  if (cents == null || Number.isNaN(Number(cents))) return "—";
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function when(iso?: string | null) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

function statusVariant(status?: string | null) {
  if (status === "active" || status === "paid") return "default" as const;
  if (status === "canceled" || status === "uncollectible") return "destructive" as const;
  return "secondary" as const;
}

/**
 * Member billing pulled live from the member apps (Firestore).
 * READ-ONLY — this view never writes to a member record.
 */
export default function MemberBillingPanel() {
  const [q, setQ] = useState("");

  const accounts = useFirestoreList("billing_accounts", { limit: 200 });
  const subs = useFirestoreList("billing_subscriptions", { limit: 200 });
  const invoices = useFirestoreList("billing_invoices", {
    orderBy: { field: "createdAt", direction: "desc" },
    limit: 100,
  });

  const needle = q.trim().toLowerCase();
  const filteredAccounts = useMemo(
    () =>
      (accounts.docs as any[]).filter(
        (a) => !needle || String(a.email ?? "").toLowerCase().includes(needle),
      ),
    [accounts.docs, needle],
  );

  const kpis = useMemo(() => {
    const activeSubs = (subs.docs as any[]).filter((s) => s.status === "active");
    const mrrCents = activeSubs.reduce(
      (sum, s) =>
        sum +
        (s.lineItems ?? []).reduce(
          (t: number, li: any) => t + (Number(li.totalCents) || 0),
          0,
        ),
      0,
    );
    const unpaid = (invoices.docs as any[]).filter(
      (i) => i.status && i.status !== "paid" && i.status !== "void",
    );
    return {
      accounts: accounts.docs.length,
      activeSubs: activeSubs.length,
      mrrCents,
      unpaid: unpaid.length,
    };
  }, [accounts.docs, subs.docs, invoices.docs]);

  const anyError = accounts.error ?? subs.error ?? invoices.error;
  const loading = accounts.loading || subs.loading || invoices.loading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-foreground">Member billing</h2>
          <p className="text-xs text-muted-foreground">
            Live from the member apps · read-only
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            disabled={loading}
            onClick={() => {
              accounts.refetch();
              subs.refetch();
              invoices.refetch();
            }}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {anyError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{anyError}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Billing accounts" value={String(kpis.accounts)} />
        <Kpi label="Active subscriptions" value={String(kpis.activeSubs)} />
        <Kpi label="Recurring / cycle" value={money(kpis.mrrCents)} />
        <Kpi label="Unpaid invoices" value={String(kpis.unpaid)} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Billing accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.loading ? (
            <Spinner />
          ) : filteredAccounts.length === 0 ? (
            <Empty label="No billing accounts match." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment method</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.email ?? "—"}</TableCell>
                    <TableCell className="text-sm">{a.membershipTier ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(a.status)}>{a.status ?? "unknown"}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.defaultPaymentMethodLast4
                        ? `${a.defaultPaymentMethodBrand ?? "card"} ···· ${a.defaultPaymentMethodLast4}`
                        : "None on file"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {when(a.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {subs.loading ? (
            <Spinner />
          ) : subs.docs.length === 0 ? (
            <Empty label="No subscriptions found." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Period ends</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(subs.docs as any[]).slice(0, 50).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">
                      {s.lineItems?.[0]?.label ?? "Subscription"}
                    </TableCell>
                    <TableCell className="text-sm">{s.membershipTier ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(s.status)}>{s.status ?? "unknown"}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {money(s.lineItems?.[0]?.totalCents)}
                      {s.interval && (
                        <span className="text-muted-foreground"> /{s.interval}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {when(s.currentPeriodEnd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.loading ? (
            <Spinner />
          ) : invoices.docs.length === 0 ? (
            <Empty label="No invoices found." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.docs as any[]).slice(0, 50).map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm">
                      {inv.lineItems?.[0]?.label ?? "Invoice"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(inv.status)}>
                        {inv.status ?? "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {money(inv.amountDueCents)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {money(inv.amountPaidCents)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {when(inv.periodStart)}
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          View
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 font-mono text-2xl text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}
