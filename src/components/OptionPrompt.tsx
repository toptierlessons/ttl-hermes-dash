import { useState } from "react";
import type { ClarifyPrompt } from "@/state/SessionsProvider";

/** Rich option picker shown when the agent asks the user to choose
 * (gateway `clarify.request`). Renders each choice as a large clickable
 * card — friendly for non-technical users.
 *
 * Note: a clarify request arrives mid-turn while the agent is paused waiting
 * on the answer, so the options stay clickable regardless of session "busy"
 * state. A local lock prevents a double-submit. */
export default function OptionPrompt({
  prompt,
  onChoose,
}: {
  prompt: ClarifyPrompt;
  onChoose: (choice: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting;
  function choose(choice: string) {
    if (submitting) return;
    setSubmitting(true);
    onChoose(choice);
  }
  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-200">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-400/20 text-xs">
          ?
        </span>
        {prompt.question || "Please choose an option"}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {prompt.choices.map((choice) => (
          <button
            key={choice}
            disabled={disabled}
            onClick={() => choose(choice)}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left text-sm transition-colors hover:border-amber-300/50 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}
