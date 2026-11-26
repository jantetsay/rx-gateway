// Database schema. Dates are stored as YYYY-MM-DD text and times as ISO text,
// so nothing shifts with a server's time zone. Never store certificates, keys,
// passwords, patient data or real pricing in any of these tables.

import { boolean, integer, jsonb, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  /** admin, executive, pm, member. Client roles come with the host portal's login. */
  role: text("role").notNull(),
});

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  segment: text("segment").notNull(),
  ownerId: text("owner_id").references(() => users.id),
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  tier: integer("tier"),
  stage: text("stage").notNull(),
  archived: boolean("archived").notNull().default(false),
  archiveReason: text("archive_reason"),
  contractSigned: text("contract_signed"),
  targetWindowStart: text("target_window_start"),
  targetWindowEnd: text("target_window_end"),
  notEarlierThan: text("not_earlier_than"),
  committedDate: text("committed_date"),
  pmId: text("pm_id").references(() => users.id),
  templateVersion: text("template_version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projectWorkstreams = pgTable("project_workstreams", {
  projectId: text("project_id").notNull().references(() => projects.id),
  workstream: text("workstream").notNull(),
  ownerId: text("owner_id").references(() => users.id),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.projectId, t.workstream] })]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  stage: text("stage").notNull(),
  workstream: text("workstream").notNull(),
  gateKey: text("gate_key"),
  ownerId: text("owner_id").references(() => users.id),
  startDate: text("start_date"),
  durationDays: integer("duration_days").notNull().default(1),
  dueDate: text("due_date"),
  status: text("status").notNull().default("not_started"),
  critical: boolean("critical").notNull().default(false),
  compliance: boolean("compliance").notNull().default(false),
  blockerNote: text("blocker_note"),
  blockedSince: text("blocked_since"),
  blockerPlanDate: text("blocker_plan_date"),
  evidence: text("evidence"),
  completedAt: text("completed_at"),
  lastUpdateAt: text("last_update_at"),
  decisionNeeded: text("decision_needed"),
  source: text("source").notNull().default("app"),
  /** For rows read from a sheet: tab and row key. The sheet stays the source for these. */
  sourceRef: text("source_ref"),
  /** For rows read from a sheet: its note or description column, when mapped. */
  description: text("description"),
  /** Delivery progress a sheet keeps beside the item, as written there ("YES", "NO", a date, "N/R"). */
  built: text("built"),
  released: text("released"),
  demoed: text("demoed"),
  accepted: text("accepted"),
  /** The row's ticket in the team's work tracker, as the sheet has it: a number or a link. */
  ticket: text("ticket"),
  /** Rows from a tab mapped to its own dashboard card (a stakeholder's list) carry that card's name; they stay out of the main counts. */
  card: text("card"),
  /** The sheet's status words as written, shown beside the item. */
  sheetStatus: text("sheet_status"),
  /** A delivery ID the sheet keeps in its own column, when the row's key is something else. */
  deliveryId: text("delivery_id"),
});

export const dependencies = pgTable("dependencies", {
  predId: text("pred_id").notNull().references(() => tasks.id),
  succId: text("succ_id").notNull().references(() => tasks.id),
  lagDays: integer("lag_days").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.predId, t.succId] })]);

export const gates = pgTable("gates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  key: text("key").notNull(),
  plannedDate: text("planned_date"),
  satDate: text("sat_date"),
  result: text("result").notNull().default("pending"),
});

export const gateSigners = pgTable("gate_signers", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => gates.id),
  roleLabel: text("role_label").notNull(),
  personName: text("person_name"),
  signedAt: text("signed_at"),
});

export const clientRoles = pgTable("client_roles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  roleLabel: text("role_label").notNull(),
  personName: text("person_name"),
});

/** The DSCSA L4 connection register. */
export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  partnerName: text("partner_name").notNull(),
  requestedAt: text("requested_at"),
  acknowledgedAt: text("acknowledged_at"),
  neededDayOne: boolean("needed_day_one").notNull().default(false),
  status: text("status").notNull().default("requested"),
});

export const issues = pgTable("issues", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  severity: integer("severity").notNull(),
  compliance: boolean("compliance").notNull().default(false),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
});

/** Written exception to a gate rule. Steve approves; it has an expiry date. */
export const exceptions = pgTable("exceptions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  rule: text("rule").notNull(),
  reason: text("reason").notNull(),
  approvedBy: text("approved_by"),
  expiresAt: text("expires_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Hand change to a computed color. Lapses at the next weekly refresh. */
export const overrides = pgTable("overrides", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  scope: text("scope").notNull(),
  target: text("target").notNull(),
  color: text("color").notNull(),
  reason: text("reason").notNull(),
  setBy: text("set_by").notNull(),
  setAt: text("set_at").notNull(),
  lapsesAt: text("lapses_at").notNull(),
});

export const escalationAcks = pgTable("escalation_acks", {
  key: text("key").primaryKey(),
  projectId: text("project_id").notNull(),
  acknowledgedBy: text("acknowledged_by").notNull(),
  acknowledgedAt: text("acknowledged_at").notNull(),
});

export const baselines = pgTable("baselines", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  label: text("label").notNull(),
  takenAt: text("taken_at").notNull(),
  goLive: text("go_live"),
  gateDates: jsonb("gate_dates").$type<Record<string, string | null>>().notNull(),
  approvedBy: text("approved_by"),
});

/** Weekly and gate-sitting snapshots, so trends show. */
export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  takenAt: text("taken_at").notNull(),
  reason: text("reason").notNull(),
  color: text("color").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull(),
  forecastGoLive: text("forecast_go_live"),
  slipDays: integer("slip_days"),
});

/** One verified profile per trading partner, shared across clients. No secrets. */
export const partnerProfiles = pgTable("partner_profiles", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  kind: text("kind").notNull(),
  method: text("method"),
  isaQualifierTest: text("isa_qualifier_test"),
  isaIdTest: text("isa_id_test"),
  gsIdTest: text("gs_id_test"),
  isaQualifierProd: text("isa_qualifier_prod"),
  isaIdProd: text("isa_id_prod"),
  gsIdProd: text("gs_id_prod"),
  as2Id: text("as2_id"),
  mdn: text("mdn"),
  signingAlgorithm: text("signing_algorithm"),
  encryptionAlgorithm: text("encryption_algorithm"),
  vanProvider: text("van_provider"),
  sftpHostedBy: text("sftp_hosted_by"),
  ediVersion: text("edi_version"),
  shipToQualifier: text("ship_to_qualifier"),
  specGuide: text("spec_guide"),
  hubRequired: boolean("hub_required").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: text("verified_at"),
  notes: text("notes"),
});

export const ediPartners = pgTable("edi_partners", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  profileId: text("profile_id").references(() => partnerProfiles.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  inPhaseOne: text("in_phase_one").notNull().default("tbd"),
  method: text("method"),
  stage: integer("stage").notNull().default(1),
  ownerId: text("owner_id").references(() => users.id),
  nextStep: text("next_step"),
  nextStepDate: text("next_step_date"),
  blocker: text("blocker"),
  dateTold: text("date_told"),
  lastContact: text("last_contact"),
  ticket: text("ticket"),
  certificateSent: boolean("certificate_sent").notNull().default(false),
  certExpiry: text("cert_expiry"),
  licenseExpiry: text("license_expiry"),
  isa15: text("isa15").notNull().default("T"),
  c2InScope: boolean("c2_in_scope").notNull().default(false),
  csosStatus: text("csos_status"),
  badFileRejected: boolean("bad_file_rejected").notNull().default(false),
  complianceCleared: boolean("compliance_cleared").notNull().default(false),
  oldProvider: text("old_provider"),
  exitPlanDate: text("exit_plan_date"),
  profileRecheckedAt: text("profile_rechecked_at"),
  firstPassPct: integer("first_pass_pct"),
  openRejects: integer("open_rejects"),
  avgAckHours: integer("avg_ack_hours"),
  source: text("source").notNull().default("app"),
  sourceRef: text("source_ref"),
  /** The partner's status as its tracking sheet words it, read on each sync. */
  sheetStatus: text("sheet_status"),
});

/** The transaction test matrix: one row per partner and transaction set. */
export const ediTests = pgTable("edi_tests", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id").notNull().references(() => ediPartners.id),
  transaction: text("transaction").notNull(),
  direction: text("direction").notNull(),
  testStatus: text("test_status").notNull().default("not_run"),
  prodStatus: text("prod_status").notNull().default("not_live"),
  notes: text("notes"),
  /** Set when a tracking sheet supplies this row: its status words and where it came from. */
  sheetStatus: text("sheet_status"),
  sourceRef: text("source_ref"),
});

export const specGaps = pgTable("spec_gaps", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id").notNull().references(() => ediPartners.id),
  description: text("description").notNull(),
  ownerId: text("owner_id").references(() => users.id),
  dueDate: text("due_date"),
  resolved: boolean("resolved").notNull().default(false),
});

/** A Google Sheet the app reads, read-only, with how its columns map to records. */
export const sheetSources = pgTable("sheet_sources", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  label: text("label").notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  mapping: jsonb("mapping").notNull(),
  lastSyncedAt: text("last_synced_at"),
  lastResult: text("last_result"),
});

/** Read-only record of who changed what and when. */
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  projectId: text("project_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  note: text("note"),
});
