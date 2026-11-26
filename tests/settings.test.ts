import { describe, expect, it } from "vitest";
import { memoryDb } from "@/db/client";
import * as repo from "@/db/repo";
import { checkColors, colorCss, contrast, DEFAULT_COLORS, inkOn, mergeColors, normalizeHex } from "@/domain/colors";
import { logRow, mappingChange } from "@/domain/settingslog";

describe("status colors", () => {
  it("normalizes hex and rejects anything else", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("0f4a96")).toBe("#0f4a96");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345g")).toBeNull();
  });

  it("falls back to the default for a saved value that isn't a color", () => {
    const c = mergeColors({ lv0: "url(x)", done: "#00ff00" });
    expect(c.lv0).toBe(DEFAULT_COLORS.lv0);
    expect(c.done).toBe("#00ff00");
  });

  it("passes the defaults with warnings only", () => {
    expect(contrast("#fff", "#000")).toBeCloseTo(21, 0);
    const issues = checkColors(DEFAULT_COLORS);
    expect(issues.filter((i) => i.level === "fail")).toEqual([]);
  });

  it("fails a level ramp that gets lighter and a color too pale to see", () => {
    const issues = checkColors({ ...DEFAULT_COLORS, lv3: "#d8e8fb", pastDue: "#fdfdfd" });
    expect(issues.some((i) => i.level === "fail" && i.keys.includes("lv3"))).toBe(true);
    expect(issues.some((i) => i.level === "fail" && i.keys.includes("pastDue"))).toBe(true);
  });

  it("fails status colors that look alike", () => {
    const issues = checkColors({ ...DEFAULT_COLORS, done: "#dc3c3e" });
    expect(issues.some((i) => i.level === "fail" && i.keys.includes("done") && i.keys.includes("pastDue"))).toBe(true);
  });

  it("picks dark words on light cells and white on dark ones", () => {
    expect(inkOn("#0f4a96")).toBe("#ffffff");
    expect(inkOn("#e8f1fd")).toBe("#0e2a52");
  });

  it("emits only variables with hex values", () => {
    const css = colorCss({ ...DEFAULT_COLORS, done: "};body{display:none" as string });
    expect(css).toMatch(/^:root\{[^{}]*\}$/);
    expect(css).toContain(`--color-st-good:${DEFAULT_COLORS.done};`);
    expect(css).toContain("--color-lv-ink-4:#ffffff;");
  });
});

describe("settings change log", () => {
  it("says which tabs and columns a mapping edit touched", () => {
    const before = { tabs: [{ kind: "partners", tab: "Connections", columns: { name: "Partner" } }, { kind: "tests", tab: "Old", columns: {} }] };
    const after = { tabs: [{ kind: "partners", tab: "Connections", columns: { name: "Partner", inScope: "On list" } }] };
    const d = mappingChange(before, after);
    expect(d.old).toContain("2 tabs");
    expect(d.old).toContain("Old (tests)");
    expect(d.new).toContain("Connections (partners): added inScope");
    expect(mappingChange(after, after).new).toBe("No change in tabs or columns");
  });

  it("saves colors, logs one row per changed color, and reads them back", async () => {
    const db = await memoryDb();
    expect(await repo.statusColors(db)).toEqual(DEFAULT_COLORS);
    expect(await repo.saveStatusColors(db, { ...DEFAULT_COLORS, done: "#1f7a4d", lv4: "#0b3a7a" }, null)).toBe(2);
    expect(await repo.saveStatusColors(db, { ...DEFAULT_COLORS, done: "#1f7a4d", lv4: "#0b3a7a" }, null)).toBe(0);
    expect((await repo.statusColors(db)).done).toBe("#1f7a4d");
    const log = await repo.settingsLog(db);
    expect(log).toHaveLength(2);
    const rows = log.map((e) => logRow(e as never, () => "?"));
    const done = rows.find((r) => r.what === "Status color: Done")!;
    expect(done.old).toBe(DEFAULT_COLORS.done);
    expect(done.new).toBe("#1f7a4d");
    expect(done.colors).toEqual({ old: DEFAULT_COLORS.done, new: "#1f7a4d" });
  }, 30_000);
});
