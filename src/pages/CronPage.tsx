import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  X,
  Clock,
  Play,
  Pause,
  Pencil,
  Trash2,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import {
  api,
  type CronJob,
  type CronDeliveryTarget,
  type ProfileInfo,
} from "@/lib/api";
import {
  DEFAULT_SCHEDULE_STATE,
  buildScheduleString,
  describeStored,
  stateFromStored,
  type ScheduleBuilderState,
} from "@/lib/schedule";
import { formatDateTime, formatRelative } from "@/lib/time";
import SchedulePicker from "@/components/SchedulePicker";

const field =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none";

function jobProfile(job: CronJob): string {
  return job.profile || job.profile_name || "default";
}
function jobStatus(job: CronJob): "active" | "paused" | "failed" {
  if (!job.enabled) return "paused";
  if (job.last_error) return "failed";
  return "active";
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [targets, setTargets] = useState<CronDeliveryTarget[]>([
    {
      id: "local",
      name: "Local (save only)",
      home_target_set: true,
      home_env_var: null,
    },
  ]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CronJob | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, t, p] = await Promise.all([
        api.getCronJobs("all"),
        api.getCronDeliveryTargets().catch(() => ({ targets: [] })),
        api.getProfiles().catch(() => ({ profiles: [] })),
      ]);
      setJobs(j);
      if (t.targets.length) setTargets(t.targets);
      setProfiles(p.profiles);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Create/edit panel ------------------------------------------------------
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<CronJob | null>(null);

  const openNew = () => {
    setEditing(null);
    setPanelOpen(true);
  };
  const openEdit = (job: CronJob) => {
    setEditing(job);
    setPanelOpen(true);
  };

  const action = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Scheduled Tasks
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Tell the agent what to do and when. Runs on the server on schedule —
            even with this dashboard closed.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
        >
          <Plus className="h-4 w-4" /> New task
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
          <Clock className="mx-auto mb-3 h-7 w-7 text-white/30" />
          <p className="text-sm text-white/50">No scheduled tasks yet.</p>
          <button
            onClick={openNew}
            className="mt-3 text-sm text-sky-300 hover:underline"
          >
            Create your first task
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobCard
              key={`${jobProfile(job)}:${job.id}`}
              job={job}
              busy={busyId === job.id}
              onToggle={() =>
                action(job.id, () =>
                  job.enabled
                    ? api.pauseCronJob(job.id, jobProfile(job))
                    : api.resumeCronJob(job.id, jobProfile(job)),
                )
              }
              onRun={() =>
                action(job.id, () =>
                  api.triggerCronJob(job.id, jobProfile(job)),
                )
              }
              onEdit={() => openEdit(job)}
              onDelete={() => setConfirmDelete(job)}
            />
          ))}
        </div>
      )}

      {panelOpen && (
        <TaskPanel
          editing={editing}
          targets={targets}
          profiles={profiles}
          onClose={() => setPanelOpen(false)}
          onSaved={async () => {
            setPanelOpen(false);
            await load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete “${confirmDelete.name || confirmDelete.prompt?.slice(0, 30) || "task"}”?`}
          body="This scheduled task will be permanently removed."
          busy={busyId === confirmDelete.id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const job = confirmDelete;
            await action(job.id, () =>
              api.deleteCronJob(job.id, jobProfile(job)),
            );
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function JobCard({
  job,
  busy,
  onToggle,
  onRun,
  onEdit,
  onDelete,
}: {
  job: CronJob;
  busy: boolean;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = jobStatus(job);
  const cadence = describeStored(job.schedule, job.schedule_display);
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="truncate font-medium">
              {job.name || "Untitled task"}
            </span>
          </div>
          {job.prompt && (
            <p className="mt-1 line-clamp-2 text-sm text-white/55">
              {job.prompt}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {cadence}
            </span>
            {job.next_run_at && status !== "paused" && (
              <span>
                Next: {formatRelative(job.next_run_at)} (
                {formatDateTime(job.next_run_at)})
              </span>
            )}
            {job.last_run_at && (
              <span>Last: {formatRelative(job.last_run_at)}</span>
            )}
            {job.deliver && <span>Deliver: {job.deliver}</span>}
          </div>
          {status === "failed" && job.last_error && (
            <details className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <summary className="cursor-pointer">
                Last run failed — why?
              </summary>
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap">
                {job.last_error}
              </pre>
            </details>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy && (
            <Loader2 className="mr-1 h-4 w-4 animate-spin text-white/40" />
          )}
          <IconBtn title="Run now" onClick={onRun}>
            <Play className="h-4 w-4" />
          </IconBtn>
          <IconBtn title={job.enabled ? "Pause" : "Resume"} onClick={onToggle}>
            {job.enabled ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 text-emerald-300" />
            )}
          </IconBtn>
          <IconBtn title="Edit" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Delete" onClick={onDelete} danger>
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        "rounded-md p-1.5 text-white/50 hover:bg-white/10",
        danger ? "hover:bg-red-500/10 hover:text-red-300" : "hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: "active" | "paused" | "failed" }) {
  const map = {
    active: { label: "Active", cls: "bg-emerald-400/15 text-emerald-300" },
    paused: { label: "Paused", cls: "bg-white/10 text-white/50" },
    failed: { label: "Failed", cls: "bg-red-400/15 text-red-300" },
  }[status];
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${map.cls}`}>
      {map.label}
    </span>
  );
}

function TaskPanel({
  editing,
  targets,
  profiles,
  onClose,
  onSaved,
}: {
  editing: CronJob | null;
  targets: CronDeliveryTarget[];
  profiles: ProfileInfo[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [profile, setProfile] = useState(
    editing ? editing.profile || "default" : "default",
  );
  const [name, setName] = useState(editing?.name || "");
  const [prompt, setPrompt] = useState(editing?.prompt || "");
  const [deliver, setDeliver] = useState(editing?.deliver || "local");
  const [sched, setSched] = useState<ScheduleBuilderState>(
    editing
      ? stateFromStored(editing.schedule, editing.schedule_display)
      : DEFAULT_SCHEDULE_STATE,
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scheduleString = buildScheduleString(sched);
  const canSave = !!prompt.trim() && !!scheduleString && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      if (editing) {
        await api.updateCronJob(
          editing.id,
          {
            prompt: prompt.trim(),
            schedule: scheduleString,
            name: name.trim(),
            deliver,
          },
          profile,
        );
      } else {
        await api.createCronJob(
          {
            prompt: prompt.trim(),
            schedule: scheduleString,
            name: name.trim() || undefined,
            deliver,
          },
          profile,
        );
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const onlyLocal = targets.filter((t) => t.id !== "local").length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#15181d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold">
            {editing ? "Edit task" : "New scheduled task"}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {profiles.length > 1 && (
            <Labeled label="Profile">
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                className={field}
              >
                {profiles.map((p) => (
                  <option key={p.name} value={p.name} className="bg-[#15181d]">
                    {p.name}
                  </option>
                ))}
              </select>
            </Labeled>
          )}

          <Labeled label="Name (optional)">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily summary"
              className={field}
            />
          </Labeled>

          <Labeled label="What should the agent do on each run?">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Describe the task in plain language…"
              className={`${field} resize-y`}
            />
          </Labeled>

          <Labeled label="Schedule">
            <SchedulePicker state={sched} onChange={setSched} />
          </Labeled>

          <Labeled label="Deliver to">
            <select
              value={deliver}
              onChange={(e) => setDeliver(e.target.value)}
              className={field}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#15181d]">
                  {t.name}
                </option>
              ))}
            </select>
            {onlyLocal && (
              <p className="mt-1.5 text-xs text-white/35">
                No messaging platforms configured. Set one up under Channels to
                deliver reports; “Local” just saves the result on the server.
              </p>
            )}
          </Labeled>

          {err && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50">
        {label}
      </span>
      {children}
    </label>
  );
}

function ConfirmModal({
  title,
  body,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-black/60 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#15181d] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2 text-base font-semibold">
          <Trash2 className="h-4 w-4 text-red-400" />
          {title}
        </div>
        <p className="text-sm text-white/60">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
