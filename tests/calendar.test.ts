import { describe, expect, it } from "vitest";
import { addWorkingDays, nextMonday, workingDaysBetween } from "@/domain/calendar";

describe("working days", () => {
  it("counts Friday to Monday as one working day", () => {
    expect(workingDaysBetween("2026-11-27", "2026-11-30")).toBe(1);
    expect(workingDaysBetween("2026-11-30", "2026-11-27")).toBe(-1);
    expect(workingDaysBetween("2026-11-30", "2026-11-30")).toBe(0);
  });
  it("skips weekends and holidays", () => {
    expect(addWorkingDays("2026-11-27", 1)).toBe("2026-11-30");
    expect(addWorkingDays("2026-11-25", 1, new Set(["2026-11-26"]))).toBe("2026-11-27");
    expect(addWorkingDays("2026-11-28", 0)).toBe("2026-11-30");
  });
  it("lapses hand changes on the next Monday", () => {
    expect(nextMonday("2026-11-26")).toBe("2026-11-30");
    expect(nextMonday("2026-11-30")).toBe("2026-12-07");
  });
});
