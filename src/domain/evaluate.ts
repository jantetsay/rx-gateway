// Computes every color from the records. Nobody types a color in: a person can
// only lay a hand change on top, with a written reason, and it lapses at the
// next weekly refresh. Every color carries the rules that set it.

import { calendarDaysBetween, workingDaysBetween, type ISODate } from "./calendar";
import { evaluatePartner, partnerGate, type PartnerEval } from "./edi";
import { RULES } from "./rules";
import { schedule, type ScheduleResult } from "./schedule";
import { GATE_BY_KEY, GO_LIVE_KEY, WORKSTREAM_LABEL } from "./template";
import {
  GATES, WORKSTREAMS, worst,
  type Color, type Gate, type GateKey, type HandOverride, type ProjectSnapshot, type Rated, type Task, type WorkstreamKey,
} from "./types";

export interface TaskEval extends Rated {
  task: Task;
  overdueDays: number;
  onCriticalPath: boolean;
  forecastStart: ISODate | null;
  forecastFinish: ISODate | null;
  dueSoon: boolean;
}

export interface WorkstreamRow extends Rated {
  key: WorkstreamKey;
  label: string;
  ownerId: string | null;
  total: number;
  done: number;
  pctDone: number;
  criticalOpen: number;
  overdue: number;
  missingOwners: number;
  blockers: number;
  nextGate: GateKey | null;
  nextGateDate: ISODate | null;
  override: HandOverride | null;
  effective: Color;
}

export interface GateEval extends Rated {
  gate: Gate;
  name: string;
  feeding: { key: WorkstreamKey; color: Color }[];
  unsignedRoles: string[];
  unnamedRoles: string[];
  criticalOpen: TaskEval[];
  override: HandOverride | null;
  effective: Color;
}

export type EscalationLevel = 1 | 2 | 3;

export interface Escalation {
  key: string;
  level: EscalationLevel;
  severity1: boolean;
  compliance: boolean;
  title: string;
  taskId: string | null;
  daysLate: number;
  blocks: string[];
  decision: string;
  notify: string;
}

export interface ProjectEval {
  projectId: string;
  lane: "pre_discovery" | "delivery";
  schedule: ScheduleResult;
  forecastGoLive: ISODate | null;
  reference: { date: ISODate; label: "target" | "committed" } | null;
  slipDays: number | null;
  tasks: Map<string, TaskEval>;
  workstreams: WorkstreamRow[];
  gates: GateEval[];
  nextGate: GateEval | null;
  escalations: Escalation[];
  partners: PartnerEval[];
  computed: Rated;
  override: HandOverride | null;
  effective: Color;
  stale: boolean;
  lastUpdate: ISODate | null;
  overridesInForce: HandOverride[];
  exceptionsInForce: ProjectSnapshot["exceptions"];
}

const live = (o: HandOverride, asOf: ISODate) => o.lapsesAt > asOf;

function overrideFor(s: ProjectSnapshot, scope: HandOverride["scope"], target: string, asOf: ISODate): HandOverride | null {
  return s.overrides.filter((o) => o.scope === scope && o.target === target && live(o, asOf)).sort((a, b) => (a.setAt < b.setAt ? 1 : -1))[0] ?? null;
}

export function rateTask(t: Task, sched: ScheduleResult | null, asOf: ISODate): TaskEval {
  const sc = sched?.byId.get(t.id);
  const done = t.status === "done";
  const overdueDays = !done && t.dueDate && t.dueDate < asOf ? workingDaysBetween(t.dueDate, asOf) : 0;
  const onCriticalPath = !done && !!sc?.critical;
  const daysToDue = !done && t.dueDate && t.dueDate >= asOf ? workingDaysBetween(asOf, t.dueDate) : null;
  const dueSoon = daysToDue !== null && daysToDue <= RULES.task.dueSoonWorkingDays;
  const quiet = !t.lastUpdateAt || workingDaysBetween(t.lastUpdateAt.slice(0, 10), asOf) > RULES.task.noUpdateWorkingDays;

  const colors: Color[] = [];
  const reasons: string[] = [];
  const add = (c: Color, r: string) => { colors.push(c); reasons.push(r); };

  if (!done) {
    if (t.status === "blocked" && !t.blockerPlanDate) add("red", "Blocked with no dated plan");
    if (overdueDays > 0 && onCriticalPath) add("red", `Overdue ${days(overdueDays)} on the critical path`);
    if (t.critical && t.dueDate && t.dueDate < asOf) add("red", "Critical checkpoint open past its date");
    if (!t.ownerId) add("yellow", "No owner");
    if (!t.dueDate) add("yellow", "No date");
    if (overdueDays > 0 && !onCriticalPath) add("yellow", `Overdue ${days(overdueDays)}, off the critical path`);
    if (dueSoon && quiet) add("yellow", `Due in ${days(daysToDue)} with no update`);
    if (t.status === "blocked" && t.blockerPlanDate) add("yellow", `Blocked, recovery plan dated ${t.blockerPlanDate}`);
  } else if (t.kind === "checkpoint" && !t.evidence) {
    add("yellow", "Done with no evidence on file");
  }
  const color = worst(...colors);
  if (color === "green") reasons.push(done ? "Done, with evidence" : "Owner and date in place, on schedule");
  return {
    task: t, color, reasons, overdueDays, onCriticalPath, dueSoon,
    forecastStart: sc?.start ?? null, forecastFinish: sc?.finish ?? null,
  };
}

function rateItems(items: TaskEval[], partners: PartnerEval[], gates: Map<GateKey, Gate>, label: string): Rated {
  const colors: Color[] = [];
  const reasons: string[] = [];
  for (const e of items) {
    if (e.color === "red") { colors.push("red"); reasons.push(`Red item: ${e.task.title}`); }
    else if (e.color === "yellow") { colors.push("yellow"); reasons.push(`Yellow item: ${e.task.title}`); }
    const g = e.task.gateKey ? gates.get(e.task.gateKey) : undefined;
    if (g && g.result !== "passed" && g.plannedDate && e.forecastFinish && e.task.status !== "done" && e.forecastFinish > g.plannedDate) {
      colors.push("red");
      reasons.push(`${e.task.title} will push ${g.key} past its planned date (${g.plannedDate})`);
    }
  }
  for (const p of partners) {
    if (p.color !== "green") { colors.push(p.color); reasons.push(`${p.color === "red" ? "Red" : "Yellow"} partner: ${p.partner.name}`); }
  }
  const color = worst(...colors);
  if (color === "green") reasons.push(`${label}: no yellow or red items`);
  return { color, reasons: dedupe(reasons) };
}

const dedupe = (xs: string[]) => [...new Set(xs)];
export const days = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

export function evaluateProject(s: ProjectSnapshot, asOf: ISODate): ProjectEval {
  const p = s.project;
  const enabled = new Set(s.workstreams.filter((w) => w.enabled).map((w) => w.workstream));
  const inScope = s.tasks.filter((t) => enabled.has(t.workstream) || t.kind === "milestone");
  const projectStart = p.contractSigned ?? inScope.map((t) => t.startDate).filter(Boolean).sort()[0] ?? asOf;
  const sched = schedule(inScope, s.dependencies, { projectStart, asOf });
  const goLiveTask = inScope.find((t) => t.kind === "milestone" && t.title === "Go live") ?? inScope.find((t) => t.id.endsWith(GO_LIVE_KEY));
  const forecastGoLive = goLiveTask ? sched.byId.get(goLiveTask.id)?.finish ?? null : null;

  const gateMap = new Map(s.gates.map((g) => [g.key, g]));
  const g7a = gateMap.get("G7a");
  const committed = g7a?.result === "passed" && p.committedDate;
  const reference = committed
    ? { date: p.committedDate!, label: "committed" as const }
    : p.targetWindowEnd ? { date: p.targetWindowEnd, label: "target" as const } : null;
  const slipDays = p.stage !== "pre_discovery" && reference && forecastGoLive ? Math.max(0, workingDaysBetween(reference.date, forecastGoLive)) : null;

  const lane = p.stage === "pre_discovery" ? "pre_discovery" : "delivery";
  // Pre-discovery is rated on G1 and G2 only; the rest of the plan is a sketch until signature.
  const rated = (t: Task) => t.kind !== "milestone" && (lane === "delivery" || t.gateKey === "G1" || t.gateKey === "G2");

  const tasks = new Map<string, TaskEval>();
  for (const t of inScope) {
    if (!rated(t)) continue;
    const e = rateTask(t, sched, asOf);
    const o = overrideFor(s, "task", t.id, asOf);
    if (o) e.reasons.push(`Hand change to ${o.color}: ${o.reason}`);
    tasks.set(t.id, e);
  }
  const currentGoLive = (committed ? p.committedDate : null) ?? p.notEarlierThan ?? p.targetWindowEnd ?? null;
  const partners = s.ediPartners.map((x) => evaluatePartner(x, asOf, currentGoLive));

  // Heat map rows.
  const workstreams: WorkstreamRow[] = [];
  for (const key of WORKSTREAMS) {
    if (!enabled.has(key)) continue;
    const items = [...tasks.values()].filter((e) => e.task.workstream === key);
    const wsPartners = key === "edi_integrations" && lane === "delivery" ? partners.filter((x) => x.partner.inPhaseOne !== "no") : [];
    if (!items.length && !wsPartners.length) continue;
    const rated = rateItems(items, wsPartners, gateMap, WORKSTREAM_LABEL[key]);
    const open = items.filter((e) => e.task.status !== "done");
    const nextGate = GATES.find((g) => gateMap.get(g)?.result !== "passed" && open.some((e) => e.task.gateKey === g)) ?? null;
    const done = items.filter((e) => e.task.status === "done").length;
    const override = overrideFor(s, "workstream", key, asOf);
    workstreams.push({
      key, label: WORKSTREAM_LABEL[key], ...rated,
      ownerId: s.workstreams.find((w) => w.workstream === key)?.ownerId ?? null,
      total: items.length, done, pctDone: items.length ? Math.round((done / items.length) * 100) : 0,
      criticalOpen: open.filter((e) => e.task.critical).length,
      overdue: open.filter((e) => e.overdueDays > 0).length + wsPartners.filter((x) => x.partner.nextStepDate && x.partner.nextStepDate < asOf && x.partner.stage !== 9).length,
      missingOwners: open.filter((e) => !e.task.ownerId).length + wsPartners.filter((x) => !x.partner.ownerId).length,
      blockers: open.filter((e) => e.task.status === "blocked").length + wsPartners.filter((x) => !!x.partner.blocker).length,
      nextGate, nextGateDate: nextGate ? gateMap.get(nextGate)?.plannedDate ?? null : null,
      override, effective: override?.color ?? rated.color,
    });
  }

  // Gates.
  const gates: GateEval[] = [];
  for (const key of GATES) {
    const gate = gateMap.get(key);
    if (!gate) continue;
    const items = [...tasks.values()].filter((e) => e.task.gateKey === key);
    const gp = partners.filter((x) => partnerGate(x.partner) === key);
    const feeding: GateEval["feeding"] = [];
    const reasons: string[] = [];
    const colors: Color[] = [];
    const unnamedRoles = gate.signers.filter((x) => !x.personName).map((x) => x.roleLabel);
    const unsignedRoles = gate.signers.filter((x) => !x.signedAt).map((x) => x.roleLabel);
    const criticalOpen = items.filter((e) => e.task.critical && e.task.status !== "done");

    if (gate.result === "passed") {
      colors.push("green"); reasons.push(`Passed${gate.satDate ? ` on ${gate.satDate}` : ""}`);
    } else if (gate.result === "failed") {
      colors.push("red"); reasons.push(`Sat and failed${gate.satDate ? ` on ${gate.satDate}` : ""}`);
    } else {
      for (const ws of WORKSTREAMS) {
        const wsItems = items.filter((e) => e.task.workstream === ws);
        const wsPartners = ws === "edi_integrations" ? gp : [];
        if (!wsItems.length && !wsPartners.length) continue;
        const r = rateItems(wsItems, wsPartners, gateMap, WORKSTREAM_LABEL[ws]);
        feeding.push({ key: ws, color: r.color });
        if (r.color === "red") { colors.push("red"); reasons.push(`${WORKSTREAM_LABEL[ws]} is red for this gate (worst color rolls up)`); }
        if (r.color === "yellow") { colors.push("yellow"); reasons.push(`${WORKSTREAM_LABEL[ws]} is yellow for this gate`); }
      }
      const atSitting = !!gate.plannedDate && asOf >= gate.plannedDate;
      if (atSitting && criticalOpen.length) { colors.push("red"); reasons.push(`Critical checkpoint open at the sitting: ${criticalOpen.map((e) => e.task.title).join("; ")}`); }
      if (atSitting && unnamedRoles.length) { colors.push("red"); reasons.push(`Signer missing at the sitting: ${unnamedRoles.join(", ")}`); }
      if (!atSitting && unnamedRoles.length && gate.plannedDate && workingDaysBetween(asOf, gate.plannedDate) <= RULES.gate.signerUnnamedWithinWorkingDays) {
        colors.push("yellow"); reasons.push(`Signer unnamed within ${RULES.gate.signerUnnamedWithinWorkingDays} working days of the sitting: ${unnamedRoles.join(", ")}`);
      }
      if (!colors.length) { colors.push("green"); reasons.push("Every workstream feeding it is green"); }
    }
    const rated = { color: worst(...colors), reasons: dedupe(reasons) };
    const override = overrideFor(s, "gate", key, asOf);
    gates.push({ gate, name: GATE_BY_KEY[key].name, feeding, unsignedRoles, unnamedRoles, criticalOpen, ...rated, override, effective: override?.color ?? rated.color });
  }

  const ratedGates = lane === "pre_discovery" ? gates.filter((g) => g.gate.key === "G1" || g.gate.key === "G2") : gates;
  const nextGate = ratedGates.find((g) => g.gate.result !== "passed") ?? null;
  const escalations = p.archived ? [] : buildEscalations(s, tasks, sched, asOf, committed ? { committed: p.committedDate!, forecast: forecastGoLive } : null);

  // Project color.
  const colors: Color[] = [];
  const reasons: string[] = [];
  const add = (c: Color, r: string) => { colors.push(c); reasons.push(r); };
  if (lane === "pre_discovery") {
    for (const g of ratedGates) if (g.effective !== "green") add(g.effective, `${g.gate.key} ${g.name} is ${g.effective}`);
  } else {
    if (nextGate?.effective === "red") add("red", `Next gate ${nextGate.gate.key} ${nextGate.name} is red`);
    if (nextGate?.effective === "yellow") add("yellow", `Next gate ${nextGate.gate.key} ${nextGate.name} is yellow`);
    if (slipDays !== null && reference) {
      if (slipDays > RULES.project.slipYellowMaxWorkingDays) add("red", `Forecast go-live ${forecastGoLive} is ${days(slipDays)} past the ${reference.label} date`);
      else if (slipDays > 0) add("yellow", `Forecast go-live ${forecastGoLive} is ${days(slipDays)} past the ${reference.label} date`);
    }
    const l3 = escalations.filter((e) => e.level === 3 || e.severity1);
    if (l3.length) add("red", `${l3.length} Level 3 or severity 1 escalation${l3.length > 1 ? "s" : ""} in force`);
    const compliance = s.issues.filter((i) => i.compliance && !i.closedAt);
    const failedConn = s.connections.filter((c) => c.neededDayOne && c.status === "failed");
    if (compliance.length) add("red", `Open compliance item: ${compliance.map((i) => i.title).join("; ")}`);
    if (failedConn.length) add("red", `A DSCSA connection a day-one transaction needs has failed: ${failedConn.map((c) => c.partnerName).join(", ")}`);
    const l2 = escalations.filter((e) => e.level === 2 && !e.severity1);
    if (l2.length) add("yellow", `${l2.length} Level 2 escalation${l2.length > 1 ? "s" : ""} in force`);
    const unnamed = s.clientRoles.filter((r) => !r.personName);
    if (unnamed.length) add("yellow", `Unnamed client role: ${unnamed.map((r) => r.roleLabel).join(", ")}`);
    const unack = s.connections.filter((c) => !c.acknowledgedAt && c.requestedAt && calendarDaysBetween(c.requestedAt, asOf) > RULES.project.l4UnacknowledgedCalendarDays);
    if (unack.length) add("yellow", `L4 connection unacknowledged past 2 weeks: ${unack.map((c) => c.partnerName).join(", ")}`);
  }
  const exceptionsInForce = s.exceptions.filter((x) => !!x.approvedBy && x.expiresAt > asOf);
  if (exceptionsInForce.length) add("yellow", `Override in force: ${exceptionsInForce.map((x) => x.rule).join("; ")}`);
  const computedColor = worst(...colors);
  if (computedColor === "green") reasons.push(lane === "pre_discovery" ? "G1 and G2 on track" : "Next gate green and no slip");
  const override = overrideFor(s, "project", p.id, asOf);

  const updates = [p.updatedAt, ...s.tasks.map((t) => t.lastUpdateAt)].filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort();
  const lastUpdate = updates.at(-1) ?? null;
  const stale = !lastUpdate || calendarDaysBetween(lastUpdate, asOf) > RULES.project.staleCalendarDays;

  return {
    projectId: p.id, lane, schedule: sched, forecastGoLive, reference, slipDays, tasks, workstreams, gates, nextGate,
    escalations, partners, computed: { color: computedColor, reasons: dedupe(reasons) }, override,
    effective: override?.color ?? computedColor, stale, lastUpdate,
    overridesInForce: s.overrides.filter((o) => live(o, asOf)), exceptionsInForce,
  };
}

function buildEscalations(
  s: ProjectSnapshot, tasks: Map<string, TaskEval>, sched: ScheduleResult, asOf: ISODate,
  goLive: { committed: ISODate; forecast: ISODate | null } | null,
): Escalation[] {
  const out: Escalation[] = [];
  const r = RULES.escalation;
  const succ = new Map<string, string[]>();
  for (const d of s.dependencies) succ.set(d.predId, [...(succ.get(d.predId) ?? []), d.succId]);
  const byId = new Map(s.tasks.map((t) => [t.id, t]));
  const notifyFor = (lvl: EscalationLevel) => (lvl === 1 ? "Task owner" : lvl === 2 ? "Project manager" : "Executive sponsor");

  for (const e of tasks.values()) {
    const t = e.task;
    if (t.status === "done") continue;
    const blockedDays = t.status === "blocked" && t.blockedSince ? workingDaysBetween(t.blockedSince.slice(0, 10), asOf) : 0;
    let level: EscalationLevel | 0 = 0;
    if ((e.overdueDays >= r.level3CriticalOverdueWorkingDays && e.onCriticalPath) || (t.compliance && e.overdueDays > 0)) level = 3;
    else if (e.overdueDays >= r.level2OverdueWorkingDays || blockedDays > r.level2BlockerWorkingDays || (e.overdueDays > 0 && e.onCriticalPath)) level = 2;
    else if (e.dueSoon || e.overdueDays > 0) level = 1;
    if (!level) continue;
    const blocks = (succ.get(t.id) ?? []).map((id) => byId.get(id)?.title).filter((x): x is string => !!x);
    if (t.gateKey && !blocks.some((b) => b.startsWith(t.gateKey!))) blocks.push(`${t.gateKey} ${GATE_BY_KEY[t.gateKey].name}`);
    out.push({
      key: `${t.id}:L${level}`, level, severity1: false, compliance: t.compliance && level === 3,
      title: t.title, taskId: t.id, daysLate: e.overdueDays, blocks,
      decision: t.decisionNeeded ?? (e.overdueDays > 0 ? "Owner to commit a recovery date" : "Owner to confirm it lands on time"),
      notify: notifyFor(level),
    });
  }
  if (goLive?.forecast && goLive.forecast > goLive.committed) {
    out.push({
      key: `${s.project.id}:golive:${goLive.committed}`, level: 3, severity1: false, compliance: false,
      title: `Go-live at risk: forecast ${goLive.forecast} against committed ${goLive.committed}`, taskId: null,
      daysLate: workingDaysBetween(goLive.committed, goLive.forecast), blocks: ["Go live"],
      decision: "Recover the plan or re-baseline (Steve approves)", notify: notifyFor(3),
    });
  }
  for (const i of s.issues) {
    if (i.closedAt) continue;
    if (i.severity === 1) out.push({ key: `issue:${i.id}`, level: 3, severity1: true, compliance: i.compliance, title: i.title, taskId: null, daysLate: 0, blocks: [], decision: "Decide the recovery now", notify: "Project manager and executive sponsor" });
    else if (i.compliance) out.push({ key: `issue:${i.id}`, level: 3, severity1: false, compliance: true, title: i.title, taskId: null, daysLate: 0, blocks: [], decision: "Compliance lead to rule on it", notify: notifyFor(3) });
  }
  for (const c of s.connections) {
    if (c.neededDayOne && c.status === "failed") out.push({ key: `conn:${c.id}`, level: 3, severity1: false, compliance: true, title: `DSCSA connection failed: ${c.partnerName}`, taskId: null, daysLate: 0, blocks: ["Go live"], decision: "Fix the connection or hold go-live", notify: notifyFor(3) });
  }
  return out.sort((a, b) => b.level - a.level || Number(b.severity1) - Number(a.severity1) || b.daysLate - a.daysLate);
}
