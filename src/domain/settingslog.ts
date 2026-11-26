// Turns audit entries about settings into change log rows: what changed, the old
// value and the new one. A sheet mapping is long JSON, so its row says which
// tabs and columns changed instead of printing both versions. Pure.

import { colorDef } from "./colors";

export interface LogEntry {
  id: number;
  at: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

export interface LogRow {
  id: number;
  at: string;
  what: string;
  old: string | null;
  new: string | null;
  /** Set when old and new are colors, so the page can show swatches. */
  colors?: { old: string | null; new: string | null };
}

type Tab = { kind?: string; tab?: string; columns?: Record<string, unknown>; [k: string]: unknown };
const tabsOf = (m: unknown): Tab[] => {
  const tabs = (m as { tabs?: unknown })?.tabs;
  return Array.isArray(tabs) ? (tabs as Tab[]) : [];
};
const tabName = (x: Tab) => `${x.tab ?? "?"}${x.kind ? ` (${x.kind})` : ""}`;

/** "Added tab X; removed tab Y; Connections: columns inScope added". Empty when nothing differs. */
export function mappingChange(before: unknown, after: unknown): { old: string; new: string } {
  const a = new Map(tabsOf(before).map((x) => [tabName(x), x]));
  const b = new Map(tabsOf(after).map((x) => [tabName(x), x]));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const changed: string[] = [];
  for (const [k, x] of b) {
    const y = a.get(k);
    if (!y) continue;
    const cx = (x.columns ?? {}) as Record<string, unknown>;
    const cy = (y.columns ?? {}) as Record<string, unknown>;
    const plus = Object.keys(cx).filter((c) => !(c in cy));
    const minus = Object.keys(cy).filter((c) => !(c in cx));
    const moved = Object.keys(cx).filter((c) => c in cy && JSON.stringify(cx[c]) !== JSON.stringify(cy[c]));
    const other = JSON.stringify({ ...x, columns: undefined }) !== JSON.stringify({ ...y, columns: undefined });
    const parts = [
      plus.length ? `added ${plus.join(", ")}` : "",
      minus.length ? `removed ${minus.join(", ")}` : "",
      moved.length ? `changed ${moved.join(", ")}` : "",
      other ? "other options" : "",
    ].filter(Boolean);
    if (parts.length) changed.push(`${k}: ${parts.join("; ")}`);
  }
  const old = [`${a.size} tab${a.size === 1 ? "" : "s"}`, removed.length ? `including ${removed.join(", ")}, now removed` : ""].filter(Boolean);
  const neu = [added.length ? `Added tabs: ${added.join(", ")}` : "", ...changed].filter(Boolean);
  return {
    old: old.join(", "),
    new: neu.length ? neu.join(". ") : "No change in tabs or columns",
  };
}

const val = (x: unknown) => (x as { value?: unknown })?.value;

export function logRow(e: LogEntry, sourceLabel: (id: string) => string): LogRow {
  if (e.entity === "setting" && e.entityId.startsWith("statusColors.")) {
    const key = e.entityId.slice("statusColors.".length);
    const o = (val(e.before) as string) ?? null;
    const n = (val(e.after) as string) ?? null;
    return { id: e.id, at: e.at, what: `Status color: ${colorDef(key)?.label ?? key}`, old: o, new: n, colors: { old: o, new: n } };
  }
  if (e.entity === "sheet_source") {
    const label = (e.after as { label?: string })?.label || sourceLabel(e.entityId);
    if (e.action === "create") return { id: e.id, at: e.at, what: `Sheet added: ${label}`, old: null, new: label };
    const before = (e.before as { mapping?: unknown })?.mapping;
    const after = (e.after as { mapping?: unknown })?.mapping;
    const d = mappingChange(before, after);
    return { id: e.id, at: e.at, what: `Sheet mapping: ${sourceLabel(e.entityId)}`, old: d.old, new: d.new };
  }
  const o = val(e.before);
  const n = val(e.after);
  return { id: e.id, at: e.at, what: `${e.entity}: ${e.entityId}`, old: o === undefined ? null : JSON.stringify(o), new: n === undefined ? null : JSON.stringify(n) };
}
