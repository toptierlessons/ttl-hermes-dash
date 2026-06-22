import { useState } from "react";
import { CornerDownLeft, HelpCircle } from "lucide-react";
import type { ClarifyPrompt } from "@/state/SessionsProvider";

/** Rich answer panel shown when the agent pauses to ask the user something
 * (gateway `clarify.request`). The agent is blocked until we reply, so this
 * stays active regardless of session "busy" state.
 *
 * Two ways to answer, since the agent accepts any string back: tap one of the
 * offered choices, or type a free-form reply. A local lock prevents a
 * double-submit while the response is in flight. */
export default function OptionPrompt({
  prompt,
  onChoose,
}: {
  prompt: ClarifyPrompt;
  onChoose: (choice: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [custom, setCustom] = useState("");

  function choose(choice: string) {
    const c = choice.trim();
    if (!c || submitting) return;
    setSubmitting(true);
    onChoose(c);
  }

  const hasChoices = prompt.choices.length > 0;

  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-400/6 p-4">
      <div className="mb-3 flex items-start gap-2 text-amber-100">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <span className="min-w-0 text-sm leading-snug font-medium wrap-break-word">
          {prompt.question || "Please choose an option"}
        </span>
      </div>

      {hasChoices && (
        <div className="grid gap-2 sm:grid-cols-2">
          {prompt.choices.map((choice) => (
            <button
              key={choice}
              disabled={submitting}
              onClick={() => choose(choice)}
              className="min-h-12 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left text-sm leading-snug wrap-break-word transition-colors hover:border-amber-300/50 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {/* Free-text fallback — always available, even with no listed choices. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          choose(custom);
        }}
        className={[
          "flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 pr-1.5 pl-3",
          "focus-within:border-amber-300/40",
          hasChoices ? "mt-3" : "",
        ].join(" ")}
      >
        <input
          value={custom}
          disabled={submitting}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={
            hasChoices ? "Or type your own answer…" : "Type your answer…"
          }
          className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white placeholder:text-white/35 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting || !custom.trim()}
          aria-label="Send answer"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-400/90 text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
