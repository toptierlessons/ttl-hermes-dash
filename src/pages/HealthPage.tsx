import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, RefreshCw, Clock } from "lucide-react";
import {
  api,
  type StatusResponse,
  type CronJob,
  type SystemStats,
  type UpdateCheckResponse,
} from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
import { formatRelative } from "@/lib/time";

type Probe<T> =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; data: T }
  | { state: "error"; message: string };

const WS_READY_TIMEOUT_MS = 8000;

/** Connect a GatewayClient and resolve once the server emits `gateway.ready`
 * (the same handshake the chat depends on). Rejects on connect failure or
 * timeout. Always closes the socket afterward. */
async function probeGateway(): Promise<void> {
  const gw = new GatewayClient();
  let offReady: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for gateway.ready"));
      }, WS_READY_TIMEOUT_MS);

      offReady = gw.on("gateway.ready", () => {
        clearTimeout(timer);
        resolve();
      });

      gw.connect().catch((e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  } finally {
    offReady();
    gw.close();
  }
}

export default function HealthPage() {
  const [rest, setRest] = useState<Probe<StatusResponse>>({ state: "idle" });
  const [ws, setWs] = useState<Probe<null>>({ state: "idle" });
  const [cron, setCron] = useState<Probe<CronJob[]>>({ state: "idle" });
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [update, setUpdate] = useState<UpdateCheckResponse | null>(null);

  const runChecks = useCallback(async () => {
    setRest({ state: "checking" });
    setWs({ state: "checking" });
    setCron({ state: "checking" });
    api
      .getSystemStats()
      .then(setSystem)
      .catch(() => setSystem(null));
    api
      .checkHermesUpdate()
      .then(setUpdate)
      .catch(() => setUpdate(null));

    try {
      const data = await api.getStatus();
      setRest({ state: "ok", data });
    } catch (e) {
      setRest({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await probeGateway();
      setWs({ state: "ok", data: null });
    } catch (e) {
      setWs({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      const jobs = await api.getCronJobs("all");
      setCron({ state: "ok", data: jobs });
    } catch (e) {
      setCron({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const busy =
    rest.state === "checking" ||
    ws.state === "checking" ||
    cron.state === "checking";

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Connection check
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Verifies the dashboard can reach the Hermes backend.
          </p>
        </div>
        <button
          onClick={() => void runChecks()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          Re-check
        </button>
      </div>

      <div className="space-y-4">
        <ProbeCard title="REST API" subtitle="GET /api/status" probe={rest}>
          {rest.state === "ok" && (
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <Field label="Version" value={rest.data.version} />
              <Field
                label="Gateway"
                value={rest.data.gateway_running ? "running" : "stopped"}
              />
              <Field
                label="Active sessions"
                value={String(rest.data.active_sessions)}
              />
              <Field
                label="Auth mode"
                value={rest.data.auth_required ? "gated" : "loopback"}
              />
            </dl>
          )}
        </ProbeCard>

        <ProbeCard
          title="Realtime channel"
          subtitle="WebSocket /api/ws → gateway.ready"
          probe={ws}
        >
          {ws.state === "ok" && (
            <p className="mt-2 text-sm text-white/60">
              Handshake succeeded — the chat transport is reachable.
            </p>
          )}
        </ProbeCard>

        <CronHealthCard cron={cron} />

        <SystemPane stats={system} update={update} />
      </div>

      <p className="mt-6 text-xs text-white/40">
        Serving origin: <code className="text-white/60">{location.origin}</code>{" "}
        — <code>/api</code> is proxied to the Hermes backend
        (HERMES_DASHBOARD_URL, default <code>http://127.0.0.1:9119</code>).
      </p>
    </div>
  );
}

function ProbeCard({
  title,
  subtitle,
  probe,
  children,
}: {
  title: string;
  subtitle: string;
  probe: Probe<unknown>;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-4">
      <div className="flex items-center gap-3">
        <StatusIcon state={probe.state} />
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-white/40">{subtitle}</div>
        </div>
        <span className="ml-auto text-sm">
          {probe.state === "ok" && (
            <span className="text-emerald-400">Connected</span>
          )}
          {probe.state === "error" && (
            <span className="text-red-400">Failed</span>
          )}
          {probe.state === "checking" && (
            <span className="text-white/50">Checking…</span>
          )}
        </span>
      </div>
      {probe.state === "error" && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs wrap-break-word text-red-300">
          {probe.message}
        </p>
      )}
      {children}
    </div>
  );
}

function StatusIcon({ state }: { state: Probe<unknown>["state"] }) {
  if (state === "ok")
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />;
  if (state === "error")
    return <XCircle className="h-5 w-5 shrink-0 text-red-400" />;
  if (state === "checking")
    return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-white/50" />;
  return <div className="h-5 w-5 shrink-0 rounded-full bg-white/20" />;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-white/40">{label}</dt>
      <dd className="text-right font-mono text-white/80">{value}</dd>
    </>
  );
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SystemPane({
  stats,
  update,
}: {
  stats: SystemStats | null;
  update: UpdateCheckResponse | null;
}) {
  if (!stats) return null;
  const items: { label: string; value: React.ReactNode }[] = [
    { label: "OS", value: `${stats.os} ${stats.os_release}` },
    { label: "Arch", value: stats.arch },
    { label: "Host", value: stats.hostname },
    { label: "Python", value: `${stats.python_impl} ${stats.python_version}` },
    {
      label: "Hermes",
      value: (
        <span className="inline-flex items-center gap-2">
          v{stats.hermes_version}
          {update &&
            (update.update_available ? (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[0.7rem] text-amber-300">
                update available
              </span>
            ) : (
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[0.7rem] text-emerald-300">
                latest
              </span>
            ))}
        </span>
      ),
    },
    {
      label: "CPU",
      value: `${stats.cpu_count} cores · ${Math.round(stats.cpu_percent)}%`,
    },
    {
      label: "Memory",
      value: `${gb(stats.memory.used)} / ${gb(stats.memory.total)} (${Math.round(stats.memory.percent)}%)`,
    },
    {
      label: "Disk",
      value: `${gb(stats.disk.used)} / ${gb(stats.disk.total)} (${Math.round(stats.disk.percent)}%)`,
    },
    { label: "Uptime", value: uptime(stats.uptime_seconds) },
    {
      label: "Load avg",
      value: stats.load_avg.map((n) => n.toFixed(2)).join(" / "),
    },
  ];
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-5">
      <div className="mb-4 text-xs font-medium tracking-wide text-white/40 uppercase">
        System
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-xs tracking-wide text-white/40 uppercase">
              {it.label}
            </dt>
            <dd className="mt-1 text-sm text-white/85">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CronHealthCard({ cron }: { cron: Probe<CronJob[]> }) {
  const jobs = cron.state === "ok" ? cron.data : [];
  const failed = jobs.filter((j) => j.enabled && j.last_error);
  const paused = jobs.filter((j) => !j.enabled);
  const ok = cron.state === "ok" && failed.length === 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-4">
      <div className="flex items-center gap-3">
        {cron.state === "checking" ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-white/50" />
        ) : cron.state === "error" || failed.length > 0 ? (
          <XCircle className="h-5 w-5 shrink-0 text-red-400" />
        ) : (
          <Clock className="h-5 w-5 shrink-0 text-emerald-400" />
        )}
        <div className="min-w-0">
          <div className="font-medium">Scheduled tasks</div>
          <div className="text-xs text-white/40">
            {cron.state === "ok"
              ? `${jobs.length} task${jobs.length === 1 ? "" : "s"} · ${paused.length} paused`
              : "GET /api/cron/jobs"}
          </div>
        </div>
        <span className="ml-auto text-sm">
          {cron.state === "checking" && (
            <span className="text-white/50">Checking…</span>
          )}
          {cron.state === "error" && (
            <span className="text-red-400">Failed</span>
          )}
          {ok && <span className="text-emerald-400">Healthy</span>}
          {cron.state === "ok" && failed.length > 0 && (
            <span className="text-red-400">{failed.length} failing</span>
          )}
        </span>
      </div>

      {cron.state === "error" && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs wrap-break-word text-red-300">
          {cron.message}
        </p>
      )}

      {failed.map((j) => (
        <details
          key={j.id}
          className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          <summary className="cursor-pointer">
            {j.name || j.prompt?.slice(0, 40) || j.id} — failed{" "}
            {j.last_run_at ? formatRelative(j.last_run_at) : ""}
          </summary>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap">
            {j.last_error}
          </pre>
        </details>
      ))}

      {cron.state === "ok" && (
        <Link
          to="/scheduled"
          className="mt-3 inline-block text-xs text-sky-300 hover:underline"
        >
          Manage scheduled tasks →
        </Link>
      )}
    </div>
  );
}
