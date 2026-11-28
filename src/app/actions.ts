"use server";

// Every edit in the app goes through here: check, write through the repo (which
// audits it), refresh the pages that show it, and send the person back with a
// plain message. Errors come back as a message, never a crash page.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import * as repo from "@/db/repo";
import * as t from "@/db/schema";
import { mappingSchema, sheetIdOf } from "@/sheets/mapping";
import { syncSource } from "@/sheets/sync";
import { today } from "@/domain/calendar";
import { checkColors, COLOR_DEFS, DEFAULT_COLORS, normalizeHex, type StatusColors } from "@/domain/colors";
import { STAGES, WORKSTREAMS, type Color, type HandOverride, type StageKey, type TaskStatus } from "@/domain/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;

function back(f: FormData, msg: { ok?: string; error?: string }): never {
  const to = str(f, "back") || "/";
  const url = new URL(to, "http://x");
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  if (msg.ok) url.searchParams.set("ok", msg.ok);
  if (msg.error) url.searchParams.set("error", msg.error);
  redirect(url.pathname + url.search);
}

async function run(f: FormData, ok: string, fn: (db: Awaited<ReturnType<typeof getDb>>, actor: string | null) => Promise<unknown>): Promise<never> {
  const db = await getDb();
  const actor = (await repo.actingUser(db))?.id ?? null;
  let said: unknown;
  try {
    said = await fn(db, actor);
  } catch (e) {
    back(f, { error: e instanceof Error ? e.message : "Something went wrong" });
  }
  revalidatePath("/", "layout");
  // An action may return its own message, for example how many settings changed.
  back(f, { ok: typeof said === "string" && said ? said : ok });
}

function needActor(actor: string | null): string {
  if (!actor) throw new Error("No acting user is set up. Add one with the seed or RXG_ACTING_USER.");
  return actor;
}

export async function setTaskStatus(f: FormData) {
  const status = str(f, "status") as TaskStatus;
  return run(f, "Saved", (db, a) => repo.updateTask(db, str(f, "taskId"), {
    status,
    ...(status === "blocked" ? { blockerNote: opt(f, "blockerNote"), blockerPlanDate: opt(f, "blockerPlanDate") } : {}),
  }, a));
}

export async function setTaskOwner(f: FormData) {
  return run(f, "Owner saved", (db, a) => repo.updateTask(db, str(f, "taskId"), { ownerId: opt(f, "ownerId") }, a));
}

export async function addOverride(f: FormData) {
  return run(f, "Hand change recorded. It lapses next Monday.", (db, a) => repo.addOverride(db, {
    projectId: str(f, "projectId"),
    scope: str(f, "scope") as HandOverride["scope"],
    target: str(f, "target"),
    color: str(f, "color") as Color,
    reason: str(f, "reason"),
  }, needActor(a)));
}

export async function acknowledge(f: FormData) {
  return run(f, "Acknowledged", (db, a) => repo.acknowledgeEscalation(db, str(f, "key"), str(f, "projectId"), needActor(a)));
}

export async function nameSigner(f: FormData) {
  return run(f, "Signer named", (db, a) => repo.nameSigner(db, str(f, "signerId"), opt(f, "personName"), a));
}

export async function sign(f: FormData) {
  return run(f, "Signature recorded", (db, a) => repo.signGate(db, str(f, "signerId"), a));
}

export async function sitGate(f: FormData) {
  return run(f, "Gate sitting recorded", (db, a) => repo.sitGate(db, str(f, "gateId"), str(f, "result") as "passed" | "failed", {
    notEarlierThan: opt(f, "notEarlierThan") ?? undefined,
    committedDate: opt(f, "committedDate") ?? undefined,
  }, a));
}

export async function nameClientRole(f: FormData) {
  return run(f, "Saved", (db, a) => repo.nameClientRole(db, str(f, "roleId"), opt(f, "personName"), a));
}

export async function weeklyRefresh(f: FormData) {
  return run(f, "Weekly refresh done: colors recorded for the trend", (db) => repo.snapshotProjects(db, undefined, "weekly refresh"));
}

export async function movePartner(f: FormData) {
  return run(f, "Partner moved", (db, a) => repo.updatePartner(db, str(f, "partnerId"), { stage: Number(str(f, "stage")) }, a));
}

export async function setPartnerFields(f: FormData) {
  return run(f, "Partner saved", (db, a) => repo.updatePartner(db, str(f, "partnerId"), {
    nextStep: opt(f, "nextStep"),
    nextStepDate: opt(f, "nextStepDate"),
    ownerId: opt(f, "ownerId"),
    lastContact: opt(f, "lastContact"),
    badFileRejected: f.get("badFileRejected") === "on",
    complianceCleared: f.get("complianceCleared") === "on",
  }, a));
}

export async function setTest(f: FormData) {
  return run(f, "Test result saved", (db, a) => repo.setTest(db, str(f, "partnerId"), str(f, "transaction"),
    str(f, "direction") as "inbound" | "outbound", { testStatus: str(f, "testStatus") }, a));
}

export async function resolveGap(f: FormData) {
  return run(f, "Gap resolved", (db, a) => repo.resolveGap(db, str(f, "gapId"), a));
}

export async function addClient(f: FormData) {
  return run(f, "Client added. You can attach a sheet to it now.", async (db, a) => {
    const name = str(f, "name");
    if (!name) throw new Error("Give the client a name");
    const stage = (STAGES as readonly string[]).includes(str(f, "stage")) ? (str(f, "stage") as StageKey) : "onboarding";
    const start = str(f, "start") || today();
    const goLive = opt(f, "goLive");
    const clientId = `cl-${randomUUID().slice(0, 8)}`;
    await db.insert(t.clients).values({ id: clientId, name, segment: str(f, "segment") || "Not set", ownerId: a });
    await repo.audit(db, a, "create", "client", clientId, { after: { name } });
    await repo.createProject(db, {
      clientId, name, stage, start, modules: [], tier: null, pmId: a,
      targetWindowStart: null, targetWindowEnd: goLive, workstreams: [...WORKSTREAMS], contractSigned: start,
      fromSheet: str(f, "plan") !== "template",
    }, a);
  });
}

export async function addSheetSource(f: FormData) {
  return run(f, "Sheet source added. Press Sync now to read it.", async (db, a) => {
    let parsed: unknown;
    try { parsed = JSON.parse(str(f, "mapping")); } catch { throw new Error("The mapping isn't valid JSON"); }
    const tabs = (parsed as { tabs?: unknown })?.tabs ?? parsed;
    const m = mappingSchema.safeParse({ tabs });
    if (!m.success) throw new Error(`The mapping doesn't fit: ${m.error.issues[0]?.path.join(".")} ${m.error.issues[0]?.message}`);
    const id = `src-${randomUUID().slice(0, 8)}`;
    const spreadsheetId = sheetId(str(f, "spreadsheet"));
    if (!spreadsheetId) throw new Error("Paste the sheet's address or its ID");
    await db.insert(t.sheetSources).values({ id, projectId: str(f, "projectId"), label: str(f, "label") || "Tracking sheet", spreadsheetId, mapping: m.data });
    await repo.audit(db, a, "create", "sheet_source", id, { projectId: str(f, "projectId"), after: { label: str(f, "label") } });
  });
}

/** Replaces a sheet source's mapping, for example to drop a tab another sheet now covers. The next sync applies it. */
export async function updateSheetMapping(f: FormData) {
  return run(f, "Mapping saved. Press Sync now to apply it.", async (db, a) => {
    const id = str(f, "sourceId");
    const [src] = await db.select().from(t.sheetSources).where(eq(t.sheetSources.id, id));
    if (!src) throw new Error("No such sheet source");
    let parsed: unknown;
    try { parsed = JSON.parse(str(f, "mapping")); } catch { throw new Error("The mapping isn't valid JSON"); }
    const tabs = (parsed as { tabs?: unknown })?.tabs ?? parsed;
    const m = mappingSchema.safeParse({ tabs });
    if (!m.success) throw new Error(`The mapping doesn't fit: ${m.error.issues[0]?.path.join(".")} ${m.error.issues[0]?.message}`);
    await db.update(t.sheetSources).set({ mapping: m.data }).where(eq(t.sheetSources.id, id));
    await repo.audit(db, a, "update", "sheet_source", id, { projectId: src.projectId, before: { mapping: src.mapping }, after: { mapping: m.data } });
  });
}

export async function syncNow(f: FormData) {
  const db = await getDb();
  const actor = (await repo.actingUser(db))?.id ?? null;
  const r = await syncSource(db, str(f, "sourceId"), actor);
  revalidatePath("/", "layout");
  back(f, r.ok ? { ok: r.message } : { error: r.message });
}

const sheetId = sheetIdOf;

/** Saves the status colors picked on Settings. A pick that fails a check is still saved, with a warning. */
export async function saveColors(f: FormData) {
  return run(f, "No colors changed", async (db, a) => {
    const now = await repo.statusColors(db);
    const next = { ...now } as StatusColors;
    for (const d of COLOR_DEFS) {
      const raw = str(f, `c_${d.key}`);
      if (!raw) continue;
      const v = normalizeHex(raw);
      if (!v) throw new Error(`${d.label}: "${raw}" isn't a color. Use a hex value like #257de0.`);
      next[d.key] = v;
    }
    const n = await repo.saveStatusColors(db, next, a);
    if (!n) return "No colors changed";
    const fails = checkColors(next).filter((x) => x.level === "fail").length;
    return `Saved ${n} color${n === 1 ? "" : "s"}.${fails ? ` ${fails} check${fails === 1 ? "" : "s"} failed: see the notes under the colors.` : ""}`;
  });
}

/** Puts one color, or all of them, back to the default. */
export async function resetColors(f: FormData) {
  return run(f, "Already the default", async (db, a) => {
    const key = str(f, "key");
    if (key && !(key in DEFAULT_COLORS)) throw new Error("That isn't one of the status colors.");
    const now = await repo.statusColors(db);
    const next = key ? { ...now, [key]: DEFAULT_COLORS[key as keyof StatusColors] } : { ...DEFAULT_COLORS };
    const n = await repo.saveStatusColors(db, next as StatusColors, a);
    return n ? `Reset ${n} color${n === 1 ? "" : "s"} to the default.` : "Already the default";
  });
}
