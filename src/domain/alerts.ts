// In-app alerts, derived from the records. Quiet by design: one alert per item
// per day, keeping only the most urgent reason, so people don't tune them out.

import { addWorkingDays, calendarDaysBetween, type ISODate } from "./calendar";
import { RULES } from "./rules";
import type { ProjectEval } from "./evaluate";
import type { ProjectSnapshot } from "./types";

export type AlertKind =
  | "severity1" | "escalation" | "overdue" | "blocked" | "dates_moved" | "due_soon" | "gate_at_risk" | "expiry" | "test_failing";

const PRIORITY: Record<AlertKind, number> = {
  severity1: 0, escalation: 1, overdue: 2, blocked: 3, gate_at_risk: 4, test_failing: 5, expiry: 6, dates_moved: 7, due_soon: 8,
};

export interface Alert {
  key: string;
  kind: AlertKind;
  projectId: string;
  itemId: string;
  recipientId: string | null;
  title: string;
  detail: string;
  instant: boolean;
}

export function buildAlerts(s: ProjectSnapshot, e: ProjectEval, asOf: ISODate): Alert[] {
  const all: Alert[] = [];
  const pm = s.project.pmId;
  const push = (a: Omit<Alert, "key" | "projectId">) => all.push({ ...a, projectId: s.project.id, key: `${a.kind}:${a.itemId}:${asOf}` });

  for (const t of e.tasks.values()) {
    const task = t.task;
    if (task.status === "done") continue;
    const to = task.ownerId ?? pm;
    if (t.overdueDays > 0) push({ kind: "overdue", itemId: task.id, recipientId: to, title: task.title, detail: `Overdue ${t.overdueDays} working days`, instant: false });
    if (task.status === "blocked") push({ kind: "blocked", itemId: task.id, recipientId: to, title: task.title, detail: task.blockerNote ?? "Blocked", instant: false });
    if (t.dueSoon) push({ kind: "due_soon", itemId: task.id, recipientId: to, title: task.title, detail: `Due ${task.dueDate}`, instant: false });
    if (task.startDate && t.forecastStart && t.forecastStart > addWorkingDays(task.startDate, 0) && t.overdueDays === 0) {
      push({ kind: "dates_moved", itemId: task.id, recipientId: to, title: task.title, detail: `Earlier work slipped: now starts ${t.forecastStart}`, instant: false });
    }
  }
  for (const esc of e.escalations) {
    if (esc.level < 2 && !esc.severity1) continue;
    const owner = esc.taskId ? s.tasks.find((t) => t.id === esc.taskId)?.ownerId ?? null : null;
    push({
      kind: esc.severity1 ? "severity1" : "escalation", itemId: esc.taskId ?? esc.key, recipientId: esc.level >= 2 ? pm : owner,
      title: esc.title, detail: `Level ${esc.level}${esc.daysLate ? `, ${esc.daysLate} working days late` : ""}. Decision: ${esc.decision}`,
      instant: esc.severity1,
    });
  }
  for (const g of e.gates) {
    if (g.gate.result === "pending" && g.effective !== "green") {
      push({ kind: "gate_at_risk", itemId: g.gate.id, recipientId: pm, title: `${g.gate.key} ${g.name}`, detail: g.reasons[0] ?? "At risk", instant: false });
    }
  }
  for (const pe of e.partners) {
    const p = pe.partner;
    for (const [label, date] of [["Certificate", p.certExpiry], ["License", p.licenseExpiry]] as const) {
      if (date && calendarDaysBetween(asOf, date) <= RULES.edi.expiryYellowCalendarDays) {
        push({ kind: "expiry", itemId: p.id, recipientId: p.ownerId ?? pm, title: p.name, detail: `${label} expires ${date}`, instant: false });
      }
    }
    if (p.tests.some((t) => t.testStatus === "failed")) push({ kind: "test_failing", itemId: p.id, recipientId: p.ownerId ?? pm, title: p.name, detail: "A test transaction is failing", instant: false });
  }

  // One alert per item per day: keep the most urgent.
  const best = new Map<string, Alert>();
  for (const a of all) {
    const cur = best.get(a.itemId);
    if (!cur || PRIORITY[a.kind] < PRIORITY[cur.kind]) best.set(a.itemId, a);
  }
  return [...best.values()].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
}
