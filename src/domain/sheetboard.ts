// The home page's lead section: for each client whose work is read from a
// tracking sheet, what is open, what is past due and by how much, who owns it,
// and where each EDI partner stands. Pure: the page passes in rows and sources.

import { addDays, calendarDaysBetween, parse, workingDaysBetween, type ISODate } from "./calendar";
import type { PortfolioRow } from "./portfolio";
import { EDI_STAGES } from "./edi";
import { SHEET_PLAN } from "./template";
import { CORE_STREAMS, STREAMS, codeOf, streamOf, type StreamKey } from "./streams";

export interface SheetItem {
  id: string;
  title: string;
  /** The item's short name: the title before its first colon, or the whole title. */
  name: string;
  /** The sheet's note for the row, else the title after its first colon. */
  description: string | null;
  tab: string;
  /** Built, Released, Demoed and Accepted as the sheet writes them; null where it says nothing. */
  /** The item's ID in the sheet (D37, DM-02, A04), when its key is a code rather than a title. */
  code: string | null;
  /** The delivery ID: the sheet's own delivery column where mapped, else the code. */
  deliveryId: string | null;
  /** The sheet's status words as written. */
  status: string | null;
  /** The work-tracker ticket: its number, and a link only when the sheet gives one to the tracker's own site. */
  ticket: { number: string | null; url: string | null } | null;
  progress: { built: string | null; released: string | null; demoed: string | null; accepted: string | null };
  due: ISODate | null;
  daysLate: number;
  owner: string | null;
  blocked: boolean;
  stream: StreamKey;
  /** The heat-map column the item falls in: a week's Monday, "nodate", or null when it is further out than the map shows. */
  week: string | null;
}

export interface SheetPartner {
  id: string;
  name: string;
  nextStep: string | null;
  nextStepDate: ISODate | null;
  daysLate: number;
  owner: string | null;
  type: "supplier" | "customer";
  method: string | null;
  stage: number;
  stageLabel: string;
  lastContact: ISODate | null;
  blocker: string | null;
  /** The status as the tracking sheet words it, when the partner comes from a sheet. */
  sheetStatus: string | null;
  /** In this phase's scope: yes, no, or not decided. */
  inScope: "yes" | "no" | "tbd";
  /** Transaction sets in the test matrix, as "850 out", with their test result and the sheet's own status words. */
  sets: { label: string; transaction: string; direction: "inbound" | "outbound"; testStatus: "passed" | "failed" | "not_run"; live: boolean; sheetStatus: string | null }[];
}

/** Open work in one business work stream. */
export interface StreamSplit { key: StreamKey; label: string; open: number; pastDue: number; dueSoon: number; noDate: number; done: number; total: number }

/** Open items by work stream and the week they are due: the heat map. */
export interface StreamHeat {
  /** Columns: weeks (Monday) then "nodate". The first week also holds anything older. */
  columns: { key: string; label: string; past: boolean; isThisWeek: boolean; orEarlier: boolean }[];
  rows: { key: StreamKey; label: string; cells: Record<string, number>; open: number }[];
  max: number;
}

/** Open work in one tab, split by when it is due. */
export interface TabSplit { tab: string; pastDue: number; dueSoon: number; later: number; noDate: number; done: number }

/** Open items by the week (Monday) they are due. */
export interface DueWeek { start: ISODate; pastDue: number; upcoming: number; isThisWeek: boolean }

/** A tab with its own card on the dashboard (a stakeholder's list): its items stay out of the main counts. */
export interface ListCard {
  key: string;
  label: string;
  open: number;
  done: number;
  pastDue: number;
  total: number;
  /** Items by the sheet's status words, most common first. */
  byStatus: { label: string; count: number }[];
  /** Every item, open first. */
  items: (SheetItem & { done: boolean })[];
}

export interface SheetBoard {
  row: PortfolioRow;
  sheetOnly: boolean;
  sources: { label: string; lastSyncedAt: string | null; lastResult: string | null }[];
  counts: { open: number; pastDue: number; dueSoon: number; noDate: number; done: number; partners: number; partnersPastDue: number };
  /** Every open item, most overdue first, then by due date, undated last. */
  open: SheetItem[];
  pastDue: SheetItem[];
  dueSoon: SheetItem[];
  /** Open items by tab, for the "what is open" line. */
  openByTab: { tab: string; open: number; pastDue: number }[];
  /** Every item (open and done) the board counts. */
  total: number;
  byTab: TabSplit[];
  weeks: DueWeek[];
  /** The partners the board counts: the in-scope ones when any partner is marked in scope, otherwise all. */
  partners: SheetPartner[];
  /** Every partner, in scope or not, for the "show all" toggle. */
  allPartners: SheetPartner[];
  /** True when the board shows only partners marked in scope. */
  scoped: boolean;
  /** One entry per work stream that has items, core streams always, in a fixed order. */
  byStream: StreamSplit[];
  heat: StreamHeat;
  /** Tabs mapped to their own card, outside the main counts. */
  cards: ListCard[];
  /** True when no open item names an owner: the sheet probably has no owner column. */
  noOwners: boolean;
}

export interface SourceInfo { projectId: string; label: string; lastSyncedAt: string | null; lastResult: string | null }

/** The Monday on or before a date. */
export function weekStart(d: ISODate): ISODate {
  const dow = new Date(parse(d)).getUTCDay(); // 0 Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** Weekly buckets of open dated items: up to `back` weeks before this week, and `ahead` weeks after it. */
export function dueWeeks(items: { due: ISODate | null; daysLate: number }[], asOf: ISODate, back = 8, ahead = 6): DueWeek[] {
  const thisWeek = weekStart(asOf);
  const dated = items.filter((i): i is { due: ISODate; daysLate: number } => !!i.due);
  const earliest = dated.map((i) => weekStart(i.due)).sort()[0] ?? thisWeek;
  let start = earliest < addDays(thisWeek, -7 * back) ? addDays(thisWeek, -7 * back) : earliest;
  if (start > thisWeek) start = thisWeek;
  const out: DueWeek[] = [];
  for (let w = start; w <= addDays(thisWeek, 7 * ahead); w = addDays(w, 7)) out.push({ start: w, pastDue: 0, upcoming: 0, isThisWeek: w === thisWeek });
  for (const i of dated) {
    let w = weekStart(i.due);
    if (w < start) w = start; // older work folds into the first bar
    const b = out.find((x) => x.start === w);
    if (!b) continue; // further out than the window
    if (i.daysLate > 0) b.pastDue++; else b.upcoming++;
  }
  return out;
}

/** The heat-map column a due date falls in, folding older weeks into the first. */
export function weekBucket(due: ISODate | null, weeks: DueWeek[]): string | null {
  if (!due) return "nodate";
  if (!weeks.length) return null;
  const w = weekStart(due);
  if (w < weeks[0].start) return weeks[0].start;
  return weeks.some((x) => x.start === w) ? w : null;
}

/** A URL-safe key for a card's name. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";

/** The row's ID from its source reference, when the key is a code like D37, DM-02 or T1 rather than a title. */
export function itemCode(ref: string | null | undefined): string | null {
  const c = codeOf(ref);
  return c && /^[A-Z]{1,4}-?\d+[a-z]?$/i.test(c) ? c : null;
}

/** A ticket cell as a number and, for a link to the work tracker's own site, the link. */
export function ticketOf(raw: string | null): { number: string | null; url: string | null } | null {
  const v = raw?.trim();
  if (!v || /^[-\u2013\u2014]+$/.test(v)) return null;
  let url: string | null = null;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" && (u.hostname === "app.asana.com")) url = u.href;
  } catch { /* not a link */ }
  const number = v.match(/(\d{6,})(?!.*\d{6,})/)?.[1] ?? (/^#?\w[\w-]*$/.test(v) ? v.replace(/^#/, "") : null);
  return number || url ? { number, url } : null;
}

/** Splits "Anticipated Purchasing: demand-planning view" into a name and a description; a sheet note wins as the description. */
export function nameAndDescription(title: string, note: string | null): { name: string; description: string | null } {
  const at = title.indexOf(":");
  const name = at > 0 && title.slice(at + 1).trim() ? title.slice(0, at).trim() : title.trim();
  const rest = at > 0 ? title.slice(at + 1).trim() : "";
  const n = note?.trim();
  return { name, description: n && n !== "-" ? n : rest || null };
}

function streamSplits(all: { done: boolean; item: SheetItem }[], asOf: ISODate, dueSoonDays: number): StreamSplit[] {
  const out = new Map<StreamKey, StreamSplit>();
  for (const s of STREAMS) {
    if (CORE_STREAMS.includes(s.key)) out.set(s.key, { key: s.key, label: s.label, open: 0, pastDue: 0, dueSoon: 0, noDate: 0, done: 0, total: 0 });
  }
  for (const { done, item: i } of all) {
    const s = STREAMS.find((x) => x.key === i.stream)!;
    const x = out.get(s.key) ?? { key: s.key, label: s.label, open: 0, pastDue: 0, dueSoon: 0, noDate: 0, done: 0, total: 0 };
    x.total++;
    if (done) x.done++;
    else {
      x.open++;
      if (!i.due) x.noDate++;
      else if (i.daysLate > 0) x.pastDue++;
      else if (i.due >= asOf && calendarDaysBetween(asOf, i.due) <= dueSoonDays) x.dueSoon++;
    }
    out.set(s.key, x);
  }
  const order = (k: StreamKey) => STREAMS.findIndex((s) => s.key === k);
  // Unassigned shows only while something open is in it.
  return [...out.values()].filter((x) => x.key !== "unassigned" || x.open > 0).sort((a, b) => order(a.key) - order(b.key));
}

function streamHeat(items: SheetItem[], weeks: DueWeek[]): StreamHeat {
  const columns = [
    ...weeks.map((w, i) => ({
      key: w.start, orEarlier: i === 0, label: `${new Date(`${w.start}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
      past: w.start < (weeks.find((x) => x.isThisWeek)?.start ?? w.start), isThisWeek: w.isThisWeek,
    })),
    { key: "nodate", orEarlier: false, label: "No date", past: false, isThisWeek: false },
  ];
  const rows = STREAMS.filter((s) => items.some((i) => i.stream === s.key)).map((s) => {
    const mine = items.filter((i) => i.stream === s.key);
    const cells: Record<string, number> = {};
    for (const i of mine) if (i.week) cells[i.week] = (cells[i.week] ?? 0) + 1;
    return { key: s.key, label: s.label, cells, open: mine.length };
  });
  const max = Math.max(1, ...rows.flatMap((r) => Object.values(r.cells)));
  return { columns, rows, max };
}

const tabOf = (ref: string | null | undefined) => (ref ? ref.slice(ref.indexOf(":") + 1).split("!")[0] : "App");

export function buildSheetBoards(rows: PortfolioRow[], sources: SourceInfo[], asOf: ISODate, dueSoonDays = 14): SheetBoard[] {
  const out: SheetBoard[] = [];
  for (const row of rows) {
    const s = row.snapshot;
    if (s.project.archived) continue;
    const srcs = sources.filter((x) => x.projectId === s.project.id);
    const sheetOnly = s.project.templateVersion === SHEET_PLAN;
    const sheetTasks = s.tasks.filter((t) => t.source === "sheet");
    if (!sheetOnly && !srcs.length && !sheetTasks.length) continue;
    // A sheet-run project shows every item; a template project shows only what came from its sheet.
    const all = sheetOnly ? s.tasks : sheetTasks;
    // Rows from a tab with its own card stay out of the main counts.
    const tasks = all.filter((t) => !t.card);
    const person = (id: string | null) => (id ? s.people.get(id)?.name ?? null : null);

    const open = tasks.filter((t) => t.status !== "done");
    const item = (t: (typeof tasks)[number]): SheetItem => ({
      id: t.id, title: t.title,
      // A stakeholder's list keeps each ask whole; its description comes only from the sheet's note.
      ...(t.card ? { name: t.title, description: t.description ?? null } : nameAndDescription(t.title, t.description ?? null)), tab: tabOf(t.sourceRef), due: t.dueDate,
      code: itemCode(t.sourceRef), deliveryId: t.card ? (t.deliveryId ?? null) : (t.deliveryId ?? itemCode(t.sourceRef)), status: t.sheetStatus ?? null,
      ticket: ticketOf(t.ticket ?? null),
      progress: { built: t.built ?? null, released: t.released ?? null, demoed: t.demoed ?? null, accepted: t.accepted ?? null },
      daysLate: t.dueDate && t.dueDate < asOf ? workingDaysBetween(t.dueDate, asOf) : 0,
      owner: person(t.ownerId), blocked: t.status === "blocked",
      stream: streamOf({ title: t.title, tab: tabOf(t.sourceRef), code: codeOf(t.sourceRef) }), week: null,
    });
    const items = open.map(item);
    const weeks = dueWeeks(items, asOf);
    for (const i of items) i.week = weekBucket(i.due, weeks);
    const pastDue = items.filter((i) => i.daysLate > 0).sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title));
    const dueSoon = items.filter((i) => i.due && i.due >= asOf && calendarDaysBetween(asOf, i.due) <= dueSoonDays)
      .sort((a, b) => a.due!.localeCompare(b.due!));
    const tabs = new Map<string, { open: number; pastDue: number }>();
    for (const i of items) {
      const x = tabs.get(i.tab) ?? { open: 0, pastDue: 0 };
      x.open++; if (i.daysLate > 0) x.pastDue++;
      tabs.set(i.tab, x);
    }
    const partners: SheetPartner[] = s.ediPartners.filter((p) => p.stage !== 9).map((p) => ({
      id: p.id, name: p.name, nextStep: p.nextStep, nextStepDate: p.nextStepDate,
      daysLate: p.nextStepDate && p.nextStepDate < asOf ? workingDaysBetween(p.nextStepDate, asOf) : 0,
      owner: person(p.ownerId), type: p.type, method: p.method, stage: p.stage,
      stageLabel: EDI_STAGES[p.stage - 1] ?? `Stage ${p.stage}`, lastContact: p.lastContact, blocker: p.blocker, sheetStatus: p.sheetStatus ?? null, inScope: p.inPhaseOne,
      sets: p.tests.map((t) => ({
        label: `${t.transaction} ${t.direction === "inbound" ? "in" : "out"}`, transaction: t.transaction, direction: t.direction,
        testStatus: t.testStatus, live: t.prodStatus === "live", sheetStatus: t.sheetStatus ?? null,
      })),
    })).sort((a, b) => b.daysLate - a.daysLate || (a.nextStepDate ?? "9999").localeCompare(b.nextStepDate ?? "9999") || a.name.localeCompare(b.name));
    const allPartners = partners;
    const scoped = allPartners.some((p) => p.inScope === "yes");
    const shownPartners = scoped ? allPartners.filter((p) => p.inScope === "yes") : allPartners;

    const split = new Map<string, TabSplit>();
    for (const t of tasks) {
      const tab = tabOf(t.sourceRef);
      const x = split.get(tab) ?? { tab, pastDue: 0, dueSoon: 0, later: 0, noDate: 0, done: 0 };
      if (t.status === "done") x.done++;
      else if (!t.dueDate) x.noDate++;
      else if (t.dueDate < asOf) x.pastDue++;
      else if (calendarDaysBetween(asOf, t.dueDate) <= dueSoonDays) x.dueSoon++;
      else x.later++;
      split.set(tab, x);
    }

    const cardMap = new Map<string, ListCard>();
    for (const t of all) {
      if (!t.card) continue;
      const key = slug(t.card);
      const c = cardMap.get(key) ?? { key, label: t.card, open: 0, done: 0, pastDue: 0, total: 0, byStatus: [], items: [] };
      const it = { ...item(t), done: t.status === "done" };
      c.total++;
      if (it.done) c.done++; else { c.open++; if (it.daysLate > 0) c.pastDue++; }
      c.items.push(it);
      cardMap.set(key, c);
    }
    const cards = [...cardMap.values()].map((c) => {
      const n = new Map<string, number>();
      for (const i of c.items) n.set(i.status ?? "No status", (n.get(i.status ?? "No status") ?? 0) + 1);
      const order = (x: SheetItem) => x.code ?? x.name;
      c.items.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || order(a).localeCompare(order(b), undefined, { numeric: true }));
      return { ...c, byStatus: [...n].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) };
    });

    out.push({
      row, sheetOnly, total: tasks.length, cards,
      byTab: [...split.values()].sort((a, b) => (b.pastDue + b.dueSoon + b.later + b.noDate) - (a.pastDue + a.dueSoon + a.later + a.noDate)),
      weeks,
      byStream: streamSplits(tasks.map((t) => ({ done: t.status === "done", item: item(t) })), asOf, dueSoonDays),
      heat: streamHeat(items, weeks),
      sources: srcs.map(({ label, lastSyncedAt, lastResult }) => ({ label, lastSyncedAt, lastResult })),
      counts: {
        open: open.length, pastDue: pastDue.length, dueSoon: dueSoon.length, noDate: items.filter((i) => !i.due).length,
        done: tasks.length - open.length, partners: shownPartners.length, partnersPastDue: shownPartners.filter((p) => p.daysLate > 0).length,
      },
      open: [...items].sort((a, b) => b.daysLate - a.daysLate || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title)),
      pastDue, dueSoon,
      openByTab: [...tabs].map(([tab, x]) => ({ tab, ...x })).sort((a, b) => b.open - a.open),
      partners: shownPartners, allPartners, scoped,
      noOwners: open.length > 0 && open.every((t) => !t.ownerId),
    });
  }
  // Most past-due work first.
  return out.sort((a, b) => b.counts.pastDue - a.counts.pastDue || a.row.snapshot.project.clientName.localeCompare(b.row.snapshot.project.clientName));
}
