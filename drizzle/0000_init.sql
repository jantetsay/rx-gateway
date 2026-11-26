CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"project_id" text,
	"before" jsonb,
	"after" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"taken_at" text NOT NULL,
	"go_live" text,
	"gate_dates" jsonb NOT NULL,
	"approved_by" text
);
--> statement-breakpoint
CREATE TABLE "client_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"role_label" text NOT NULL,
	"person_name" text
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"segment" text NOT NULL,
	"owner_id" text
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"partner_name" text NOT NULL,
	"requested_at" text,
	"acknowledged_at" text,
	"needed_day_one" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dependencies" (
	"pred_id" text NOT NULL,
	"succ_id" text NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dependencies_pred_id_succ_id_pk" PRIMARY KEY("pred_id","succ_id")
);
--> statement-breakpoint
CREATE TABLE "edi_partners" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"in_phase_one" text DEFAULT 'tbd' NOT NULL,
	"method" text,
	"stage" integer DEFAULT 1 NOT NULL,
	"owner_id" text,
	"next_step" text,
	"next_step_date" text,
	"blocker" text,
	"date_told" text,
	"last_contact" text,
	"ticket" text,
	"certificate_sent" boolean DEFAULT false NOT NULL,
	"cert_expiry" text,
	"license_expiry" text,
	"isa15" text DEFAULT 'T' NOT NULL,
	"c2_in_scope" boolean DEFAULT false NOT NULL,
	"csos_status" text,
	"bad_file_rejected" boolean DEFAULT false NOT NULL,
	"compliance_cleared" boolean DEFAULT false NOT NULL,
	"old_provider" text,
	"exit_plan_date" text,
	"profile_rechecked_at" text,
	"first_pass_pct" integer,
	"open_rejects" integer,
	"avg_ack_hours" integer,
	"source" text DEFAULT 'app' NOT NULL,
	"source_ref" text
);
--> statement-breakpoint
CREATE TABLE "edi_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"transaction" text NOT NULL,
	"direction" text NOT NULL,
	"test_status" text DEFAULT 'not_run' NOT NULL,
	"prod_status" text DEFAULT 'not_live' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "escalation_acks" (
	"key" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"acknowledged_by" text NOT NULL,
	"acknowledged_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"rule" text NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text,
	"expires_at" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_signers" (
	"id" text PRIMARY KEY NOT NULL,
	"gate_id" text NOT NULL,
	"role_label" text NOT NULL,
	"person_name" text,
	"signed_at" text
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"planned_date" text,
	"sat_date" text,
	"result" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"severity" integer NOT NULL,
	"compliance" boolean DEFAULT false NOT NULL,
	"opened_at" text NOT NULL,
	"closed_at" text
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"scope" text NOT NULL,
	"target" text NOT NULL,
	"color" text NOT NULL,
	"reason" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" text NOT NULL,
	"lapses_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"kind" text NOT NULL,
	"method" text,
	"isa_qualifier_test" text,
	"isa_id_test" text,
	"gs_id_test" text,
	"isa_qualifier_prod" text,
	"isa_id_prod" text,
	"gs_id_prod" text,
	"as2_id" text,
	"mdn" text,
	"signing_algorithm" text,
	"encryption_algorithm" text,
	"van_provider" text,
	"sftp_hosted_by" text,
	"edi_version" text,
	"ship_to_qualifier" text,
	"spec_guide" text,
	"hub_required" boolean DEFAULT false NOT NULL,
	"verified_by" text,
	"verified_at" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "project_workstreams" (
	"project_id" text NOT NULL,
	"workstream" text NOT NULL,
	"owner_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "project_workstreams_project_id_workstream_pk" PRIMARY KEY("project_id","workstream")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier" integer,
	"stage" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"archive_reason" text,
	"contract_signed" text,
	"target_window_start" text,
	"target_window_end" text,
	"not_earlier_than" text,
	"committed_date" text,
	"pm_id" text,
	"template_version" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"last_synced_at" text,
	"last_result" text
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"taken_at" text NOT NULL,
	"reason" text NOT NULL,
	"color" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"forecast_go_live" text,
	"slip_days" integer
);
--> statement-breakpoint
CREATE TABLE "spec_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"description" text NOT NULL,
	"owner_id" text,
	"due_date" text,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"stage" text NOT NULL,
	"workstream" text NOT NULL,
	"gate_key" text,
	"owner_id" text,
	"start_date" text,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"compliance" boolean DEFAULT false NOT NULL,
	"blocker_note" text,
	"blocked_since" text,
	"blocker_plan_date" text,
	"evidence" text,
	"completed_at" text,
	"last_update_at" text,
	"decision_needed" text,
	"source" text DEFAULT 'app' NOT NULL,
	"source_ref" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_roles" ADD CONSTRAINT "client_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_pred_id_tasks_id_fk" FOREIGN KEY ("pred_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_succ_id_tasks_id_fk" FOREIGN KEY ("succ_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_partners" ADD CONSTRAINT "edi_partners_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_partners" ADD CONSTRAINT "edi_partners_profile_id_partner_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_partners" ADD CONSTRAINT "edi_partners_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_tests" ADD CONSTRAINT "edi_tests_partner_id_edi_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."edi_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_signers" ADD CONSTRAINT "gate_signers_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workstreams" ADD CONSTRAINT "project_workstreams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workstreams" ADD CONSTRAINT "project_workstreams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_id_users_id_fk" FOREIGN KEY ("pm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sources" ADD CONSTRAINT "sheet_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_gaps" ADD CONSTRAINT "spec_gaps_partner_id_edi_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."edi_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_gaps" ADD CONSTRAINT "spec_gaps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;