// EDI partner tracker: stages, stall rules, the transaction test matrix and the
// "passed" test. Certificates, keys and passwords are never stored: the tracker
// only records whether a certificate was sent.

import { calendarDaysBetween, workingDaysBetween, type ISODate } from "./calendar";
import { RULES } from "./rules";
import { worst, type Color, type Rated } from "./types";

export const EDI_STAGES = [
  "Intro sent",
  "Form received",
  "Spec gaps checked",
  "Connection set up",
  "Connectivity tested",
  "Test transactions passed",
  "Compliance cleared",
  "Prod cutover scheduled",
  "Live on EDI",
  "Fallback: manual orders",
] as const;

export const FALLBACK_STAGE = 10;

export const TRANSACTION_SETS = ["850", "855", "856", "810", "997", "999", "832", "846", "852", "867", "844", "849"] as const;

export interface EdiTest {
  id: string;
  transaction: string;
  direction: "inbound" | "outbound";
  testStatus: "not_run" | "passed" | "failed";
  prodStatus: "not_live" | "live";
  notes: string | null;
}

export interface SpecGap {
  id: string;
  description: string;
  ownerId: string | null;
  dueDate: ISODate | null;
  resolved: boolean;
}

export interface EdiPartner {
  id: string;
  projectId: string;
  profileId: string | null;
  name: string;
  type: "supplier" | "customer";
  inPhaseOne: "yes" | "no" | "tbd";
  method: "AS2" | "VAN" | "SFTP" | null;
  stage: number;
  ownerId: string | null;
  nextStep: string | null;
  nextStepDate: ISODate | null;
  blocker: string | null;
  dateTold: ISODate | null;
  lastContact: ISODate | null;
  ticket: string | null;
  certificateSent: boolean;
  certExpiry: ISODate | null;
  licenseExpiry: ISODate | null;
  isa15: "T" | "P";
  c2InScope: boolean;
  csosStatus: string | null;
  badFileRejected: boolean;
  complianceCleared: boolean;
  oldProvider: string | null;
  exitPlanDate: ISODate | null;
  profileRecheckedAt: ISODate | null;
  /** EDI metrics reported at G8, entered by a person. */
  firstPassPct: number | null;
  openRejects: number | null;
  avgAckHours: number | null;
  tests: EdiTest[];
  gaps: SpecGap[];
}

export interface PartnerEval extends Rated {
  partner: EdiPartner;
  flags: string[];
  passed: boolean;
  passedMissing: string[];
}

/** Passed: every in-scope set passed testing, a bad file rejected correctly, C2 through CSOS where in scope. */
export function passedTesting(p: EdiPartner): { passed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (p.tests.length === 0) missing.push("No transaction sets in the test matrix");
  for (const t of p.tests) if (t.testStatus !== "passed") missing.push(`${t.transaction} ${t.direction} not passed`);
  if (!p.badFileRejected) missing.push("A deliberately bad file has not been rejected correctly");
  if (p.c2InScope && (p.csosStatus ?? "").toLowerCase() !== "passed") missing.push("C2 order through CSOS not passed");
  return { passed: missing.length === 0, missing };
}

/** Returns a reason the move is refused, or null when it is allowed. */
export function stageMoveError(p: EdiPartner, to: number): string | null {
  if (to < 1 || to > FALLBACK_STAGE) return "No such stage";
  if (to >= 6 && to < FALLBACK_STAGE && !passedTesting(p).passed) return "Stage 6 needs every in-scope set passed and a bad file rejected";
  if (to >= 8 && !p.complianceCleared) return "Needs compliance cleared (license, DEA and ATP decision on file) first";
  return null;
}

export function evaluatePartner(p: EdiPartner, asOf: ISODate, currentGoLive: ISODate | null): PartnerEval {
  const reasons: string[] = [];
  const flags: string[] = [];
  const colors: Color[] = ["green"];
  const r = RULES.edi;
  const live = p.stage === 9;

  if (!live && p.nextStepDate && p.nextStepDate < asOf) { colors.push("red"); reasons.push(`Next-step date ${p.nextStepDate} has passed`); }
  if (!live && (!p.lastContact || workingDaysBetween(p.lastContact, asOf) > r.noContactWorkingDays)) {
    colors.push("yellow");
    reasons.push(p.lastContact ? `No contact since ${p.lastContact}` : "No contact recorded");
  }
  for (const [label, date] of [["Certificate", p.certExpiry], ["License", p.licenseExpiry]] as const) {
    if (!date) continue;
    const days = calendarDaysBetween(asOf, date);
    if (days <= r.expiryRedCalendarDays) { colors.push("red"); reasons.push(`${label} expires ${date}`); }
    else if (days <= r.expiryYellowCalendarDays) { colors.push("yellow"); reasons.push(`${label} expires ${date}`); }
  }
  if (currentGoLive && p.dateTold && p.dateTold !== currentGoLive) flags.push(`Was told ${p.dateTold}; current go-live is ${currentGoLive}`);
  if (currentGoLive && !p.dateTold && p.inPhaseOne === "yes") flags.push("Go-live date not yet sent");
  if (currentGoLive && p.inPhaseOne !== "no" && p.stage < 6 && calendarDaysBetween(asOf, currentGoLive) <= r.fallbackCalendarDays) {
    flags.push("Not at stage 6 two weeks before go-live: move to fallback planning");
  }
  for (const g of p.gaps) {
    if (!g.resolved && (!g.ownerId || !g.dueDate)) { colors.push("yellow"); reasons.push(`Spec gap with no owner or date: ${g.description}`); }
    else if (!g.resolved && g.dueDate && g.dueDate < asOf) { colors.push("yellow"); reasons.push(`Spec gap past its date: ${g.description}`); }
  }
  if (p.oldProvider && !p.exitPlanDate) { colors.push("yellow"); reasons.push("Moving off an old provider with no dated exit plan"); }
  if (p.profileId && p.stage >= 4 && !p.profileRecheckedAt) { colors.push("yellow"); reasons.push("Shared profile not re-checked for this connection"); }
  if (!p.ownerId) { colors.push("yellow"); reasons.push("No owner"); }
  if (p.tests.some((t) => t.testStatus === "failed")) { colors.push("yellow"); reasons.push("A test transaction is failing"); }

  const { passed, missing } = passedTesting(p);
  const color = worst(...colors);
  if (color === "green") reasons.push(live ? "Live on EDI" : "Moving on schedule");
  return { partner: p, color, reasons, flags, passed, passedMissing: missing };
}

/** The gate a phase-one partner has to clear next: in testing by G5, passed by G6. */
export function partnerGate(p: EdiPartner): "G5" | "G6" | null {
  if (p.inPhaseOne === "no" || p.stage === FALLBACK_STAGE) return null;
  if (p.stage < 5) return "G5";
  if (p.stage < 6) return "G6";
  return null;
}
