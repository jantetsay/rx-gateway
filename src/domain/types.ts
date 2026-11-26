// Core domain types for RX Gateway. Pure TypeScript, no framework imports,
// so the rules can move into the host portal unchanged.

export type Color = "green" | "yellow" | "red";

export const COLOR_RANK: Record<Color, number> = { green: 0, yellow: 1, red: 2 };

export function worst(...colors: Color[]): Color {
  return colors.reduce<Color>((a, b) => (COLOR_RANK[b] > COLOR_RANK[a] ? b : a), "green");
}

/** A color plus the rules that set it, so every color can open its reason. */
export interface Rated {
  color: Color;
  reasons: string[];
}

export const STAGES = [
  "pre_discovery",
  "deep_dive",
  "onboarding",
  "integration",
  "data",
  "validate_go_live",
  "hypercare",
] as const;
export type StageKey = (typeof STAGES)[number];

export const GATES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7a", "G7b", "G8"] as const;
export type GateKey = (typeof GATES)[number];

export const WORKSTREAMS = [
  "env_config",
  "data",
  "dscsa_partners",
  "edi_integrations",
  "training",
  "site_hardware",
  "finance",
  "ecommerce",
] as const;
export type WorkstreamKey = (typeof WORKSTREAMS)[number];

export type TaskStatus = "not_started" | "in_progress" | "blocked" | "done";
export type TaskKind = "task" | "checkpoint" | "milestone";

export interface Person {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  projectId: string;
  kind: TaskKind;
  title: string;
  stage: StageKey;
  workstream: WorkstreamKey;
  /** The gate this item has to be done by. */
  gateKey: GateKey | null;
  ownerId: string | null;
  /** Planned start; the scheduler may push it later. */
  startDate: string | null;
  durationDays: number;
  dueDate: string | null;
  status: TaskStatus;
  /** A critical checkpoint holds its gate on its own. */
  critical: boolean;
  /** Licensing, suspect product or a failed DSCSA connection. */
  compliance: boolean;
  blockerNote: string | null;
  blockedSince: string | null;
  /** The dated recovery plan for a blocker. */
  blockerPlanDate: string | null;
  evidence: string | null;
  completedAt: string | null;
  lastUpdateAt: string | null;
  decisionNeeded: string | null;
  source: "app" | "sheet";
}

export interface Dependency {
  predId: string;
  succId: string;
  lagDays: number;
}

export type GateResult = "pending" | "passed" | "failed";

export interface GateSigner {
  id: string;
  roleLabel: string;
  personName: string | null;
  signedAt: string | null;
}

export interface Gate {
  id: string;
  projectId: string;
  key: GateKey;
  plannedDate: string | null;
  satDate: string | null;
  result: GateResult;
  signers: GateSigner[];
}

export interface ClientRole {
  roleLabel: string;
  personName: string | null;
}

export interface Connection {
  id: string;
  partnerName: string;
  requestedAt: string | null;
  acknowledgedAt: string | null;
  neededDayOne: boolean;
  status: "requested" | "acknowledged" | "testing" | "live" | "failed";
}

export interface Issue {
  id: string;
  title: string;
  severity: 1 | 2 | 3;
  compliance: boolean;
  openedAt: string;
  closedAt: string | null;
}

/** A written exception to a gate rule, approved by Steve, with an expiry. */
export interface ExceptionRecord {
  id: string;
  rule: string;
  reason: string;
  approvedBy: string | null;
  expiresAt: string;
}

/** A hand change to a computed color. Lapses at the next weekly refresh. */
export interface HandOverride {
  id: string;
  scope: "project" | "gate" | "workstream" | "task";
  target: string;
  color: Color;
  reason: string;
  setBy: string;
  setAt: string;
  lapsesAt: string;
}

export interface Project {
  id: string;
  clientId: string;
  clientName: string;
  segment: string;
  name: string;
  modules: string[];
  tier: number | null;
  stage: StageKey;
  archived: boolean;
  contractSigned: string | null;
  targetWindowStart: string | null;
  targetWindowEnd: string | null;
  /** "No earlier than" date, set at G5. */
  notEarlierThan: string | null;
  /** Set when G7a Conditional Go passes. */
  committedDate: string | null;
  pmId: string | null;
  updatedAt: string;
}

export interface WorkstreamOwner {
  workstream: WorkstreamKey;
  ownerId: string | null;
  enabled: boolean;
}

/** Everything the rules need for one project, loaded in one go. */
export interface ProjectSnapshot {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
  gates: Gate[];
  clientRoles: ClientRole[];
  connections: Connection[];
  issues: Issue[];
  exceptions: ExceptionRecord[];
  overrides: HandOverride[];
  workstreams: WorkstreamOwner[];
  people: Map<string, Person>;
  ediPartners: import("./edi").EdiPartner[];
}
