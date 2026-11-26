import { describe, expect, it } from "vitest";
import { mapPartnerRows, mappingSchema, mapTaskRows, parseDate } from "@/sheets/mapping";

// Made-up rows in the shape of a typical tracking sheet. No real client data.
const taskRows = [
  ["Code", "Task", "State", "Due", "Days late", "Completed", "Last touched"],
  ["X01", "Load template signed off", "OVERDUE", "2026-11-02", "10", "-", "2026-10-20"],
  ["X02", "Users and roles matrix", "COMPLETE", "2026-10-15", "", "2026-10-14", "2026-10-14"],
  ["", "Section heading", "", "", "", "", ""],
  ["X03", "Price list profile", "OPEN", "11/30/2026", "", "", ""],
];

const partnerRows = [
  ["Partner", "Task", "Due", "Days late", "State"],
  ["Partner A", "Orders In", "2026-11-15", "8", "OVERDUE"],
  ["Partner A", "Invoices Out", "2026-11-10", "13", "DONE"],
  ["Partner A", "Acks Out", "2026-11-20", "3", "OVERDUE"],
  ["Partner B", "Orders In", "2026-12-01", "", "OPEN"],
];

const mapping = mappingSchema.parse({
  tabs: [
    { kind: "tasks", tab: "Delivery", defaults: { workstream: "env_config", stage: "validate_go_live", gate: "G6" },
      columns: { key: "Code", title: "Task", status: "State", due: "Due", completed: "Completed", lastTouched: "Last touched" } },
    { kind: "edi_partners", tab: "Partners", columns: { name: "Partner", nextStep: "Task", nextStepDate: "Due", status: "State" } },
  ],
});

describe("sheet mapping", () => {
  it("reads dates in the usual forms", () => {
    expect(parseDate("2026-11-26")).toBe("2026-11-26");
    expect(parseDate("11/26/2026")).toBe("2026-11-26");
    expect(parseDate("26 Nov 2026")).toBe("2026-11-26");
    expect(parseDate("-")).toBeNull();
  });
  it("maps task rows and skips blank and heading rows", () => {
    const tabMap = mapping.tabs[0];
    if (tabMap.kind !== "tasks") throw new Error();
    const rows = mapTaskRows(tabMap, taskRows);
    expect(rows.map((r) => r.ref)).toEqual(["Delivery!X01", "Delivery!X02", "Delivery!X03"]);
    expect(rows[0]).toMatchObject({ status: "in_progress", dueDate: "2026-11-02", completedAt: null, gateKey: "G6" });
    expect(rows[1]).toMatchObject({ status: "done", completedAt: "2026-10-14" });
    expect(rows[2].dueDate).toBe("2026-11-30");
  });
  it("rolls partner rows up to one partner with its earliest open step", () => {
    const tabMap = mapping.tabs[1];
    if (tabMap.kind !== "edi_partners") throw new Error();
    const ps = mapPartnerRows(tabMap, partnerRows);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ name: "Partner A", nextStep: "Orders In", nextStepDate: "2026-11-15" });
  });
  it("names the missing column when a mapping doesn't match the sheet", () => {
    const tabMap = mapping.tabs[0];
    if (tabMap.kind !== "tasks") throw new Error();
    expect(() => mapTaskRows({ ...tabMap, columns: { ...tabMap.columns, due: "Due date" } }, taskRows)).toThrow(/no column "Due date"/);
  });
});
