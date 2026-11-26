import { describe, expect, it } from "vitest";
import { addWorkingDays, nextMonday } from "@/domain/calendar";
import { evaluateProject, rateTask } from "@/domain/evaluate";
import { completeThrough, makeSnapshot, task } from "./fixtures";

describe("task and checkpoint colors", () => {
  const base = makeSnapshot();
  const t = { ...task(base, "kickoff"), dueDate: "2026-03-10", status: "in_progress" as const };

  it("is green with owner and date, on schedule", () => {
    expect(rateTask({ ...t, lastUpdateAt: "2026-03-01" }, null, "2026-03-02").color).toBe("green");
  });
  it("is yellow with no owner or no date", () => {
    expect(rateTask({ ...t, ownerId: null }, null, "2026-03-02").reasons).toContain("No owner");
    expect(rateTask({ ...t, dueDate: null }, null, "2026-03-02").color).toBe("yellow");
  });
  it("is yellow due within 3 working days with no update", () => {
    const r = rateTask({ ...t, lastUpdateAt: "2026-02-20" }, null, "2026-03-06");
    expect(r.color).toBe("yellow");
    expect(r.reasons[0]).toMatch(/Due in 2 working days with no update/);
    expect(rateTask({ ...t, lastUpdateAt: "2026-03-05" }, null, "2026-03-06").color).toBe("green");
  });
  it("is yellow overdue off the critical path, red on it", () => {
    expect(rateTask(t, null, "2026-03-12").color).toBe("yellow");
    const sched = { byId: new Map([[t.id, { start: "2026-03-12", finish: "2026-03-12", float: 0, critical: true }]]), finish: "2026-03-12", cycle: [] };
    const r = rateTask(t, sched, "2026-03-12");
    expect(r.color).toBe("red");
    expect(r.reasons).toContain("Overdue 2 working days on the critical path");
  });
  it("is red blocked with no dated plan, yellow with one", () => {
    expect(rateTask({ ...t, status: "blocked" }, null, "2026-03-02").color).toBe("red");
    expect(rateTask({ ...t, status: "blocked", blockerPlanDate: "2026-03-05" }, null, "2026-03-02").color).toBe("yellow");
  });
  it("is red when a critical checkpoint is open past its date", () => {
    expect(rateTask({ ...t, critical: true }, null, "2026-03-11").reasons).toContain("Critical checkpoint open past its date");
  });
  it("is yellow done with no evidence", () => {
    expect(rateTask({ ...t, status: "done", completedAt: "2026-03-01", evidence: null }, null, "2026-03-02").color).toBe("yellow");
  });
});

describe("gates", () => {
  it("holds the gate on one open critical checkpoint at the sitting, whatever the percentage", () => {
    const s = makeSnapshot();
    completeThrough(s, ["G1", "G2"]);
    const g3 = s.gates.find((g) => g.key === "G3")!;
    for (const t of s.tasks) if (t.gateKey === "G3" && t.id !== "p1-baa") { t.status = "done"; t.completedAt = t.dueDate; t.evidence = "x"; }
    const e = evaluateProject(s, g3.plannedDate!);
    const ge = e.gates.find((g) => g.gate.key === "G3")!;
    expect(ge.color).toBe("red");
    expect(ge.reasons.join(" ")).toMatch(/Critical checkpoint open at the sitting: BAA/);
  });
  it("is yellow with a signer unnamed within 10 working days, red at the sitting", () => {
    const s = makeSnapshot();
    completeThrough(s, ["G1", "G2"]);
    const g3 = s.gates.find((g) => g.key === "G3")!;
    g3.signers[0].personName = null;
    const near = evaluateProject(s, addWorkingDays(g3.plannedDate!, -8)).gates.find((g) => g.gate.key === "G3")!;
    expect(near.reasons.join(" ")).toMatch(/Signer unnamed within 10 working days/);
    const at = evaluateProject(s, g3.plannedDate!).gates.find((g) => g.gate.key === "G3")!;
    expect(at.reasons.join(" ")).toMatch(/Signer missing at the sitting/);
    expect(at.color).toBe("red");
  });
  it("is green once passed, red once failed", () => {
    const s = makeSnapshot();
    completeThrough(s, ["G1"]);
    const e = evaluateProject(s, "2026-01-06");
    expect(e.gates.find((g) => g.gate.key === "G1")!.color).toBe("green");
    s.gates.find((g) => g.key === "G2")!.result = "failed";
    expect(evaluateProject(s, "2026-01-06").gates.find((g) => g.gate.key === "G2")!.color).toBe("red");
  });
});

describe("project color", () => {
  const fresh = () => {
    const s = makeSnapshot();
    completeThrough(s, ["G1", "G2"]);
    return s;
  };
  const asOf = "2026-01-15";

  it("is green when the next gate is green with no slip", () => {
    const s = fresh();
    s.project.targetWindowEnd = "2027-12-31";
    for (const t of s.tasks) t.lastUpdateAt = asOf;
    const e = evaluateProject(s, asOf);
    expect(e.computed.reasons).toEqual(["Next gate green and no slip"]);
    expect(e.effective).toBe("green");
  });
  it("turns yellow on a slip of 1 to 10 working days and red past 10", () => {
    const s = fresh();
    for (const t of s.tasks) t.lastUpdateAt = asOf;
    const goLive = s.tasks.find((t) => t.title === "Go live")!.dueDate!;
    s.project.targetWindowEnd = addWorkingDays(goLive, -5);
    expect(evaluateProject(s, asOf).computed.color).toBe("yellow");
    s.project.targetWindowEnd = addWorkingDays(goLive, -11);
    const e = evaluateProject(s, asOf);
    expect(e.computed.color).toBe("red");
    expect(e.slipDays).toBe(11);
  });
  it("measures slip against the committed date once G7a passes", () => {
    const s = fresh();
    const goLive = s.tasks.find((t) => t.title === "Go live")!.dueDate!;
    s.project.targetWindowEnd = "2030-01-01";
    s.project.committedDate = addWorkingDays(goLive, -3);
    s.gates.find((g) => g.key === "G7a")!.result = "passed";
    const e = evaluateProject(s, asOf);
    expect(e.reference?.label).toBe("committed");
    expect(e.slipDays).toBe(3);
    expect(e.escalations.some((x) => x.title.startsWith("Go-live at risk"))).toBe(true);
  });
  it("is yellow with an unnamed client role, an override in force, or an L4 connection unacknowledged past 2 weeks", () => {
    const s = fresh();
    s.project.targetWindowEnd = "2030-01-01";
    for (const t of s.tasks) t.lastUpdateAt = asOf;
    s.clientRoles[0].personName = null;
    expect(evaluateProject(s, asOf).computed.reasons).toContain("Unnamed client role: Executive sponsor");
    s.clientRoles[0].personName = "Sam";
    s.exceptions.push({ id: "x", rule: "G5 without first mock", reason: "Client backup late", approvedBy: "Steve", expiresAt: "2026-02-01" });
    expect(evaluateProject(s, asOf).computed.color).toBe("yellow");
    expect(evaluateProject(s, "2026-02-02").exceptionsInForce).toHaveLength(0);
    s.exceptions = [];
    s.connections.push({ id: "c", partnerName: "Partner A", requestedAt: "2025-12-31", acknowledgedAt: null, neededDayOne: true, status: "requested" });
    expect(evaluateProject(s, asOf).computed.color).toBe("yellow");
  });
  it("is red on a severity 1 issue or an open compliance item", () => {
    const s = fresh();
    s.project.targetWindowEnd = "2030-01-01";
    s.issues.push({ id: "i", title: "Cutover blocked", severity: 1, compliance: false, openedAt: asOf, closedAt: null });
    expect(evaluateProject(s, asOf).computed.color).toBe("red");
    s.issues = [{ id: "i", title: "License lapsed", severity: 2, compliance: true, openedAt: asOf, closedAt: null }];
    expect(evaluateProject(s, asOf).computed.reasons.join(" ")).toMatch(/Open compliance item/);
  });
  it("rates pre-discovery on G1 and G2 only", () => {
    const s = makeSnapshot({ stage: "pre_discovery" });
    s.clientRoles[0].personName = null;
    const e = evaluateProject(s, "2026-01-05");
    expect(e.lane).toBe("pre_discovery");
    expect(e.computed.reasons.join(" ")).not.toMatch(/client role/);
  });
  it("lays a hand change on top, flagged, until the next weekly refresh", () => {
    const s = fresh();
    s.project.targetWindowEnd = "2030-01-01";
    s.overrides.push({ id: "o", scope: "project", target: "p1", color: "red", reason: "Client reorg", setBy: "u1", setAt: asOf, lapsesAt: nextMonday(asOf) });
    const e = evaluateProject(s, asOf);
    expect(e.effective).toBe("red");
    expect(e.override?.reason).toBe("Client reorg");
    expect(evaluateProject(s, nextMonday(asOf)).override).toBeNull();
  });
  it("shows a stale badge after 7 days with no update", () => {
    const s = fresh();
    expect(evaluateProject(s, "2026-01-12").stale).toBe(false);
    expect(evaluateProject(s, "2026-01-30").stale).toBe(true);
  });
  it("lets the worst color roll up from one red task to its workstream", () => {
    const s = fresh();
    const kickoff = task(s, "kickoff");
    kickoff.status = "blocked";
    const e = evaluateProject(s, asOf);
    expect(e.workstreams.find((w) => w.key === "env_config")!.color).toBe("red");
  });
});

describe("escalations", () => {
  it("escalates by days late and critical path", () => {
    const s = makeSnapshot();
    completeThrough(s, ["G1", "G2"]);
    s.project.targetWindowEnd = "2030-01-01";
    const k = task(s, "kickoff");
    const lvl = (asOf: string) => evaluateProject(s, asOf).escalations.find((x) => x.taskId === k.id)?.level;
    expect(lvl(addWorkingDays(k.dueDate!, -2))).toBe(1);
    expect(lvl(addWorkingDays(k.dueDate!, 1))).toBe(2); // overdue on the critical path
    expect(lvl(addWorkingDays(k.dueDate!, 5))).toBe(3);
  });
  it("sends a compliance item straight to Level 3", () => {
    const s = makeSnapshot();
    completeThrough(s, ["G1", "G2"]);
    const lic = task(s, "licensing");
    const e = evaluateProject(s, addWorkingDays(lic.dueDate!, 1)).escalations.find((x) => x.taskId === lic.id)!;
    expect(e.level).toBe(3);
    expect(e.compliance).toBe(true);
  });
});
