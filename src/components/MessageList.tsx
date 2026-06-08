import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  Loader2,
  Check,
  TriangleAlert,
} from "lucide-react";
import { Terminal } from "lucide-react";
import type {
  ChatMessage,
  ThreadItem,
  ToolItem,
  SystemNote,
} from "@/state/SessionsProvider";

export default function MessageList({
  messages,
  activity,
}: {
  messages: ThreadItem[];
  activity?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom as content streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activity]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      {messages.map((m) =>
        m.kind === "tool" ? (
          <ToolCard key={m.id} tool={m} />
        ) : m.kind === "system" ? (
          <SystemCard key={m.id} note={m} />
        ) : (
          <MessageBubble key={m.id} msg={m} />
        ),
      )}
      {activity && (
        <div className="flex items-center gap-2 text-sm text-white/45">
          <span className="inline-flex gap-1">
            <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
          </span>
          {activity}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-sky-500/15 px-4 py-2.5 text-sm whitespace-pre-wrap text-sky-50">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {msg.reasoning && <Reasoning text={msg.reasoning} />}
      <div className="md text-white/90">
        {msg.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content}
          </ReactMarkdown>
        ) : msg.streaming ? (
          <span className="text-white/40">…</span>
        ) : null}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const expandable = !!tool.result;
  return (
    <div
      data-testid="tool-card"
      className="rounded-lg border border-white/10 bg-white/[0.03]"
    >
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={[
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
          expandable ? "hover:bg-white/[0.04]" : "cursor-default",
        ].join(" ")}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-white/40" />
        <span className="font-mono text-xs text-white/70">{tool.name}</span>
        {tool.context && (
          <span className="min-w-0 flex-1 truncate text-xs text-white/45">
            {tool.context}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {typeof tool.durationS === "number" && tool.status !== "running" && (
            <span className="text-xs text-white/30">
              {tool.durationS < 1
                ? `${Math.round(tool.durationS * 1000)}ms`
                : `${tool.durationS.toFixed(1)}s`}
            </span>
          )}
          <ToolStatus status={tool.status} />
          {expandable &&
            (open ? (
              <ChevronDown className="h-3.5 w-3.5 text-white/40" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-white/40" />
            ))}
        </span>
      </button>
      {open && tool.result && (
        <pre className="overflow-x-auto border-t border-white/10 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-white/55">
          {tool.result}
        </pre>
      )}
    </div>
  );
}

function SystemCard({ note }: { note: SystemNote }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs text-white/55">
        <Terminal className="h-3.5 w-3.5" />
        <span className="font-mono">{note.command}</span>
      </div>
      {note.text && (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-white/60">
          {note.text}
        </pre>
      )}
    </div>
  );
}

function ToolStatus({ status }: { status: ToolItem["status"] }) {
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />;
  if (status === "error")
    return <TriangleAlert className="h-3.5 w-3.5 text-red-400" />;
  return <Check className="h-3.5 w-3.5 text-emerald-400" />;
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-white/45 hover:text-white/70"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Reasoning
      </button>
      {open && (
        <div className="px-3 pb-2.5 text-xs leading-relaxed whitespace-pre-wrap text-white/55">
          {text}
        </div>
      )}
    </div>
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-white/40"
      style={{ animationDelay: delay }}
    />
  );
}
