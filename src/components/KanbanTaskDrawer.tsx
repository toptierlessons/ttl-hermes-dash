import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  Pencil,
  Paperclip,
  TriangleAlert,
  Copy,
  RefreshCw,
} from "lucide-react";
import {
  api,
  type KanbanTaskDetail,
  type KanbanProfile,
  type KanbanLinkItem,
  type KanbanRun,
} from "@/lib/api";
import { formatRelative } from "@/lib/time";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Duration of a run as a compact label (e.g. "45s", "2m", "1h"). */
function fmtElapsed(r: KanbanRun): string {
  if (!r.started_at) return "";
  const end = r.ended_at || Math.floor(Date.now() / 1000);
  const d = Math.max(0, end - r.started_at);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.round(d / 60)}m`;
  return `${Math.round(d / 3600)}h`;
}

const FAIL_OUTCOMES = new Set([
  "crashed",
  "failed",
  "gave_up",
  "error",
  "timeout",
]);
function runAccent(outcome?: string | null, active?: boolean): string {
  if (active) return "border-l-sky-400";
  if (outcome && FAIL_OUTCOMES.has(outcome)) return "border-l-red-400";
  if (outcome === "done" || outcome === "completed" || outcome === "succeeded")
    return "border-l-emerald-400";
  return "border-l-white/20";
}

const STATUS_ACTIONS: { label: string; status: string }[] = [
  { label: "→ Triage", status: "triage" },
  { label: "→ Todo", status: "todo" },
  { label: "→ Ready", status: "ready" },
  { label: "Block", status: "blocked" },
  { label: "Complete", status: "done" },
  { label: "Archive", status: "archived" },
];

const STATUS_DOT: Record<string, string> = {
  triage: "bg-white/40",
  todo: "bg-sky-400",
  scheduled: "bg-indigo-400",
  ready: "bg-amber-400",
  running: "bg-emerald-400",
  blocked: "bg-red-400",
  review: "bg-violet-400",
  done: "bg-emerald-500",
  archived: "bg-white/25",
};

export default function KanbanTaskDrawer({
  taskId,
  boardTasks,
  onClose,
  onChanged,
}: {
  taskId: string;
  boardTasks: { id: string; title: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [profiles, setProfiles] = useState<KanbanProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setDetail(await api.getKanbanTask(taskId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [taskId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live refresh while the drawer is open so run history + events stay current
  // (e.g. claimed → spawned → active → done). Skip while a mutation is in
  // flight to avoid racing the optimistic update. The in-place edit fields
  // guard their own drafts, so background reloads won't disrupt typing.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const iv = setInterval(() => {
      if (!busyRef.current) void reload();
    }, 3500);
    return () => clearInterval(iv);
  }, [reload]);

  useEffect(() => {
    api
      .getKanbanProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch(() => setProfiles([]));
  }, []);

  // Run a mutation, then refresh both the drawer and the board.
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        await reload();
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload, onChanged],
  );

  const task = detail?.task;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[#15181d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <span className="font-mono text-sm text-white/60">{taskId}</span>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!task ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/40">
            {error ? (
              <span className="text-red-300">{error}</span>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <TitleEditor
              title={task.title}
              status={task.status}
              onSave={(title) =>
                run(() => api.updateKanbanTask(taskId, { title }))
              }
            />

            {/* Summary */}
            <div className="rounded-xl border border-white/10 p-4 text-sm">
              <Row label="Status" value={task.status} />
              <Row label="Assignee" value={task.assignee || "unassigned"} />
              <Row label="Priority" value={String(task.priority ?? 0)} />
              <Row label="Workspace" value={task.workspace_kind || "—"} />
              <Row label="Created by" value={task.created_by || "—"} />
            </div>

            {/* Diagnostics — surfaced when the task has been failing */}
            <DiagnosticsPanel
              taskId={taskId}
              task={task}
              runs={detail.runs}
              profiles={profiles}
              busy={busy}
              onReassign={(p) =>
                run(() => api.reassignKanbanTask(taskId, p, true))
              }
            />

            {/* Status actions */}
            <div className="flex flex-wrap gap-2">
              {STATUS_ACTIONS.map((a) => (
                <button
                  key={a.status}
                  disabled={busy || task.status === a.status}
                  onClick={() =>
                    run(() =>
                      api.updateKanbanTask(taskId, { status: a.status }),
                    )
                  }
                  className={[
                    "rounded-lg px-3 py-1.5 text-sm",
                    task.status === a.status
                      ? "bg-white/10 text-white/40"
                      : "bg-white/5 text-white/80 hover:bg-white/10",
                  ].join(" ")}
                >
                  {a.label}
                </button>
              ))}
            </div>

            {/* Assignee + priority */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assignee">
                <select
                  value={task.assignee || ""}
                  disabled={busy}
                  onChange={(e) =>
                    run(() =>
                      api.reassignKanbanTask(taskId, e.target.value || null),
                    )
                  }
                  className={selectCls}
                >
                  <option value="" className="bg-[#15181d]">
                    unassigned
                  </option>
                  {profiles.map((p) => (
                    <option
                      key={p.name}
                      value={p.name}
                      className="bg-[#15181d]"
                    >
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={String(task.priority ?? 0)}
                  disabled={busy}
                  onChange={(e) =>
                    run(() =>
                      api.updateKanbanTask(taskId, {
                        priority: Number(e.target.value),
                      }),
                    )
                  }
                  className={selectCls}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n} className="bg-[#15181d]">
                      {n === 0 ? "0 (none)" : `P${n}`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Description */}
            <Description
              body={task.body || ""}
              onSave={(body) =>
                run(() => api.updateKanbanTask(taskId, { body }))
              }
            />

            {/* Dependencies */}
            <Dependencies
              detail={detail}
              boardTasks={boardTasks.filter((t) => t.id !== taskId)}
              onAddParent={(pid) => run(() => api.addKanbanLink(pid, taskId))}
              onAddChild={(cid) => run(() => api.addKanbanLink(taskId, cid))}
            />

            {/* Attachments */}
            <Attachments
              count={detail.attachments.length}
              names={detail.attachments.map(
                (a) => a.name || a.filename || String(a.id),
              )}
              onUpload={(file) =>
                run(() => api.uploadKanbanAttachment(taskId, file))
              }
            />

            {/* Comments */}
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
                Comments ({detail.comments.length})
              </h3>
              {detail.comments.length === 0 ? (
                <p className="text-xs text-white/30">— no comments —</p>
              ) : (
                <div className="space-y-2">
                  {detail.comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg bg-white/[0.03] px-3 py-2"
                    >
                      <div className="mb-0.5 flex items-center gap-2 text-xs text-white/40">
                        <span>{c.author}</span>
                        <span>·</span>
                        <span>{formatRelative(c.created_at)}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap text-white/85">
                        {c.body}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Events */}
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
                Events ({detail.events.length})
              </h3>
              <div className="space-y-1.5">
                {detail.events.map((ev) => (
                  <div key={ev.id} className="flex gap-2 text-xs">
                    <span className="text-white/70">{ev.kind}</span>
                    <span className="text-white/35">
                      {formatRelative(ev.created_at)}
                    </span>
                    <span className="truncate text-white/30">
                      {ev.payload ? JSON.stringify(ev.payload) : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Run history */}
            <RunHistory runs={detail.runs} />

            {/* Worker log — live transcript of what the worker is doing */}
            <WorkerLog
              taskId={taskId}
              active={
                task.status === "running" ||
                detail.runs.some((r) => !r.ended_at)
              }
            />
          </div>
        )}

        {/* Comment composer */}
        {task && (
          <CommentBox
            disabled={busy}
            onSubmit={(body) => run(() => api.addKanbanComment(taskId, body))}
          />
        )}
      </div>
    </div>
  );
}

const selectCls =
  "mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none";

function DiagnosticsPanel({
  taskId,
  task,
  runs,
  profiles,
  busy,
  onReassign,
}: {
  taskId: string;
  task: { consecutive_failures?: number; last_failure_error?: string | null };
  runs: KanbanRun[];
  profiles: KanbanProfile[];
  busy: boolean;
  onReassign: (profile: string) => void;
}) {
  const fails = task.consecutive_failures ?? 0;
  const [hidden, setHidden] = useState(false);
  const [profile, setProfile] = useState("");
  const [copied, setCopied] = useState(false);
  // Only surface diagnostics when the task has actually been failing.
  if (fails <= 0 && !task.last_failure_error) return null;

  const recent = [...runs].sort(
    (a, b) =>
      (b.ended_at ?? b.started_at ?? 0) - (a.ended_at ?? a.started_at ?? 0),
  )[0];
  const outcome = recent?.outcome || recent?.status || "failure";
  const lastError = task.last_failure_error || recent?.error || "—";

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="text-xs text-amber-300/80 hover:underline"
      >
        Show diagnostics
      </button>
    );
  }

  return (
    <div className="rounded-xl border-l-2 border-red-400/60 bg-red-500/[0.07] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-300">
          <TriangleAlert className="h-4 w-4" />
          <span className="text-sm font-semibold">
            Agent {outcome} ×{fails}
          </span>
        </div>
        <button
          onClick={() => setHidden(true)}
          className="rounded border border-white/15 px-2 py-0.5 text-xs text-white/60 hover:bg-white/10"
        >
          Hide
        </button>
      </div>
      <p className="mb-3 text-sm leading-relaxed text-white/70">
        This task has failed {fails} time{fails === 1 ? "" : "s"} in a row (most
        recent: {outcome}). Fix the root cause, then reassign or unblock it to
        retry.
      </p>
      <dl className="mb-3 space-y-1 text-xs">
        <DiagRow label="consecutive_failures" value={String(fails)} />
        <DiagRow label="most_recent_outcome" value={outcome} mono />
        <DiagRow label="last_error" value={lastError} mono />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/50">Reassign to:</span>
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="" className="bg-[#15181d]">
            — profile —
          </option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name} className="bg-[#15181d]">
              {p.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !profile}
          onClick={() => onReassign(profile)}
          className="rounded-lg bg-white/10 px-3 py-1 text-sm hover:bg-white/20 disabled:opacity-40"
        >
          Reassign &amp; retry
        </button>
        <button
          onClick={() => {
            navigator.clipboard
              ?.writeText(`hermes kanban log ${taskId}`)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          title={`hermes kanban log ${taskId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1 font-mono text-xs text-white/70 hover:bg-white/10"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? "copied" : `hermes kanban log ${taskId}`}
        </button>
      </div>
    </div>
  );
}

function DiagRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-white/45">{label}:</dt>
      <dd
        className={`min-w-0 break-words text-white/80 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function WorkerLog({ taskId, active }: { taskId: string; active: boolean }) {
  const [data, setData] = useState<{
    content: string;
    size_bytes: number;
    exists: boolean;
    truncated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getKanbanTaskLog(taskId));
    } catch {
      /* keep last good data */
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stream live while the worker is running: poll every 3s.
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => void load(), 3000);
    return () => clearInterval(iv);
  }, [active, load]);

  // Tail to the bottom on new output.
  const content = data?.content ? stripAnsi(data.content) : "";
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);

  if (data && !data.exists) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-white/50 uppercase">
          Worker log{data ? ` (${data.size_bytes} B)` : ""}
          {active && (
            <span className="ml-2 inline-flex items-center gap-1 text-[0.7rem] text-emerald-300 normal-case">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              live
            </span>
          )}
        </h3>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          refresh
        </button>
      </div>
      {content ? (
        <pre
          ref={boxRef}
          className="max-h-80 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-white/75"
        >
          {data?.truncated ? "…(earlier output truncated)…\n" : ""}
          {content}
        </pre>
      ) : (
        <p className="text-xs text-white/30">— no worker output yet —</p>
      )}
    </div>
  );
}

function RunHistory({ runs }: { runs: KanbanRun[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!runs || runs.length === 0) return null;
  const sorted = [...runs].sort(
    (a, b) => (a.started_at ?? 0) - (b.started_at ?? 0),
  );
  const visible = showAll ? sorted : sorted.slice(-3);
  const hiddenCount = sorted.length - visible.length;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
        Run history ({runs.length})
      </h3>
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mb-2 text-xs text-sky-300 hover:underline"
        >
          +{hiddenCount} earlier
        </button>
      )}
      <div className="space-y-2">
        {visible.map((r) => {
          const active = !r.ended_at;
          const outcome = active ? "active" : r.outcome || r.status || "ended";
          const meta =
            r.metadata && Object.keys(r.metadata).length > 0
              ? r.metadata
              : null;
          return (
            <div
              key={r.id}
              className={`rounded-lg border border-l-2 border-white/10 bg-white/[0.03] p-3 ${runAccent(r.outcome, active)}`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-white/85">{outcome}</span>
                <span className="text-xs text-white/45">
                  {r.profile ? `@${r.profile}` : "(no profile)"}
                </span>
                <span className="text-xs text-white/35">{fmtElapsed(r)}</span>
                {r.started_at && (
                  <span className="ml-auto text-xs text-white/35">
                    {formatRelative(r.started_at)}
                  </span>
                )}
              </div>
              {r.summary && (
                <div className="mt-1 text-xs text-white/65">{r.summary}</div>
              )}
              {r.error && (
                <div className="mt-1 font-mono text-xs text-red-300">
                  {r.error}
                </div>
              )}
              {meta && (
                <details className="mt-2" open>
                  <summary className="cursor-pointer text-xs font-medium text-white/50">
                    Metadata
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 font-mono text-xs text-white/70">
                    {JSON.stringify(meta, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex py-1">
      <span className="w-28 shrink-0 text-white/40">{label}</span>
      <span className="text-white/85">{value}</span>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold tracking-wide text-white/50 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function TitleEditor({
  title,
  status,
  onSave,
}: {
  title: string;
  status: string;
  onSave: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  // Only sync from props when not actively editing, so live polling doesn't
  // overwrite what the user is typing.
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);
  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-base text-white focus:outline-none"
        />
        <button
          onClick={() => {
            if (draft.trim()) onSave(draft.trim());
            setEditing(false);
          }}
          className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm text-white hover:bg-sky-400"
        >
          Save
        </button>
      </div>
    );
  }
  return (
    <div className="group flex items-center gap-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] || "bg-white/40"}`}
      />
      <h2 className="text-lg font-semibold">{title}</h2>
      <button
        onClick={() => setEditing(true)}
        title="Edit title"
        className="text-white/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white/70"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Description({
  body,
  onSave,
}: {
  body: string;
  onSave: (b: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  useEffect(() => {
    if (!editing) setDraft(body);
  }, [body, editing]);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-white/50 uppercase">
          Description
        </h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-sky-300 hover:underline"
          >
            edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-y rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(body);
                setEditing(false);
              }}
              className="rounded-lg border border-white/15 px-3 py-1 text-sm hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              className="rounded-lg bg-sky-500 px-3 py-1 text-sm text-white hover:bg-sky-400"
            >
              Save
            </button>
          </div>
        </div>
      ) : body ? (
        <p className="text-sm whitespace-pre-wrap text-white/80">{body}</p>
      ) : (
        <p className="text-sm text-white/30">— no description —</p>
      )}
    </div>
  );
}

function Dependencies({
  detail,
  boardTasks,
  onAddParent,
  onAddChild,
}: {
  detail: KanbanTaskDetail;
  boardTasks: { id: string; title: string }[];
  onAddParent: (id: string) => void;
  onAddChild: (id: string) => void;
}) {
  const [parent, setParent] = useState("");
  const [child, setChild] = useState("");
  const label = (l: KanbanLinkItem) => l.title || l.id;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
        Dependencies
      </h3>
      <DepRow
        caption="Parents"
        items={detail.links.parents.map(label)}
        value={parent}
        setValue={setParent}
        options={boardTasks}
        addLabel="+ parent"
        onAdd={() => parent && onAddParent(parent)}
      />
      <DepRow
        caption="Children"
        items={detail.links.children.map(label)}
        value={child}
        setValue={setChild}
        options={boardTasks}
        addLabel="+ child"
        onAdd={() => child && onAddChild(child)}
      />
    </div>
  );
}

function DepRow({
  caption,
  items,
  value,
  setValue,
  options,
  addLabel,
  onAdd,
}: {
  caption: string;
  items: string[];
  value: string;
  setValue: (v: string) => void;
  options: { id: string; title: string }[];
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="mb-2">
      <div className="text-xs text-white/45">
        {caption}: {items.length ? items.join(", ") : "none"}
      </div>
      <div className="mt-1 flex gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white focus:outline-none"
        >
          <option value="" className="bg-[#15181d]">
            — {caption === "Parents" ? "add parent" : "add child"} —
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-[#15181d]">
              {o.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            onAdd();
            setValue("");
          }}
          disabled={!value}
          className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40"
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function Attachments({
  count,
  names,
  onUpload,
}: {
  count: number;
  names: string[];
  onUpload: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
        Attachments ({count})
      </h3>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
      >
        <Paperclip className="h-3.5 w-3.5" /> Upload file
      </button>
      {names.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-white/60">
          {names.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentBox({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (body: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="border-t border-white/10 p-4">
      <textarea
        rows={1}
        value={text}
        disabled={disabled}
        placeholder="Add a comment… (Enter to submit)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const t = text.trim();
            if (t) {
              onSubmit(t);
              setText("");
            }
          }
        }}
        className="max-h-32 w-full resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
      />
    </div>
  );
}
