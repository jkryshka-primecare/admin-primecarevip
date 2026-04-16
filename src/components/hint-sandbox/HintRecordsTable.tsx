import { Loader2 } from "lucide-react";
import {
  PAGE_SIZE_OPTIONS,
  PAGINATED_RESOURCES,
  formatCell,
  pickColumns,
  type HintResource,
} from "./types";

interface Props {
  resource: HintResource;
  records: Record<string, unknown>[] | null;
  loading: boolean;
  total: number | null;
  limit: number;
  offset: number;
  onLimitChange: (limit: number) => void;
  onOffsetChange: (offset: number) => void;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export const HintRecordsTable = ({
  resource,
  records,
  loading,
  total,
  limit,
  offset,
  onLimitChange,
  onOffsetChange,
  onRowClick,
}: Props) => {
  const isPaginated = PAGINATED_RESOURCES.has(resource);
  const count = records?.length ?? 0;

  return (
    <div className="border border-border rounded overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4 flex-wrap bg-secondary/30">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {resource}
          {isPaginated && (
            <>
              {" · showing "}
              <span className="text-foreground">{count}</span>
              {total !== null && (
                <>
                  {" of "}
                  <span className="text-foreground">{total}</span>
                </>
              )}
              {" · offset "}
              {offset}
              {"–"}
              {offset + count}
            </>
          )}
        </span>

        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}

          {isPaginated && (
            <>
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Page size
              </label>
              <select
                value={limit}
                onChange={(e) => onLimitChange(Number(e.target.value))}
                disabled={loading}
                className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground disabled:opacity-50"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <button
                onClick={() => onOffsetChange(Math.max(0, offset - limit))}
                disabled={loading || offset === 0}
                className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                onClick={() => onOffsetChange(offset + limit)}
                disabled={
                  loading ||
                  !records ||
                  records.length < limit ||
                  (total !== null && offset + limit >= total)
                }
                className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </>
          )}
        </div>
      </div>

      {records && records.length > 0 ? (
        <RecordsTableBody records={records} onRowClick={onRowClick} />
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          {loading ? "Fetching from Hint..." : "No records to display."}
        </div>
      )}
    </div>
  );
};

const RecordsTableBody = ({
  records,
  onRowClick,
}: {
  records: Record<string, unknown>[];
  onRowClick?: (row: Record<string, unknown>) => void;
}) => {
  const columns = pickColumns(records);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-secondary/20 border-b border-border">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="text-left px-4 py-2 font-bold tracking-widest uppercase text-[10px] text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.slice(0, 25).map((row, i) => {
            const clickable = !!onRowClick && typeof row.id === "string";
            return (
              <tr
                key={i}
                onClick={clickable ? () => onRowClick!(row) : undefined}
                className={
                  "border-b border-border/50 transition-colors " +
                  (clickable
                    ? "cursor-pointer hover:bg-sapphire/10"
                    : "hover:bg-secondary/20")
                }
              >
                {columns.map((c) => (
                  <td key={c} className="px-4 py-2 text-foreground font-mono">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
