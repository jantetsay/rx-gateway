// The seven-stage project template with gates G1 to G8. Versioned: a project
// records the template version it was created from. Durations are starting
// values in working days, to be corrected from actuals as projects close.
// Nothing here is client-specific.

import type { GateKey, StageKey, TaskKind, WorkstreamKey } from "./types";

export const TEMPLATE_VERSION = "2026.11-1";

export const STAGE_LABEL: Record<StageKey, string> = {
  pre_discovery: "Pre-discovery",
  deep_dive: "Deep-dive discovery",
  onboarding: "Onboarding",
  integration: "Integration including EDI",
  data: "Data implementation and ingestion",
  validate_go_live: "Validate and go live",
  hypercare: "Hypercare",
};

export const WORKSTREAM_LABEL: Record<WorkstreamKey, string> = {
  env_config: "Environment and configuration",
  data: "Data",
  dscsa_partners: "DSCSA and trading partners",
  edi_integrations: "EDI and integrations",
  training: "Training",
  site_hardware: "Site hardware and printing",
  finance: "Finance",
  ecommerce: "E-commerce",
};

export interface GateDef {
  key: GateKey;
  name: string;
  /** The stage this gate closes. */
  stage: StageKey;
  owner: string;
  signers: string[];
  criteria: string;
}

export const GATE_DEFS: GateDef[] = [
  { key: "G1", name: "Feasibility", stage: "pre_discovery", owner: "Delivery lead", signers: ["Delivery lead"],
    criteria: "Source system and backup known, readiness tier set, trading partners counted and sorted." },
  { key: "G2", name: "Commitment lock", stage: "pre_discovery", owner: "Sales and delivery", signers: ["Sales lead", "Delivery lead"],
    criteria: "Duration band from the tier, data classes and partner transaction sets in scope. First baseline saved." },
  { key: "G3", name: "Delivery acceptance", stage: "deep_dive", owner: "Implementation manager", signers: ["Implementation manager"],
    criteria: "Named client data owner, backup or extract requested, BAA and allowlist if PHI, intake done per partner." },
  { key: "G4", name: "Environment and access", stage: "onboarding", owner: "Technical lead", signers: ["Technical lead"],
    criteria: "Secure upload and sandbox live, endpoints and certificates exchanged, L4 connections requested." },
  { key: "G5", name: "Data readiness", stage: "data", owner: "Data lead and client data owner", signers: ["Data lead", "Client data owner"],
    criteria: "Extract profiled, gap report acknowledged, first mock load run, every go-live partner in testing. Sets the no-earlier-than date." },
  { key: "G6", name: "Validation complete", stage: "data", owner: "Client signatory", signers: ["Client signatory"],
    criteria: "Mock loads pass, counts and dollars tie, V3 reconciliation signed, every go-live partner passed testing." },
  { key: "G7a", name: "Conditional Go", stage: "validate_go_live", owner: "Implementation manager",
    signers: ["Implementation manager", "RxERP executive", "Client sponsor", "Client ops lead", "EDI lead"],
    criteria: "Rehearsal passed inside the cutover window, rollback rehearsed. Commits the go-live date, about 21 days out." },
  { key: "G7b", name: "Final Go", stage: "validate_go_live", owner: "Implementation manager",
    signers: ["Implementation manager", "RxERP executive", "Client sponsor", "Client ops lead", "EDI lead"],
    criteria: "Five days out. Fallback staffed, super-users certified. Can still stop the cutover." },
  { key: "G8", name: "Stabilization exit", stage: "hypercare", owner: "Support and implementation", signers: ["Support lead", "Implementation manager"],
    criteria: "No open critical data defects, every partner clean in production, EDI metrics reported, L1 handed over." },
];

export const GATE_BY_KEY = Object.fromEntries(GATE_DEFS.map((g) => [g.key, g])) as Record<GateKey, GateDef>;

/** Client roles every project must have named. An unnamed role turns the project yellow. */
export const CLIENT_ROLES = ["Executive sponsor", "Day-to-day contact", "Data owner", "Controller", "Ops lead"];

export interface TemplateItem {
  key: string;
  kind: TaskKind;
  stage: StageKey;
  workstream: WorkstreamKey;
  gate: GateKey | null;
  title: string;
  duration: number;
  critical?: boolean;
  compliance?: boolean;
  deps?: (string | [string, number])[];
}

const T = (
  key: string, stage: StageKey, workstream: WorkstreamKey, gate: GateKey | null, title: string,
  duration: number, opts: Partial<Pick<TemplateItem, "critical" | "compliance" | "deps" | "kind">> = {},
): TemplateItem => ({ key, kind: opts.kind ?? "checkpoint", stage, workstream, gate, title, duration, ...opts });

const M = (key: string, stage: StageKey, gate: GateKey | null, title: string, deps: (string | [string, number])[]): TemplateItem =>
  ({ key, kind: "milestone", stage, workstream: "env_config", gate, title, duration: 0, deps });

export const TEMPLATE: TemplateItem[] = [
  // Stage 0. Pre-discovery
  T("scope", "pre_discovery", "env_config", "G1", "Modules and sites in scope confirmed", 3),
  T("source", "pre_discovery", "data", "G1", "Source system, version and backup availability known", 3, { critical: true }),
  T("tier", "pre_discovery", "data", "G1", "Data readiness tier (1 to 4) set", 1, { critical: true, deps: ["source"] }),
  T("partner_count", "pre_discovery", "edi_integrations", "G1", "Trading partners counted and sorted, paid hubs flagged", 3),
  T("dscsa_count", "pre_discovery", "dscsa_partners", "G1", "DSCSA connections counted", 2),
  M("g1", "pre_discovery", "G1", "G1 Feasibility", ["scope", "tier", "partner_count", "dscsa_count"]),
  T("band", "pre_discovery", "data", "G2", "Duration band set; data classes and years of history in scope", 2, { critical: true, deps: ["g1"] }),
  T("tx_scope", "pre_discovery", "edi_integrations", "G2", "Partner count and transaction sets in scope", 2, { deps: ["g1"] }),
  T("workload", "pre_discovery", "env_config", "G2", "Client workload sized by role per week", 2, { deps: ["g1"] }),
  T("scope_sign", "pre_discovery", "finance", "G2", "Scope, assumptions and pricing basis signed", 2, { critical: true, deps: ["band", "tx_scope", "workload"] }),
  M("g2", "pre_discovery", "G2", "G2 Commitment lock", ["scope_sign"]),

  // Stage 1. Deep-dive discovery
  T("kickoff", "deep_dive", "env_config", "G3", "Kickoff and deep dive: owner and date on every item", 5, { deps: ["g2"] }),
  T("data_owner", "deep_dive", "data", "G3", "Named client data owner", 2, { critical: true, deps: ["kickoff"] }),
  T("backup_req", "deep_dive", "data", "G3", "Native backup or extract requested", 2, { critical: true, deps: ["kickoff"] }),
  T("baa", "deep_dive", "data", "G3", "BAA and table allowlist signed if PHI is involved", 5, { critical: true, deps: ["data_owner"] }),
  T("intake", "deep_dive", "edi_integrations", "G3", "Intake done per partner", 10, { deps: ["kickoff"] }),
  T("cust_lists", "deep_dive", "edi_integrations", "G3", "Client customer and supplier lists received", 5, { deps: ["kickoff"] }),
  T("conn_inventory", "deep_dive", "dscsa_partners", "G3", "Existing connections inventory", 5, { deps: ["kickoff"] }),
  T("licensing", "deep_dive", "dscsa_partners", "G3", "Licenses, DEA and CSOS expiry recorded; ATP decision on file", 5, { critical: true, compliance: true, deps: ["kickoff"] }),
  M("g3", "deep_dive", "G3", "G3 Delivery acceptance", ["baa", "backup_req", "intake", "cust_lists", "conn_inventory", "licensing"]),

  // Stage 2. Onboarding
  T("sandbox", "onboarding", "env_config", "G4", "Sandbox, users and roles matrix", 5, { critical: true, deps: ["g3"] }),
  T("secure_upload", "onboarding", "data", "G4", "Secure upload and restore sandbox live; load template version fixed", 5, { critical: true, deps: ["g3"] }),
  T("endpoints", "onboarding", "edi_integrations", "G4", "AS2 or SFTP endpoints and certificates exchanged", 10, { deps: ["g3"] }),
  T("hub_cert", "onboarding", "edi_integrations", "G4", "Hub certification booked where a partner needs one", 3, { deps: ["g3"] }),
  T("l4_request", "onboarding", "dscsa_partners", "G4", "L4 (EPCIS) connections requested", 3, { deps: ["g3"] }),
  T("cust_vetting", "onboarding", "dscsa_partners", "G4", "Customer licenses and DEA numbers verified", 5, { deps: ["g3"] }),
  T("site_walk", "onboarding", "site_hardware", "G4", "Site walk: bins, scanners, printers and C2 flow", 5, { deps: ["g3"] }),
  M("g4", "onboarding", "G4", "G4 Environment and access", ["sandbox", "secure_upload", "endpoints", "hub_cert", "l4_request", "cust_vetting", "site_walk"]),

  // Stages 3 and 4. Integration and data
  T("extract", "data", "data", "G5", "Extract complete and profiled", 10, { critical: true, deps: ["g4"] }),
  T("gap_report", "data", "data", "G5", "Gap report acknowledged in writing", 3, { critical: true, deps: ["extract"] }),
  T("mock1", "data", "data", "G5", "First mock load run", 5, { critical: true, deps: ["gap_report"] }),
  T("partners_testing", "integration", "edi_integrations", "G5", "Every go-live partner in testing; silent partners have a written hold", 10, { critical: true, deps: ["g4"] }),
  T("epcis_tests", "integration", "dscsa_partners", "G5", "EPCIS test files pass schema and content checks", 10, { deps: ["g4"] }),
  T("ecom", "integration", "ecommerce", "G5", "E-commerce connection tested with realistic payloads", 5, { deps: ["g4"] }),
  T("gl_map", "data", "finance", "G5", "GL mapping, open AR and AP mapped", 5, { deps: ["g4"] }),
  M("g5", "data", "G5", "G5 Data readiness", ["mock1", "partners_testing", "epcis_tests", "ecom", "gl_map"]),
  T("mock23", "data", "data", "G6", "Mock loads 2 and 3 pass; counts and dollars tie", 10, { critical: true, deps: ["g5"] }),
  T("v3", "data", "data", "G6", "V3 reconciliation signed by the client controller", 5, { critical: true, deps: ["mock23"] }),
  T("v4", "validate_go_live", "env_config", "G6", "V4 behavioral tests run by client staff", 5, { critical: true, deps: ["g5"] }),
  T("partners_passed", "integration", "edi_integrations", "G6", "Every go-live partner passed testing with clean acknowledgments", 10, { critical: true, deps: ["g5"] }),
  T("returns", "integration", "finance", "G6", "Returns and credits process agreed", 3, { critical: true, deps: ["g5"] }),
  T("key_users", "validate_go_live", "training", "G6", "Key users trained before the first rehearsal", 5, { deps: ["g5"] }),
  T("opening_bal", "data", "finance", "G6", "Opening balances tie to the trial balance; controller signs", 5, { critical: true, deps: ["gl_map"] }),
  M("g6", "data", "G6", "G6 Validation complete", ["v3", "v4", "partners_passed", "returns", "key_users", "opening_bal"]),

  // Stage 5. Validate and go live
  T("rehearsal", "validate_go_live", "data", "G7a", "Simulated go-live passed inside the cutover window", 5, { critical: true, deps: ["g6"] }),
  T("rollback", "validate_go_live", "env_config", "G7a", "Rollback rehearsed; freeze and delta load set", 3, { critical: true, deps: ["rehearsal"] }),
  T("switch_dates", "validate_go_live", "edi_integrations", "G7a", "Switch date sent to each partner; endpoints on a dated plan", 3, { deps: ["g6"] }),
  M("g7a", "validate_go_live", "G7a", "G7a Conditional Go", ["rollback", "switch_dates"]),
  T("fallback", "validate_go_live", "edi_integrations", "G7b", "Manual order fallback staffed", 2, { deps: ["g7a"] }),
  T("super_users", "validate_go_live", "training", "G7b", "Super-users certified", 3, { deps: ["g7a"] }),
  T("labels", "validate_go_live", "site_hardware", "G7b", "Label and printer test scans pass", 2, { deps: ["g7a"] }),
  M("g7b", "validate_go_live", "G7b", "G7b Final Go", [["fallback", 7], ["super_users", 7], ["labels", 7]]),
  M("go_live", "validate_go_live", null, "Go live", [["g7b", 5]]),

  // Stage 6. Hypercare
  T("defects", "hypercare", "data", "G8", "No open critical data defects; quarantine cleared", 22, { critical: true, deps: ["go_live"] }),
  T("partners_clean", "hypercare", "edi_integrations", "G8", "Every partner clean in production; EDI metrics reported; old provider exited", 22, { deps: ["go_live"] }),
  T("l1_handoff", "hypercare", "env_config", "G8", "Monitoring and L1 handed to support", 5, { deps: ["defects"] }),
  T("archive_owner", "hypercare", "data", "G8", "Legacy archive has a named owner", 3, { deps: ["go_live"] }),
  M("g8", "hypercare", "G8", "G8 Stabilization exit", ["l1_handoff", "partners_clean", "archive_owner"]),
];

/** The milestone whose finish is the forecast go-live date. */
export const GO_LIVE_KEY = "go_live";
