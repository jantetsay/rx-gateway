// The home page's lead section: for each client whose work is read from a
// tracking sheet, what is open, what is past due and by how much, who owns it,
// and where each EDI partner stands. Pure: the page passes in rows and sources.

import { calendarDaysBetween, workingDaysBetween, type ISODate } from "./calendar";
import type { PortfolioRow } from "./portfolio";
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
}

export interface SheetBoard {
  row: PortfolioRow;
  sheetOnly: boolean;
  sources: { label: string; lastSyncedAt: string | null; lastResult: string | null }[];
  counts: { open: number; pastDue: number; dueSoon: number; noDate: number; done: number; partners: number; partnersPastDue: number };
  pastDue: SheetItem[];
  dueSoon: SheetItem[];
  /** Open items by tab, for the "what is open" line. */
  openByTab: { tab: string; open: number; pastDue: number }[];
  partners: SheetPartner[];
  /** True when no open item names an owner: the sheet probably has no owner column. */
  noOwners: boolean;
}

export interface SourceInfo { projectId: string; label: string; lastSyncedAt: string | null; lastResult: string | null }

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
      owner: person(p.ownerId),
    })).sort((a, b) => b.daysLate - a.daysLate || (a.nextStepDate ?? "9999").localeCompare(b.nextStepDate ?? "9999") || a.name.localeCompare(b.name));

    out.push({
      row, sheetOnly,
      sources: srcs.map(({ label, lastSyncedAt, lastResult }) => ({ label, lastSyncedAt, lastResult })),
      counts: {
        open: open.length, pastDue: pastDue.length, dueSoon: dueSoon.length, noDate: items.filter((i) => !i.due).length,
        done: tasks.length - open.length, partners: partners.length, partnersPastDue: partners.filter((p) => p.daysLate > 0).length,
      },
      pastDue, dueSoon,
      openByTab: [...tabs].map(([tab, x]) => ({ tab, ...x })).sort((a, b) => b.open - a.open),
      partners,
      noOwners: open.length > 0 && open.every((t) => !t.ownerId),
    });
  }
  // Most past-due work first.
  return out.sort((a, b) => b.counts.pastDue - a.counts.pastDue || a.row.snapshot.project.clientName.localeCompare(b.row.snapshot.project.clientName));
}
