import { useRef, useState } from "react";
import { SendHorizontal, Square, BookOpen, Slash } from "lucide-react";
import type { Skill } from "@/lib/api";

/** Curated native slash commands surfaced in the "/" palette. Any other
 * "/command" the user types is still sent through as well. */
const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "List available commands" },
  { name: "/history", desc: "Show conversation history" },
  { name: "/title", desc: "Set a title for this chat" },
  { name: "/compress", desc: "Compress context to save tokens" },
  { name: "/retry", desc: "Retry the last message" },
  { name: "/undo", desc: "Undo the last turn" },
  { name: "/save", desc: "Save the conversation" },
  { name: "/model", desc: "Switch the model" },
];

export default function Composer({
  busy,
  blocked,
  skills,
  onSend,
  onCommand,
  onStop,
}: {
  busy?: boolean;
  blocked?: boolean;
  skills: Skill[];
  onSend: (text: string) => void;
  onCommand: (command: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const isCommand = text.trim().startsWith("/");
  // Show the command palette while the user is still typing the command name.
  const showPalette = isCommand && !text.trim().includes(" ");
  const filtered = showPalette
    ? COMMANDS.filter((c) => c.name.startsWith(text.trim()))
    : [];

  function submit() {
    const t = text.trim();
    if (!t || busy || blocked) return;
    if (t.startsWith("/")) onCommand(t);
    else onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function autosize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function pickCommand(name: string) {
    setText(name + " ");
    taRef.current?.focus();
  }

  function insertSkill(name: string) {
    setText((t) => `${t ? t.replace(/\s*$/, " ") : ""}Use the ${name} skill: `);
    setSkillsOpen(false);
    setSkillQuery("");
    taRef.current?.focus();
  }

  const skillMatches = skills.filter(
    (s) =>
      !skillQuery ||
      s.name.toLowerCase().includes(skillQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(skillQuery.toLowerCase()),
  );

  return (
    <div className="relative border-t border-white/10 bg-black/20 px-4 py-3">
      {/* Slash-command palette */}
      {showPalette && filtered.length > 0 && (
        <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-white/15 bg-[#15181d] shadow-lg">
          {filtered.map((c) => (
            <button
              key={c.name}
              onClick={() => pickCommand(c.name)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <Slash className="h-3.5 w-3.5 text-white/40" />
              <span className="font-mono text-white/80">{c.name}</span>
              <span className="truncate text-xs text-white/45">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Skills picker */}
      {skillsOpen && (
        <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-white/15 bg-[#15181d] shadow-lg">
          <input
            autoFocus
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
            placeholder="Search skills…"
            className="w-full border-b border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {skillMatches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-white/35">
                No skills found.
              </p>
            ) : (
              skillMatches.slice(0, 40).map((s) => (
                <button
                  key={s.name}
                  onClick={() => insertSkill(s.name)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-white/5"
                >
                  <span className="font-mono text-xs text-white/80">
                    {s.name}
                  </span>
                  <span className="line-clamp-1 text-xs text-white/45">
                    {s.description}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-3 py-2">
        <button
          type="button"
          onClick={() => setSkillsOpen((v) => !v)}
          title="Insert a skill"
          className={
            skillsOpen ? "text-sky-300" : "text-white/40 hover:text-white/70"
          }
        >
          <BookOpen className="h-5 w-5" />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder="Send a message…"
          onChange={(e) => {
            setText(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={onKeyDown}
          className="max-h-48 flex-1 resize-none bg-transparent py-1.5 text-sm text-white placeholder:text-white/35 focus:outline-none"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-white hover:bg-white/25"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={blocked || !text.trim()}
            className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500 text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl text-center text-xs text-white/30">
        {isCommand
          ? "Runs a native command"
          : "Enter to send · Shift+Enter for a new line · / for commands"}
      </p>
    </div>
  );
}
