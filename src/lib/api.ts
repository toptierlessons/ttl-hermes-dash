// Trimmed copy of the Hermes web dashboard API client (web/src/lib/api.ts).
// Keeps only the auth/transport plumbing plus the status + session reads the
// new dashboard needs. Theme/plugin/admin endpoints are intentionally dropped.
//
// The dashboard can be served at the root of its host or under a URL prefix
// when reverse-proxied. The Python backend injects `window.__HERMES_BASE_PATH__`
// into index.html so the SPA can address its own `/api/...` URLs without a
// rebuild. Empty string means "served at root".
function readBasePath(): string {
  if (typeof window === "undefined") return "";
  const raw = window.__HERMES_BASE_PATH__ ?? "";
  if (!raw) return "";
  const withLead = raw.startsWith("/") ? raw : `/${raw}`;
  return withLead.replace(/\/+$/, "");
}

export const HERMES_BASE_PATH = readBasePath();
const BASE = HERMES_BASE_PATH;

// Ephemeral session token for protected endpoints. Injected into index.html
// by the server (or scraped + re-injected by the dev Vite plugin) — never
// fetched via API.
declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
    __HERMES_BASE_PATH__?: string;
    /** `true` when the dashboard's OAuth gate is engaged (public bind, no
     * `--insecure`). Toggles the WS-upgrade path from `?token=` to a
     * single-use `?ticket=` fetched via `getWsTicket`. */
    __HERMES_AUTH_REQUIRED__?: boolean;
  }
}

const SESSION_HEADER = "X-Hermes-Session-Token";

function setSessionHeader(headers: Headers, token: string): void {
  if (!headers.has(SESSION_HEADER)) {
    headers.set(SESSION_HEADER, token);
  }
}

interface FetchJSONOptions {
  /** When true, a 401 is surfaced as a thrown error rather than triggering
   *  the loopback stale-token page reload. */
  allowUnauthorized?: boolean;
}

export async function fetchJSON<T>(
  url: string,
  init?: RequestInit,
  options?: FetchJSONOptions,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = window.__HERMES_SESSION_TOKEN__;
  if (token) {
    setSessionHeader(headers, token);
  }
  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
  if (res.status === 401) {
    let body: { error?: string; login_url?: string } = {};
    try {
      body = await res.clone().json();
    } catch {
      /* non-JSON 401 — let it fall through */
    }
    if (
      (body.error === "unauthenticated" || body.error === "session_expired") &&
      body.login_url
    ) {
      window.location.assign(body.login_url);
      return new Promise<T>(() => {});
    }
    // Loopback mode: the session token rotates on every server restart. A tab
    // kept open across a restart holds the OLD token, so every fetch 401s.
    // The HTML is served `no-store`, so a reload picks up the fresh token.
    // Trigger that reload once on the first stale-token 401.
    if (!window.__HERMES_AUTH_REQUIRED__ && !options?.allowUnauthorized) {
      let alreadyReloaded = false;
      try {
        alreadyReloaded =
          sessionStorage.getItem("hermes.tokenReloadAttempted") === "1";
      } catch {
        /* privacy mode — fall through to throw */
      }
      if (!alreadyReloaded) {
        try {
          sessionStorage.setItem("hermes.tokenReloadAttempted", "1");
        } catch {
          /* best effort */
        }
        window.location.reload();
        return new Promise<T>(() => {});
      }
    }
  }
  if (res.ok) {
    try {
      sessionStorage.removeItem("hermes.tokenReloadAttempted");
    } catch {
      /* ignore */
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Authenticated `fetch` for `/api/...` requests that aren't plain JSON —
 * file uploads (`FormData`), binary downloads, etc. Mirrors `fetchJSON`'s
 * auth handling but returns the raw `Response` and never throws / redirects.
 */
export async function authedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = window.__HERMES_SESSION_TOKEN__;
  if (token) {
    setSessionHeader(headers, token);
  }
  return fetch(`${BASE}${url}`, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
}

/**
 * Fetch a single-use ticket for a WebSocket upgrade in gated mode. Browsers
 * can't set `Authorization` on a WS upgrade, so this REST round-trip bridges
 * cookie auth to WS auth. Tickets are single-use, TTL=30s.
 */
export async function getWsTicket(): Promise<{
  ticket: string;
  ttl_seconds: number;
}> {
  const res = await fetch(`${BASE}/api/auth/ws-ticket`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`/api/auth/ws-ticket: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Resolve the auth query-param pair (`[name, value]`) for a WebSocket connect.
 * Gated mode mints a fresh single-use ticket; loopback returns the token.
 */
export async function buildWsAuthParam(): Promise<[string, string]> {
  if (window.__HERMES_AUTH_REQUIRED__) {
    const { ticket } = await getWsTicket();
    return ["ticket", ticket];
  }
  const token = window.__HERMES_SESSION_TOKEN__ ?? "";
  return ["token", token];
}

/** Build an absolute `ws(s)://` URL for a dashboard WebSocket endpoint with
 * the correct auth query param appended for the active mode. */
export async function buildWsUrl(
  path: string,
  params?: Record<string, string>,
): Promise<string> {
  const [authName, authValue] = await buildWsAuthParam();
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const qs = new URLSearchParams(params ?? {});
  qs.set(authName, authValue);
  return `${proto}//${window.location.host}${BASE}${path}?${qs}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformStatus {
  error_code?: string;
  error_message?: string;
  state: string;
  updated_at: string;
}

export interface StatusResponse {
  active_sessions: number;
  auth_required?: boolean;
  auth_providers?: string[];
  config_path: string;
  config_version: number;
  env_path: string;
  gateway_exit_reason: string | null;
  gateway_health_url: string | null;
  gateway_pid: number | null;
  gateway_platforms: Record<string, PlatformStatus>;
  gateway_running: boolean;
  gateway_state: string | null;
  gateway_updated_at: string | null;
  hermes_home: string;
  latest_config_version: number;
  release_date: string;
  version: string;
}

export interface SessionInfo {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
  parent_session_id?: string | null;
}

export interface PaginatedSessions {
  sessions: SessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  tool_name?: string;
  tool_call_id?: string;
  timestamp?: number;
}

export interface SessionMessagesResponse {
  session_id: string;
  messages: SessionMessage[];
}

export interface SessionSearchResult {
  /** Matched text with the hit wrapped in `>>>` / `<<<` markers. */
  snippet: string;
  role: string;
  source: string | null;
  model: string | null;
  session_started: number;
  /** Stored session id — pass to `session.resume` to reopen. */
  session_id: string;
  lineage_root: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
}

export interface CronJob {
  id: string;
  profile?: string | null;
  profile_name?: string | null;
  name?: string | null;
  prompt?: string | null;
  schedule?: { kind?: string; expr?: string; display?: string };
  schedule_display?: string | null;
  enabled: boolean;
  state?: string | null;
  deliver?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_error?: string | null;
}

export interface CronDeliveryTarget {
  id: string;
  name: string;
  home_target_set: boolean;
  home_env_var: string | null;
}

export interface ProfileInfo {
  name: string;
  is_default?: boolean;
  model?: string | null;
  provider?: string | null;
  description?: string | null;
}

export interface SystemStats {
  os: string;
  os_release: string;
  arch: string;
  hostname: string;
  platform: string;
  python_version: string;
  python_impl: string;
  hermes_version: string;
  cpu_count: number;
  cpu_percent: number;
  load_avg: number[];
  uptime_seconds: number;
  memory: { total: number; available: number; used: number; percent: number };
  disk: { total: number; used: number; free: number; percent: number };
}

export interface UpdateCheckResponse {
  install_method: string;
  current_version: string;
  behind: number;
  update_available: boolean;
  can_apply: boolean;
  update_command: string;
  message: string;
}

export interface Skill {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

export interface AnalyticsDailyEntry {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsSkillEntry {
  skill: string;
  view_count: number;
  manage_count: number;
  total_count: number;
  percentage: number;
  last_used_at: number;
}

export interface AnalyticsResponse {
  daily: AnalyticsDailyEntry[];
  by_model: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    estimated_cost: number;
    sessions: number;
    api_calls: number;
  }>;
  totals: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  period_days: number;
  skills: {
    summary: {
      total_skill_loads: number;
      total_skill_edits: number;
      total_skill_actions: number;
      distinct_skills_used: number;
    };
    top_skills: AnalyticsSkillEntry[];
  };
}

export interface ModelAnalyticsEntry {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
  tool_calls: number;
  last_used_at: number;
  avg_tokens_per_session: number;
}

export interface ModelsAnalyticsResponse {
  models: ModelAnalyticsEntry[];
  totals: {
    distinct_models: number;
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  period_days: number;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  getStatus: () => fetchJSON<StatusResponse>("/api/status"),
  getSessions: (limit = 20, offset = 0) =>
    fetchJSON<PaginatedSessions>(
      `/api/sessions?limit=${limit}&offset=${offset}`,
    ),
  getSessionMessages: (id: string) =>
    fetchJSON<SessionMessagesResponse>(
      `/api/sessions/${encodeURIComponent(id)}/messages`,
    ),
  searchSessions: (q: string) =>
    fetchJSON<SessionSearchResponse>(
      `/api/sessions/search?q=${encodeURIComponent(q)}`,
    ),
  /** Permanently delete a stored session. Uses authedFetch so an empty 2xx
   * body doesn't trip JSON parsing. */
  deleteSession: async (id: string): Promise<void> => {
    const res = await authedFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Delete failed: HTTP ${res.status}`);
    }
  },

  // --- System / analytics / skills ---
  getSystemStats: () => fetchJSON<SystemStats>("/api/system/stats"),
  checkHermesUpdate: () =>
    fetchJSON<UpdateCheckResponse>("/api/hermes/update/check"),
  getAnalytics: (days = 30) =>
    fetchJSON<AnalyticsResponse>(`/api/analytics/usage?days=${days}`),
  getModelsAnalytics: (days = 30) =>
    fetchJSON<ModelsAnalyticsResponse>(`/api/analytics/models?days=${days}`),
  getSkills: () => fetchJSON<Skill[]>("/api/skills"),

  // --- Profiles ---
  getProfiles: () => fetchJSON<{ profiles: ProfileInfo[] }>("/api/profiles"),

  // --- Cron / scheduled tasks ---
  getCronJobs: (profile = "all") =>
    fetchJSON<CronJob[]>(
      `/api/cron/jobs?profile=${encodeURIComponent(profile)}`,
    ),
  getCronDeliveryTargets: () =>
    fetchJSON<{ targets: CronDeliveryTarget[] }>("/api/cron/delivery-targets"),
  createCronJob: (
    job: { prompt: string; schedule: string; name?: string; deliver?: string },
    profile = "default",
  ) =>
    fetchJSON<CronJob>(
      `/api/cron/jobs?profile=${encodeURIComponent(profile)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      },
    ),
  updateCronJob: (
    id: string,
    updates: Partial<{
      prompt: string;
      schedule: string;
      name: string;
      deliver: string;
    }>,
    profile = "default",
  ) =>
    fetchJSON<CronJob>(
      `/api/cron/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      },
    ),
  pauseCronJob: (id: string, profile = "default") =>
    fetchJSON<CronJob>(
      `/api/cron/jobs/${encodeURIComponent(id)}/pause?profile=${encodeURIComponent(profile)}`,
      { method: "POST" },
    ),
  resumeCronJob: (id: string, profile = "default") =>
    fetchJSON<CronJob>(
      `/api/cron/jobs/${encodeURIComponent(id)}/resume?profile=${encodeURIComponent(profile)}`,
      { method: "POST" },
    ),
  triggerCronJob: (id: string, profile = "default") =>
    fetchJSON<CronJob>(
      `/api/cron/jobs/${encodeURIComponent(id)}/trigger?profile=${encodeURIComponent(profile)}`,
      { method: "POST" },
    ),
  deleteCronJob: async (id: string, profile = "default"): Promise<void> => {
    const res = await authedFetch(
      `/api/cron/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
  },
};
