import {
  type ScheduleBuilderState,
  type ScheduleMode,
  type IntervalUnit,
  type Weekday,
  WEEKDAY_INDEXES,
  WEEKDAY_SHORT,
  schedulePreview,
} from "@/lib/schedule";

const MODES: { value: ScheduleMode; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "interval", label: "Every…" },
  { value: "once", label: "Once" },
];

const fieldCls =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none";

export default function SchedulePicker({
  state,
  onChange,
}: {
  state: ScheduleBuilderState;
  onChange: (next: ScheduleBuilderState) => void;
}) {
  const set = (patch: Partial<ScheduleBuilderState>) =>
    onChange({ ...state, ...patch });
  const preview = schedulePreview(state);

  return (
    <div className="space-y-3">
      <select
        value={state.mode}
        onChange={(e) => set({ mode: e.target.value as ScheduleMode })}
        className={fieldCls}
      >
        {MODES.map((m) => (
          <option key={m.value} value={m.value} className="bg-[#15181d]">
            {m.label}
          </option>
        ))}
      </select>

      {state.mode === "interval" && (
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={state.intervalValue}
            onChange={(e) => set({ intervalValue: Number(e.target.value) })}
            className={fieldCls}
          />
          <select
            value={state.intervalUnit}
            onChange={(e) =>
              set({ intervalUnit: e.target.value as IntervalUnit })
            }
            className={fieldCls}
          >
            <option value="minutes" className="bg-[#15181d]">
              minutes
            </option>
            <option value="hours" className="bg-[#15181d]">
              hours
            </option>
            <option value="days" className="bg-[#15181d]">
              days
            </option>
          </select>
        </div>
      )}

      {state.mode === "weekly" && (
        <div className="flex gap-1.5">
          {WEEKDAY_INDEXES.map((w) => {
            const on = state.weekdays.includes(w);
            return (
              <button
                key={w}
                type="button"
                onClick={() =>
                  set({
                    weekdays: on
                      ? state.weekdays.filter((d) => d !== w)
                      : ([...state.weekdays, w] as Weekday[]),
                  })
                }
                className={[
                  "h-9 flex-1 rounded-lg border text-xs",
                  on
                    ? "border-sky-400/50 bg-sky-400/15 text-sky-200"
                    : "border-white/15 bg-white/5 text-white/50 hover:bg-white/10",
                ].join(" ")}
              >
                {WEEKDAY_SHORT[w][0]}
              </button>
            );
          })}
        </div>
      )}

      {state.mode === "monthly" && (
        <label className="block text-xs text-white/50">
          Day of month
          <input
            type="number"
            min={1}
            max={31}
            value={state.dayOfMonth}
            onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
            className={`${fieldCls} mt-1`}
          />
        </label>
      )}

      {(state.mode === "daily" ||
        state.mode === "weekly" ||
        state.mode === "monthly") && (
        <label className="block text-xs text-white/50">
          Time of day (your timezone)
          <input
            type="time"
            value={state.timeOfDay}
            onChange={(e) => set({ timeOfDay: e.target.value })}
            className={`${fieldCls} mt-1`}
          />
        </label>
      )}

      {state.mode === "once" && (
        <label className="block text-xs text-white/50">
          Date &amp; time (your timezone)
          <input
            type="datetime-local"
            value={state.onceAt}
            onChange={(e) => set({ onceAt: e.target.value })}
            className={`${fieldCls} mt-1`}
          />
        </label>
      )}

      {preview ? (
        <div className="rounded-lg bg-white/3 px-3 py-2 text-xs">
          <div className="text-white/70">{preview.summary}</div>
          <div className="mt-0.5 text-white/35">
            Stored as <code className="text-white/55">{preview.stored}</code>{" "}
            (UTC) — fixed, won&apos;t shift for daylight saving.
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200/80">
          Pick a valid schedule to continue.
        </div>
      )}
    </div>
  );
}
