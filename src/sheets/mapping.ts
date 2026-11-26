// How a sheet's tabs and columns map to readiness records. Pure functions, so
// a mapping can be tested against sample rows without touching Google. Mapping
// files hold tab and column names only, never a client's data.

import { z } from "zod";
import { GATES, STAGES, WORKSTREAMS, type TaskStatus } from "@/domain/types";

const taskTab = z.object({
  kind: z.literal("tasks"),
  tab: z.string().min(1),
  /** Give this tab's rows their own dashboard card under this name (a stakeholder's list, say). They stay out of the main open counts. */
  card: z.string().min(1).optional(),
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
    /** A note or description column, shown under the item. */
    notes: z.string().optional(),
    /** The ticket in the team's work tracker: a number or a link to it. */
    ticket: z.string().optional(),
    /** A delivery ID in its own column, when the key column is something else. */
    delivery: z.string().optional(),
    built: z.string().optional(),
    released: z.string().optional(),
    demoed: z.string().optional(),
    accepted: z.string().optional(),
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
    /** "Customer" or "Supplier"; sets the type of a partner the sheet adds. */
    type: z.string().optional(),
    /** AS2, VAN or SFTP; sets the method when the app has none. */
    method: z.string().optional(),
    /** Marks the partners in this phase's scope ("Yes"). Blank means not decided; "No" means out. The dashboard shows in-scope partners first. */
    inScope: z.string().optional(),
  }),
  /** Row states that mean the step is finished, so it isn't the partner's next step. */
  doneStates: z.array(z.string()).default(["done", "complete", "completed", "closed"]),
});

/** One row per partner and transaction set, as an EDI register's transactions tab has it. */
const setTab = z.object({
  kind: z.literal("edi_sets"),
  tab: z.string().min(1),
  headerRow: z.number().int().min(1).default(1),
  columns: z.object({
    /** Matched to a partner by name, in any of the client's sheets. */
    partner: z.string(),
    set: z.string(),
    /** "Inbound to RxERP", "in", "Outbound", "out" and the like. */
    direction: z.string().optional(),
    /** Where the set stands: Not started, Mapping, Testing, Certified, Live… */
    status: z.string().optional(),
    /** The last test's result: Passed, Failed, Pending… */
    lastTest: z.string().optional(),
  }),
});

/**
 * Delivery progress kept on another tab (a stakeholder's list, say): rows
 * matched to items by their code (D37, DM-02…), filling Built, Released,
 * Demoed and Accepted. The first tab that has a value for an item wins.
 */
const progressTab = z.object({
  kind: z.literal("item_progress"),
  tab: z.string().min(1),
  headerRow: z.number().int().min(1).default(1),
  columns: z.object({
    /** The item's code, as the tasks tab's key column has it. */
    key: z.string(),
    built: z.string().optional(),
    released: z.string().optional(),
    demoed: z.string().optional(),
    accepted: z.string().optional(),
  }),
});

export const mappingSchema = z.object({ tabs: z.array(z.discriminatedUnion("kind", [taskTab, partnerTab, setTab, progressTab])).min(1) });
export type SheetMapping = z.infer<typeof mappingSchema>;
export type TaskTabMapping = z.infer<typeof taskTab>;
export type PartnerTabMapping = z.infer<typeof partnerTab>;
export type SetTabMapping = z.infer<typeof setTab>;
export type ProgressTabMapping = z.infer<typeof progressTab>;
export const PROGRESS_STEPS = ["built", "released", "demoed", "accepted"] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];
export type ItemProgress = Record<ProgressStep, string | null>;

export interface SheetSet {
  ref: string;
  partner: string;
  transaction: string;
  direction: "inbound" | "outbound";
  testStatus: "not_run" | "passed" | "failed";
  prodStatus: "not_live" | "live";
  /** The status words as written, for the heat map. */
  status: string | null;
}

export interface SheetTask {
  ref: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  lastUpdateAt: string | null;
  ownerName: string | null;
  notes: string | null;
  ticket: string | null;
  deliveryId: string | null;
  /** The status cell as written. */
  sheetStatus: string | null;
  card: string | null;
  progress: ItemProgress;
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
  /** The status cell as written, from the partner's last row. */
  status: string | null;
  type: "customer" | "supplier" | null;
  method: "AS2" | "VAN" | "SFTP" | null;
  /** From the scope column: null when the mapping has no scope column. */
  inScope: "yes" | "no" | "tbd" | null;
}

/** Reads a scope cell: yes, y, x, true or in mean in scope; no, n, false or out mean out; anything else is not decided. */
export function scopeOf(v: string): "yes" | "no" | "tbd" {
  const t = v.trim().toLowerCase();
  if (/^(yes|y|x|true|in|in scope)$/.test(t)) return "yes";
  if (/^(no|n|false|out|out of scope)$/.test(t)) return "no";
  return "tbd";
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

/** A cell that says something: blank and dash cells say nothing. */
const say = (v: string) => (v && !/^[-\u2013\u2014]+$/.test(v) ? v : null);

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
      lastUpdateAt: parseDate(cell(r, c.lastTouched)), ownerName: cell(r, c.owner) || null, notes: cell(r, c.notes) || null, ticket: cell(r, c.ticket) || null,
      deliveryId: say(cell(r, c.delivery)), sheetStatus: cell(r, c.status) || null, card: m.card ?? null,
      progress: { built: say(cell(r, c.built)), released: say(cell(r, c.released)), demoed: say(cell(r, c.demoed)), accepted: say(cell(r, c.accepted)) },
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
    const others = [c.nextStep, c.nextStepDate, c.status, c.lastContact].some((i) => i !== undefined && cell(r, i) !== "");
    if (!others && name.split(/\s+/).length > 5) continue;
    const p = byName.get(name) ?? { ref: `${m.tab}!${name}`, name, nextStep: null, nextStepDate: null, lastContact: null, defaultStage: m.defaultStage, status: null, type: null, method: null, inScope: null };
    const finished = done.has(cell(r, c.status).toLowerCase());
    const due = parseDate(cell(r, c.nextStepDate));
    // The partner's next step is its earliest open step.
    if (!finished && (p.nextStepDate === null || (due && due < p.nextStepDate))) {
      p.nextStep = cell(r, c.nextStep) || p.nextStep;
      p.nextStepDate = due ?? p.nextStepDate;
    }
    p.status = cell(r, c.status) || p.status;
    const type = cell(r, c.type).toLowerCase();
    if (type.startsWith("cust")) p.type = "customer"; else if (type.startsWith("supp") || type.startsWith("vend")) p.type = "supplier";
    const method = cell(r, c.method).toUpperCase().match(/^(AS2|VAN|SFTP)\b/);
    if (method) p.method = method[1] as "AS2" | "VAN" | "SFTP";
    if (c.inScope !== undefined && c.inScope >= 0) {
      // Any row of the partner marked in scope puts it in scope.
      const sc = scopeOf(cell(r, c.inScope));
      p.inScope = p.inScope === "yes" || sc === "yes" ? "yes" : p.inScope === "no" || sc === "no" ? "no" : "tbd";
    }
    const contact = parseDate(cell(r, c.lastContact));
    if (contact && (!p.lastContact || contact > p.lastContact)) p.lastContact = contact;
    byName.set(name, p);
  }
  return [...byName.values()];
}

export function mapSetRows(m: SetTabMapping, rows: string[][]): SheetSet[] {
  const { header, body } = table(rows, m.headerRow);
  const c = Object.fromEntries(Object.entries(m.columns).map(([k, v]) => [k, column(header, v, m.tab)])) as Record<keyof SetTabMapping["columns"], number>;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out = new Map<string, SheetSet>();
  for (const r of body) {
    const partner = cell(r, c.partner);
    const set = cell(r, c.set).match(/\b(\d{3})\b/)?.[1];
    if (!partner || !set) continue;
    const dir = cell(r, c.direction).toLowerCase();
    // "Inbound to RxERP" or "in" is inbound; "Outbound from …" or "out" is outbound. No direction reads as inbound.
    const direction = /^out|outbound|send/.test(dir) ? "outbound" : "inbound";
    const status = cell(r, c.status) || null;
    const test = cell(r, c.lastTest).toLowerCase();
    const st = (status ?? "").toLowerCase();
    const live = /\b(live|production)\b/.test(st) && !/not live/.test(st);
    const testStatus = /fail/.test(test) || /fail/.test(st) ? "failed" : /pass|certif|approved/.test(test) || /pass|certif|approved/.test(st) || live ? "passed" : "not_run";
    const ref = `${m.tab}!${partner}|${set}|${direction}`;
    out.set(ref, { ref, partner, transaction: set, direction, testStatus, prodStatus: live ? "live" : "not_live", status });
  }
  return [...out.values()];
}

/** Progress rows by item code. A blank or dash cell says nothing; a code listed twice keeps its first value for each step. */
export function mapProgressRows(m: ProgressTabMapping, rows: string[][]): Map<string, ItemProgress> {
  const { header, body } = table(rows, m.headerRow);
  const c = Object.fromEntries(Object.entries(m.columns).map(([k, v]) => [k, column(header, v, m.tab)])) as Record<keyof ProgressTabMapping["columns"], number>;
  const cell = (r: string[], i: number | undefined) => (i !== undefined && i >= 0 ? (r[i] ?? "").trim() : "");
  const out = new Map<string, ItemProgress>();
  for (const r of body) {
    const key = say(cell(r, c.key));
    if (!key) continue;
    const p = out.get(key) ?? { built: null, released: null, demoed: null, accepted: null };
    for (const step of PROGRESS_STEPS) p[step] ??= say(cell(r, c[step]));
    out.set(key, p);
  }
  return out;
}
