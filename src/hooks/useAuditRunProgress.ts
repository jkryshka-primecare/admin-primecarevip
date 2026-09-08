import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks a manually-triggered coverage audit from "started" to "a newer report
 * landed". The Firebase job publishes nothing until it finishes, so there is no
 * true percentage to read: this is an elapsed-time bar against a typical run
 * length, plus polling that flips the banner the moment a fresher report exists.
 */
const KEY = "admin.auditRun";
/** Typical full-walk run length. Only drives the bar's visual pace. */
const EXPECTED_MS = 4 * 60 * 1000;
const POLL_MS = 15000;
/** Past this with nothing published, the run is treated as stuck, not slow. */
const STALL_MS = 20 * 60 * 1000;

export type AuditRunState = {
  startedAt: number;
  baselineRunId: string | null;
  runId?: string | null;
  finishedAt?: number | null;
};

function load(): AuditRunState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuditRunState) : null;
  } catch {
    return null;
  }
}

function save(s: AuditRunState | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function useAuditRunProgress(opts: {
  currentRunId: string | null | undefined;
  /** ISO time of the report on screen — a fresher one also means "landed". */
  currentGeneratedAt?: string | null;
  refetch: () => void;
}) {
  const { currentRunId, currentGeneratedAt, refetch } = opts;
  const [run, setRun] = useState<AuditRunState | null>(() => load());
  const [now, setNow] = useState(() => Date.now());
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const start = useCallback(
    (runId?: string | null) => {
      const next: AuditRunState = {
        startedAt: Date.now(),
        baselineRunId: currentRunId ?? null,
        runId: runId ?? null,
        finishedAt: null,
      };
      setRun(next);
      save(next);
    },
    [currentRunId],
  );

  const dismiss = useCallback(() => {
    setRun(null);
    save(null);
  }, []);

  const running = !!run && !run.finishedAt;

  // A newer report id — or a report generated after we started — = the run landed.
  useEffect(() => {
    if (!running || !run) return;
    const genMs = currentGeneratedAt ? Date.parse(currentGeneratedAt) : NaN;
    const fresher = Number.isFinite(genMs) && genMs > run.startedAt;
    if ((currentRunId && currentRunId !== run.baselineRunId) || fresher) {
      const done = { ...run, finishedAt: Date.now(), runId: currentRunId ?? run.runId };
      setRun(done);
      save(done);
    }
  }, [currentRunId, currentGeneratedAt, running, run]);

  // Tick for the elapsed clock, poll the bridge for a fresh report.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => refetchRef.current(), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [running]);

  const elapsedMs = run ? (run.finishedAt ?? now) - run.startedAt : 0;
  // Asymptotic: approaches but never reaches 100% until the report actually lands.
  const progress = run?.finishedAt
    ? 100
    : Math.min(95, 100 * (1 - Math.exp(-elapsedMs / (EXPECTED_MS / 2))));

  // Far past a typical run with nothing published: the job is not coming back.
  const stalled = running && elapsedMs > STALL_MS;

  return {
    run,
    running,
    stalled,
    finished: !!run?.finishedAt,
    elapsedMs,
    progress,
    expectedMs: EXPECTED_MS,
    start,
    dismiss,
  };
}


export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
