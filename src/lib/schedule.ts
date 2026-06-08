/**
 * Schedule builder for the Scheduled Tasks (cron) UI.
 *
 * The Hermes backend interprets cron expressions in the SERVER's timezone,
 * which is UTC, and has no per-job timezone field (verified empirically).
 * To give non-technical users an intuitive local-time experience while
 * guaranteeing the run "never shifts on DST", we:
 *
 *   1. Let the user enter times in their OWN (browser) timezone.
 *   2. Convert that local time ONCE to the equivalent UTC cron expression
 *      and store that fixed expression.
 *
 * Because UTC observes no DST, a fixed UTC cron fires at the same absolute
 * instant forever — it never shifts. (Its local clock-time can read 1h
 * different after a DST change, which is the unavoidable consequence of
 * pinning to an absolute moment; we surface both times in the UI.)
 *
 * The backend `parse_schedule` grammar we target:
 *   - Interval (recurring):  "every 30m" | "every 2h" | "every 1d"
 *   - Cron (5-field, UTC):   "0 13 * * *"
 *   - ISO timestamp (once):  "2026-02-03T14:00:00"  (naive = server/UTC)
 */

export type ScheduleMode = "interval" | "daily" | "weekly" | "monthly" | "once";
export type IntervalUnit = "minutes" | "hours" | "days";

/** Cron weekday convention: Sunday = 0 .. Saturday = 6. */
export const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAY_INDEXES)[number];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ScheduleBuilderState {
  mode: ScheduleMode;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  /** "HH:MM" 24h, in the user's LOCAL timezone. */
  timeOfDay: string;
  /** Weekly: selected local weekdays (0..6). */
  weekdays: Weekday[];
  /** Monthly: 1..31, local. */
  dayOfMonth: number;
  /** Once: "YYYY-MM-DDTHH:MM" local, from <input type=datetime-local>. */
  onceAt: string;
}

export const DEFAULT_SCHEDULE_STATE: ScheduleBuilderState = {
  mode: "daily",
  intervalValue: 30,
  intervalUnit: "minutes",
  timeOfDay: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
  onceAt: "",
};

const UNIT_SUFFIX: Record<IntervalUnit, string> = {
  minutes: "m",
  hours: "h",
  days: "d",
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayDiff(aMs: number, bMs: number): number {
  return Math.round((aMs - bMs) / 86_400_000);
}

/** Local HH:MM → UTC fields, with the date carry (-1/0/+1) when the
 * conversion crosses midnight. */
function localToUtc(hour: number, minute: number) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const localDay = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const utcDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dayDelta: dayDiff(utcDay, localDay), // utcDate - localDate
  };
}

/** UTC HH:MM → local fields, with the date carry (-1/0/+1). */
function utcToLocal(hour: number, minute: number) {
  const now = new Date();
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
    ),
  );
  const localDay = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const utcDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    hour: d.getHours(),
    minute: d.getMinutes(),
    dayDelta: dayDiff(localDay, utcDay), // localDate - utcDate
  };
}

function parseTimeOfDay(
  value: string,
): { hour: number; minute: number } | null {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hh, mm] = value.split(":").map((x) => parseInt(x, 10));
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hour: hh, minute: mm };
}

/** The viewer's short timezone label, e.g. "EDT" or "GMT+2". */
export function tzLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "local";
  } catch {
    return "local";
  }
}

/** Format an h:m (24h) pair as a friendly local 12h string, e.g. "9:00 AM". */
function fmt12(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Build the backend schedule string (UTC) from local picker state.
 * Returns "" when the state is incomplete (caller disables submit). */
export function buildScheduleString(state: ScheduleBuilderState): string {
  switch (state.mode) {
    case "interval": {
      const n = Math.floor(state.intervalValue);
      if (!Number.isFinite(n) || n < 1) return "";
      return `every ${n}${UNIT_SUFFIX[state.intervalUnit]}`;
    }
    case "daily": {
      const t = parseTimeOfDay(state.timeOfDay);
      if (!t) return "";
      const u = localToUtc(t.hour, t.minute);
      return `${u.minute} ${u.hour} * * *`;
    }
    case "weekly": {
      const t = parseTimeOfDay(state.timeOfDay);
      if (!t || state.weekdays.length === 0) return "";
      const u = localToUtc(t.hour, t.minute);
      const days = [
        ...new Set(
          state.weekdays.map((w) => ((w + u.dayDelta + 7) % 7) as Weekday),
        ),
      ].sort((a, b) => a - b);
      return `${u.minute} ${u.hour} * * ${days.join(",")}`;
    }
    case "monthly": {
      const t = parseTimeOfDay(state.timeOfDay);
      if (!t) return "";
      const dom = Math.floor(state.dayOfMonth);
      if (dom < 1 || dom > 31) return "";
      const u = localToUtc(t.hour, t.minute);
      const shifted = Math.min(31, Math.max(1, dom + u.dayDelta));
      return `${u.minute} ${u.hour} ${shifted} * *`;
    }
    case "once": {
      if (!state.onceAt) return "";
      const d = new Date(state.onceAt); // parsed as local
      if (Number.isNaN(d.getTime())) return "";
      // Naive UTC wall-clock string (server interprets naive as its UTC zone).
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
        d.getUTCDate(),
      )}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:00`;
    }
  }
}

/** Preview shown under the form: a local-time summary plus the fixed UTC
 * expression that will be stored. */
export function schedulePreview(
  state: ScheduleBuilderState,
): { summary: string; stored: string } | null {
  const stored = buildScheduleString(state);
  if (!stored) return null;
  const tz = tzLabel();
  switch (state.mode) {
    case "interval": {
      const n = Math.floor(state.intervalValue);
      const unit =
        state.intervalUnit === "minutes"
          ? n === 1
            ? "minute"
            : "minutes"
          : state.intervalUnit === "hours"
            ? n === 1
              ? "hour"
              : "hours"
            : n === 1
              ? "day"
              : "days";
      return { summary: `Every ${n} ${unit}`, stored };
    }
    case "daily": {
      const t = parseTimeOfDay(state.timeOfDay)!;
      return { summary: `Daily at ${fmt12(t.hour, t.minute)} ${tz}`, stored };
    }
    case "weekly": {
      const t = parseTimeOfDay(state.timeOfDay)!;
      const days = [...state.weekdays]
        .sort((a, b) => a - b)
        .map((w) => WEEKDAY_SHORT[w])
        .join(", ");
      return {
        summary: `Weekly on ${days} at ${fmt12(t.hour, t.minute)} ${tz}`,
        stored,
      };
    }
    case "monthly": {
      const t = parseTimeOfDay(state.timeOfDay)!;
      return {
        summary: `Monthly on day ${Math.floor(state.dayOfMonth)} at ${fmt12(
          t.hour,
          t.minute,
        )} ${tz}`,
        stored,
      };
    }
    case "once": {
      const d = new Date(state.onceAt);
      return {
        summary: `Once on ${d.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })} ${tz}`,
        stored,
      };
    }
  }
}

interface StoredSchedule {
  kind?: string;
  expr?: string;
  display?: string;
  minutes?: number;
  run_at?: string;
}

/** Human cadence for a stored job, converted back into the viewer's local
 * timezone. Falls back to the raw display/expr for exotic expressions. */
export function describeStored(
  schedule: StoredSchedule | undefined,
  fallbackDisplay?: string | null,
): string {
  const expr =
    schedule?.expr ||
    (fallbackDisplay && fallbackDisplay.includes(" ") ? fallbackDisplay : "");

  if (schedule?.kind === "interval" && typeof schedule.minutes === "number") {
    const m = schedule.minutes;
    if (m % 1440 === 0) return `Every ${m / 1440} day(s)`;
    if (m % 60 === 0) return `Every ${m / 60} hour(s)`;
    return `Every ${m} minute(s)`;
  }
  if (schedule?.kind === "once" && schedule.run_at) {
    return `Once on ${new Date(schedule.run_at).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;
  }

  // Interval string like "every 30m" stored as display.
  const interval = (fallbackDisplay || "").match(/^every\s+(\d+)([mhd])$/i);
  if (interval) {
    const n = interval[1];
    const u = interval[2].toLowerCase();
    return `Every ${n} ${u === "m" ? "minute(s)" : u === "h" ? "hour(s)" : "day(s)"}`;
  }

  const human = expr ? describeCronLocal(expr) : null;
  if (human) return human;
  return (
    fallbackDisplay || schedule?.display || schedule?.expr || "Custom schedule"
  );
}

/** Convert a 5-field UTC cron expression to a local-timezone sentence.
 * Returns null for expressions too complex to humanize safely. */
function describeCronLocal(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = parts;
  if (monF !== "*") return null;
  const single = (f: string) => /^\d+$/.test(f);
  if (!single(minF) || !single(hourF)) return null;

  const { hour, minute, dayDelta } = utcToLocal(
    parseInt(hourF, 10),
    parseInt(minF, 10),
  );
  const time = `${fmt12(hour, minute)} ${tzLabel()}`;
  const domAll = domF === "*";
  const dowAll = dowF === "*";

  if (domAll && dowAll) return `Daily at ${time}`;

  if (domAll && !dowAll) {
    if (!/^\d+(,\d+)*$/.test(dowF)) return null;
    const local = [
      ...new Set(
        dowF
          .split(",")
          .map((n) => parseInt(n, 10))
          .filter((n) => n >= 0 && n <= 6)
          .map((w) => (w + dayDelta + 7) % 7),
      ),
    ].sort((a, b) => a - b);
    const days = local.map((w) => WEEKDAY_SHORT[w]).join(", ");
    return `Weekly on ${days} at ${time}`;
  }

  if (!domAll && dowAll && single(domF)) {
    const dom = Math.min(31, Math.max(1, parseInt(domF, 10) + dayDelta));
    return `Monthly on day ${dom} at ${time}`;
  }
  return null;
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/** Best-effort reverse: turn a stored (UTC) schedule back into local picker
 * state for editing. Unrecognized shapes fall back to the default. */
export function stateFromStored(
  schedule: StoredSchedule | undefined,
  display?: string | null,
): ScheduleBuilderState {
  const s: ScheduleBuilderState = { ...DEFAULT_SCHEDULE_STATE };
  const disp = display || schedule?.display || "";

  const iv = disp.match(/^every\s+(\d+)([mhd])$/i);
  if (iv) {
    s.mode = "interval";
    s.intervalValue = parseInt(iv[1], 10);
    s.intervalUnit =
      iv[2] === "m" ? "minutes" : iv[2] === "h" ? "hours" : "days";
    return s;
  }
  if (schedule?.kind === "interval" && typeof schedule.minutes === "number") {
    const m = schedule.minutes;
    s.mode = "interval";
    if (m % 1440 === 0)
      ((s.intervalUnit = "days"), (s.intervalValue = m / 1440));
    else if (m % 60 === 0)
      ((s.intervalUnit = "hours"), (s.intervalValue = m / 60));
    else ((s.intervalUnit = "minutes"), (s.intervalValue = m));
    return s;
  }
  if (schedule?.kind === "once" && schedule.run_at) {
    const d = new Date(schedule.run_at);
    if (!Number.isNaN(d.getTime())) {
      s.mode = "once";
      s.onceAt = toLocalInput(d);
      return s;
    }
  }

  const expr = schedule?.expr || (disp.split(/\s+/).length === 5 ? disp : "");
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [minF, hourF, domF, monF, dowF] = parts;
    if (monF === "*" && /^\d+$/.test(minF) && /^\d+$/.test(hourF)) {
      const loc = utcToLocal(parseInt(hourF, 10), parseInt(minF, 10));
      s.timeOfDay = `${pad2(loc.hour)}:${pad2(loc.minute)}`;
      const domAll = domF === "*";
      const dowAll = dowF === "*";
      if (domAll && dowAll) {
        s.mode = "daily";
      } else if (domAll && /^\d+(,\d+)*$/.test(dowF)) {
        s.mode = "weekly";
        s.weekdays = [
          ...new Set(
            dowF
              .split(",")
              .map(
                (n) => ((parseInt(n, 10) + loc.dayDelta + 7) % 7) as Weekday,
              ),
          ),
        ].sort((a, b) => a - b);
      } else if (dowAll && /^\d+$/.test(domF)) {
        s.mode = "monthly";
        s.dayOfMonth = Math.min(
          31,
          Math.max(1, parseInt(domF, 10) + loc.dayDelta),
        );
      }
    }
  }
  return s;
}
