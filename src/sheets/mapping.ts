// How a sheet's tabs and columns map to readiness records. Pure functions, so
// a mapping can be tested against sample rows without touching Google. Mapping
// files hold tab and column names only, never a client's data.

import { z } from "zod";
import { GATES, STAGES, WORKSTREAMS, type TaskStatus } from "@/domain/types";

const taskTab = z.object({
  kind: z.literal("tasks"),
  tab: z.string().min(1),
  headerRow: z.number().int().min(1).default(1),
  defaults: z.object({
    workstream: z.enum(WORKSTREAMS),
    stage: z.enum(STAGES),
    gate: z.enum(GATES).nullable().default(null),
    critical: z.boolean().default(false),
  }),
  columns: z.object({
    key: z.string(),
    title: z.string(),
    status: z.string().optional(),
    due: z.string().optional(),
    completed: z.string().optional(),
    lastTouched: z.string().optional(),
    owner: z.string().optional(),
  }),
  statusMap: z.record(z.string(), z.enum(["not_started", "in_progress", "blocked", "done"])).default({}),
});

const partnerTab = z.object({
  kind: z.literal("edi_partners"),
  tab: z.string().min(1),
  headerRow: z.number().int().min(1).default(1),
  /** Stage for a partner the sheet adds; later reads never change a stage set in the app. */
  defaultStage: z.number().int().min(1).max(10).default(1),
  columns: z.object({
    name: z.string(),
    nextStep: z.string().optional(),
    nextStepDate: z.string().optional(),
    status: z.string().optional(),
    lastContact: z.string().optional(),
  }),
  /** Row states that mean the step is finished, so it isn't the partner's next step. */
  doneStates: z.array(z.string()).default(["done", "complete", "completed", "closed"]),
});

export const mappingSchema = z.object({ tabs: z.array(z.discriminatedUnion("kind", [taskTab, partnerTab])).min(1) });
export type SheetMapping = z.infer<typeof mappingSchema>;
export type TaskTabMapping = z.infer<typeof taskTab>;
export type PartnerTabMapping = z.infer<typeof partnerTab>;

export interface SheetTask {
  ref: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  lastUpdateAt: string | null;
  ownerName: string | null;
  workstream: TaskTabMapping["defaults"]["workstream"];
  stage: TaskTabMapping["defaults"]["stage"];
  gateKey: TaskTabMapping["defaults"]["gate"];
  critical: boolean;
}

export interface SheetPartner {
  ref: string;
  name: string;
  nextStep: string | null;
  nextStepDate: string | null;
  lastContact: string | null;
  defaultStage: number;
}

/** Accepts 2026-11-26, 11/26/2026 and 26 Nov 2026. Anything else is no date. */
export function parseDate(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  if (!s || s === "-") return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && months.includes(m[2].toLowerCase())) return iso(+m[3], months.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function guessStatus(raw: string, map: Record<string, TaskStatus>): TaskStatus {
  const s = raw.trim();
  const exact = map[s] ?? map[s.toUpperCase()] ?? map[s.toLowerCase()];
  if (exact) return exact;
  const l = s.toLowerCase();
  if (/(^|\b)(done|complete|completed|closed|shipped|delivered)(\b|$)/.test(l)) return "done";
  if (/block/.test(l)) return "blocked";
  if (!l || /not started|to do|todo/.test(l)) return "not_started";
  return "in_progress";
}

function table(rows: string[][], headerRow: number): { header: string[]; body: string[][] } {
  const header = (rows[headerRow - 1] ?? []).map((h) => h.replace(/\s+/g, " ").trim());
  return { header, body: rows.slice(headerRow) };
}

function column(header: string[], name: string | undefined, tab: string): number {
  if (!name) return -1;
  const want = name.replace(/\s+/g, " ").trim().toLowerCase();
  const i = header.findIndex((h) => h.toLowerCase() === want);
  if (i < 0) throw new Error(`Tab "${tab}" has no column "${name}". Columns: ${header.filter(Boolean).join(", ")}`);
  return i;
}

export function mapTaskRows(m: TaskTabMapping, rows: string[][]): SheetTask[] {
  const { header, body } = table(rows, m.headerRow);
  const c = Object.fromEntries(Object.entries(m.columns).map(([k, v]) => [k, column(header, v, m.tab)])) as Record<keyof TaskTabMapping["columns"], number>;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out: SheetTask[] = [];
  // A blank key marks a heading row, which is skipped. A key that is only a
  // dash means "no ID yet", so the row is keyed by its title. A key the tab
  // repeats (several rows coded "EDI", say) is joined with the row's title, so
  // each row stays its own item and keeps its key when rows are reordered.
  const isDash = (k: string) => /^[-\u2013\u2014]+$/.test(k);
  const counts = new Map<string, number>();
  for (const r of body) {
    const k = cell(r, c.key);
    if (k && cell(r, c.title) && !isDash(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const used = new Map<string, number>();
  for (const r of body) {
    const title = cell(r, c.title);
    const raw = cell(r, c.key);
    if (!raw || !title) continue; // section headings and blank rows
    const base = isDash(raw) ? title : (counts.get(raw) ?? 0) > 1 ? `${raw} ${title}` : raw;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const key = n === 1 ? base : `${base}#${n}`;
    const completedAt = parseDate(cell(r, c.completed));
    let status = c.status >= 0 ? guessStatus(cell(r, c.status), m.statusMap) : completedAt ? "done" : "not_started";
    if (completedAt && status !== "done" && c.status < 0) status = "done";
    out.push({
      ref: `${m.tab}!${key}`, title, status, dueDate: parseDate(cell(r, c.due)), completedAt,
      lastUpdateAt: parseDate(cell(r, c.lastTouched)), ownerName: cell(r, c.owner) || null,
      workstream: m.defaults.workstream, stage: m.defaults.stage, gateKey: m.defaults.gate, critical: m.defaults.critical,
    });
  }
  return out;
}

export function mapPartnerRows(m: PartnerTabMapping, rows: string[][]): SheetPartner[] {
  const { header, body } = table(rows, m.headerRow);
  const c = Object.fromEntries(Object.entries(m.columns).map(([k, v]) => [k, column(header, v, m.tab)])) as Record<keyof PartnerTabMapping["columns"], number>;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const done = new Set(m.doneStates.map((s) => s.toLowerCase()));
  const byName = new Map<string, SheetPartner>();
  for (const r of body) {
    const name = cell(r, c.name);
    if (!name) continue;
    // A row with a sentence in the name column and nothing else filled is a note, not a partner.
    const others = [c.nextStep, c.nextStepDate, c.status, c.lastContact].some((i) => cell(r, i) !== "");
    if (!others && name.split(/\s+/).length > 5) continue;
    const p = byName.get(name) ?? { ref: `${m.tab}!${name}`, name, nextStep: null, nextStepDate: null, lastContact: null, defaultStage: m.defaultStage };
    const finished = done.has(cell(r, c.status).toLowerCase());
    const due = parseDate(cell(r, c.nextStepDate));
    // The partner's next step is its earliest open step.
    if (!finished && (p.nextStepDate === null || (due && due < p.nextStepDate))) {
      p.nextStep = cell(r, c.nextStep) || p.nextStep;
      p.nextStepDate = due ?? p.nextStepDate;
    }
    const contact = parseDate(cell(r, c.lastContact));
    if (contact && (!p.lastContact || contact > p.lastContact)) p.lastContact = contact;
    byName.set(name, p);
  }
  return [...byName.values()];
}
