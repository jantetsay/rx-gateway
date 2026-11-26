// The home page's lead section: for each client whose work is read from a
// tracking sheet, what is open, what is past due and by how much, who owns it,
// and where each EDI partner stands. Pure: the page passes in rows and sources.

import { addDays, calendarDaysBetween, parse, workingDaysBetween, type ISODate } from "./calendar";
import type { PortfolioRow } from "./portfolio";
import { EDI_STAGES } from "./edi";
import { SHEET_PLAN } from "./template";

export interface SheetItem {
  id: string;
  title: string;
  tab: string;
  due: ISODate | null;
  daysLate: number;
  owner: string | null;
  blocked: boolean;
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
  /** Transaction sets in the test matrix, as "850 out", with their test result. */
  sets: { label: string; testStatus: "passed" | "failed" | "not_run"; live: boolean }[];
}

/** Open work in one tab, split by when it is due. */
export interface TabSplit { tab: string; pastDue: number; dueSoon: number; later: number; noDate: number; done: number }

/** Open items by the week (Monday) they are due. */
export interface DueWeek { start: ISODate; pastDue: number; upcoming: number; isThisWeek: boolean }

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
  partners: SheetPartner[];
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
    const tasks = sheetOnly ? s.tasks : sheetTasks;
    const person = (id: string | null) => (id ? s.people.get(id)?.name ?? null : null);

    const open = tasks.filter((t) => t.status !== "done");
    const item = (t: (typeof tasks)[number]): SheetItem => ({
      id: t.id, title: t.title, tab: tabOf(t.sourceRef), due: t.dueDate,
      daysLate: t.dueDate && t.dueDate < asOf ? workingDaysBetween(t.dueDate, asOf) : 0,
      owner: person(t.ownerId), blocked: t.status === "blocked",
    });
    const items = open.map(item);
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
      stageLabel: EDI_STAGES[p.stage - 1] ?? `Stage ${p.stage}`, lastContact: p.lastContact, blocker: p.blocker,
      sets: p.tests.map((t) => ({ label: `${t.transaction} ${t.direction}`, testStatus: t.testStatus, live: t.prodStatus === "live" })),
    })).sort((a, b) => b.daysLate - a.daysLate || (a.nextStepDate ?? "9999").localeCompare(b.nextStepDate ?? "9999") || a.name.localeCompare(b.name));

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

    out.push({
      row, sheetOnly, total: tasks.length,
      byTab: [...split.values()].sort((a, b) => (b.pastDue + b.dueSoon + b.later + b.noDate) - (a.pastDue + a.dueSoon + a.later + a.noDate)),
      weeks: dueWeeks(items, asOf),
      sources: srcs.map(({ label, lastSyncedAt, lastResult }) => ({ label, lastSyncedAt, lastResult })),
      counts: {
        open: open.length, pastDue: pastDue.length, dueSoon: dueSoon.length, noDate: items.filter((i) => !i.due).length,
        done: tasks.length - open.length, partners: partners.length, partnersPastDue: partners.filter((p) => p.daysLate > 0).length,
      },
      open: [...items].sort((a, b) => b.daysLate - a.daysLate || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title)),
      pastDue, dueSoon,
      openByTab: [...tabs].map(([tab, x]) => ({ tab, ...x })).sort((a, b) => b.open - a.open),
      partners,
      noOwners: open.length > 0 && open.every((t) => !t.ownerId),
    });
  }
  // Most past-due work first.
  return out.sort((a, b) => b.counts.pastDue - a.counts.pastDue || a.row.snapshot.project.clientName.localeCompare(b.row.snapshot.project.clientName));
}
