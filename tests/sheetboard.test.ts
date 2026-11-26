import { beforeAll, describe, expect, it } from "vitest";
import { memoryDb, type DB } from "@/db/client";
import * as repo from "@/db/repo";
import * as t from "@/db/schema";
import { evaluateProject } from "@/domain/evaluate";
import { buildRow } from "@/domain/portfolio";
import { buildSheetBoards } from "@/domain/sheetboard";
import { WORKSTREAMS } from "@/domain/types";

let db: DB;
let projectId: string;
const asOf = "2026-11-26";

beforeAll(async () => {
  db = await memoryDb();
  await db.insert(t.users).values({ id: "u1", name: "Pat Example", email: "pat@example.com", role: "admin" });
  await db.insert(t.clients).values({ id: "c1", name: "Example Distribution Co", segment: "Wholesaler" });
  projectId = await repo.createProject(db, {
    clientId: "c1", name: "Example Distribution Co", stage: "validate_go_live", start: "2026-01-05", modules: [], tier: null, pmId: "u1",
    targetWindowStart: null, targetWindowEnd: "2027-01-04", workstreams: [...WORKSTREAMS], contractSigned: "2026-01-05", fromSheet: true,
  }, "u1");
  const task = (id: string, title: string, dueDate: string | null, status = "in_progress", ownerId: string | null = null) => ({
    id, projectId, kind: "task", title, stage: "validate_go_live", workstream: "env_config", dueDate, status, ownerId,
    source: "sheet", sourceRef: `src1:Delivery!${id}`,
  });
  await db.insert(t.tasks).values([
    task("a", "Cut over the price files", "2026-10-30"),
    task("b", "Confirm label printers", "2026-11-23"),
    task("c", "Train the warehouse team", "2026-12-03"),
    task("d", "Load open orders", null),
    task("e", "Kickoff", "2026-09-01", "done"),
  ]);
  await db.insert(t.ediPartners).values([
    { id: "p1", projectId, name: "Partner A", type: "customer", nextStep: "Send test file", nextStepDate: "2026-11-20", source: "sheet" },
    { id: "p2", projectId, name: "Partner B", type: "customer", nextStep: "Exchange certificates", nextStepDate: "2026-12-10", source: "sheet" },
  ]);
  await db.insert(t.sheetSources).values({ id: "src1", projectId, label: "Tracking sheet", spreadsheetId: "x", mapping: {}, lastSyncedAt: "2026-11-26T15:00:00Z" });
}, 30_000);

describe("a client run from its tracking sheet", () => {
  it("lays out no template work, gates or client roles", async () => {
    const [s] = await repo.loadSnapshots(db, [projectId]);
    expect(s.project.templateVersion).toBe("sheet");
    expect(s.gates).toHaveLength(0);
    expect(s.clientRoles).toHaveLength(0);
    expect(s.tasks.every((x) => x.source === "sheet")).toBe(true);
  });

  it("is colored by what is past due in the sheet, not by a template forecast", async () => {
    const [s] = await repo.loadSnapshots(db, [projectId]);
    const e = evaluateProject(s, asOf);
    expect(e.nextGate).toBeNull();
    expect(e.forecastGoLive).toBeNull();
    const why = e.computed.reasons.join(" | ");
    expect(e.computed.color).toBe("red");
    expect(why).toMatch(/1 open item more than 10 working days past due: Cut over the price files/);
    expect(why).toMatch(/1 EDI partner past their next-step date: Partner A/);
    expect(why).not.toMatch(/gate|Forecast|Unnamed client role/);
  });

  it("puts open, past-due, due-soon and partner status on the home page board", async () => {
    const [s] = await repo.loadSnapshots(db, [projectId]);
    const row = buildRow(s, evaluateProject(s, asOf), null);
    const [b] = buildSheetBoards([row], [{ projectId, label: "Tracking sheet", lastSyncedAt: "2026-11-26T15:00:00Z", lastResult: null }], asOf);
    expect(b.counts).toMatchObject({ open: 4, pastDue: 2, dueSoon: 1, noDate: 1, done: 1, partners: 2, partnersPastDue: 1 });
    expect(b.pastDue.map((i) => i.title)).toEqual(["Cut over the price files", "Confirm label printers"]);
    expect(b.pastDue[0].tab).toBe("Delivery");
    expect(b.dueSoon.map((i) => i.title)).toEqual(["Train the warehouse team"]);
    expect(b.partners[0]).toMatchObject({ name: "Partner A", daysLate: 4 });
    expect(b.noOwners).toBe(true);
  });

  it("leaves template clients with no sheet off the board", async () => {
    await db.insert(t.clients).values({ id: "c2", name: "Other Co", segment: "Manufacturer" });
    const other = await repo.createProject(db, {
      clientId: "c2", name: "Other Co", stage: "onboarding", start: "2026-11-02", modules: [], tier: null, pmId: "u1",
      targetWindowStart: null, targetWindowEnd: null, workstreams: [...WORKSTREAMS], contractSigned: "2026-11-02",
    }, "u1");
    const [s] = await repo.loadSnapshots(db, [other]);
    expect(buildSheetBoards([buildRow(s, evaluateProject(s, asOf), null)], [], asOf)).toHaveLength(0);
  });
});
