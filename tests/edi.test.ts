import { describe, expect, it } from "vitest";
import { evaluatePartner, stageMoveError, type EdiPartner } from "@/domain/edi";

const partner = (over: Partial<EdiPartner> = {}): EdiPartner => ({
  id: "e1", projectId: "p1", profileId: null, name: "Partner A", type: "supplier", inPhaseOne: "yes", method: "AS2", stage: 4,
  ownerId: "u1", nextStep: "Connectivity test", nextStepDate: "2026-12-10", blocker: null, dateTold: "2027-01-07",
  lastContact: "2026-11-25", ticket: null, certificateSent: true, certExpiry: null, licenseExpiry: null, isa15: "T",
  c2InScope: false, csosStatus: null, badFileRejected: false, complianceCleared: false, oldProvider: null, exitPlanDate: null,
  profileRecheckedAt: null, firstPassPct: null, openRejects: null, avgAckHours: null,
  tests: [{ id: "t1", transaction: "850", direction: "inbound", testStatus: "not_run", prodStatus: "not_live", notes: null }],
  gaps: [], ...over,
});

describe("EDI stall rules", () => {
  const asOf = "2026-11-26";
  it("is green when moving on schedule", () => {
    expect(evaluatePartner(partner(), asOf, "2027-01-07").color).toBe("green");
  });
  it("is red when the next-step date has passed", () => {
    expect(evaluatePartner(partner({ nextStepDate: "2026-11-20" }), asOf, null).color).toBe("red");
  });
  it("is yellow with no contact in 5 business days", () => {
    expect(evaluatePartner(partner({ lastContact: "2026-11-18" }), asOf, null).color).toBe("yellow");
  });
  it("is yellow on a certificate or license within 60 days, red within 30", () => {
    expect(evaluatePartner(partner({ certExpiry: "2027-01-15" }), asOf, null).color).toBe("yellow");
    expect(evaluatePartner(partner({ licenseExpiry: "2026-12-20" }), asOf, null).color).toBe("red");
  });
  it("flags a partner working to an old go-live date", () => {
    expect(evaluatePartner(partner({ dateTold: "2026-12-04" }), asOf, "2027-01-07").flags[0]).toMatch(/Was told 2026-12-04/);
  });
  it("moves a partner short of stage 6 two weeks before go-live to fallback planning", () => {
    expect(evaluatePartner(partner(), asOf, "2026-12-08").flags.join(" ")).toMatch(/fallback planning/);
  });
  it("needs a spec gap to carry an owner and a date", () => {
    const e = evaluatePartner(partner({ gaps: [{ id: "g", description: "N104 qualifier", ownerId: null, dueDate: null, resolved: false }] }), asOf, null);
    expect(e.color).toBe("yellow");
  });
});

describe("EDI stage moves", () => {
  it("refuses stage 6 until every set passed and a bad file was rejected", () => {
    expect(stageMoveError(partner(), 6)).toMatch(/Stage 6 needs/);
    const ok = partner({ badFileRejected: true, tests: [{ id: "t", transaction: "850", direction: "inbound", testStatus: "passed", prodStatus: "not_live", notes: null }] });
    expect(stageMoveError(ok, 6)).toBeNull();
    expect(stageMoveError(ok, 8)).toMatch(/compliance/);
  });
  it("allows fallback only after compliance is cleared", () => {
    expect(stageMoveError(partner(), 10)).toMatch(/compliance/);
    expect(stageMoveError(partner({ complianceCleared: true }), 10)).toBeNull();
  });
});
