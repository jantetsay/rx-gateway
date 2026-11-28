import { instantiate } from "@/domain/instantiate";
import { CLIENT_ROLES } from "@/domain/template";
import { WORKSTREAMS, type ProjectSnapshot, type Task } from "@/domain/types";

let n = 0;
export const newId = () => `id${++n}`;

/** A made-up project laid out from the template. No real client data. */
export function makeSnapshot(opts: { start?: string; stage?: ProjectSnapshot["project"]["stage"] } = {}): ProjectSnapshot {
  const start = opts.start ?? "2026-01-05";
  const plan = instantiate("p1", start, { workstreams: [...WORKSTREAMS], newId });
  return {
    project: {
      id: "p1", clientId: "c1", clientName: "Example Distribution Co", segment: "Wholesaler", name: "Onboarding",
      modules: ["ERP"], tier: 2, stage: opts.stage ?? "deep_dive", archived: false, contractSigned: start,
      targetWindowStart: null, targetWindowEnd: null, notEarlierThan: null, committedDate: null, pmId: "u1", updatedAt: start,
    },
    tasks: plan.tasks.map((t) => ({ ...t, ownerId: "u1", lastUpdateAt: start })),
    dependencies: plan.dependencies,
    gates: plan.gates.map((g) => ({ ...g, signers: g.signers.map((s) => ({ ...s, personName: "Pat Example" })) })),
    clientRoles: CLIENT_ROLES.map((roleLabel) => ({ roleLabel, personName: "Sam Example" })),
    connections: [], issues: [], exceptions: [], overrides: [],
    workstreams: WORKSTREAMS.map((workstream) => ({ workstream, ownerId: "u1", enabled: true })),
    people: new Map([["u1", { id: "u1", name: "Pat Example" }]]),
    ediPartners: [],
  };
}

export function task(s: ProjectSnapshot, key: string): Task {
  const t = s.tasks.find((x) => x.id === `p1-${key}`);
  if (!t) throw new Error(`no task ${key}`);
  return t;
}

/** Mark every item feeding the given gates done, with evidence, and pass the gates. */
export function completeThrough(s: ProjectSnapshot, gates: string[]) {
  for (const t of s.tasks) {
    if (t.gateKey && gates.includes(t.gateKey)) {
      t.status = "done"; t.completedAt = t.dueDate; t.evidence = "On file";
    }
  }
  for (const g of s.gates) if (gates.includes(g.key)) { g.result = "passed"; g.satDate = g.plannedDate; }
}
