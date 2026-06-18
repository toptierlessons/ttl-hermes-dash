import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GatewayClient,
  type ConnectionState,
  type GatewayEvent,
} from "@/lib/gatewayClient";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types — modelled on the live gateway protocol (discovered empirically):
//   session.create        -> { session_id, stored_session_id, info:{ model } }
//   session.resume {session_id:<storedId>}
//                         -> { session_id:<NEW live id>, message_count,
//                              messages:[{role, text, reasoning?}], running, info }
//   prompt.submit         { session_id, text }
//   clarify.respond       { session_id, request_id, choice }
// Streaming events (all carry session_id = the LIVE id):
//   message.start | message.delta {text} | message.complete {text, reasoning}
//   reasoning.delta {text} | thinking.delta {text}
//   tool.start {tool_id, name, context} | tool.complete {tool_id, name}
//   clarify.request {question, choices[], request_id}
//   session.info {running, model, ...} | error {message}
//
// Session history is the server's responsibility — the rail is populated from
// REST `GET /api/sessions` on load (no client-side persistence). Opening a
// past session calls `session.resume` to load its transcript AND attach a live
// gateway handle, which mints a new live `session_id` that events route by.
// ---------------------------------------------------------------------------

export interface ChatMessage {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  streaming?: boolean;
}

/** A tool the agent invoked, shown inline in the thread. */
export interface ToolItem {
  kind: "tool";
  id: string;
  toolId?: string;
  name: string;
  /** Human-readable summary the agent attached (e.g. "Pick a color:"). */
  context?: string;
  /** Result summary once complete (stringified). */
  result?: string;
  status: "running" | "done" | "error";
  durationS?: number;
}

/** Output of a slash command run in the session (e.g. /help, /history). */
export interface SystemNote {
  kind: "system";
  id: string;
  command: string;
  text: string;
}

export type ThreadItem = ChatMessage | ToolItem | SystemNote;

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export interface ClarifyPrompt {
  request_id: string;
  question: string;
  choices: string[];
}

export interface ChatSession {
  /** The id used for gateway RPCs. For an opened session this is the live
   * gateway id; for an unopened history entry it's the stored id (until
   * `openSession` resumes it and swaps in the live id). */
  id: string;
  /** Persisted session id from `GET /api/sessions` — stable across reloads. */
  storedId?: string;
  title: string;
  model?: string;
  /** Origin of the session: "cli"/"tui"/"web"/"api" (chat) vs a gateway
   * platform like "slack"/"telegram"/"discord". Drives rail grouping. */
  source?: string;
  messages: ThreadItem[];
  status: "idle" | "busy";
  /** Server-side liveness: the session is ongoing (not ended/archived).
   * Distinct from `status`, which is the moment-to-moment agent activity. */
  active: boolean;
  /** True once a live gateway handle is attached (created or resumed). */
  opened: boolean;
  /** True while a `session.resume` is in flight. */
  loading?: boolean;
  /** Transient label of what the agent is doing (thinking text / tool name). */
  activity?: string;
  clarify?: ClarifyPrompt | null;
  error?: string | null;
  createdAt: number;
  lastActive: number;
}

interface SessionsContextValue {
  connection: ConnectionState;
  sessions: ChatSession[];
  activeId: string | null;
  historyLoading: boolean;
  setActiveId: (id: string) => void;
  createSession: () => Promise<string>;
  openSession: (sessionId: string, fallbackTitle?: string) => Promise<void>;
  sendPrompt: (sessionId: string, text: string) => Promise<void>;
  /** Interrupt a running turn (gateway `session.interrupt`). */
  stopSession: (sessionId: string) => Promise<void>;
  /** Run a native slash command (gateway `slash.exec`); output appended inline. */
  runCommand: (sessionId: string, command: string) => Promise<void>;
  respondClarify: (
    sessionId: string,
    requestId: string,
    choice: string,
  ) => Promise<void>;
  closeSession: (sessionId: string) => void;
  /** Permanently delete a session on the server and remove it locally. */
  deleteSession: (sessionId: string) => Promise<void>;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

let msgCounter = 0;
function nextMsgId(): string {
  return `m${++msgCounter}`;
}

/** Condense a tool result (object/string) into a short display string. */
function toolResultSummary(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") return result;
  try {
    const s = JSON.stringify(result);
    return s.length > 600 ? s.slice(0, 600) + "…" : s;
  } catch {
    return undefined;
  }
}

/** Map a `session.resume` transcript into renderable thread items —
 * user/assistant messages plus the intermediate `tool` turns. */
function mapResumeMessages(raw: unknown): ThreadItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadItem[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const role = r.role;
    if (role === "user" || role === "assistant") {
      const content =
        typeof r.text === "string"
          ? r.text
          : typeof r.content === "string"
            ? r.content
            : "";
      const reasoning =
        typeof r.reasoning === "string" && r.reasoning
          ? r.reasoning
          : undefined;
      if (!content && !reasoning) continue;
      out.push({ kind: "message", id: nextMsgId(), role, content, reasoning });
    } else if (role === "tool") {
      const name = typeof r.name === "string" ? r.name : "tool";
      const context = typeof r.context === "string" ? r.context : undefined;
      out.push({
        kind: "tool",
        id: nextMsgId(),
        name,
        context,
        result: toolResultSummary(r.result),
        status: "done",
      });
    }
  }
  return out;
}

const STREAM_EVENTS = [
  "message.start",
  "message.delta",
  "message.complete",
  "reasoning.delta",
  "thinking.delta",
  "tool.start",
  "tool.complete",
  "tool.generating",
  "clarify.request",
  "session.info",
  "error",
] as const;

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<GatewayClient | null>(null);
  if (!clientRef.current) clientRef.current = new GatewayClient();
  const gw = clientRef.current;

  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Mirror sessions into a ref so callbacks can read the current list without
  // re-subscribing or threading it through deps.
  const sessionsRef = useRef<ChatSession[]>(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  /** Immutably update one session by id. */
  const patch = useCallback(
    (id: string, fn: (s: ChatSession) => ChatSession) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
    },
    [],
  );

  /** Append streamed text to the currently-streaming assistant message,
   * creating one if none exists yet. A fresh bubble is created after any tool
   * cards, so the final answer renders below the tools it used. */
  const appendContent = useCallback(
    (id: string, text: string) => {
      if (!text) return;
      patch(id, (s) => {
        const msgs = [...s.messages];
        let idx = msgs.length - 1;
        while (
          idx >= 0 &&
          !(
            msgs[idx].kind === "message" &&
            (msgs[idx] as ChatMessage).role === "assistant" &&
            (msgs[idx] as ChatMessage).streaming
          )
        ) {
          idx--;
        }
        if (idx < 0) {
          msgs.push({
            kind: "message",
            id: nextMsgId(),
            role: "assistant",
            content: "",
            streaming: true,
          });
          idx = msgs.length - 1;
        }
        const cur = msgs[idx] as ChatMessage;
        msgs[idx] = { ...cur, content: cur.content + text };
        return { ...s, messages: msgs };
      });
    },
    [patch],
  );

  // Connect once and route events by session_id.
  useEffect(() => {
    const offState = gw.onState(setConnection);

    const handlers = STREAM_EVENTS.map((type) =>
      gw.on(type, (ev: GatewayEvent) => {
        const sid = ev.session_id;
        if (!sid) return;
        const p = (ev.payload ?? {}) as Record<string, unknown>;
        switch (ev.type) {
          case "message.start":
            // Don't create a bubble yet — the assistant bubble is created
            // lazily on the first content delta, so it lands after any tools.
            patch(sid, (s) => ({ ...s, status: "busy" }));
            break;
          case "message.delta":
            appendContent(sid, String(p.text ?? ""));
            break;
          case "reasoning.delta":
            // Reasoning streams as transient status; the full reasoning is
            // attached to the final message at message.complete.
            patch(sid, (s) => ({
              ...s,
              status: "busy",
              activity: "Reasoning…",
            }));
            break;
          case "thinking.delta": {
            const t = String(p.text ?? "").trim();
            if (t) patch(sid, (s) => ({ ...s, activity: t }));
            break;
          }
          case "message.complete":
            patch(sid, (s) => {
              const msgs = [...s.messages];
              const text = String(p.text ?? "");
              const reasoning =
                typeof p.reasoning === "string" && p.reasoning
                  ? p.reasoning
                  : undefined;
              // Finalize the last streaming assistant message.
              let i = msgs.length - 1;
              while (
                i >= 0 &&
                !(
                  msgs[i].kind === "message" &&
                  (msgs[i] as ChatMessage).role === "assistant" &&
                  (msgs[i] as ChatMessage).streaming
                )
              ) {
                i--;
              }
              if (i >= 0) {
                const cur = msgs[i] as ChatMessage;
                msgs[i] = {
                  ...cur,
                  content: text || cur.content,
                  reasoning: reasoning ?? cur.reasoning,
                  streaming: false,
                };
              } else if (text || reasoning) {
                // Pure tool turn with no streamed bubble — add the final text.
                msgs.push({
                  kind: "message",
                  id: nextMsgId(),
                  role: "assistant",
                  content: text,
                  reasoning,
                });
              }
              return {
                ...s,
                messages: msgs,
                status: "idle",
                activity: undefined,
              };
            });
            break;
          case "tool.generating":
            patch(sid, (s) => ({
              ...s,
              status: "busy",
              activity: p.name ? `Preparing ${String(p.name)}…` : "Working…",
            }));
            break;
          case "tool.start":
            patch(sid, (s) => {
              const msgs = [...s.messages];
              // Close any streaming assistant bubble so the tool card renders
              // after the text the agent emitted before calling it.
              const last = msgs[msgs.length - 1];
              if (
                last &&
                last.kind === "message" &&
                last.role === "assistant" &&
                last.streaming
              ) {
                if (last.content) {
                  msgs[msgs.length - 1] = { ...last, streaming: false };
                } else {
                  msgs.pop();
                }
              }
              msgs.push({
                kind: "tool",
                id: nextMsgId(),
                toolId: typeof p.tool_id === "string" ? p.tool_id : undefined,
                name: typeof p.name === "string" ? p.name : "tool",
                context: typeof p.context === "string" ? p.context : undefined,
                status: "running",
              });
              return {
                ...s,
                status: "busy",
                activity:
                  String(p.context ?? "") ||
                  (p.name ? `Using ${String(p.name)}…` : "Working…"),
              };
            });
            break;
          case "tool.complete":
            patch(sid, (s) => {
              const msgs = [...s.messages];
              const toolId = typeof p.tool_id === "string" ? p.tool_id : null;
              // Match by tool_id; else the last still-running tool item.
              let i = msgs.length - 1;
              while (i >= 0) {
                const it = msgs[i];
                if (
                  it.kind === "tool" &&
                  (toolId ? it.toolId === toolId : it.status === "running")
                ) {
                  break;
                }
                i--;
              }
              if (i >= 0) {
                const cur = msgs[i] as ToolItem;
                msgs[i] = {
                  ...cur,
                  status: p.error ? "error" : "done",
                  result:
                    toolResultSummary(p.result) ??
                    (typeof p.error === "string" ? p.error : cur.result),
                  durationS:
                    typeof p.duration_s === "number"
                      ? p.duration_s
                      : cur.durationS,
                };
              }
              return { ...s, messages: msgs };
            });
            break;
          case "clarify.request":
            patch(sid, (s) => {
              // The agent pauses here awaiting the answer. Close out any
              // in-flight assistant bubble so the picker reads cleanly; drop
              // it entirely if it never produced visible content.
              let msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (
                last &&
                last.kind === "message" &&
                last.role === "assistant" &&
                last.streaming
              ) {
                if (!last.content && !last.reasoning) {
                  msgs = msgs.slice(0, -1);
                } else {
                  msgs[msgs.length - 1] = { ...last, streaming: false };
                }
              }
              return {
                ...s,
                messages: msgs,
                activity: undefined,
                clarify: {
                  request_id: String(p.request_id ?? ""),
                  question: String(p.question ?? ""),
                  choices: Array.isArray(p.choices)
                    ? (p.choices as unknown[]).map(String)
                    : [],
                },
              };
            });
            break;
          case "session.info":
            patch(sid, (s) => ({
              ...s,
              model: typeof p.model === "string" ? p.model : s.model,
              status: p.running === true ? "busy" : s.status,
            }));
            break;
          case "error":
            patch(sid, (s) => ({
              ...s,
              error: String(p.message ?? "Unknown error"),
              status: "idle",
            }));
            break;
        }
      }),
    );

    gw.connect().catch(() => {
      /* state listener already reflects the error */
    });

    return () => {
      offState();
      handlers.forEach((off) => off());
    };
    // gw is a stable ref; patch/appendContent are stable.
  }, [gw, patch, appendContent]);

  // Populate the rail from server history once on mount. The server is the
  // source of truth for past sessions — this re-runs fresh on every reload, so
  // there's no client-side persistence to drift. REST auth doesn't depend on
  // the WS connection, so this can run independently.
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    (async () => {
      try {
        const res = await api.getSessions(40, 0);
        const hist: ChatSession[] = res.sessions
          .filter((s) => s.message_count > 0)
          .sort((a, b) => b.last_active - a.last_active)
          .map((s) => ({
            id: s.id,
            storedId: s.id,
            title: s.title || s.preview || "Untitled chat",
            model: s.model || undefined,
            source: s.source || undefined,
            messages: [],
            status: "idle",
            active: s.is_active,
            opened: false,
            clarify: null,
            error: null,
            createdAt: s.started_at,
            lastActive: s.last_active,
          }));
        setSessions((prev) => {
          // Keep any live sessions already created this load; dedupe history
          // against them by stored id.
          const liveStored = new Set(
            prev.map((p) => p.storedId).filter(Boolean) as string[],
          );
          return [...prev, ...hist.filter((h) => !liveStored.has(h.storedId!))];
        });
      } catch {
        /* history unavailable — rail just starts empty */
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, []);

  const createSession = useCallback(async (): Promise<string> => {
    const res = await gw.request<{
      session_id: string;
      stored_session_id?: string;
      info?: { model?: string };
    }>("session.create", {});
    const id = res.session_id;
    const now = Date.now();
    setSessions((prev) => [
      {
        id,
        storedId: res.stored_session_id,
        title: "New chat",
        model: res.info?.model,
        source: "web",
        messages: [],
        status: "idle",
        active: true,
        opened: true,
        clarify: null,
        error: null,
        createdAt: now,
        lastActive: now,
      },
      ...prev,
    ]);
    setActiveId(id);
    return id;
  }, [gw]);

  /** Open a session. Accepts either a rail id or a stored id (e.g. from a
   * search result, which may not be in the rail yet). If it's not already
   * open, `session.resume` loads the transcript and attaches a live gateway
   * handle, swapping in the live id that events route by. */
  const openSession = useCallback(
    async (sessionId: string, fallbackTitle?: string): Promise<void> => {
      const existing = sessionsRef.current.find(
        (x) => x.id === sessionId || x.storedId === sessionId,
      );
      if (existing?.opened) {
        setActiveId(existing.id);
        return;
      }

      // The row id we operate on: an existing unopened entry, or a fresh stub
      // (when opened from search and not yet in the rail).
      const rowId = existing?.id ?? sessionId;
      const storedId = existing?.storedId ?? sessionId;
      if (!existing) {
        const now = Date.now();
        const stub: ChatSession = {
          id: rowId,
          storedId,
          title: fallbackTitle?.slice(0, 40) || "Loading…",
          messages: [],
          status: "idle",
          // Opening/viewing a session must NOT imply it's active — let the
          // resume's `running` flag (below) decide. Defaulting to true made a
          // refresh-restored ended session wrongly read "Active".
          active: false,
          opened: false,
          loading: true,
          clarify: null,
          error: null,
          createdAt: now,
          lastActive: now,
        };
        setSessions((prev) =>
          prev.some((x) => x.id === rowId) ? prev : [stub, ...prev],
        );
      }
      setActiveId(rowId);
      patch(rowId, (x) => ({ ...x, loading: true, error: null }));
      try {
        const r = await gw.request<{
          session_id: string;
          messages?: unknown;
          running?: boolean;
          info?: { model?: string };
        }>("session.resume", { session_id: storedId });
        const liveId = r.session_id;
        const msgs = mapResumeMessages(r.messages);
        const firstUser = msgs.find(
          (m) => m.kind === "message" && m.role === "user",
        ) as ChatMessage | undefined;
        const firstUserText = firstUser?.content;
        const isPlaceholder = (t: string) =>
          !t || t === "Loading…" || t === "New chat";
        setSessions((prev) =>
          prev.map((x) =>
            x.id === rowId
              ? {
                  ...x,
                  id: liveId,
                  opened: true,
                  loading: false,
                  // Opening/viewing a session must NOT mark it active — keep
                  // the server's liveness, or reflect the live `running` flag.
                  active: r.running === true ? true : x.active,
                  messages: msgs,
                  model: r.info?.model ?? x.model,
                  status: r.running === true ? "busy" : "idle",
                  title:
                    isPlaceholder(x.title) && firstUserText
                      ? firstUserText.slice(0, 40)
                      : x.title,
                }
              : x,
          ),
        );
        setActiveId(liveId);
      } catch (e) {
        patch(rowId, (x) => ({
          ...x,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [gw, patch],
  );

  const sendPrompt = useCallback(
    async (sessionId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      patch(sessionId, (s) => ({
        ...s,
        status: "busy",
        error: null,
        // Sending a message means the session is now being worked on.
        active: true,
        activity: "Thinking…",
        lastActive: Date.now(),
        title:
          s.title === "New chat" && s.messages.length === 0
            ? trimmed.slice(0, 40)
            : s.title,
        messages: [
          ...s.messages,
          { kind: "message", id: nextMsgId(), role: "user", content: trimmed },
        ],
      }));
      try {
        await gw.request("prompt.submit", {
          session_id: sessionId,
          text: trimmed,
        });
      } catch (e) {
        patch(sessionId, (s) => ({
          ...s,
          status: "idle",
          activity: undefined,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [gw, patch],
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      try {
        await gw.request("session.interrupt", { session_id: sessionId });
      } catch {
        /* best effort — message.complete (if any) still finalizes below */
      }
      patch(sessionId, (s) => ({ ...s, status: "idle", activity: undefined }));
    },
    [gw, patch],
  );

  const runCommand = useCallback(
    async (sessionId: string, command: string) => {
      const cmd = command.trim();
      if (!cmd) return;
      const noteId = nextMsgId();
      patch(sessionId, (s) => ({
        ...s,
        status: "busy",
        error: null,
        activity: `Running ${cmd}…`,
        messages: [
          ...s.messages,
          { kind: "system", id: noteId, command: cmd, text: "" },
        ],
      }));
      try {
        const r = await gw.request<{ output?: string }>("slash.exec", {
          session_id: sessionId,
          command: cmd,
        });
        const out = stripAnsi(String(r?.output ?? "")).trim();
        patch(sessionId, (s) => ({
          ...s,
          status: "idle",
          activity: undefined,
          messages: s.messages.map((m) =>
            m.id === noteId && m.kind === "system"
              ? { ...m, text: out || "(done)" }
              : m,
          ),
        }));
      } catch (e) {
        patch(sessionId, (s) => ({
          ...s,
          status: "idle",
          activity: undefined,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [gw, patch],
  );

  const respondClarify = useCallback(
    async (sessionId: string, requestId: string, choice: string) => {
      // Optimistically clear the prompt and record the choice as a user turn.
      patch(sessionId, (s) => ({
        ...s,
        clarify: null,
        status: "busy",
        active: true,
        activity: "Thinking…",
        messages: [
          ...s.messages,
          { kind: "message", id: nextMsgId(), role: "user", content: choice },
        ],
      }));
      try {
        await gw.request("clarify.respond", {
          session_id: sessionId,
          request_id: requestId,
          choice,
        });
      } catch (e) {
        patch(sessionId, (s) => ({
          ...s,
          status: "idle",
          activity: undefined,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [gw, patch],
  );

  const closeSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setActiveId((cur) => {
        if (cur !== sessionId) return cur;
        const remaining = sessions.filter((s) => s.id !== sessionId);
        return remaining.length ? remaining[remaining.length - 1].id : null;
      });
    },
    [sessions],
  );

  const deleteSession = useCallback(async (sessionId: string) => {
    const s = sessionsRef.current.find((x) => x.id === sessionId);
    const storedId = s?.storedId;
    // A brand-new chat that never received a message isn't persisted on the
    // server yet, so its DELETE 404s — that's fine, just drop it locally.
    // Re-throw other failures so genuine errors still surface.
    if (storedId) {
      try {
        await api.deleteSession(storedId);
      } catch (e) {
        if (!(e instanceof Error && /\b404\b/.test(e.message))) throw e;
      }
    }
    setSessions((prev) => prev.filter((x) => x.id !== sessionId));
    setActiveId((cur) => (cur === sessionId ? null : cur));
  }, []);

  const value = useMemo<SessionsContextValue>(
    () => ({
      connection,
      sessions,
      activeId,
      historyLoading,
      setActiveId,
      createSession,
      openSession,
      sendPrompt,
      stopSession,
      runCommand,
      respondClarify,
      closeSession,
      deleteSession,
    }),
    [
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
      closeSession,
      deleteSession,
    ],
  );

  return (
    <SessionsContext.Provider value={value}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within SessionsProvider");
  return ctx;
}
