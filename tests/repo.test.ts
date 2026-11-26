import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { memoryDb, type DB } from "@/db/client";
import * as repo from "@/db/repo";
import * as t from "@/db/schema";
import { evaluateProject } from "@/domain/evaluate";
import { WORKSTREAMS } from "@/domain/types";
import { syncSource } from "@/sheets/sync";

let db: DB;
let projectId: string;

beforeAll(async () => {
  db = await memoryDb();
  await db.insert(t.users).values({ id: "u1", name: "Pat Example", email: "pat@example.com", role: "admin" });
  await db.insert(t.clients).values({ id: "c1", name: "Example Distribution Co", segment: "Wholesaler" });
  projectId = await repo.createProject(db, {
    clientId: "c1", name: "Onboarding", stage: "deep_dive", start: "2026-11-02", modules: ["ERP"], tier: 2, pmId: "u1",
    targetWindowStart: null, targetWindowEnd: "2027-03-31", workstreams: [...WORKSTREAMS], contractSigned: "2026-11-02",
  }, "u1");
}, 30_000);

describe("records and audit", () => {
  it("lays out a project from the template and evaluates it", async () => {
    const [s] = await repo.loadSnapshots(db, [projectId]);
    expect(s.gates).toHaveLength(9);
    expect(s.clientRoles.every((r) => r.personName === null)).toBe(true);
    const e = evaluateProject(s, "2026-11-03");
    expect(e.computed.reasons.join(" ")).toMatch(/Unnamed client role/);
  });
  it("records every change in the audit log", async () => {
    const [s] = await repo.loadSnapshots(db, [projectId]);
    await repo.updateTask(db, s.tasks.find((x) => x.title.startsWith("Kickoff"))!.id, { ownerId: "u1", evidence: "Notes on file" }, "u1");
    const log = await db.select().from(t.auditLog).where(eq(t.auditLog.entity, "task"));
    expect(log.length).toBeGreaterThan(0);
  });
  it("refuses a hand change without a written reason", async () => {
    await expect(repo.addOverride(db, { projectId, scope: "project", target: projectId, color: "green", reason: "" }, "u1")).rejects.toThrow(/written reason/);
  });
  it("won't pass a gate until every signer has signed, and G7a needs the committed date", async () => {
    const [s] = await repo.loadSnapshots(db, [projectId]);
    const g7a = s.gates.find((g) => g.key === "G7a")!;
    await expect(repo.sitGate(db, g7a.id, "passed", {}, "u1")).rejects.toThrow(/signer/);
    for (const sg of g7a.signers) { await repo.nameSigner(db, sg.id, "Someone", "u1"); await repo.signGate(db, sg.id, "u1"); }
    await expect(repo.sitGate(db, g7a.id, "passed", {}, "u1")).rejects.toThrow(/commits the go-live date/);
    await repo.sitGate(db, g7a.id, "passed", { committedDate: "2027-03-15" }, "u1");
    const [after] = await repo.loadSnapshots(db, [projectId]);
    expect(after.project.committedDate).toBe("2027-03-15");
  });
  it("reads a sheet one way and keeps sheet-owned fields read-only in the app", async () => {
    await db.insert(t.sheetSources).values({
      id: "src1", projectId, label: "Tracker", spreadsheetId: "fake",
      mapping: { tabs: [{ kind: "tasks", tab: "Delivery", defaults: { workstream: "data", stage: "data", gate: "G5" }, columns: { key: "Code", title: "Task", status: "State", due: "Due" } }] },
    });
    const reader = async () => new Map([["Delivery", [["Code", "Task", "State", "Due"], ["X1", "Made-up item", "OPEN", "2026-12-01"]]]]);
    const r = await syncSource(db, "src1", "u1", reader);
    expect(r).toMatchObject({ ok: true, tasks: { added: 1 } });
    const [row] = await db.select().from(t.tasks).where(eq(t.tasks.source, "sheet"));
    await expect(repo.updateTask(db, row.id, { dueDate: "2026-12-05" }, "u1")).rejects.toThrow(/comes from the sheet/);
    await repo.updateTask(db, row.id, { ownerId: "u1" }, "u1");
    const again = await syncSource(db, "src1", "u1", async () => new Map([["Delivery", [["Code", "Task", "State", "Due"]]]]));
    expect(again.tasks.removed).toBe(1);
  });
  it("takes a partner off when its source no longer lists it", async () => {
    await db.insert(t.sheetSources).values({
      id: "src2", projectId, label: "Register", spreadsheetId: "fake",
      mapping: { tabs: [{ kind: "edi_partners", tab: "Connections", columns: { name: "Partner", status: "Status", type: "Type" } }] },
    });
    const head = ["Partner", "Status", "Type"];
    const r = await syncSource(db, "src2", "u1", async () => new Map([["Connections", [head, ["Made-up Supplier", "Testing", "Supplier"], ["Made-up Customer", "Discovery", "Customer"]]]]));
    expect(r.partners).toMatchObject({ added: 2 });
    const [sup] = await db.select().from(t.ediPartners).where(eq(t.ediPartners.name, "Made-up Supplier"));
    expect(sup).toMatchObject({ type: "supplier", sheetStatus: "Testing" });
    const again = await syncSource(db, "src2", "u1", async () => new Map([["Connections", [head, ["Made-up Supplier", "Live", "Supplier"]]]]));
    expect(again.partners).toMatchObject({ updated: 1, removed: 1 });
    const [after] = await db.select().from(t.ediPartners).where(eq(t.ediPartners.name, "Made-up Supplier"));
    expect(after.sheetStatus).toBe("Live");
  });
  it("reads a register's transaction sets onto its partners, and drops sets the sheet no longer lists", async () => {
    await db.insert(t.sheetSources).values({
      id: "src3", projectId, label: "Register with sets", spreadsheetId: "fake",
      mapping: { tabs: [
        { kind: "edi_partners", tab: "Connections", columns: { name: "Partner", status: "Status" } },
        { kind: "edi_sets", tab: "Transactions", columns: { partner: "Partner", set: "Set", direction: "Direction", status: "Map status" } },
      ] },
    });
    const conn = ["Partner", "Status"];
    const tx = ["Partner", "Set", "Direction", "Map status"];
    const r = await syncSource(db, "src3", "u1", async () => new Map([
      ["Connections", [conn, ["Set Partner One", "Testing"]]],
      ["Transactions", [tx, ["Set Partner One", "850", "Inbound to RxERP", "Not started"], ["Set Partner One", "810", "Outbound from RxERP", "Live"], ["Nobody Here", "850", "in", ""]]],
    ]));
    expect(r.ok).toBe(true);
    expect(r.sets).toMatchObject({ added: 2, unmatched: ["Nobody Here"] });
    expect(r.message).toMatch(/2 transaction sets\. No partner named Nobody Here/);
    const [p] = await db.select().from(t.ediPartners).where(eq(t.ediPartners.name, "Set Partner One"));
    const sets = await db.select().from(t.ediTests).where(eq(t.ediTests.partnerId, p.id));
    expect(sets.find((x) => x.transaction === "810")).toMatchObject({ direction: "outbound", prodStatus: "live", sheetStatus: "Live" });
    const again = await syncSource(db, "src3", "u1", async () => new Map([
      ["Connections", [conn, ["Set Partner One", "Testing"]]],
      ["Transactions", [tx, ["Set Partner One", "850", "Inbound to RxERP", "Testing"]]],
    ]));
    expect(again.sets).toMatchObject({ updated: 1, removed: 1 });
    // A partner whose only tests came from the sheet still leaves when the sheet drops it.
    const gone = await syncSource(db, "src3", "u1", async () => new Map([["Connections", [conn]], ["Transactions", [tx]]]));
    expect(gone.partners.removed).toBe(1);
  });
  it("fills Built, Released, Demoed and Accepted from progress tabs by item code, and a note as the description", async () => {
    await db.insert(t.sheetSources).values({
      id: "src4", projectId, label: "Tracker 4", spreadsheetId: "fake",
      mapping: { tabs: [
        { kind: "tasks", tab: "Delivery", defaults: { workstream: "data", stage: "data", gate: null }, columns: { key: "Code", title: "Task", status: "State", notes: "Note" } },
        { kind: "item_progress", tab: "List A", headerRow: 2, columns: { key: "Delivery ID", built: "1 BUILT", released: "2 RELEASED", accepted: "3 ACCEPTED" } },
        { kind: "item_progress", tab: "List B", columns: { key: "Ticket", demoed: "Demo'd?", accepted: "Accepted" } },
      ] },
    });
    const r = await syncSource(db, "src4", "u1", async () => new Map([
      ["Delivery", [["Code", "Task", "State", "Note"], ["Z1", "Made-up one: the detail", "OPEN", ""], ["Z2", "Made-up two", "OPEN", "A note"], ["Z3", "Made-up three", "OPEN", "-"]]],
      ["List A", [["A title row"], ["Delivery ID", "1 BUILT", "2 RELEASED", "3 ACCEPTED"], ["Z1", "YES", "NO", ""], ["-", "YES", "YES", "YES"]]],
      ["List B", [["Ticket", "Demo'd?", "Accepted"], ["Z1", "No", "YES"], ["Z2", "", ""]]],
    ]));
    expect(r.ok).toBe(true);
    expect(r.progress).toBe(1);
    const rows = await db.select().from(t.tasks).where(eq(t.tasks.source, "sheet"));
    const z1 = rows.find((x) => x.sourceRef === "src4:Delivery!Z1")!;
    expect([z1.built, z1.released, z1.demoed, z1.accepted]).toEqual(["YES", "NO", "No", "YES"]);
    const z2 = rows.find((x) => x.sourceRef === "src4:Delivery!Z2")!;
    expect([z2.description, z2.built, z2.accepted]).toEqual(["A note", null, null]);
  });
  it("reads a tab with its own card, keeping its own progress, status words and delivery IDs", async () => {
    await db.insert(t.sheetSources).values({
      id: "src5", projectId, label: "Tracker 5", spreadsheetId: "fake",
      mapping: { tabs: [
        { kind: "tasks", tab: "Asks", card: "Made-up list", headerRow: 2, defaults: { workstream: "env_config", stage: "validate_go_live", gate: null },
          columns: { key: "Ask ID", title: "Ask", status: "Status", delivery: "Delivery ID", ticket: "Ticket #", built: "Built", accepted: "Accepted" },
          statusMap: { "3 ACCEPTED": "done" } },
        { kind: "item_progress", tab: "Other", columns: { key: "ID", built: "Built", demoed: "Demoed" } },
      ] },
    });
    const r = await syncSource(db, "src5", "u1", async () => new Map([
      ["Asks", [["title"], ["Ask ID", "Ask", "Status", "Delivery ID", "Ticket #", "Built", "Accepted"],
        ["Q1", "Good to have: a made-up thing", "3 ACCEPTED", "D99", "1234567", "YES", "YES"],
        ["Q2", "Another made-up ask", "0 NOT BUILT", "-", "no ticket", "NO", ""]]],
      ["Other", [["ID", "Built", "Demoed"], ["Q2", "YES", "No"]]],
    ]));
    expect(r.ok).toBe(true);
    const rows = (await db.select().from(t.tasks).where(eq(t.tasks.source, "sheet"))).filter((x) => x.sourceRef?.startsWith("src5:"));
    const q1 = rows.find((x) => x.sourceRef === "src5:Asks!Q1")!;
    expect([q1.card, q1.status, q1.sheetStatus, q1.deliveryId, q1.ticket, q1.built, q1.accepted]).toEqual(["Made-up list", "done", "3 ACCEPTED", "D99", "1234567", "YES", "YES"]);
    const q2 = rows.find((x) => x.sourceRef === "src5:Asks!Q2")!;
    // The tab's own "NO" wins over the progress tab; the progress tab fills what the tab leaves blank.
    expect([q2.status, q2.deliveryId, q2.built, q2.demoed]).toEqual(["in_progress", null, "NO", "No"]);
  });
  it("reports a sheet that can't be read without throwing", async () => {
    const r = await syncSource(db, "src1", "u1", async () => { throw new Error("The sheet isn't shared"); });
    expect(r.ok).toBe(false);
    const [src] = await db.select().from(t.sheetSources).where(eq(t.sheetSources.id, "src1"));
    expect(src.lastResult).toMatch(/isn't shared/);
  });
});
