// Lays out a new project from the template: tasks with planned dates, their
// dependencies, and gates with planned sitting dates and signer roles.

import type { ISODate } from "./calendar";
import { schedule } from "./schedule";
import { GATE_DEFS, TEMPLATE, TEMPLATE_VERSION, type TemplateItem } from "./template";
import type { Dependency, Gate, Task, WorkstreamKey } from "./types";

export interface Plan {
  templateVersion: string;
  tasks: Task[];
  dependencies: Dependency[];
  gates: Gate[];
}

export function instantiate(
  projectId: string,
  start: ISODate,
  opts: { workstreams: WorkstreamKey[]; newId: () => string; template?: TemplateItem[] },
): Plan {
  const items = (opts.template ?? TEMPLATE).filter((t) => t.kind === "milestone" || opts.workstreams.includes(t.workstream));
  const keep = new Set(items.map((t) => t.key));
  const idByKey = new Map(items.map((t) => [t.key, `${projectId}-${t.key}`]));

  const tasks: Task[] = items.map((t) => ({
    id: idByKey.get(t.key)!, projectId, kind: t.kind, title: t.title, stage: t.stage, workstream: t.workstream,
    gateKey: t.gate, ownerId: null, startDate: null, durationDays: t.duration, dueDate: null, status: "not_started",
    critical: !!t.critical, compliance: !!t.compliance, blockerNote: null, blockedSince: null, blockerPlanDate: null,
    evidence: null, completedAt: null, lastUpdateAt: null, decisionNeeded: null, source: "app",
  }));

  // A dependency on a dropped item (a workstream not bought) passes through to that item's own predecessors.
  const byKey = new Map((opts.template ?? TEMPLATE).map((t) => [t.key, t]));
  const resolve = (key: string, lag: number, seen = new Set<string>()): [string, number][] => {
    if (keep.has(key)) return [[key, lag]];
    if (seen.has(key)) return [];
    seen.add(key);
    return (byKey.get(key)?.deps ?? []).flatMap((d) => (Array.isArray(d) ? resolve(d[0], lag + d[1], seen) : resolve(d, lag, seen)));
  };
  const dependencies: Dependency[] = [];
  for (const t of items) {
    for (const d of t.deps ?? []) {
      const [key, lag] = Array.isArray(d) ? d : [d, 0];
      for (const [k, l] of resolve(key, lag)) dependencies.push({ predId: idByKey.get(k)!, succId: idByKey.get(t.key)!, lagDays: l });
    }
  }

  const plan = schedule(tasks, dependencies, { projectStart: start });
  for (const t of tasks) {
    const s = plan.byId.get(t.id);
    if (s) { t.startDate = s.start; t.dueDate = s.finish; }
  }
  const gates: Gate[] = GATE_DEFS.map((g) => ({
    id: `${projectId}-gate-${g.key}`, projectId, key: g.key,
    plannedDate: tasks.find((t) => t.kind === "milestone" && t.gateKey === g.key)?.dueDate ?? null,
    satDate: null, result: "pending",
    signers: g.signers.map((roleLabel) => ({ id: opts.newId(), roleLabel, personName: null, signedAt: null })),
  }));
  return { templateVersion: TEMPLATE_VERSION, tasks, dependencies, gates };
}
