import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package,
  Wrench,
  Plus,
  Loader2,
  X,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { api, type Skill, type Toolset } from "@/lib/api";

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [toolsets, setToolsets] = useState<Toolset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<string>("all"); // "all" | "toolsets" | <category>
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Selecting a filter also closes the mobile drawer.
  const selectView = (v: string) => {
    setView(v);
    setFiltersOpen(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        api.getSkills(),
        api.getToolsets().catch(() => [] as Toolset[]),
      ]);
      // Normalize: some skills come back with null category/description.
      setSkills(
        s.map((x) => ({
          ...x,
          category: x.category || "uncategorized",
          description: x.description || "",
        })),
      );
      setToolsets(t.map((x) => ({ ...x, description: x.description || "" })));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of skills) map.set(s.category, (map.get(s.category) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [skills]);

  async function toggleSkill(s: Skill) {
    setBusy(s.name);
    setSkills((prev) =>
      prev.map((x) => (x.name === s.name ? { ...x, enabled: !x.enabled } : x)),
    );
    try {
      await api.toggleSkill(s.name, !s.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load();
    } finally {
      setBusy(null);
    }
  }
  async function toggleToolset(t: Toolset) {
    setBusy(t.name);
    setToolsets((prev) =>
      prev.map((x) => (x.name === t.name ? { ...x, enabled: !x.enabled } : x)),
    );
    try {
      await api.toggleToolset(t.name, !t.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load();
    } finally {
      setBusy(null);
    }
  }

  const q = query.trim().toLowerCase();
  const showToolsets = view === "toolsets";
  const visibleSkills = skills
    .filter((s) => view === "all" || view === "toolsets" || s.category === view)
    .filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const visibleToolsets = toolsets
    .filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const headerLabel = showToolsets
    ? "Toolsets"
    : view === "all"
      ? "All"
      : titleCase(view);
  const count = showToolsets ? visibleToolsets.length : visibleSkills.length;

  return (
    <div className="flex h-full">
      {/* Backdrop (mobile, when the filter drawer is open) */}
      {filtersOpen && (
        <button
          aria-label="Close filters"
          onClick={() => setFiltersOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      {/* Filters — drawer below lg, static rail on desktop */}
      <div
        className={[
          "z-40 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-white/10 bg-[#0d1014] p-3",
          "fixed inset-y-0 left-0 transition-transform duration-200 ease-out",
          "lg:static lg:z-auto lg:w-60 lg:max-w-none lg:translate-x-0 lg:bg-black/20",
          filtersOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="mb-2 px-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
          Filters
        </div>
        <FilterRow
          icon={Package}
          label="All"
          count={skills.length}
          active={view === "all"}
          onClick={() => selectView("all")}
        />
        <FilterRow
          icon={Wrench}
          label="Toolsets"
          count={toolsets.length}
          active={view === "toolsets"}
          onClick={() => selectView("toolsets")}
        />
        <div className="mt-4 mb-1 px-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
          Categories
        </div>
        {categories.map(([cat, n]) => (
          <button
            key={cat}
            onClick={() => selectView(cat)}
            className={[
              "flex min-h-10 items-center gap-2 rounded-lg px-2 text-left text-sm",
              view === cat
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1 truncate">{titleCase(cat)}</span>
            <span className="text-xs text-white/40">{n}</span>
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <button
            onClick={() => setFiltersOpen(true)}
            className="-ml-1 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/10 lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" /> Filters
          </button>
          {showToolsets ? (
            <Wrench className="hidden h-5 w-5 text-white/50 lg:block" />
          ) : (
            <Package className="hidden h-5 w-5 text-white/50 lg:block" />
          )}
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
            {headerLabel}
          </h1>
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-white/45">
            {count} {showToolsets ? "toolsets" : "skills"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5">
              <Search className="h-4 w-4 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="w-28 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none sm:w-40"
              />
            </div>
            <button
              onClick={() => setNewOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New skill</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : showToolsets ? (
            <div className="space-y-1">
              {visibleToolsets.map((t) => (
                <Row
                  key={t.name}
                  name={t.label || t.name}
                  description={t.description}
                  enabled={t.enabled}
                  busy={busy === t.name}
                  onToggle={() => void toggleToolset(t)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {visibleSkills.map((s) => (
                <Row
                  key={s.name}
                  name={s.name}
                  description={s.description}
                  enabled={s.enabled}
                  busy={busy === s.name}
                  onToggle={() => void toggleSkill(s)}
                />
              ))}
              {visibleSkills.length === 0 && (
                <p className="text-sm text-white/40">No skills match.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {newOpen && (
        <NewSkillModal
          onClose={() => setNewOpen(false)}
          onCreate={async (body) => {
            setBusy("__create__");
            try {
              await api.createSkill(body);
              setNewOpen(false);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              throw e;
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </div>
  );
}

function FilterRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: typeof Package;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
        active
          ? "bg-white/10 text-white"
          : "text-white/60 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      <Icon className="h-4 w-4 shrink-0 text-white/50" />
      <span className="flex-1">{label}</span>
      <span className="text-xs text-white/35">{count}</span>
    </button>
  );
}

function Row({
  name,
  description,
  enabled,
  busy,
  onToggle,
}: {
  name: string;
  description: string;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-white/[0.02]">
      <ToggleSwitch enabled={enabled} busy={busy} onToggle={onToggle} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm text-white/90">{name}</div>
        {description && (
          <div className="mt-0.5 text-sm text-white/50">{description}</div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  busy,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={busy}
      title={
        enabled ? "Enabled — click to disable" : "Disabled — click to enable"
      }
      className={[
        "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        enabled ? "bg-sky-500" : "bg-white/15",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          enabled ? "translate-x-4" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

const SKILL_TEMPLATE = `---
name: my-skill
description: One-line description of when to use this skill.
---

# My Skill

Numbered steps, exact commands, and pitfalls go here.
`;

function NewSkillModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (body: {
    name: string;
    content: string;
    category?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState(SKILL_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const canCreate = !!name.trim() && !!content.trim() && !saving;

  async function submit() {
    if (!canCreate) return;
    setSaving(true);
    try {
      // The skill's displayed name comes from the SKILL.md frontmatter, not the
      // request's `name` field — keep them in sync so the skill isn't created
      // as the template's "my-skill".
      const trimmed = name.trim();
      const content2 = /^name:[ \t].*$/m.test(content)
        ? content.replace(/^name:[ \t].*$/m, `name: ${trimmed}`)
        : `---\nname: ${trimmed}\ndescription: One-line description.\n---\n\n${content}`;
      await onCreate({
        name: trimmed,
        content: content2,
        category: category.trim() || undefined,
      });
    } catch {
      /* error shown by parent */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#15181d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">New skill</h2>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 text-sm text-white/50">
            Author a custom skill — YAML frontmatter plus markdown instructions.
            It becomes available to the agent and attachable to cron jobs.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
                Name
              </span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-skill"
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
                Category (optional)
              </span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="devops"
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase">
              SKILL.md
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs leading-relaxed text-white/85 focus:border-white/30 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            disabled={!canCreate}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create skill
          </button>
        </div>
      </div>
    </div>
  );
}
