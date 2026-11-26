// Forward and backward pass over tasks and finish-to-start dependencies.
// Dates are working days. A task finishing in n days starting on day s ends on
// s + n - 1; a milestone (n = 0) ends on the day it starts.

import { addWorkingDays, maxDate, type ISODate } from "./calendar";
import type { Dependency, Task } from "./types";

export interface Scheduled {
  start: ISODate;
  finish: ISODate;
  /** Working days this task can slip before it moves the project finish. */
  float: number;
  critical: boolean;
}

export interface ScheduleResult {
  byId: Map<string, Scheduled>;
  finish: ISODate;
  /** Tasks in a cycle are left unscheduled and reported here. */
  cycle: string[];
}

function finishOf(start: ISODate, duration: number, holidays?: ReadonlySet<ISODate>): ISODate {
  return duration <= 0 ? start : addWorkingDays(start, duration - 1, holidays);
}

function startAfter(predFinish: ISODate, predDuration: number, lag: number, holidays?: ReadonlySet<ISODate>): ISODate {
  // A milestone's successor can start the same day; a task's starts the next working day.
  const gap = (predDuration <= 0 ? 0 : 1) + lag;
  return gap === 0 ? addWorkingDays(predFinish, 0, holidays) : addWorkingDays(predFinish, gap, holidays);
}

function topoOrder(tasks: Task[], deps: Dependency[]): { order: Task[]; cycle: string[] } {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map(tasks.map((t) => [t.id, 0]));
  const out = new Map<string, Dependency[]>();
  for (const d of deps) {
    if (!ids.has(d.predId) || !ids.has(d.succId)) continue;
    indeg.set(d.succId, (indeg.get(d.succId) ?? 0) + 1);
    out.set(d.predId, [...(out.get(d.predId) ?? []), d]);
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order: Task[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const d of out.get(id) ?? []) {
      const n = (indeg.get(d.succId) ?? 0) - 1;
      indeg.set(d.succId, n);
      if (n === 0) queue.push(d.succId);
    }
  }
  const cycle = tasks.filter((t) => !order.includes(t)).map((t) => t.id);
  return { order, cycle };
}

/**
 * Forecast schedule. With asOf set, work that isn't done can't start before
 * asOf, so overdue work pushes everything after it. Without asOf it is a pure
 * plan from the start dates (used to lay out a new project).
 */
export function schedule(
  tasks: Task[],
  deps: Dependency[],
  opts: { projectStart: ISODate; asOf?: ISODate; holidays?: ReadonlySet<ISODate> },
): ScheduleResult {
  const { projectStart, asOf, holidays } = opts;
  const { order, cycle } = topoOrder(tasks, deps);
  const preds = new Map<string, Dependency[]>();
  const succs = new Map<string, Dependency[]>();
  for (const d of deps) {
    preds.set(d.succId, [...(preds.get(d.succId) ?? []), d]);
    succs.set(d.predId, [...(succs.get(d.predId) ?? []), d]);
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const es = new Map<string, ISODate>();
  const ef = new Map<string, ISODate>();

  for (const t of order) {
    let start = addWorkingDays(maxDate(projectStart, t.startDate)!, 0, holidays);
    for (const d of preds.get(t.id) ?? []) {
      const p = taskById.get(d.predId);
      const pf = ef.get(d.predId);
      if (p && pf) start = maxDate(start, startAfter(pf, p.durationDays, d.lagDays, holidays))!;
    }
    if (t.status === "done" && t.completedAt) {
      const done = t.completedAt.slice(0, 10);
      es.set(t.id, start < done ? start : done);
      ef.set(t.id, done);
      continue;
    }
    let end = finishOf(start, t.durationDays, holidays);
    if (asOf) {
      const now = addWorkingDays(asOf, 0, holidays);
      if (t.status === "not_started" && start < now) {
        // Hasn't begun: it can only start today.
        start = now;
        end = finishOf(start, t.durationDays, holidays);
      } else if (end < now) {
        // Under way but not done: it can finish today at the earliest.
        end = now;
      }
    }
    es.set(t.id, start);
    ef.set(t.id, end);
  }

  const finish = maxDate(...ef.values()) ?? projectStart;
  // Backward pass for float.
  const lf = new Map<string, ISODate>();
  for (const t of [...order].reverse()) {
    let latest = finish;
    for (const d of succs.get(t.id) ?? []) {
      const s = taskById.get(d.succId);
      const sls = lf.has(d.succId) && s ? lateStart(lf.get(d.succId)!, s.durationDays, holidays) : null;
      if (!sls) continue;
      // Latest finish so the successor can still start on its late start.
      const gap = (t.durationDays <= 0 ? 0 : 1) + d.lagDays;
      const candidate = gap === 0 ? sls : addWorkingDays(sls, -gap, holidays);
      latest = latest < candidate ? latest : candidate;
    }
    lf.set(t.id, latest);
  }

  const byId = new Map<string, Scheduled>();
  for (const t of order) {
    const start = es.get(t.id)!;
    const end = ef.get(t.id)!;
    const late = lf.get(t.id)!;
    const floatDays = countWorking(end, late, holidays);
    byId.set(t.id, { start, finish: end, float: floatDays, critical: t.status !== "done" && floatDays <= 0 });
  }
  return { byId, finish, cycle };
}

function lateStart(lateFinish: ISODate, duration: number, holidays?: ReadonlySet<ISODate>): ISODate {
  return duration <= 0 ? lateFinish : addWorkingDays(lateFinish, -(duration - 1), holidays);
}

function countWorking(a: ISODate, b: ISODate, holidays?: ReadonlySet<ISODate>): number {
  if (a === b) return 0;
  let n = 0;
  if (a < b) {
    let d = a;
    while (d < b) { d = addWorkingDays(d, 1, holidays); if (d <= b) n++; }
    return n;
  }
  let d = b;
  while (d < a) { d = addWorkingDays(d, 1, holidays); if (d <= a) n++; }
  return -n;
}
