// Reads and writes. Every write goes through here and leaves an audit entry.

import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { nextMonday, today, type ISODate } from "@/domain/calendar";
import { stageMoveError, type EdiPartner } from "@/domain/edi";
import { instantiate } from "@/domain/instantiate";
import { CLIENT_ROLES } from "@/domain/template";
import type {
  Color, GateKey, HandOverride, ProjectSnapshot, StageKey, Task, TaskStatus, WorkstreamKey,
} from "@/domain/types";
import type { DB } from "./client";
import * as t from "./schema";

export const newId = () => randomUUID();
const nowIso = () => new Date().toISOString();

export type User = typeof t.users.$inferSelect;

export async function audit(
  db: DB, actorId: string | null, action: string, entity: string, entityId: string,
  opts: { projectId?: string | null; before?: unknown; after?: unknown; note?: string } = {},
) {
  await db.insert(t.auditLog).values({
    at: nowIso(), actorId, action, entity, entityId, projectId: opts.projectId ?? null,
    before: opts.before ?? null, after: opts.after ?? null, note: opts.note ?? null,
  });
}

export async function actingUser(db: DB): Promise<User | null> {
  const email = process.env.RXG_ACTING_USER;
  if (email) {
    const [u] = await db.select().from(t.users).where(eq(t.users.email, email));
    if (u) return u;
  }
  const [admin] = await db.select().from(t.users).where(eq(t.users.role, "admin")).orderBy(asc(t.users.name)).limit(1);
  return admin ?? null;
}

// ---------- Loading ----------

export async function loadSnapshots(db: DB, projectIds?: string[]): Promise<ProjectSnapshot[]> {
  const projects = await db.select({ p: t.projects, c: t.clients }).from(t.projects)
    .innerJoin(t.clients, eq(t.projects.clientId, t.clients.id))
    .where(projectIds ? inArray(t.projects.id, projectIds) : undefined);
  if (!projects.length) return [];
  const ids = projects.map((x) => x.p.id);
  const [tasks, gates, roles, conns, iss, exc, ovr, ws, users, partners] = await Promise.all([
    db.select().from(t.tasks).where(inArray(t.tasks.projectId, ids)),
    db.select().from(t.gates).where(inArray(t.gates.projectId, ids)),
    db.select().from(t.clientRoles).where(inArray(t.clientRoles.projectId, ids)),
    db.select().from(t.connections).where(inArray(t.connections.projectId, ids)),
    db.select().from(t.issues).where(inArray(t.issues.projectId, ids)),
    db.select().from(t.exceptions).where(inArray(t.exceptions.projectId, ids)),
    db.select().from(t.overrides).where(inArray(t.overrides.projectId, ids)),
    db.select().from(t.projectWorkstreams).where(inArray(t.projectWorkstreams.projectId, ids)),
    db.select().from(t.users),
    db.select().from(t.ediPartners).where(inArray(t.ediPartners.projectId, ids)),
  ]);
  const taskIds = tasks.map((x) => x.id);
  const gateIds = gates.map((x) => x.id);
  const partnerIds = partners.map((x) => x.id);
  const [deps, signers, tests, gaps] = await Promise.all([
    taskIds.length ? db.select().from(t.dependencies).where(inArray(t.dependencies.succId, taskIds)) : [],
    gateIds.length ? db.select().from(t.gateSigners).where(inArray(t.gateSigners.gateId, gateIds)) : [],
    partnerIds.length ? db.select().from(t.ediTests).where(inArray(t.ediTests.partnerId, partnerIds)) : [],
    partnerIds.length ? db.select().from(t.specGaps).where(inArray(t.specGaps.partnerId, partnerIds)) : [],
  ]);
  const people = new Map(users.map((u) => [u.id, { id: u.id, name: u.name }]));
  const byProject = <T extends { projectId: string }>(xs: T[], id: string) => xs.filter((x) => x.projectId === id);

  return projects.map(({ p, c }) => ({
    project: {
      id: p.id, clientId: c.id, clientName: c.name, segment: c.segment, name: p.name, modules: p.modules, tier: p.tier,
      stage: p.stage as StageKey, archived: p.archived, contractSigned: p.contractSigned, targetWindowStart: p.targetWindowStart,
      targetWindowEnd: p.targetWindowEnd, notEarlierThan: p.notEarlierThan, committedDate: p.committedDate, pmId: p.pmId, updatedAt: p.updatedAt,
    },
    tasks: byProject(tasks, p.id).map((x) => ({
      ...x, kind: x.kind as Task["kind"], stage: x.stage as StageKey, workstream: x.workstream as WorkstreamKey,
      gateKey: x.gateKey as GateKey | null, status: x.status as TaskStatus, source: x.source as Task["source"],
    })),
    dependencies: deps.filter((d) => taskIds.includes(d.succId) && tasks.find((x) => x.id === d.succId)?.projectId === p.id),
    gates: byProject(gates, p.id).map((g) => ({
      id: g.id, projectId: g.projectId, key: g.key as GateKey, plannedDate: g.plannedDate, satDate: g.satDate,
      result: g.result as "pending" | "passed" | "failed",
      signers: signers.filter((s) => s.gateId === g.id).sort((a, b) => a.id.localeCompare(b.id)),
    })),
    clientRoles: byProject(roles, p.id),
    connections: byProject(conns, p.id).map((x) => ({ ...x, status: x.status as ProjectSnapshot["connections"][number]["status"] })),
    issues: byProject(iss, p.id).map((x) => ({ ...x, severity: x.severity as 1 | 2 | 3 })),
    exceptions: byProject(exc, p.id),
    overrides: byProject(ovr, p.id).map((x) => ({ ...x, scope: x.scope as HandOverride["scope"], color: x.color as Color })),
    workstreams: byProject(ws, p.id).map((x) => ({ ...x, workstream: x.workstream as WorkstreamKey })),
    people,
    ediPartners: byProject(partners, p.id).map((x) => toPartner(x, tests, gaps)),
  }));
}

function toPartner(
  x: typeof t.ediPartners.$inferSelect, tests: (typeof t.ediTests.$inferSelect)[], gaps: (typeof t.specGaps.$inferSelect)[],
): EdiPartner {
  return {
    ...x, type: x.type as EdiPartner["type"], inPhaseOne: x.inPhaseOne as EdiPartner["inPhaseOne"],
    method: x.method as EdiPartner["method"], isa15: x.isa15 as "T" | "P",
    tests: tests.filter((y) => y.partnerId === x.id).map((y) => ({
      id: y.id, transaction: y.transaction, direction: y.direction as "inbound" | "outbound",
      testStatus: y.testStatus as "not_run" | "passed" | "failed", prodStatus: y.prodStatus as "not_live" | "live", notes: y.notes,
    })).sort((a, b) => a.transaction.localeCompare(b.transaction)),
    gaps: gaps.filter((y) => y.partnerId === x.id),
  };
}

export async function previousColors(db: DB, asOf: ISODate): Promise<Map<string, Color>> {
  // Trend since last week: the newest snapshot at least 6 days old.
  const cutoff = new Date(Date.parse(asOf) - 6 * 86_400_000).toISOString();
  const rows = await db.select().from(t.snapshots).where(lt(t.snapshots.takenAt, cutoff)).orderBy(desc(t.snapshots.takenAt));
  const out = new Map<string, Color>();
  for (const r of rows) if (!out.has(r.projectId)) out.set(r.projectId, r.color as Color);
  return out;
}

// ---------- Projects ----------

export interface NewProject {
  clientId: string;
  name: string;
  stage: StageKey;
  start: ISODate;
  modules: string[];
  tier: number | null;
  pmId: string | null;
  targetWindowStart: ISODate | null;
  targetWindowEnd: ISODate | null;
  workstreams: WorkstreamKey[];
  contractSigned: ISODate | null;
}

export async function createProject(db: DB, input: NewProject, actorId: string | null): Promise<string> {
  const id = `prj-${randomUUID().slice(0, 8)}`;
  const plan = instantiate(id, input.start, { workstreams: input.workstreams, newId });
  await db.transaction(async (tx) => {
    await tx.insert(t.projects).values({
      id, clientId: input.clientId, name: input.name, modules: input.modules, tier: input.tier, stage: input.stage,
      contractSigned: input.contractSigned, targetWindowStart: input.targetWindowStart, targetWindowEnd: input.targetWindowEnd,
      pmId: input.pmId, templateVersion: plan.templateVersion, updatedAt: nowIso(),
    });
    const { WORKSTREAMS } = await import("@/domain/types");
    await tx.insert(t.projectWorkstreams).values(WORKSTREAMS.map((w) => ({ projectId: id, workstream: w, enabled: input.workstreams.includes(w), ownerId: null })));
    await tx.insert(t.tasks).values(plan.tasks.map((x) => ({ ...x })));
    if (plan.dependencies.length) await tx.insert(t.dependencies).values(plan.dependencies);
    await tx.insert(t.gates).values(plan.gates.map(({ signers: _s, ...g }) => g));
    await tx.insert(t.gateSigners).values(plan.gates.flatMap((g) => g.signers.map((s) => ({ ...s, gateId: g.id }))));
    await tx.insert(t.clientRoles).values(CLIENT_ROLES.map((roleLabel) => ({ id: newId(), projectId: id, roleLabel, personName: null })));
  });
  await audit(db, actorId, "create", "project", id, { projectId: id, after: { name: input.name, templateVersion: plan.templateVersion } });
  return id;
}

async function touchProject(db: DB, projectId: string) {
  await db.update(t.projects).set({ updatedAt: nowIso() }).where(eq(t.projects.id, projectId));
}

export async function updateProject(db: DB, projectId: string, patch: Partial<typeof t.projects.$inferInsert>, actorId: string | null, note?: string) {
  const [before] = await db.select().from(t.projects).where(eq(t.projects.id, projectId));
  if (!before) throw new Error("No such project");
  await db.update(t.projects).set({ ...patch, updatedAt: nowIso() }).where(eq(t.projects.id, projectId));
  await audit(db, actorId, "update", "project", projectId, { projectId, before: pick(before, Object.keys(patch)), after: patch, note });
}

/** A signed contract turns a pre-discovery record into a project. */
export async function convertToProject(db: DB, projectId: string, contractSigned: ISODate, actorId: string | null) {
  await updateProject(db, projectId, { stage: "deep_dive", contractSigned }, actorId, "Contract signed");
}

export async function archiveProject(db: DB, projectId: string, reason: string, actorId: string | null) {
  if (!reason.trim()) throw new Error("Give the reason: lost, paused or no decision");
  await updateProject(db, projectId, { archived: true, archiveReason: reason }, actorId, "Archived");
}

// ---------- Tasks ----------

const SHEET_OWNED: (keyof Task)[] = ["title", "dueDate", "status", "completedAt"];

export async function updateTask(db: DB, taskId: string, patch: Partial<Task>, actorId: string | null): Promise<void> {
  const [before] = await db.select().from(t.tasks).where(eq(t.tasks.id, taskId));
  if (!before) throw new Error("No such task");
  if (before.source === "sheet" && SHEET_OWNED.some((k) => k in patch)) {
    throw new Error("This item comes from the sheet. Change its title, date or state there.");
  }
  const next: Partial<typeof t.tasks.$inferInsert> = { ...patch, lastUpdateAt: nowIso() };
  if (patch.status === "done" && !before.completedAt) next.completedAt = today();
  if (patch.status && patch.status !== "done") next.completedAt = null;
  if (patch.status === "blocked" && before.status !== "blocked") next.blockedSince = today();
  if (patch.status && patch.status !== "blocked") { next.blockedSince = null; }
  await db.update(t.tasks).set(next).where(eq(t.tasks.id, taskId));
  await touchProject(db, before.projectId);
  await audit(db, actorId, "update", "task", taskId, { projectId: before.projectId, before: pick(before, Object.keys(next)), after: next });
}

export async function addTask(db: DB, task: Omit<Task, "id" | "source" | "lastUpdateAt">, actorId: string | null): Promise<string> {
  const id = newId();
  await db.insert(t.tasks).values({ ...task, id, source: "app", lastUpdateAt: nowIso() });
  await touchProject(db, task.projectId);
  await audit(db, actorId, "create", "task", id, { projectId: task.projectId, after: task });
  return id;
}

// ---------- Gates ----------

export async function nameSigner(db: DB, signerId: string, personName: string | null, actorId: string | null) {
  const [before] = await db.select().from(t.gateSigners).where(eq(t.gateSigners.id, signerId));
  if (!before) throw new Error("No such signer");
  await db.update(t.gateSigners).set({ personName: personName?.trim() || null }).where(eq(t.gateSigners.id, signerId));
  const [g] = await db.select().from(t.gates).where(eq(t.gates.id, before.gateId));
  await audit(db, actorId, "name_signer", "gate_signer", signerId, { projectId: g?.projectId, before, after: { personName } });
}

export async function signGate(db: DB, signerId: string, actorId: string | null) {
  const [s] = await db.select().from(t.gateSigners).where(eq(t.gateSigners.id, signerId));
  if (!s?.personName) throw new Error("Name the signer before recording a signature");
  await db.update(t.gateSigners).set({ signedAt: nowIso() }).where(eq(t.gateSigners.id, signerId));
  const [g] = await db.select().from(t.gates).where(eq(t.gates.id, s.gateId));
  await audit(db, actorId, "sign", "gate_signer", signerId, { projectId: g?.projectId, after: { roleLabel: s.roleLabel, personName: s.personName } });
}

/**
 * Record a gate sitting. G5 passing sets the "no earlier than" date; G7a passing
 * commits the go-live date. A pass needs every signer's signature.
 */
export async function sitGate(
  db: DB, gateId: string, result: "passed" | "failed", opts: { date?: ISODate; notEarlierThan?: ISODate; committedDate?: ISODate },
  actorId: string | null,
) {
  const [g] = await db.select().from(t.gates).where(eq(t.gates.id, gateId));
  if (!g) throw new Error("No such gate");
  const signers = await db.select().from(t.gateSigners).where(eq(t.gateSigners.gateId, gateId));
  if (result === "passed" && signers.some((s) => !s.signedAt)) throw new Error("Every required signer has to sign before the gate can pass");
  if (result === "passed" && g.key === "G5" && !opts.notEarlierThan) throw new Error("G5 sets the no-earlier-than date: give it");
  if (result === "passed" && g.key === "G7a" && !opts.committedDate) throw new Error("G7a commits the go-live date: give it");
  await db.update(t.gates).set({ result, satDate: opts.date ?? today() }).where(eq(t.gates.id, gateId));
  if (result === "passed" && g.key === "G5") await updateProject(db, g.projectId, { notEarlierThan: opts.notEarlierThan }, actorId, "Set at G5");
  if (result === "passed" && g.key === "G7a") await updateProject(db, g.projectId, { committedDate: opts.committedDate }, actorId, "Committed at G7a");
  await audit(db, actorId, "sit", "gate", gateId, { projectId: g.projectId, before: { result: g.result }, after: { result, ...opts } });
  await snapshotProjects(db, [g.projectId], `${g.key} sitting`);
}

// ---------- Overrides, exceptions, escalations, baselines ----------

export async function addOverride(
  db: DB, o: { projectId: string; scope: HandOverride["scope"]; target: string; color: Color; reason: string }, actorId: string,
) {
  if (o.reason.trim().length < 5) throw new Error("A hand change needs a written reason");
  const id = newId();
  const row = { ...o, id, setBy: actorId, setAt: nowIso(), lapsesAt: nextMonday(today()) };
  await db.insert(t.overrides).values(row);
  await audit(db, actorId, "override", o.scope, o.target, { projectId: o.projectId, after: row });
}

export async function addException(
  db: DB, x: { projectId: string; rule: string; reason: string; approvedBy: string | null; expiresAt: ISODate }, actorId: string,
) {
  if (!x.reason.trim() || !x.rule.trim()) throw new Error("An exception needs the rule it departs from and the reason");
  const id = newId();
  await db.insert(t.exceptions).values({ ...x, id, createdBy: actorId, createdAt: nowIso() });
  await audit(db, actorId, "create", "exception", id, { projectId: x.projectId, after: x });
}

export async function approveException(db: DB, id: string, approvedBy: string, actorId: string) {
  const [x] = await db.select().from(t.exceptions).where(eq(t.exceptions.id, id));
  if (!x) throw new Error("No such exception");
  await db.update(t.exceptions).set({ approvedBy }).where(eq(t.exceptions.id, id));
  await audit(db, actorId, "approve", "exception", id, { projectId: x.projectId, after: { approvedBy } });
}

export async function acknowledgeEscalation(db: DB, key: string, projectId: string, actorId: string) {
  await db.insert(t.escalationAcks).values({ key, projectId, acknowledgedBy: actorId, acknowledgedAt: nowIso() }).onConflictDoNothing();
  await audit(db, actorId, "acknowledge", "escalation", key, { projectId });
}

export async function acks(db: DB): Promise<Map<string, { by: string; at: string }>> {
  const rows = await db.select().from(t.escalationAcks);
  return new Map(rows.map((r) => [r.key, { by: r.acknowledgedBy, at: r.acknowledgedAt }]));
}

export async function takeBaseline(db: DB, projectId: string, label: string, approvedBy: string | null, goLive: ISODate | null, actorId: string | null) {
  const gates = await db.select().from(t.gates).where(eq(t.gates.projectId, projectId));
  const existing = await db.select().from(t.baselines).where(eq(t.baselines.projectId, projectId));
  if (existing.length >= 2 && !approvedBy) throw new Error("A re-baseline needs Steve's approval");
  const id = newId();
  await db.insert(t.baselines).values({
    id, projectId, label, takenAt: nowIso(), goLive, approvedBy,
    gateDates: Object.fromEntries(gates.map((g) => [g.key, g.plannedDate])),
  });
  await audit(db, actorId, "baseline", "project", projectId, { projectId, after: { label, approvedBy } });
}

// ---------- Client roles, connections, issues ----------

export async function nameClientRole(db: DB, roleId: string, personName: string | null, actorId: string | null) {
  const [r] = await db.select().from(t.clientRoles).where(eq(t.clientRoles.id, roleId));
  if (!r) throw new Error("No such role");
  await db.update(t.clientRoles).set({ personName: personName?.trim() || null }).where(eq(t.clientRoles.id, roleId));
  await touchProject(db, r.projectId);
  await audit(db, actorId, "update", "client_role", roleId, { projectId: r.projectId, before: r, after: { personName } });
}

export async function addConnection(db: DB, c: { projectId: string; partnerName: string; neededDayOne: boolean; requestedAt: ISODate | null }, actorId: string | null) {
  const id = newId();
  await db.insert(t.connections).values({ ...c, id, status: "requested" });
  await audit(db, actorId, "create", "connection", id, { projectId: c.projectId, after: c });
}

export async function updateConnection(db: DB, id: string, patch: Partial<typeof t.connections.$inferInsert>, actorId: string | null) {
  const [c] = await db.select().from(t.connections).where(eq(t.connections.id, id));
  if (!c) throw new Error("No such connection");
  await db.update(t.connections).set(patch).where(eq(t.connections.id, id));
  await audit(db, actorId, "update", "connection", id, { projectId: c.projectId, before: pick(c, Object.keys(patch)), after: patch });
}

export async function addIssue(db: DB, i: { projectId: string; title: string; severity: 1 | 2 | 3; compliance: boolean }, actorId: string | null) {
  const id = newId();
  await db.insert(t.issues).values({ ...i, id, openedAt: today() });
  await touchProject(db, i.projectId);
  await audit(db, actorId, "create", "issue", id, { projectId: i.projectId, after: i });
}

export async function closeIssue(db: DB, id: string, actorId: string | null) {
  const [i] = await db.select().from(t.issues).where(eq(t.issues.id, id));
  if (!i) throw new Error("No such issue");
  await db.update(t.issues).set({ closedAt: today() }).where(eq(t.issues.id, id));
  await audit(db, actorId, "close", "issue", id, { projectId: i.projectId });
}

// ---------- EDI ----------

export async function addPartner(db: DB, p: Partial<typeof t.ediPartners.$inferInsert> & { projectId: string; name: string; type: string }, actorId: string | null) {
  const id = newId();
  await db.insert(t.ediPartners).values({ ...p, id });
  await audit(db, actorId, "create", "edi_partner", id, { projectId: p.projectId, after: { name: p.name } });
  return id;
}

export async function updatePartner(db: DB, id: string, patch: Partial<typeof t.ediPartners.$inferInsert>, actorId: string | null) {
  const [snap] = await loadPartner(db, id);
  if (!snap) throw new Error("No such partner");
  if (patch.stage !== undefined && patch.stage !== snap.stage) {
    const err = stageMoveError({ ...snap, complianceCleared: patch.complianceCleared ?? snap.complianceCleared, badFileRejected: patch.badFileRejected ?? snap.badFileRejected }, patch.stage);
    if (err) throw new Error(err);
  }
  await db.update(t.ediPartners).set(patch).where(eq(t.ediPartners.id, id));
  await touchProject(db, snap.projectId);
  await audit(db, actorId, "update", "edi_partner", id, { projectId: snap.projectId, after: patch });
}

async function loadPartner(db: DB, id: string): Promise<EdiPartner[]> {
  const rows = await db.select().from(t.ediPartners).where(eq(t.ediPartners.id, id));
  if (!rows.length) return [];
  const tests = await db.select().from(t.ediTests).where(eq(t.ediTests.partnerId, id));
  const gaps = await db.select().from(t.specGaps).where(eq(t.specGaps.partnerId, id));
  return rows.map((r) => toPartner(r, tests, gaps));
}

export async function setTest(db: DB, partnerId: string, transaction: string, direction: "inbound" | "outbound",
  patch: { testStatus?: string; prodStatus?: string; notes?: string | null }, actorId: string | null) {
  const [existing] = await db.select().from(t.ediTests)
    .where(and(eq(t.ediTests.partnerId, partnerId), eq(t.ediTests.transaction, transaction), eq(t.ediTests.direction, direction)));
  const [p] = await db.select().from(t.ediPartners).where(eq(t.ediPartners.id, partnerId));
  if (existing) await db.update(t.ediTests).set(patch).where(eq(t.ediTests.id, existing.id));
  else await db.insert(t.ediTests).values({ id: newId(), partnerId, transaction, direction, ...patch });
  await audit(db, actorId, "test", "edi_partner", partnerId, { projectId: p?.projectId, after: { transaction, direction, ...patch } });
}

export async function addGap(db: DB, g: { partnerId: string; description: string; ownerId: string | null; dueDate: ISODate | null }, actorId: string | null) {
  const id = newId();
  await db.insert(t.specGaps).values({ ...g, id });
  const [p] = await db.select().from(t.ediPartners).where(eq(t.ediPartners.id, g.partnerId));
  await audit(db, actorId, "create", "spec_gap", id, { projectId: p?.projectId, after: g });
}

export async function resolveGap(db: DB, id: string, actorId: string | null) {
  await db.update(t.specGaps).set({ resolved: true }).where(eq(t.specGaps.id, id));
  await audit(db, actorId, "resolve", "spec_gap", id);
}

export async function upsertProfile(db: DB, p: typeof t.partnerProfiles.$inferInsert, actorId: string | null) {
  const id = p.id ?? newId();
  const [existing] = await db.select().from(t.partnerProfiles).where(eq(t.partnerProfiles.id, id));
  if (existing) await db.update(t.partnerProfiles).set(p).where(eq(t.partnerProfiles.id, id));
  else await db.insert(t.partnerProfiles).values({ ...p, id });
  await audit(db, actorId, existing ? "update" : "create", "partner_profile", id, { before: existing ?? null, after: p });
  return id;
}

// ---------- Snapshots and weekly refresh ----------

export async function snapshotProjects(db: DB, projectIds: string[] | undefined, reason: string) {
  const { evaluateProject } = await import("@/domain/evaluate");
  const snaps = await loadSnapshots(db, projectIds);
  const asOf = today();
  for (const s of snaps) {
    const e = evaluateProject(s, asOf);
    await db.insert(t.snapshots).values({
      projectId: s.project.id, takenAt: nowIso(), reason, color: e.effective,
      reasons: e.computed.reasons, forecastGoLive: e.forecastGoLive, slipDays: e.slipDays,
    });
  }
  return snaps.length;
}

function pick<T extends object>(o: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k))) as Partial<T>;
}
