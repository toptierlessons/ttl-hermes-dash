import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Zap, Loader2, Trash2, X } from "lucide-react";
import {
  api,
  buildWsUrl,
  type KanbanBoard,
  type KanbanTask,
  type KanbanProfile,
} from "@/lib/api";
import { formatRelative } from "@/lib/time";
import KanbanTaskDrawer from "@/components/KanbanTaskDrawer";

/** The columns the board shows, in order, with friendly labels + help.
 * Mirrors the bundled Kanban plugin's COLUMN_ORDER / FALLBACK_COLUMN_* maps. */
const COLUMNS: { key: string; label: string; help: string }[] = [
  {
    key: "triage",
    label: "Triage",
    help: "Raw ideas — a specifier will flesh out the spec",
  },
  { key: "todo", label: "Todo", help: "Waiting on dependencies or unassigned" },
  {
    key: "ready",
    label: "Ready",
    help: "Dependencies satisfied; assign a profile to dispatch",
  },
  {
    key: "running",
    label: "In Progress",
    help: "Claimed by a worker — in-flight",
  },
  { key: "blocked", label: "Blocked", help: "Worker asked for human input" },
  { key: "done", label: "Done", help: "Completed" },
];
const ARCHIVED = { key: "archived", label: "Archived", help: "Archived tasks" };

function priorityLabel(p?: number): string | null {
  return p && p > 0 ? `P${p}` : null;
}
function progressText(p?: Record<string, number> | null): string | null {
  if (!p) return null;
  const total = p.total ?? p.steps ?? 0;
  if (!total) return null;
  const done = p.completed ?? p.done ?? p.current ?? 0;
  return `${done}/${total}`;
}

export default function KanbanPage() {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [tenant, setTenant] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [lanesByProfile, setLanesByProfile] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [addColumn, setAddColumn] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<KanbanProfile[]>([]);

  useEffect(() => {
    api
      .getKanbanProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch(() => setProfiles([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.getKanbanBoard();
      setBoard(data);
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

  // Live updates: tail task_events over a WebSocket and refetch (debounced).
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 400);
    };
    async function connect() {
      if (closed) return;
      try {
        const url = await buildWsUrl("/api/plugins/kanban/events");
        ws = new WebSocket(url);
        ws.onmessage = scheduleRefetch;
        ws.onclose = () => {
          if (!closed) reconnect = setTimeout(connect, 3000);
        };
      } catch {
        if (!closed) reconnect = setTimeout(connect, 3000);
      }
    }
    void connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      if (debounce) clearTimeout(debounce);
      ws?.close();
    };
  }, [load]);

  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Optimistic move, then PATCH status; refetch reconciles.
  async function moveTask(id: string, status: string) {
    setBoard((prev) => {
      if (!prev) return prev;
      let moved: KanbanTask | undefined;
      const stripped = prev.columns.map((c) => ({
        ...c,
        tasks: c.tasks.filter((t) => {
          if (t.id === id) {
            moved = t;
            return false;
          }
          return true;
        }),
      }));
      if (!moved) return prev;
      const movedTask = { ...moved, status };
      return {
        ...prev,
        columns: stripped.map((c) =>
          c.name === status ? { ...c, tasks: [movedTask, ...c.tasks] } : c,
        ),
      };
    });
    try {
      await api.updateKanbanTask(id, { status });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      void load();
    }
  }

  function matchesFilters(t: KanbanTask): boolean {
    if (tenant !== "all" && (t.tenant ?? "") !== tenant) return false;
    if (assignee !== "all" && (t.assignee ?? "") !== assignee) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay =
        `${t.id} ${t.title} ${t.assignee ?? ""} ${t.tenant ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  const colMap = new Map(board?.columns.map((c) => [c.name, c.tasks]) ?? []);
  const visibleColumns = showArchived ? [...COLUMNS, ARCHIVED] : COLUMNS;
  // Flat task list (id + title) for the drawer's dependency pickers.
  const allTasks =
    board?.columns.flatMap((c) =>
      c.tasks.map((t) => ({ id: t.id, title: t.title })),
    ) ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-b border-white/10 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Kanban
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void action(() => api.nudgeKanbanDispatcher())}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" /> Nudge dispatcher
            </button>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter cards…"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none sm:w-56"
          />
          <Select
            value={tenant}
            onChange={setTenant}
            allLabel="All tenants"
            options={board?.tenants ?? []}
          />
          <Select
            value={assignee}
            onChange={setAssignee}
            allLabel="All profiles"
            options={board?.assignees ?? []}
          />
          <Toggle
            checked={showArchived}
            onChange={setShowArchived}
            label="Show archived"
          />
          <Toggle
            checked={lanesByProfile}
            onChange={setLanesByProfile}
            label="Lanes by profile"
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Board */}
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading board…
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            {visibleColumns.map((col) => {
              const tasks = (colMap.get(col.key) ?? []).filter(matchesFilters);
              return (
                <Column
                  key={col.key}
                  col={col}
                  tasks={tasks}
                  lanesByProfile={lanesByProfile}
                  dragId={dragId}
                  onAdd={() => setAddColumn(col.key)}
                  onDropTask={(id) => void moveTask(id, col.key)}
                  onDragStart={setDragId}
                  onDragEnd={() => setDragId(null)}
                  onDelete={(id) => action(() => api.deleteKanbanTask(id))}
                  onOpen={setOpenTaskId}
                />
              );
            })}
          </div>
        )}
      </div>

      {openTaskId && (
        <KanbanTaskDrawer
          taskId={openTaskId}
          boardTasks={allTasks}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => void load()}
        />
      )}

      {addColumn && (
        <CreateTaskPanel
          columnLabel={
            COLUMNS.find((c) => c.key === addColumn)?.label ?? addColumn
          }
          profiles={profiles}
          busy={busy}
          onClose={() => setAddColumn(null)}
          onCreate={(body) =>
            action(() =>
              api
                .createKanbanTask({ ...body, status: addColumn })
                .then(() => setAddColumn(null)),
            )
          }
        />
      )}
    </div>
  );
}

function Column({
  col,
  tasks,
  lanesByProfile,
  dragId,
  onAdd,
  onDropTask,
  onDragStart,
  onDragEnd,
  onDelete,
  onOpen,
}: {
  col: { key: string; label: string; help: string };
  tasks: KanbanTask[];
  lanesByProfile: boolean;
  dragId: string | null;
  onAdd: () => void;
  onDropTask: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [over, setOver] = useState(false);

  // Group into lanes by assignee when enabled.
  const lanes = lanesByProfile
    ? groupByAssignee(tasks)
    : [{ name: null as string | null, tasks }];

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id);
      }}
      className={[
        "flex w-full flex-col rounded-xl border bg-white/[0.02] p-3 sm:w-80 sm:shrink-0",
        over && dragId ? "border-sky-400/50 bg-sky-400/5" : "border-white/10",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        <span className="text-sm font-semibold tracking-wide uppercase">
          {col.label}
        </span>
        <span className="ml-auto text-xs text-white/40">{tasks.length}</span>
        <button
          onClick={onAdd}
          title={`Add task to ${col.label}`}
          aria-label={`Add task to ${col.label}`}
          className="tap-square grid size-7 shrink-0 place-items-center rounded-lg border border-white/15 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 mb-3 text-xs text-white/35">{col.help}</p>

      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 py-6 text-center text-xs text-white/25">
            — no tasks —
          </div>
        ) : (
          lanes.map((lane) => (
            <div key={lane.name ?? "_"}>
              {lanesByProfile && lane.name !== null && (
                <div className="mt-1 mb-1.5 flex items-center gap-2 text-xs text-white/45">
                  <span className="font-medium tracking-wide uppercase">
                    {lane.name || "Unassigned"}
                  </span>
                  <span className="text-white/25">{lane.tasks.length}</span>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {lane.tasks.map((t) => (
                  <Card
                    key={t.id}
                    task={t}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDelete={onDelete}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Card({
  task,
  onDragStart,
  onDragEnd,
  onDelete,
  onOpen,
}: {
  task: KanbanTask;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const prio = priorityLabel(task.priority);
  const prog = progressText(task.progress);
  const deps = task.link_counts?.children ?? 0;
  const when = task.created_at ? formatRelative(task.created_at) : "";
  return (
    <div
      draggable
      onClick={() => onOpen(task.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      className="group cursor-pointer rounded-lg border border-white/10 bg-white/[0.04] p-3 hover:border-white/20"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-white/55">
          {task.id.toUpperCase()}
        </span>
        {prio && (
          <span className="rounded bg-amber-400/15 px-1 text-[0.7rem] text-amber-300">
            {prio}
          </span>
        )}
        {task.tenant && (
          <span className="rounded bg-white/10 px-1 text-[0.7rem] tracking-wide text-white/50 uppercase">
            {task.tenant}
          </span>
        )}
        {prog && (
          <span className="rounded bg-white/10 px-1 text-[0.7rem] text-white/50">
            {prog}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          title="Delete task"
          className="ml-auto text-white/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 text-sm leading-snug text-white/90">
        {task.title}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-white/40">
        {task.assignee && <span>@{task.assignee}</span>}
        {deps > 0 && <span>↦ {deps}</span>}
        {(task.comment_count ?? 0) > 0 && <span>💬 {task.comment_count}</span>}
        {when && <span className="ml-auto">{when}</span>}
      </div>
      {task.status === "blocked" && task.last_failure_error && (
        <div className="mt-2 truncate rounded bg-red-500/10 px-2 py-1 text-xs text-red-200">
          {task.last_failure_error}
        </div>
      )}
    </div>
  );
}

function groupByAssignee(
  tasks: KanbanTask[],
): { name: string | null; tasks: KanbanTask[] }[] {
  const map = new Map<string, KanbanTask[]>();
  for (const t of tasks) {
    const key = t.assignee ?? "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, tasks]) => ({ name, tasks }));
}

function Select({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white focus:outline-none"
    >
      <option value="all" className="bg-[#15181d]">
        {allLabel}
      </option>
      {options.map((o) => (
        <option key={o} value={o} className="bg-[#15181d]">
          {o}
        </option>
      ))}
    </select>
  );
}

function CreateTaskPanel({
  columnLabel,
  profiles,
  busy,
  onClose,
  onCreate,
}: {
  columnLabel: string;
  profiles: KanbanProfile[];
  busy: boolean;
  onClose: () => void;
  onCreate: (body: {
    title: string;
    body?: string;
    assignee?: string;
    priority?: number;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState(0);
  const canCreate = !!title.trim() && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#15181d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold">
            New task{" "}
            <span className="text-sm font-normal text-white/40">
              in {columnLabel}
            </span>
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
              Title
            </span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short, descriptive title…"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
              Description
            </span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={8}
              placeholder="Describe the task in detail — what should the agent do?"
              className="w-full resize-y rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
                Assignee
              </span>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="" className="bg-[#15181d]">
                  unassigned
                </option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name} className="bg-[#15181d]">
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
                Priority
              </span>
              <select
                value={String(priority)}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n} className="bg-[#15181d]">
                    {n === 0 ? "0 (none)" : `P${n}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            disabled={!canCreate}
            onClick={() =>
              onCreate({
                title: title.trim(),
                body: desc.trim() || undefined,
                assignee: assignee || undefined,
                priority: priority || undefined,
              })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-white/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-sky-500"
      />
      {label}
    </label>
  );
}
