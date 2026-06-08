import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  api,
  type AnalyticsResponse,
  type ModelsAnalyticsResponse,
} from "@/lib/api";
import { formatRelative } from "@/lib/time";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function num(n: number): string {
  return Math.round(n).toLocaleString();
}
function usd(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<AnalyticsResponse | null>(null);
  const [models, setModels] = useState<ModelsAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const [u, m] = await Promise.all([
        api.getAnalytics(d),
        api.getModelsAnalytics(d),
      ]);
      setUsage(u);
      setModels(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const t = usage?.totals;
  const toolCalls =
    models?.models.reduce((sum, m) => sum + (m.tool_calls || 0), 0) ?? 0;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-white/50">
            Token, cost, model and skill usage over the selected period.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/15 p-0.5 text-sm">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={[
                  "rounded-md px-2.5 py-1",
                  days === r.days
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white",
                ].join(" ")}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load(days)}
            disabled={loading}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 hover:bg-white/10 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !usage ? (
        <div className="flex items-center gap-2 py-10 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading usage…
        </div>
      ) : (
        t && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Input tokens" value={num(t.total_input)} />
              <Stat label="Output tokens" value={num(t.total_output)} />
              <Stat label="Cache read" value={num(t.total_cache_read)} />
              <Stat label="Est. cost" value={usd(t.total_estimated_cost)} />
              <Stat label="Sessions" value={num(t.total_sessions)} />
              <Stat label="API calls" value={num(t.total_api_calls)} />
              <Stat label="Tool calls" value={num(toolCalls)} />
              <Stat
                label="Skills used"
                value={num(usage!.skills.summary.distinct_skills_used)}
              />
            </div>

            {/* By model */}
            <Section title="By model">
              {models && models.models.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs tracking-wide text-white/40 uppercase">
                        <th className="py-2 pr-4 font-medium">Model</th>
                        <th className="py-2 pr-4 font-medium">Input</th>
                        <th className="py-2 pr-4 font-medium">Output</th>
                        <th className="py-2 pr-4 font-medium">Tools</th>
                        <th className="py-2 pr-4 font-medium">Calls</th>
                        <th className="py-2 pr-4 font-medium">Cost</th>
                        <th className="py-2 font-medium">Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.models.map((m) => (
                        <tr key={m.model} className="border-t border-white/5">
                          <td className="py-2 pr-4">
                            <div className="font-mono text-xs text-white/85">
                              {m.model}
                            </div>
                            <div className="text-xs text-white/35">
                              {m.provider}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-white/70">
                            {num(m.input_tokens)}
                          </td>
                          <td className="py-2 pr-4 text-white/70">
                            {num(m.output_tokens)}
                          </td>
                          <td className="py-2 pr-4 text-white/70">
                            {num(m.tool_calls)}
                          </td>
                          <td className="py-2 pr-4 text-white/70">
                            {num(m.api_calls)}
                          </td>
                          <td className="py-2 pr-4 text-white/70">
                            {usd(m.estimated_cost)}
                          </td>
                          <td className="py-2 text-xs text-white/45">
                            {m.last_used_at
                              ? formatRelative(m.last_used_at)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty />
              )}
            </Section>

            {/* Skills */}
            <Section title="Skills">
              {usage!.skills.top_skills.length > 0 ? (
                <>
                  <p className="mb-3 text-xs text-white/45">
                    {num(usage!.skills.summary.total_skill_loads)} loads ·{" "}
                    {num(usage!.skills.summary.total_skill_edits)} edits ·{" "}
                    {num(usage!.skills.summary.distinct_skills_used)} distinct
                  </p>
                  <div className="space-y-2">
                    {usage!.skills.top_skills.map((s) => (
                      <div key={s.skill} className="flex items-center gap-3">
                        <span className="w-48 shrink-0 truncate font-mono text-xs text-white/80">
                          {s.skill}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full bg-sky-400/60"
                            style={{ width: `${Math.max(4, s.percentage)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs text-white/50">
                          {s.total_count}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Empty text="No skill usage in this period." />
              )}
            </Section>
          </div>
        )
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-4">
      <div className="text-xs tracking-wide text-white/40 uppercase">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-5">
      <div className="mb-3 text-xs font-medium tracking-wide text-white/40 uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text = "No data yet." }: { text?: string }) {
  return <p className="text-sm text-white/40">{text}</p>;
}
