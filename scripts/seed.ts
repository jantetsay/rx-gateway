// Loads made-up sample data so the dashboard has something to show. Every
// name, address and number here is invented. No client data, no real pricing.

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db/client";
import * as repo from "../src/db/repo";
import * as t from "../src/db/schema";
import { addDays, addWorkingDays, today } from "../src/domain/calendar";
import { schedule } from "../src/domain/schedule";
import { WORKSTREAMS, type GateKey, type WorkstreamKey } from "../src/domain/types";

const asOf = today();
const db = await getDb();

const existing = await db.select().from(t.users);
if (existing.length) {
  console.log("Database already has data. Run `npm run db:sample` to start over with sample data.");
  process.exit(0);
}

const users = [
  { id: "u-admin", name: "Avery Admin", email: "admin@example.com", role: "admin" },
  { id: "u-exec", name: "Jordan Exec", email: "exec@example.com", role: "executive" },
  { id: "u-pm1", name: "Riley Manager", email: "pm1@example.com", role: "pm" },
  { id: "u-pm2", name: "Casey Manager", email: "pm2@example.com", role: "pm" },
  { id: "u-data", name: "Morgan Data", email: "data@example.com", role: "member" },
  { id: "u-edi", name: "Quinn EDI", email: "edi@example.com", role: "member" },
  { id: "u-train", name: "Drew Trainer", email: "train@example.com", role: "member" },
];
await db.insert(t.users).values(users);
const owners: Record<WorkstreamKey, string> = {
  env_config: "u-pm1", data: "u-data", dscsa_partners: "u-edi", edi_integrations: "u-edi",
  training: "u-train", site_hardware: "u-pm2", finance: "u-pm2", ecommerce: "u-pm1",
};

const clients = [
  { id: "c-alder", name: "Alder Distribution (sample)", segment: "Wholesaler and distributor" },
  { id: "c-birch", name: "Birch Specialty Pharma (sample)", segment: "Manufacturer" },
  { id: "c-cedar", name: "Cedar Logistics (sample)", segment: "3PL provider" },
  { id: "c-dogwood", name: "Dogwood Supply (sample)", segment: "Micro-distributor" },
  { id: "c-elm", name: "Elm Health Supply (sample)", segment: "Wholesaler and distributor" },
  { id: "c-fir", name: "Fir County Pharmacy Services (sample)", segment: "Government" },
];
await db.insert(t.clients).values(clients.map((c) => ({ ...c, ownerId: "u-exec" })));

const ws = (...skip: WorkstreamKey[]) => WORKSTREAMS.filter((w) => !skip.includes(w));

async function make(clientId: string, name: string, start: string, opts: {
  stage: string; pmId: string; tier: number; modules: string[]; targetEnd: string | null; skip?: WorkstreamKey[]; signed?: boolean;
}) {
  const id = await repo.createProject(db, {
    clientId, name, stage: opts.stage as never, start, modules: opts.modules, tier: opts.tier, pmId: opts.pmId,
    targetWindowStart: opts.targetEnd ? addDays(opts.targetEnd, -30) : null, targetWindowEnd: opts.targetEnd,
    workstreams: ws(...(opts.skip ?? [])), contractSigned: opts.signed === false ? null : start,
  }, "u-admin");
  await db.update(t.projectWorkstreams).set({ ownerId: owners.data }).where(and(eq(t.projectWorkstreams.projectId, id), eq(t.projectWorkstreams.workstream, "data")));
  for (const w of WORKSTREAMS) {
    await db.update(t.projectWorkstreams).set({ ownerId: owners[w] }).where(and(eq(t.projectWorkstreams.projectId, id), eq(t.projectWorkstreams.workstream, w)));
  }
  // Owners on every item by workstream; recent updates on open work.
  const tasks = await db.select().from(t.tasks).where(eq(t.tasks.projectId, id));
  for (const x of tasks) {
    await db.update(t.tasks).set({ ownerId: owners[x.workstream as WorkstreamKey], lastUpdateAt: addDays(asOf, -1) + "T15:00:00Z" }).where(eq(t.tasks.id, x.id));
  }
  return id;
}

async function passGates(projectId: string, keys: GateKey[]) {
  const tasks = await db.select().from(t.tasks).where(eq(t.tasks.projectId, projectId));
  for (const x of tasks) {
    if (x.gateKey && keys.includes(x.gateKey as GateKey)) {
      const done = x.dueDate && x.dueDate < asOf ? x.dueDate : addDays(asOf, -1);
      await db.update(t.tasks).set({ status: "done", completedAt: done, evidence: "Sample evidence on file" }).where(eq(t.tasks.id, x.id));
    }
  }
  const gates = await db.select().from(t.gates).where(and(eq(t.gates.projectId, projectId), inArray(t.gates.key, keys)));
  for (const g of gates) {
    await db.update(t.gates).set({ result: "passed", satDate: g.plannedDate }).where(eq(t.gates.id, g.id));
    await db.update(t.gateSigners).set({ personName: "Sample Signer", signedAt: (g.plannedDate ?? asOf) + "T17:00:00Z" }).where(eq(t.gateSigners.gateId, g.id));
  }
}

async function nameRoles(projectId: string, except: string[] = []) {
  const roles = await db.select().from(t.clientRoles).where(eq(t.clientRoles.projectId, projectId));
  for (const r of roles) if (!except.includes(r.roleLabel)) await db.update(t.clientRoles).set({ personName: `Client ${r.roleLabel.toLowerCase()}` }).where(eq(t.clientRoles.id, r.id));
}

async function nameSigners(projectId: string, keys: GateKey[]) {
  const gates = await db.select().from(t.gates).where(and(eq(t.gates.projectId, projectId), inArray(t.gates.key, keys)));
  for (const g of gates) await db.update(t.gateSigners).set({ personName: "Sample Signer" }).where(eq(t.gateSigners.gateId, g.id));
}

/** Re-plan open work from today, as a PM would after a re-baseline, so sample dates look live. */
async function replan(projectId: string) {
  const [snap] = await repo.loadSnapshots(db, [projectId]);
  const sched = schedule(snap.tasks, snap.dependencies, { projectStart: snap.project.contractSigned ?? asOf, asOf });
  for (const x of snap.tasks) {
    const f = sched.byId.get(x.id);
    if (!f || x.status === "done") continue;
    await db.update(t.tasks).set({ startDate: f.start, dueDate: f.finish }).where(eq(t.tasks.id, x.id));
  }
  for (const g of snap.gates) {
    const m = snap.tasks.find((x) => x.kind === "milestone" && x.gateKey === g.key);
    const f = m && sched.byId.get(m.id);
    if (f && g.result === "pending") await db.update(t.gates).set({ plannedDate: f.finish }).where(eq(t.gates.id, g.id));
  }
}

const byTitle = async (projectId: string, prefix: string) => {
  const rows = await db.select().from(t.tasks).where(eq(t.tasks.projectId, projectId));
  const x = rows.find((r) => r.title.startsWith(prefix));
  if (!x) throw new Error(`No task starting "${prefix}"`);
  return x;
};

// 1. Alder: in data and integration, behind on the critical path. Red.
const alder = await make("c-alder", "ERP and DSCSA onboarding", addWorkingDays(asOf, -75), {
  stage: "data", pmId: "u-pm1", tier: 3, modules: ["ERP", "DSCSA", "EDI"], targetEnd: addDays(asOf, 70), skip: ["ecommerce"],
});
await passGates(alder, ["G1", "G2", "G3", "G4"]);
await replan(alder);
await nameRoles(alder);
await nameSigners(alder, ["G5", "G6"]);
{
  const extract = await byTitle(alder, "Extract complete");
  await db.update(t.tasks).set({ status: "blocked", blockedSince: addWorkingDays(asOf, -4), blockerNote: "Client's backup is encrypted; waiting on the key through a secure channel", dueDate: addWorkingDays(asOf, -3), decisionNeeded: "Client data owner to send the backup key or a read-only copy" }).where(eq(t.tasks.id, extract.id));
  const gl = await byTitle(alder, "GL mapping");
  await db.update(t.tasks).set({ status: "in_progress", dueDate: addWorkingDays(asOf, -2) }).where(eq(t.tasks.id, gl.id));
  const epcis = await byTitle(alder, "EPCIS test files");
  await db.update(t.tasks).set({ status: "in_progress" }).where(eq(t.tasks.id, epcis.id));
  await db.insert(t.exceptions).values({ id: repo.newId(), projectId: alder, rule: "G4 passed with hub certification still booked, not done", reason: "Hub's test calendar was full; partner traffic is low volume", approvedBy: "Jordan Exec", expiresAt: addDays(asOf, 10), createdBy: "u-pm1", createdAt: addDays(asOf, -12) });
  await db.insert(t.connections).values([
    { id: repo.newId(), projectId: alder, partnerName: "Sample Manufacturer One", requestedAt: addDays(asOf, -25), acknowledgedAt: null, neededDayOne: true, status: "requested" },
    { id: repo.newId(), projectId: alder, partnerName: "Sample Manufacturer Two", requestedAt: addDays(asOf, -25), acknowledgedAt: addDays(asOf, -20), neededDayOne: true, status: "testing" },
  ]);
}

// 2. Birch: onboarding, on track.
const birch = await make("c-birch", "Serialization and ERP", addWorkingDays(asOf, -30), {
  stage: "onboarding", pmId: "u-pm2", tier: 2, modules: ["ERP", "DSCSA"], targetEnd: addDays(asOf, 200), skip: ["ecommerce"],
});
await passGates(birch, ["G1", "G2", "G3"]);
await nameRoles(birch);
await nameSigners(birch, ["G4", "G5"]);
await replan(birch);

// 3. Cedar: committed go-live, validating. An unnamed client role and a hand change.
const cedar = await make("c-cedar", "Warehouse go-live", addWorkingDays(asOf, -150), {
  stage: "validate_go_live", pmId: "u-pm1", tier: 2, modules: ["ERP", "EDI", "E-commerce"], targetEnd: addDays(asOf, 40),
});
await passGates(cedar, ["G1", "G2", "G3", "G4", "G5", "G6"]);
await nameRoles(cedar, ["Controller"]);
await nameSigners(cedar, ["G7a", "G7b"]);
{
  const goLive = await byTitle(cedar, "Go live");
  await db.update(t.projects).set({ notEarlierThan: addDays(asOf, 20) }).where(eq(t.projects.id, cedar));
  await replan(cedar);
  await db.insert(t.overrides).values({ id: repo.newId(), projectId: cedar, scope: "workstream", target: "training", color: "yellow", reason: "Two super-users just left the client; replacements not named yet", setBy: "u-pm1", setAt: asOf + "T12:00:00Z", lapsesAt: addDays(asOf, 7 - ((new Date(asOf).getUTCDay() + 6) % 7)) });
  await db.insert(t.issues).values({ id: repo.newId(), projectId: cedar, title: "Label printer driver fails on the packing line", severity: 2, compliance: false, openedAt: addDays(asOf, -2) });
  void goLive;
}

// 4. Dogwood: in hypercare, quiet.
const dogwood = await make("c-dogwood", "ERP go-live", addWorkingDays(asOf, -160), {
  stage: "hypercare", pmId: "u-pm2", tier: 1, modules: ["ERP"], targetEnd: addDays(asOf, -15), skip: ["ecommerce", "site_hardware"],
});
await passGates(dogwood, ["G1", "G2", "G3", "G4", "G5", "G6", "G7a", "G7b"]);
await nameRoles(dogwood);
await nameSigners(dogwood, ["G8"]);
{
  const goLive = await byTitle(dogwood, "Go live");
  await db.update(t.tasks).set({ status: "done", completedAt: addDays(asOf, -15) }).where(eq(t.tasks.id, goLive.id));
  await db.update(t.projects).set({ committedDate: addDays(asOf, -15), notEarlierThan: addDays(asOf, -40) }).where(eq(t.projects.id, dogwood));
  const tasks = await db.select().from(t.tasks).where(eq(t.tasks.projectId, dogwood));
  for (const x of tasks) if (x.status !== "done" && x.gateKey === "G8") {
    await db.update(t.tasks).set({ status: "in_progress", startDate: addWorkingDays(asOf, -10) }).where(eq(t.tasks.id, x.id));
  }
  await replan(dogwood);
}

// 5. Elm: pre-discovery, alongside sales.
const elm = await make("c-elm", "New onboarding (deal open)", addWorkingDays(asOf, -3), {
  stage: "pre_discovery", pmId: "u-pm2", tier: 2, modules: ["ERP", "DSCSA", "EDI"], targetEnd: addDays(asOf, 180), signed: false,
});
await nameSigners(elm, ["G1", "G2"]);
await replan(elm);

// 6. Fir: pre-discovery, lost.
const fir = await make("c-fir", "Agency pilot (deal lost)", addWorkingDays(asOf, -40), {
  stage: "pre_discovery", pmId: "u-pm1", tier: 1, modules: ["ERP"], targetEnd: null, signed: false,
});
await db.update(t.projects).set({ archived: true, archiveReason: "Lost: budget not approved" }).where(eq(t.projects.id, fir));

// Shared partner profiles (made up).
const profA = await repo.upsertProfile(db, { id: "prof-a", legalName: "Sample Wholesale Partner Inc", kind: "wholesaler", method: "AS2", isaQualifierTest: "ZZ", isaIdTest: "SAMPLEWHSTEST", gsIdTest: "SAMPLEWHS", isaQualifierProd: "ZZ", isaIdProd: "SAMPLEWHS", gsIdProd: "SAMPLEWHS", as2Id: "SAMPLEWHS-AS2", mdn: "Signed, sync", signingAlgorithm: "SHA-256", encryptionAlgorithm: "AES-256", ediVersion: "4010", shipToQualifier: "GLN in N104", specGuide: "Partner companion guide v3 (on file)", verifiedBy: "Quinn EDI", verifiedAt: addDays(asOf, -40) }, "u-edi");
const profB = await repo.upsertProfile(db, { id: "prof-b", legalName: "Sample Chain Pharmacy Group", kind: "dispenser", method: "VAN", vanProvider: "Sample VAN", ediVersion: "5010", shipToQualifier: "DEA in N104", hubRequired: true, verifiedBy: "Quinn EDI", verifiedAt: addDays(asOf, -10) }, "u-edi");

// EDI partners on Alder.
const tx = (partnerId: string, sets: [string, "inbound" | "outbound", "not_run" | "passed" | "failed"][]) =>
  db.insert(t.ediTests).values(sets.map(([transaction, direction, testStatus]) => ({ id: repo.newId(), partnerId, transaction, direction, testStatus })));
const p1 = await repo.addPartner(db, { projectId: alder, profileId: profA, name: "Sample Wholesale Partner Inc", type: "supplier", inPhaseOne: "yes", method: "AS2", stage: 5, ownerId: "u-edi", nextStep: "Send 855 and 856 test files", nextStepDate: addWorkingDays(asOf, 3), dateTold: addDays(asOf, 70), lastContact: addWorkingDays(asOf, -1), certificateSent: true, certExpiry: addDays(asOf, 45), profileRecheckedAt: addDays(asOf, -30) }, "u-edi");
await tx(p1, [["850", "outbound", "passed"], ["855", "inbound", "not_run"], ["856", "inbound", "not_run"], ["810", "inbound", "not_run"], ["997", "inbound", "passed"]]);
const p2 = await repo.addPartner(db, { projectId: alder, profileId: profB, name: "Sample Chain Pharmacy Group", type: "customer", inPhaseOne: "yes", method: "VAN", stage: 3, ownerId: "u-edi", nextStep: "Close the N104 qualifier gap", nextStepDate: addWorkingDays(asOf, -2), dateTold: addDays(asOf, 10), lastContact: addWorkingDays(asOf, -7), oldProvider: "Previous EDI provider" }, "u-edi");
await tx(p2, [["850", "inbound", "failed"], ["855", "outbound", "not_run"], ["856", "outbound", "not_run"], ["810", "outbound", "not_run"]]);
await repo.addGap(db, { partnerId: p2, description: "Expects DEA in N104; standard layout sends GLN", ownerId: null, dueDate: null }, "u-edi");
const p3 = await repo.addPartner(db, { projectId: alder, name: "Sample Regional Clinic Network", type: "customer", inPhaseOne: "tbd", method: "SFTP", stage: 2, ownerId: null, nextStep: "Chase the intake form", nextStepDate: addWorkingDays(asOf, 4), lastContact: addWorkingDays(asOf, -2) }, "u-edi");
await tx(p3, [["850", "inbound", "not_run"], ["810", "outbound", "not_run"]]);
await repo.addPartner(db, { projectId: alder, name: "Sample Specialty Distributor", type: "supplier", inPhaseOne: "yes", method: "AS2", stage: 4, ownerId: "u-edi", nextStep: "Exchange production certificate", nextStepDate: addWorkingDays(asOf, 5), dateTold: addDays(asOf, 70), lastContact: asOf, certificateSent: false, licenseExpiry: addDays(asOf, 25) }, "u-edi");

// A week-old snapshot so trends show.
const lastWeek = addDays(asOf, -7) + "T09:00:00Z";
await db.insert(t.snapshots).values([
  { projectId: alder, takenAt: lastWeek, reason: "weekly", color: "yellow", reasons: ["Sample prior week"] },
  { projectId: birch, takenAt: lastWeek, reason: "weekly", color: "yellow", reasons: ["Sample prior week"] },
  { projectId: cedar, takenAt: lastWeek, reason: "weekly", color: "green", reasons: ["Sample prior week"] },
  { projectId: dogwood, takenAt: lastWeek, reason: "weekly", color: "green", reasons: ["Sample prior week"] },
]);
await repo.audit(db, "u-admin", "seed", "database", "sample", { note: "Loaded made-up sample data" });
console.log(`Seeded ${clients.length} sample clients as of ${asOf}.`);
process.exit(0);
