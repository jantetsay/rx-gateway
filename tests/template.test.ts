import { describe, expect, it } from "vitest";
import { calendarDaysBetween, workingDaysBetween } from "@/domain/calendar";
import { instantiate } from "@/domain/instantiate";
import { GATES, WORKSTREAMS } from "@/domain/types";
import { newId } from "./fixtures";

describe("template", () => {
  const plan = instantiate("p", "2026-01-05", { workstreams: [...WORKSTREAMS], newId });
  const gate = (k: string) => plan.gates.find((g) => g.key === k)!.plannedDate!;
  const goLive = plan.tasks.find((t) => t.title === "Go live")!.dueDate!;

  it("plans every gate in order", () => {
    const dates = GATES.map(gate);
    expect(dates.every(Boolean)).toBe(true);
    expect([...dates].sort()).toEqual(dates);
  });
  it("sits G7b five working days before go-live and G7a about three weeks out", () => {
    expect(workingDaysBetween(gate("G7b"), goLive)).toBe(5);
    const out = calendarDaysBetween(gate("G7a"), goLive);
    expect(out).toBeGreaterThanOrEqual(18);
    expect(out).toBeLessThanOrEqual(25);
  });
  it("drops a workstream that wasn't bought without breaking the chain", () => {
    const noEcom = instantiate("q", "2026-01-05", { workstreams: WORKSTREAMS.filter((w) => w !== "ecommerce"), newId });
    expect(noEcom.tasks.some((t) => t.workstream === "ecommerce" && t.kind !== "milestone")).toBe(false);
    expect(noEcom.gates.every((g) => g.plannedDate)).toBe(true);
  });
});
