import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Download, ListChecks } from "lucide-react";

import type { ReconRow } from "@/hooks/useMemberReconciliation";
import {
  ageFromDob,
  buildExceptionLists,
  downloadCsv,
  exceptionsToCsv,
  type ExceptionList,
} from "@/lib/portal/exceptions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * Published exception lists for the roster gap.
 *
 * Every active member who is not provisionable right now lands on exactly one
 * named list with a stated reason, so nothing is silently dropped from the
 * rollout. Read-only; export is a local CSV download.
 */
export default function RosterExceptions({
  missing,
  rows,
}: {
  missing: ReconRow[];
  rows: ReconRow[];
}) {
  const lists = useMemo(() => buildExceptionLists(missing, rows), [missing, rows]);
  const [openId, setOpenId] = useState<string | null>(null);

  const blockingCount = lists
    .filter((l) => l.blocking)
    .reduce((n, l) => n + l.rows.length, 0);

  const exportAll = () =>
    downloadCsv(`roster-exceptions-${stamp()}.csv`, exceptionsToCsv(lists));

  const exportOne = (list: ExceptionList) =>
    downloadCsv(`roster-${list.id}-${stamp()}.csv`, exceptionsToCsv([list]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" />
              Exception lists
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Every active member needing review, bucketed by provisioning or portal-access state.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportAll}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Export all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {blockingCount > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {blockingCount} member{blockingCount === 1 ? "" : "s"} need a human before
              they can be provisioned — the resolver writes nothing for them.
            </span>
          </div>
        )}

        {lists.map((list) => {
          const open = openId === list.id;
          return (
            <div key={list.id} className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : list.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{list.label}</p>
                  <p className="text-xs text-muted-foreground">{list.description}</p>
                </div>
                <Badge
                  variant={list.blocking && list.rows.length > 0 ? "destructive" : "secondary"}
                  className="font-mono text-[10px]"
                >
                  {list.rows.length.toLocaleString()}
                </Badge>
              </button>

              {open && (
                <div className="border-t border-border px-3 pb-3 pt-2">
                  {list.rows.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      Nobody on this list.
                    </p>
                  ) : (
                    <>
                      <div className="mb-2 flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => exportOne(list)}>
                          <Download className="mr-1 h-3.5 w-3.5" />
                          Export {list.rows.length.toLocaleString()}
                        </Button>
                      </div>
                      <div className="max-h-80 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>DOB</TableHead>
                              <TableHead>Age</TableHead>
                              <TableHead>Member type</TableHead>
                              <TableHead>Hint ID</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {list.rows.map((r) => (
                              <TableRow key={r.key}>
                                <TableCell className="whitespace-nowrap text-xs font-medium">
                                  {r.name}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs">
                                  {r.email ?? "—"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-xs">
                                  {r.dob ?? "—"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-xs">
                                  {ageFromDob(r.dob) ?? "—"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs capitalize">
                                  {r.memberType ?? "—"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                                  {r.hintId ?? "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
