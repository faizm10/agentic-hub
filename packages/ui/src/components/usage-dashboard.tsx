"use client";

import type { AgentProvider, UsageReport, UsageTotals } from "@agentic-hub/types";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { AGENT_DISPLAY } from "../model/agents";
import { SegmentedControl } from "../primitives/form";
import { toAgentId } from "../client/adapters";

/** Fixed series order: color follows the provider, never its rank. */
export const USAGE_PROVIDERS: AgentProvider[] = ["claude", "codex", "anthropic", "openai", "muse"];
const SERIES: Record<AgentProvider, string> = {
  claude: "var(--series-1)",
  codex: "var(--series-2)",
  anthropic: "var(--series-3)",
  openai: "var(--series-4)",
  muse: "var(--series-5)",
};

type Metric = "tokens" | "output" | "cost";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const formatTokens = (n: number) => (n < 10_000 ? whole.format(Math.round(n)) : compact.format(n));
const totalTokens = (t: Pick<UsageTotals, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">) => t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
const providerName = (p: AgentProvider) => AGENT_DISPLAY[toAgentId(p)].name;

function value(t: UsageTotals, metric: Metric) {
  return metric === "tokens" ? totalTokens(t) : metric === "output" ? t.outputTokens : (t.costUsd ?? 0);
}
const format = (n: number, metric: Metric) => (metric === "cost" ? money.format(n) : formatTokens(n));

/** Merges several reports (e.g. web chats + each computer) into one. */
export function mergeUsageReports(reports: UsageReport[]): UsageReport {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null as number | null, turns: 0 };
  const plus = <T extends UsageTotals>(a: T, b: UsageTotals): T => ({
    ...a,
    inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens, reasoningTokens: a.reasoningTokens + b.reasoningTokens, turns: a.turns + b.turns,
    costUsd: a.costUsd === null && b.costUsd === null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
  });
  const byModel = new Map<string, UsageReport["byModel"][number]>();
  const daily = new Map<string, UsageReport["daily"][number]>();
  for (const r of reports) {
    for (const m of r.byModel) {
      const key = `${m.provider}|${m.model}`;
      const prev = byModel.get(key);
      byModel.set(key, prev ? { ...plus(prev, m), sessions: prev.sessions + m.sessions } : m);
    }
    for (const d of r.daily) {
      const key = `${d.date}|${d.provider}`;
      daily.set(key, plus(daily.get(key) ?? { date: d.date, provider: d.provider, ...zero }, d));
    }
  }
  return {
    generatedAt: reports[0]?.generatedAt ?? new Date().toISOString(),
    source: reports.map((r) => r.source).join(" + "),
    byModel: [...byModel.values()].sort((a, b) => totalTokens(b) - totalTokens(a)),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function Tile({ label, value: v, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-fg">{v}</div>
      {detail ? <div className="mt-0.5 text-2xs text-fg-subtle">{detail}</div> : null}
    </div>
  );
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}

/** Stacked daily bars, one segment per provider, with a hover breakdown. */
function DailyChart({ report, days, metric, providers }: { report: UsageReport; days: number; metric: Metric; providers: AgentProvider[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const dates = useMemo(() => {
    const out: string[] = [];
    const end = new Date(report.generatedAt);
    for (let i = days - 1; i >= 0; i--) out.push(new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    return out;
  }, [report.generatedAt, days]);
  const byDate = new Map<string, Map<AgentProvider, UsageTotals>>();
  for (const d of report.daily) {
    const m = byDate.get(d.date) ?? new Map();
    m.set(d.provider, d);
    byDate.set(d.date, m);
  }
  const stackTotal = (date: string) => providers.reduce((t, p) => t + (byDate.get(date)?.get(p) ? value(byDate.get(date)!.get(p)!, metric) : 0), 0);
  const max = niceMax(Math.max(0, ...dates.map(stackTotal)));
  const ticks = [0, max / 2, max];
  const H = 180;
  const hovered = hover ? byDate.get(hover) : undefined;

  return (
    <div className="relative">
      <div className="flex">
        <div className="relative mr-2 w-12 shrink-0 text-right text-2xs tabular-nums text-fg-subtle" style={{ height: H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
              {format(t, metric)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-border-strong" : "bg-border/60")} style={{ top: H - (t / max) * H }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]" role="img" aria-label={`Daily ${metric === "cost" ? "reported cost" : "tokens"} by provider; the table below lists the same data.`}>
            {dates.map((date) => {
              const stack = providers.map((p) => ({ p, v: byDate.get(date)?.get(p) ? value(byDate.get(date)!.get(p)!, metric) : 0 })).filter((s) => s.v > 0);
              return (
                // Hit target spans the full column height, bigger than the mark.
                <div key={date} className="flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(date)} onFocus={() => setHover(date)} tabIndex={stack.length ? 0 : -1} aria-label={`${date}: ${format(stackTotal(date), metric)}`}>
                  <div className={cn("flex flex-col-reverse gap-[2px] transition-opacity", hover && hover !== date && "opacity-50")}>
                    {stack.map((s, i) => (
                      <div
                        key={s.p}
                        style={{ height: Math.max(2, (s.v / max) * H - 2), background: SERIES[s.p] }}
                        className={cn("w-full", i === stack.length - 1 && "rounded-t-[4px]")}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {hover && hovered ? (
            <div className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-elevated px-3 py-2 text-xs shadow-md" style={{ left: `min(calc(${(dates.indexOf(hover) / dates.length) * 100}% + 12px), calc(100% - 180px))` }}>
              <div className="mb-1 font-medium text-fg">{new Date(`${hover}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
              {providers.filter((p) => hovered.get(p)).map((p) => (
                <div key={p} className="flex items-center gap-2 tabular-nums">
                  <span className="size-2 rounded-sm" style={{ background: SERIES[p] }} />
                  <span className="text-fg-muted">{providerName(p)}</span>
                  <span className="ml-auto pl-3 text-fg">{format(value(hovered.get(p)!, metric), metric)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="ml-14 mt-1.5 flex justify-between text-2xs text-fg-subtle" aria-hidden>
        <span>{new Date(`${dates[0]}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export interface UsageDashboardProps {
  reports: UsageReport[];
  days: number;
  onDaysChange: (days: number) => void;
  /** Extra note under the header, e.g. where data comes from. */
  note?: ReactNode;
}

/**
 * Token usage across providers. Numbers are what each provider reported for
 * runs made through Agentic Hub; cost is shown only where the provider
 * reports it (Claude Code), never estimated from guessed prices.
 */
export function UsageDashboard({ reports, days, onDaysChange, note }: UsageDashboardProps) {
  const [source, setSource] = useState("all");
  const [metric, setMetric] = useState<Metric>("tokens");
  const sources = reports.map((r) => r.source);
  const report = mergeUsageReports(source === "all" ? reports : reports.filter((r) => r.source === source));
  const totals = report.byModel.reduce(
    (t, m) => ({ tokens: t.tokens + totalTokens(m), input: t.input + m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens, cached: t.cached + m.cacheReadTokens, output: t.output + m.outputTokens, cost: m.costUsd === null ? t.cost : (t.cost ?? 0) + m.costUsd, turns: t.turns + m.turns }),
    { tokens: 0, input: 0, cached: 0, output: 0, cost: null as number | null, turns: 0 },
  );
  const providers = USAGE_PROVIDERS.filter((p) => report.byModel.some((m) => m.provider === p));
  const byProvider = providers.map((p) => {
    const rows = report.byModel.filter((m) => m.provider === p);
    return { p, tokens: rows.reduce((t, m) => t + totalTokens(m), 0) };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<string> label="Time range" value={String(days)} onChange={(v) => onDaysChange(Number(v))} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        {sources.length > 1 ? (
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-fg focus-ring">
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        ) : null}
        <span className="flex-1" />
        {note ? <span className="text-xs text-fg-subtle">{note}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total tokens" value={formatTokens(totals.tokens)} detail={`${whole.format(totals.turns)} replies`} />
        <Tile label="Input" value={formatTokens(totals.input)} detail={totals.input ? `${Math.round((totals.cached / totals.input) * 100)}% from cache` : "—"} />
        <Tile label="Output" value={formatTokens(totals.output)} />
        <Tile label="Reported cost" value={totals.cost === null ? "—" : money.format(totals.cost)} detail="Claude Code estimates only" />
      </div>

      {report.byModel.length ? (
        <>
          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-fg">Daily usage</h2>
              <ul className="flex flex-wrap items-center gap-3 text-xs text-fg-muted" aria-label="Legend">
                {byProvider.map(({ p, tokens }) => (
                  <li key={p} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: SERIES[p] }} />
                    {providerName(p)} <span className="tabular-nums text-fg-subtle">{formatTokens(tokens)}</span>
                  </li>
                ))}
              </ul>
              <span className="flex-1" />
              <SegmentedControl<Metric> label="Measure" value={metric} onChange={setMetric} options={[{ value: "tokens", label: "Tokens" }, { value: "output", label: "Output" }, { value: "cost", label: "Cost" }]} />
            </div>
            <DailyChart report={report} days={days} metric={metric} providers={metric === "cost" ? providers.filter((p) => report.byModel.some((m) => m.provider === p && m.costUsd !== null)) : providers} />
            {metric === "cost" && totals.cost === null ? <p className="mt-2 text-xs text-fg-muted">No provider in this range reported a cost. OpenAI, Anthropic API and Codex runs report tokens only.</p> : null}
          </section>

          <section className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="px-4 pt-3 text-left text-sm font-semibold text-fg">By model</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-muted">
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Cached</th>
                  <th className="px-3 py-2 text-right font-medium">Output</th>
                  <th className="px-3 py-2 text-right font-medium">Replies</th>
                  <th className="px-3 py-2 text-right font-medium">Sessions</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {report.byModel.map((m) => (
                  <tr key={`${m.provider}|${m.model}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SERIES[m.provider] }} />
                        <span className="text-fg">{providerName(m.provider)}</span>
                        <span className="truncate font-mono text-xs text-fg-muted">{m.model}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-fg">{formatTokens(m.inputTokens + m.cacheWriteTokens)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{formatTokens(m.cacheReadTokens)}</td>
                    <td className="px-3 py-2 text-right text-fg">{formatTokens(m.outputTokens)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{whole.format(m.turns)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{whole.format(m.sessions)}</td>
                    <td className="px-4 py-2 text-right text-fg">{m.costUsd === null ? <span className="text-fg-subtle">—</span> : money.format(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">No usage in this range yet. Token counts are recorded for every reply from Claude Code, Codex, OpenAI and Anthropic.</p>
      )}
    </div>
  );
}
