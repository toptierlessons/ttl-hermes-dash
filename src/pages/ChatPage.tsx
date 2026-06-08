import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  X,
  MessageSquare,
  AlertCircle,
  Loader2,
  Search,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useSessions, type ChatSession } from "@/state/SessionsProvider";
import { api, type SessionSearchResult, type Skill } from "@/lib/api";
import { formatRelative } from "@/lib/time";
import MessageList from "@/components/MessageList";
import Composer from "@/components/Composer";
import OptionPrompt from "@/components/OptionPrompt";

const CHAT_GROUP = "Chat Sessions";
// Origins that are direct chat surfaces (vs. gateway platforms like Slack).
const CHAT_SOURCES = new Set(["cli", "tui", "web", "api"]);

/** Rail group a session belongs to, by origin. */
function groupLabel(source?: string): string {
  if (!source || CHAT_SOURCES.has(source)) return CHAT_GROUP;
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export default function ChatPage() {
  const {
    connection,
    sessions,
    activeId,
    historyLoading,
    createSession,
    openSession,
    sendPrompt,
    stopSession,
    runCommand,
    respondClarify,
    deleteSession,
  } = useSessions();

  // Skills for the composer's skills picker (server is source of truth).
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    api
      .getSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  // Delete confirmation modal state.
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSession(pendingDelete.id);
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const active = sessions.find((s) => s.id === activeId) ?? null;
  // Most-recently-active first; new chats (just stamped) bubble to the top.
  const ordered = [...sessions].sort((a, b) => b.lastActive - a.lastActive);

  // Group sessions by origin so hand-offs from other surfaces are easy to
  // find: local chat (cli/tui/web/api) vs each gateway platform (Slack, …).
  const groups = new Map<string, ChatSession[]>();
  for (const s of ordered) {
    const g = groupLabel(s.source);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(s);
  }
  const groupNames = [...groups.keys()].sort((a, b) =>
    a === CHAT_GROUP ? -1 : b === CHAT_GROUP ? 1 : a.localeCompare(b),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // --- Keep the active session in the URL (?session=<storedId>) so a refresh
  // or a shared link lands back on the same conversation. We track the STORED
  // id (stable across reloads) rather than the ephemeral live gateway id. ---
  const [searchParams, setSearchParams] = useSearchParams();
  const [restored, setRestored] = useState(false);
  const activeUrlId = active ? (active.storedId ?? active.id) : null;

  // Restore once, after the gateway is connected (resume needs the socket)
  // AND history has loaded — so the session is matched to its real rail entry
  // (with the correct `is_active`) instead of a freshly-stubbed one.
  useEffect(() => {
    if (restored || connection !== "open" || historyLoading) return;
    setRestored(true);
    const param = searchParams.get("session");
    if (param) void openSession(param);
  }, [restored, connection, historyLoading, searchParams, openSession]);

  // Mirror the active session back into the URL.
  useEffect(() => {
    if (!restored) return;
    const cur = searchParams.get("session");
    if ((activeUrlId ?? null) === (cur ?? null)) return;
    const next = new URLSearchParams(searchParams);
    if (activeUrlId) next.set("session", activeUrlId);
    else next.delete("session");
    setSearchParams(next, { replace: true });
  }, [restored, activeUrlId, searchParams, setSearchParams]);

  // Server-side semantic search over all stored sessions.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchSessions(q);
        if (cancelled) return;
        // One row per session (the search returns a hit per matching message).
        const seen = new Set<string>();
        setResults(
          res.results.filter((r) =>
            seen.has(r.session_id) ? false : (seen.add(r.session_id), true),
          ),
        );
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  function openResult(r: SessionSearchResult) {
    void openSession(r.session_id, stripMarkers(r.snippet));
    setQuery("");
  }

  return (
    <div className="flex h-full">
      {/* Session rail */}
      <div className="flex w-64 flex-col border-r border-white/10 bg-black/20">
        <div className="flex items-center justify-between p-3">
          <span className="text-sm font-medium text-white/70">Chats</span>
          <ConnBadge state={connection} />
        </div>
        <button
          onClick={() => void createSession()}
          disabled={connection !== "open"}
          className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> New chat
        </button>

        {/* Search across all stored sessions */}
        <div className="mx-3 mb-2 px-3">
          <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="shrink-0 text-white/40 hover:text-white/70"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {q.length >= 2 ? (
            <SearchResults
              query={q}
              results={results}
              searching={searching}
              onOpen={openResult}
            />
          ) : (
            <>
              {groupNames.map((name) => {
                const items = groups.get(name)!;
                const isCollapsed = collapsed.has(name);
                return (
                  <div key={name} className="mb-1">
                    <button
                      onClick={() => toggleGroup(name)}
                      className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-medium tracking-wide text-white/40 hover:text-white/70"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      <span className="uppercase">{name}</span>
                      <span className="ml-auto rounded bg-white/5 px-1.5 text-white/35">
                        {items.length}
                      </span>
                    </button>
                    {!isCollapsed &&
                      items.map((s) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          active={s.id === activeId}
                          onSelect={() => void openSession(s.id)}
                        />
                      ))}
                  </div>
                );
              })}
              {historyLoading && sessions.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/40">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
                  history…
                </div>
              )}
              {!historyLoading && sessions.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/30">
                  No chats yet. Start a new one above.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Active thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
              <MessageSquare className="h-4 w-4 shrink-0 text-white/40" />
              <span className="truncate text-sm font-medium">
                {active.title}
              </span>
              <ActiveBadge active={active.active} />
              {active.model && (
                <span className="ml-auto rounded-md bg-white/5 px-2 py-0.5 font-mono text-xs text-white/45">
                  {active.model}
                </span>
              )}
              <button
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(active);
                }}
                title="Delete conversation"
                className={[
                  "shrink-0 rounded-md p-1.5 text-white/40 hover:bg-red-500/10 hover:text-red-300",
                  active.model ? "" : "ml-auto",
                ].join(" ")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {active.loading && active.messages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading
                  conversation…
                </div>
              ) : (
                <MessageList
                  messages={active.messages}
                  activity={active.activity}
                />
              )}

              {(active.clarify || active.error) && (
                <div className="mx-auto w-full max-w-3xl px-4 pb-6">
                  {active.error && (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {active.error}
                    </div>
                  )}
                  {active.clarify && (
                    <OptionPrompt
                      prompt={active.clarify}
                      onChoose={(choice) =>
                        void respondClarify(
                          active.id,
                          active.clarify!.request_id,
                          choice,
                        )
                      }
                    />
                  )}
                </div>
              )}
            </div>

            <Composer
              busy={active.status === "busy"}
              blocked={!!active.clarify || active.loading}
              skills={skills}
              onSend={(text) => void sendPrompt(active.id, text)}
              onCommand={(cmd) => void runCommand(active.id, cmd)}
              onStop={() => void stopSession(active.id)}
            />
          </>
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center text-sm text-white/40">
            {connection === "error"
              ? "Can't reach the agent. Check the Health page."
              : sessions.length > 0
                ? "Select a chat on the left, or start a new one."
                : connection === "open"
                  ? "Start a new chat to begin."
                  : "Connecting…"}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          title={pendingDelete.title}
          deleting={deleting}
          error={deleteError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

function ConfirmDeleteModal({
  title,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={deleting ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#15181d] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2 text-base font-semibold">
          <Trash2 className="h-4 w-4 text-red-400" />
          Delete conversation?
        </div>
        <p className="text-sm text-white/60">
          “{title}” will be permanently deleted. This can’t be undone.
        </p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-60"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        "shrink-0 rounded-md px-2 py-0.5 text-xs",
        active
          ? "bg-emerald-400/15 text-emerald-300"
          : "bg-white/10 text-white/45",
      ].join(" ")}
    >
      {active ? "Active" : "Ended"}
    </span>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={[
        "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
        active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5",
      ].join(" ")}
    >
      {session.loading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/40" />
      ) : (
        <span
          title={session.active ? "Active" : "Ended"}
          className={[
            "h-1.5 w-1.5 shrink-0 rounded-full",
            session.active ? "bg-emerald-400" : "bg-white/25",
            session.status === "busy" ? "animate-pulse" : "",
          ].join(" ")}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={["truncate", session.opened ? "" : "text-white/45"].join(
            " ",
          )}
        >
          {session.title}
        </span>
        {session.lastActive > 0 && (
          <span className="truncate text-[0.7rem] text-white/30">
            {formatRelative(session.lastActive)}
          </span>
        )}
      </span>
      {session.clarify && (
        <span className="shrink-0 text-xs text-amber-300">?</span>
      )}
    </div>
  );
}

function SearchResults({
  query,
  results,
  searching,
  onOpen,
}: {
  query: string;
  results: SessionSearchResult[] | null;
  searching: boolean;
  onOpen: (r: SessionSearchResult) => void;
}) {
  if (searching && !results) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
      </div>
    );
  }
  if (results && results.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-white/30">
        No matches for “{query}”.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {results?.map((r) => (
        <button
          key={r.session_id}
          onClick={() => onOpen(r)}
          className="rounded-lg px-3 py-2 text-left hover:bg-white/5"
        >
          <div className="mb-0.5 flex items-center gap-2 text-xs text-white/40">
            <span className="capitalize">{r.role}</span>
            {r.source && <span>· {r.source}</span>}
          </div>
          <div className="line-clamp-2 text-xs leading-relaxed text-white/70">
            {highlightSnippet(r.snippet)}
          </div>
        </button>
      ))}
    </div>
  );
}

/** Remove the `>>>` / `<<<` match markers the search API wraps hits in. */
function stripMarkers(snippet: string): string {
  return snippet.replace(/>>>|<<</g, "").trim();
}

/** Render a search snippet, emphasising the `>>>match<<<` segments. */
function highlightSnippet(snippet: string) {
  const parts = snippet.split(/(>>>.*?<<<)/g);
  return parts.map((part, i) => {
    if (part.startsWith(">>>") && part.endsWith("<<<")) {
      return (
        <mark key={i} className="rounded bg-amber-300/25 px-0.5 text-amber-100">
          {part.slice(3, -3)}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function ConnBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "online", cls: "bg-emerald-400/15 text-emerald-300" },
    connecting: { label: "connecting", cls: "bg-amber-400/15 text-amber-300" },
    idle: { label: "connecting", cls: "bg-amber-400/15 text-amber-300" },
    closed: { label: "offline", cls: "bg-red-400/15 text-red-300" },
    error: { label: "offline", cls: "bg-red-400/15 text-red-300" },
  };
  const m = map[state] ?? map.idle;
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>
  );
}
