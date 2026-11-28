import { beforeAll, describe, expect, it } from "vitest";
import { memoryDb, type DB } from "@/db/client";
import * as repo from "@/db/repo";
import * as t from "@/db/schema";
import { evaluateProject } from "@/domain/evaluate";
import { buildRow } from "@/domain/portfolio";
import { buildSheetBoards, dueWeeks, itemCode, nameAndDescription, ticketOf, weekStart } from "@/domain/sheetboard";
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
    expect(b.partners[0].stageLabel).toBeTruthy();
    expect(Array.isArray(b.partners[0].sets)).toBe(true);
    // The Open tile's detail list: every open item, most overdue first, undated last.
    expect(b.open.map((i) => i.title).slice(0, 2)).toEqual(["Cut over the price files", "Confirm label printers"]);
    expect(b.open).toHaveLength(4);
    expect(b.open[b.open.length - 1].due).toBeNull();
    expect(b.noOwners).toBe(true);
    expect(b.total).toBe(5);
    expect(b.byTab).toEqual([{ tab: "Delivery", pastDue: 2, dueSoon: 1, later: 0, noDate: 1, done: 1 }]);
    // A card per work stream: the five core streams always, others when they have items.
    expect(b.byStream.map((x) => x.key)).toEqual(["ap", "ar", "purchasing", "sales", "warehouse", "unassigned"]);
    expect(b.byStream.find((x) => x.key === "sales")).toMatchObject({ open: 2, pastDue: 1, noDate: 1, done: 0 });
    expect(b.byStream.find((x) => x.key === "warehouse")).toMatchObject({ open: 1, dueSoon: 1 });
    expect(b.byStream.find((x) => x.key === "unassigned")).toMatchObject({ open: 1, pastDue: 1, done: 1, total: 2 }); // shown: one open
    expect(b.byStream.find((x) => x.key === "ap")).toMatchObject({ open: 0, total: 0 });
    // The heat map: rows are streams with open work, columns are weeks then "No date".
    expect(b.heat.rows.map((r) => r.key)).toEqual(["sales", "warehouse", "unassigned"]);
    expect(b.heat.columns.at(-1)?.key).toBe("nodate");
    const sales = b.heat.rows.find((r) => r.key === "sales")!;
    expect(sales.cells.nodate).toBe(1);
    expect(sales.cells[b.open.find((i) => i.title === "Cut over the price files")!.week!]).toBe(1);
    expect(b.heat.columns.find((c) => c.isThisWeek)?.key).toBe("2026-11-23");
    const week = b.weeks.find((w) => w.start === "2026-11-23");
    expect(week).toMatchObject({ pastDue: 1, upcoming: 0, isThisWeek: true });
  });

  it("buckets due dates by week and folds old work into the first bar", () => {
    expect(weekStart("2026-11-26")).toBe("2026-11-23");
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
    const w = dueWeeks([
      { due: "2026-06-01", daysLate: 100 },
      { due: "2026-11-20", daysLate: 4 },
      { due: "2026-12-03", daysLate: 0 },
      { due: "2027-06-01", daysLate: 0 },
      { due: null, daysLate: 0 },
    ], "2026-11-26", 2, 2);
    expect(w.map((x) => x.start)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"]);
    expect(w[0].pastDue).toBe(1);
    expect(w[1].pastDue).toBe(1);
    expect(w[3].upcoming).toBe(1);
    expect(w.reduce((n, x) => n + x.pastDue + x.upcoming, 0)).toBe(3);
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

describe("nameAndDescription", () => {
  it("splits a title at its first colon", () => {
    expect(nameAndDescription("Anticipated Purchasing: demand-planning view", null)).toEqual({ name: "Anticipated Purchasing", description: "demand-planning view" });
  });
  it("keeps a title with no colon whole and uses the sheet note", () => {
    expect(nameAndDescription("Pricing not yet loaded", "Gates pricing on day one.")).toEqual({ name: "Pricing not yet loaded", description: "Gates pricing on day one." });
  });
  it("prefers the note and ignores a dash", () => {
    expect(nameAndDescription("Thing: detail", "Note")).toEqual({ name: "Thing", description: "Note" });
    expect(nameAndDescription("Thing", "-")).toEqual({ name: "Thing", description: null });
  });
});

describe("itemCode and ticketOf", () => {
  it("keeps a code and drops a title used as a key", () => {
    expect(itemCode("s:Delivery!D37")).toBe("D37");
    expect(itemCode("s:Migration!DM-02")).toBe("DM-02");
    expect(itemCode("s:Delivery!EDI Orders in")).toBeNull();
  });
  it("reads a tracker link as its number and keeps the link only for the tracker's own site", () => {
    expect(ticketOf("https://app.asana.com/0/111111111/222222222")).toEqual({ number: "222222222", url: "https://app.asana.com/0/111111111/222222222" });
    expect(ticketOf("https://example.com/0/111111111/333333333")).toEqual({ number: "333333333", url: null });
    expect(ticketOf("1234567")).toEqual({ number: "1234567", url: null });
    expect(ticketOf("-")).toBeNull();
    expect(ticketOf(null)).toBeNull();
  });
});
