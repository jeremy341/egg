"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowsClockwiseIcon,
  DownloadSimpleIcon,
  ListDashesIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { api } from "@/components/api";
import { Segmented } from "@/components/segmented";
import { StatusIndicator } from "@/components/status-dot";
import { ConnectionAlert } from "@/components/connection-alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_LOG_RANGE,
  LOG_RANGES,
  lineLevels,
  logFileName,
  logFileText,
  type LineLevel,
  type LogLevel,
  type LogRange,
} from "@/lib/log-filter";
import { newerLines } from "@/lib/log-page";
import { cn } from "@/lib/utils";

/**
 * Says what a line is in words and shape, not only colour. The word is visible
 * and a fixed width so the lines stay aligned. Lines that are neither get an
 * empty slot of the same width.
 */
function LevelMark({ level }: { level: LineLevel }) {
  if (level === "info") return <span aria-hidden="true" className="w-[4.5rem] shrink-0" />;
  const isError = level === "error";
  const Icon = isError ? XCircleIcon : WarningIcon;
  return (
    <span
      className={cn(
        "inline-flex w-[4.5rem] shrink-0 select-none items-center gap-1 font-sans text-xs font-medium",
        isError ? "text-[var(--status-error)]" : "text-warning"
      )}
    >
      <Icon aria-hidden="true" weight="fill" className="size-3.5 shrink-0" />
      {isError ? "Error" : "Warning"}
    </span>
  );
}

const SKELETON_LINE_WIDTHS = ["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-1/2", "w-3/4", "w-5/6"];

/**
 * Runtime output of a project's service, read from the container's journal
 * over SSH when you open it or press Refresh.
 */
export function LogsView({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [lines, setLines] = useState<string[]>([]);
  // Lines older than `lines`, added by "Load older lines". They sit above the live ones.
  const [older, setOlder] = useState<string[]>([]);
  // Where the lines before the oldest one on screen start, and the view it was given for.
  const [cursor, setCursor] = useState<{ value: string; scope: string } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [olderNote, setOlderNote] = useState("");
  const [loading, setLoading] = useState(false);
  // False until the first read for this project has finished. Only that first
  // read shows skeleton lines; later reads (search, auto refresh) keep the old
  // lines on screen until the new ones arrive.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The search box updates at once; the server is asked once typing pauses.
  const [term, setTerm] = useState("");
  const [range, setRange] = useState<LogRange>(DEFAULT_LOG_RANGE);
  const [level, setLevel] = useState<LogLevel>("all");
  const [auto, setAuto] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Only the newest request may write its result, so a slow answer for the
  // project you just left cannot land under the one you are looking at.
  const latest = useRef(0);
  // Counts every time the older lines are thrown away, so an older read that was
  // still on its way cannot land under lines it no longer belongs to.
  const epoch = useRef(0);
  const olderBusy = useRef(false);
  const shownRef = useRef({ older, lines });
  const box = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const scope = `${projectId}|${term}|${range}|${level}`;

  useEffect(() => {
    shownRef.current = { older, lines };
  });

  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // `quiet` is the automatic refresh: it does not touch the Refresh button, so
  // nothing on screen flickers every five seconds.
  const load = useCallback(
    async (quiet = false) => {
      if (!projectId) return;
      const mine = ++latest.current;
      if (!quiet) setLoading(true);
      try {
        const res = await api<{ lines: string[]; older?: string | null }>(
          `/api/projects/${projectId}/runtime-logs?lines=300&range=${range}&level=${level}${term ? `&q=${encodeURIComponent(term)}` : ""}`
        );
        if (mine !== latest.current) return;
        // With older lines on screen the automatic refresh only adds what is new
        // under them, so reading further back is not undone every five seconds.
        const shown = shownRef.current;
        const added =
          quiet && shown.older.length > 0 ? newerLines([...shown.older, ...shown.lines], res.lines) : null;
        if (quiet && olderBusy.current && shown.older.length === 0) {
          // Older lines are on their way for the lines on screen: keep those as they are.
        } else if (added) {
          if (added.length > 0) setLines((l) => [...l, ...added]);
        } else {
          epoch.current++;
          setOlder([]);
          setOlderError(null);
          setOlderNote("");
          setLines(res.lines);
          setCursor(res.older ? { value: res.older, scope: `${projectId}|${term}|${range}|${level}` } : null);
        }
        setError(null);
      } catch (e) {
        if (mine !== latest.current) return;
        setError(e instanceof Error ? e.message : "Could not read the logs");
      } finally {
        if (mine === latest.current) {
          setLoading(false);
          setReady(true);
        }
      }
    },
    [projectId, term, range, level]
  );

  useEffect(() => {
    // Reading logs is an external side effect, which is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Only the "Warnings and errors" view marks each line. Stack trace lines take
  // the level of the error above them, so the whole trace is marked.
  const all = useMemo(() => (older.length > 0 ? [...older, ...lines] : lines), [older, lines]);
  const levels = useMemo(() => (level === "problems" ? lineLevels(all) : null), [level, all]);

  // Older lines go above the ones on screen. Keep what the reader was looking at in place.
  useLayoutEffect(() => {
    const el = box.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
  }, [older]);

  async function loadOlder() {
    // The cursor only fits the view it was given for.
    if (!cursor || cursor.scope !== scope || olderBusy.current) return;
    const mine = epoch.current;
    olderBusy.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const res = await api<{ lines: string[]; older?: string | null }>(
        `/api/projects/${projectId}/runtime-logs?lines=300&range=${range}&level=${level}${term ? `&q=${encodeURIComponent(term)}` : ""}&before=${encodeURIComponent(cursor.value)}`
      );
      if (mine !== epoch.current) return;
      const el = box.current;
      anchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
      setOlder((o) => [...res.lines, ...o]);
      setCursor(res.older ? { value: res.older, scope } : null);
      setOlderNote(
        res.lines.length === 0
          ? res.older
            ? "No matching lines in that stretch. Load older lines to keep looking."
            : "No older lines."
          : `${res.lines.length} older ${res.lines.length === 1 ? "line" : "lines"} loaded${res.older ? "" : ". That is the start of the logs for this time range"}.`
      );
    } catch (e) {
      // The lines already shown stay; pressing the button tries the same read again.
      if (mine !== epoch.current) return;
      setOlderError(e instanceof Error ? e.message : "Could not read older lines");
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(() => void load(true), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, load]);

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<ListDashesIcon />}
        title="Nothing to read yet"
        description="Deploy a project and whatever it prints while it runs shows up here."
        action={
          <Link href="/new" className={cn(buttonVariants())}>
            New project
          </Link>
        }
      />
    );
  }

  function pickProject(id: string) {
    // Another project's lines must not sit under this one's name while it loads.
    setProjectId(id);
    setLines([]);
    epoch.current++;
    setOlder([]);
    setCursor(null);
    setOlderError(null);
    setOlderNote("");
    setReady(false);
  }

  const showSkeleton = !ready && all.length === 0;
  const canLoadOlder = cursor !== null && cursor.scope === scope && !showSkeleton && !(error && all.length === 0);

  // Saves exactly the lines on screen, as plain text.
  function download() {
    const name = projects.find((p) => p.id === projectId)?.name ?? "project";
    const url = URL.createObjectURL(
      new Blob([logFileText(all)], { type: "text/plain;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = logFileName(name, range);
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="log-project" className="sr-only">
          Project
        </label>
        <NativeSelect
          id="log-project"
          value={projectId}
          onChange={(e) => pickProject(e.target.value)}
          className="w-48 max-sm:w-full"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <Input
          type="search"
          aria-label="Search logs"
          placeholder="Search the last 1000 lines…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[14rem] max-w-96 flex-1 max-sm:max-w-none max-sm:basis-full"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={download}
            disabled={all.length === 0}
            aria-label={`Download ${all.length} visible ${all.length === 1 ? "line" : "lines"} as a text file`}
          >
            <DownloadSimpleIcon aria-hidden="true" />
            Download
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <ArrowsClockwiseIcon aria-hidden="true" className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented<LogRange>
          label="Time range"
          value={range}
          onChange={setRange}
          options={LOG_RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
        <Segmented<LogLevel>
          label="Level"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All lines" },
            { value: "problems", label: "Warnings and errors" },
          ]}
        />
        <label className="inline-flex min-h-10 items-center gap-2 text-label text-muted-foreground sm:min-h-8">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Refresh every 5s
        </label>
        {auto ? (
          <StatusIndicator tone="ready" label="Live" className="motion-fade text-label" />
        ) : null}
      </div>

      {error ? <ConnectionAlert message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {/* What is on screen, in one line. Not a live region: auto refresh would chatter. */}
      <p className="tabular min-h-[18px] text-label text-muted-foreground">
        {!showSkeleton && !error ? (
          <>
            {all.length} {all.length === 1 ? "line" : "lines"} from{" "}
            <span className="text-foreground">
              {projects.find((p) => p.id === projectId)?.name}
            </span>
            , last {LOG_RANGES.find((r) => r.value === range)?.label ?? range}.
          </>
        ) : null}
      </p>

      {/* What loading older lines did, said once for screen readers. */}
      <p role="status" className="sr-only">
        {olderNote}
      </p>

      {canLoadOlder ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            loading={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Loading older lines…" : "Load older lines"}
          </Button>
          {olderError ? (
            <p role="alert" className="text-label text-destructive">
              {olderError}. The lines above are still here.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* A failed read with nothing to show is already explained above, so no second empty panel. */}
      {error && all.length === 0 ? null : (
        <div
          ref={box}
          role="log"
          aria-label="Runtime logs"
          aria-busy={showSkeleton || undefined}
          tabIndex={0}
          className="log-surface max-h-[70vh] min-h-[320px] overflow-auto rounded-lg py-3 shadow-border-small"
        >
          {showSkeleton ? (
            Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="flex h-5 items-center px-4">
                <Skeleton
                  className={cn(
                    "h-3 max-w-full rounded-sm",
                    SKELETON_LINE_WIDTHS[(i * 3) % SKELETON_LINE_WIDTHS.length]
                  )}
                />
              </div>
            ))
          ) : all.length === 0 ? (
            <p className="px-4 py-12 text-center font-sans text-muted-foreground">
              {term
                  ? `No lines match “${term}”.`
                  : level === "problems"
                    ? "No warnings or errors in this time range."
                    : "Nothing printed in this time range. Try a longer one."}
            </p>
          ) : (
            all.map((l, i) => {
              const mark = levels?.[i];
              if (!levels) {
                return (
                  <p key={i} className="log-line whitespace-pre-wrap break-all">
                    {l}
                  </p>
                );
              }
              return (
                <p key={i} className="log-line flex gap-3 whitespace-pre-wrap">
                  <LevelMark level={mark ?? "info"} />
                  <span className="min-w-0 flex-1 break-all">{l}</span>
                </p>
              );
            })
          )}
        </div>
      )}
      {level === "problems" ? (
        <p className="text-label text-muted-foreground">
          Warnings and errors are found from what each line says: a level such as [ERROR] or
          level=warn, words like error, failed, fatal and warning, error names like TypeError:,
          and the lines of a stack trace under an error. Counts of zero, like “0 errors”, do not
          count.
        </p>
      ) : null}
    </div>
  );
}
