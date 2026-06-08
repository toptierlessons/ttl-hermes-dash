// Time formatting helpers. All output is in the BROWSER's local timezone
// (Intl/toLocale* default to the runtime zone), so timestamps the server
// stores in UTC / epoch render correctly for whoever is looking.

/** Coerce the various timestamp shapes the API returns into a Date.
 * - epoch seconds (e.g. session.started_at = 1780936760.19)
 * - epoch millis (e.g. message.timestamp)
 * - ISO strings (e.g. cron last_run_at) */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    // Heuristic: < 1e12 is seconds, otherwise millis.
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Absolute date + time in the local zone, e.g. "Jun 8, 2026, 4:39 PM". */
export function formatDateTime(
  value: string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Time only, local zone, e.g. "4:39 PM". */
export function formatTime(value: string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString(undefined, { timeStyle: "short" });
}

/** Short relative time, e.g. "just now", "5m ago", "3h ago", "2d ago".
 * Future instants read "in 5m" etc. (useful for cron next-run). */
export function formatRelative(
  value: string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  const diffMs = d.getTime() - Date.now();
  const past = diffMs <= 0;
  const s = Math.abs(diffMs) / 1000;
  const fmt = (n: number, unit: string) =>
    past ? `${n}${unit} ago` : `in ${n}${unit}`;
  if (s < 45) return past ? "just now" : "soon";
  const m = Math.round(s / 60);
  if (m < 60) return fmt(m, "m");
  const h = Math.round(m / 60);
  if (h < 24) return fmt(h, "h");
  const days = Math.round(h / 24);
  if (days < 30) return fmt(days, "d");
  // Older than a month — just show the date.
  return formatDateTime(d.getTime());
}

/** The viewer's IANA timezone name, e.g. "America/New_York". */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "local time";
  }
}
