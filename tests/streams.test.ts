import { describe, expect, it } from "vitest";
import { codeOf, streamOf } from "@/domain/streams";
import { levelOfText, setGrid } from "@/domain/setlevels";
import { mapSetRows } from "@/sheets/mapping";
import type { SheetPartner } from "@/domain/sheetboard";

describe("work streams from item titles", () => {
  it("takes an explicit AP or AR tag first", () => {
    expect(streamOf({ title: "Inventory report by location (AP #14)" })).toBe("ap");
    expect(streamOf({ title: "Voucher entry (AR): credit memos with GL" })).toBe("ar");
    expect(streamOf({ title: "AP transactions by date" })).toBe("ap");
  });
  it("then the tab, then the code or title prefix", () => {
    expect(streamOf({ title: "Contract pricing not yet loaded", tab: "Data Migration" })).toBe("data");
    expect(streamOf({ title: "Training Week 2: Purchasing and sales orders", code: "T2" })).toBe("training");
    expect(streamOf({ title: "Milestone: data cutover", code: "M5" })).toBe("golive");
    expect(streamOf({ title: "Validation - OQ: features tested", code: "V2" })).toBe("golive");
    expect(streamOf({ title: "Partner X - Orders In", code: "EDI" })).toBe("edi");
  });
  it("then keywords in the item's name before its description", () => {
    expect(streamOf({ title: "SO columns: expiration date and vendor cost" })).toBe("sales");
    expect(streamOf({ title: "Anticipated purchasing: demand view" })).toBe("purchasing");
    expect(streamOf({ title: "Bin report: split zone name and add rack and shelf" })).toBe("warehouse");
    expect(streamOf({ title: "Remittance advice: PDF per vendor payment" })).toBe("ap");
    expect(streamOf({ title: "Customer statements on demand" })).toBe("ar");
    expect(streamOf({ title: "Branded storefront with portal login" })).toBe("sales");
    expect(streamOf({ title: "Kickoff" })).toBe("unassigned");
  });
  it("reads the code from a source reference", () => {
    expect(codeOf("src1:Delivery!D37")).toBe("D37");
    expect(codeOf("src1:Delivery!EDI Partner X - Orders In")).toBe("EDI");
    expect(codeOf(null)).toBeNull();
  });
});

describe("transaction sets from a register", () => {
  it("reads one row per partner, set and direction", () => {
    const rows = [
      ["Partner", "Transaction set", "Direction", "Map status", "Last test"],
      ["Made-up Co", "850", "Inbound to RxERP", "Not started", "Pending"],
      ["Made-up Co", "810", "Outbound from RxERP", "Testing", "Failed"],
      ["Other Co", "856 ASN", "out", "Live", ""],
      ["", "850", "in", "", ""],
    ];
    const sets = mapSetRows({ kind: "edi_sets", tab: "Transactions", headerRow: 1, columns: { partner: "Partner", set: "Transaction set", direction: "Direction", status: "Map status", lastTest: "Last test" } }, rows);
    expect(sets).toHaveLength(3);
    expect(sets[0]).toMatchObject({ partner: "Made-up Co", transaction: "850", direction: "inbound", testStatus: "not_run", prodStatus: "not_live" });
    expect(sets[1]).toMatchObject({ transaction: "810", direction: "outbound", testStatus: "failed", status: "Testing" });
    expect(sets[2]).toMatchObject({ transaction: "856", prodStatus: "live", testStatus: "passed" });
  });
});

describe("the partner-by-set heat map", () => {
  const partner = (id: string, sheetStatus: string, sets: SheetPartner["sets"], daysLate = 0): SheetPartner => ({
    id, name: id, nextStep: null, nextStepDate: null, daysLate, owner: null, type: "supplier", method: null, stage: 1,
    stageLabel: "Discovery", lastContact: null, blocker: null, sheetStatus, inScope: "tbd", sets,
  });
  const set = (transaction: string, direction: "inbound" | "outbound", sheetStatus = "Not started", testStatus: "passed" | "failed" | "not_run" = "not_run", live = false) =>
    ({ label: `${transaction} ${direction === "inbound" ? "in" : "out"}`, transaction, direction, testStatus, live, sheetStatus });
  it("orders status words from not started to live, and spots out of scope", () => {
    expect(levelOfText("Discovery")).toBe(0);
    expect(levelOfText("Build & Connect")).toBe(1);
    expect(levelOfText("Testing")).toBe(2);
    expect(levelOfText("Certification")).toBe(3);
    expect(levelOfText("Live")).toBe(4);
    expect(levelOfText("Out of Scope")).toBeNull();
  });
  it("uses a set's own status, falls back to the partner's, and keeps the slower direction", () => {
    const g = setGrid([
      partner("A", "Testing", [set("850", "inbound"), set("810", "outbound", "Live", "passed", true)], 3),
      partner("B", "Discovery", [set("850", "inbound", "Testing"), set("850", "outbound", "Not started")]),
      partner("C", "Out of Scope", [set("850", "inbound")]),
    ]);
    expect(g.columns).toEqual(["850", "810"]);
    expect(g.rows.map((r) => r.partner.id)).toEqual(["A", "B"]);
    expect(g.outOfScope.map((p) => p.id)).toEqual(["C"]);
    expect(g.rows[0].cells["850"]).toMatchObject({ level: 2, fromPartner: true });
    expect(g.rows[0].cells["810"]).toMatchObject({ level: 4, fromPartner: false });
    expect(g.rows[1].cells["850"]).toMatchObject({ level: 0, detail: "850 in, 850 out" });
    expect(g.rows[1].cells["810"]).toBeUndefined();
  });
});
