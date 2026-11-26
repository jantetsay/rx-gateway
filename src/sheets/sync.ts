// Pulls a sheet into the readiness record. One way only: the app reads the
// sheet and never writes to it. Rows the sheet owns (title, date, state) can't
// be edited in the app; owner, evidence and blockers can, because the sheet
// doesn't hold them.

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { audit, newId } from "@/db/repo";
import * as t from "@/db/schema";
import { readTabs } from "./google";
import { mapPartnerRows, mappingSchema, mapTaskRows } from "./mapping";

export type TabReader = (spreadsheetId: string, tabs: string[]) => Promise<Map<string, string[][]>>;

export interface SyncResult {
  ok: boolean;
  message: string;
  tasks: { added: number; updated: number; removed: number };
  partners: { added: number; updated: number };
}

export async function syncSource(db: DB, sourceId: string, actorId: string | null, reader: TabReader = readTabs): Promise<SyncResult> {
  const [src] = await db.select().from(t.sheetSources).where(eq(t.sheetSources.id, sourceId));
  if (!src) throw new Error("No such sheet source");
  const result: SyncResult = { ok: false, message: "", tasks: { added: 0, updated: 0, removed: 0 }, partners: { added: 0, updated: 0 } };
  try {
    const mapping = mappingSchema.parse(src.mapping);
    const values = await reader(src.spreadsheetId, mapping.tabs.map((x) => x.tab));
    const users = await db.select().from(t.users);
    const userByName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));
    const seen = new Set<string>();
    const prefix = `${src.id}:`;
    const now = new Date().toISOString();

    for (const tab of mapping.tabs) {
      const rows = values.get(tab.tab) ?? [];
      if (tab.kind === "tasks") {
        for (const r of mapTaskRows(tab, rows)) {
          const ref = prefix + r.ref;
          seen.add(ref);
          const fields = {
            title: r.title, status: r.status, dueDate: r.dueDate, completedAt: r.completedAt,
            lastUpdateAt: r.lastUpdateAt ?? undefined,
            ...(r.ownerName && userByName.has(r.ownerName.toLowerCase()) ? { ownerId: userByName.get(r.ownerName.toLowerCase()) } : {}),
          };
          const [existing] = await db.select().from(t.tasks).where(and(eq(t.tasks.projectId, src.projectId), eq(t.tasks.sourceRef, ref)));
          if (existing) {
            await db.update(t.tasks).set(fields).where(eq(t.tasks.id, existing.id));
            result.tasks.updated++;
          } else {
            await db.insert(t.tasks).values({
              id: newId(), projectId: src.projectId, kind: "task", stage: r.stage, workstream: r.workstream, gateKey: r.gateKey,
              critical: r.critical, durationDays: 1, source: "sheet", sourceRef: ref, ...fields, lastUpdateAt: r.lastUpdateAt ?? now,
            });
            result.tasks.added++;
          }
        }
      } else {
        for (const p of mapPartnerRows(tab, rows)) {
          const ref = prefix + p.ref;
          const [existing] = await db.select().from(t.ediPartners).where(and(eq(t.ediPartners.projectId, src.projectId), eq(t.ediPartners.sourceRef, ref)));
          const fields = { nextStep: p.nextStep, nextStepDate: p.nextStepDate, ...(p.lastContact ? { lastContact: p.lastContact } : {}) };
          if (existing) {
            await db.update(t.ediPartners).set(fields).where(eq(t.ediPartners.id, existing.id));
            result.partners.updated++;
          } else {
            await db.insert(t.ediPartners).values({
              id: newId(), projectId: src.projectId, name: p.name, type: "customer", inPhaseOne: "tbd", stage: p.defaultStage,
              source: "sheet", sourceRef: ref, ...fields,
            });
            result.partners.added++;
          }
        }
      }
    }

    // Rows gone from the sheet leave the record too.
    const mine = await db.select({ id: t.tasks.id, ref: t.tasks.sourceRef }).from(t.tasks)
      .where(and(eq(t.tasks.projectId, src.projectId), eq(t.tasks.source, "sheet")));
    const gone = mine.filter((x) => x.ref?.startsWith(prefix) && !seen.has(x.ref)).map((x) => x.id);
    if (gone.length) {
      await db.delete(t.dependencies).where(inArray(t.dependencies.succId, gone));
      await db.delete(t.dependencies).where(inArray(t.dependencies.predId, gone));
      await db.delete(t.tasks).where(inArray(t.tasks.id, gone));
      result.tasks.removed = gone.length;
    }
    result.ok = true;
    result.message = `Read ${result.tasks.added + result.tasks.updated} items and ${result.partners.added + result.partners.updated} partners`;
  } catch (err) {
    result.message = err instanceof Error ? err.message : "Sync failed";
  }
  await db.update(t.sheetSources).set({ lastSyncedAt: now(), lastResult: result.message }).where(eq(t.sheetSources.id, sourceId));
  await audit(db, actorId, result.ok ? "sync" : "sync_failed", "sheet_source", sourceId, { projectId: src.projectId, after: result });
  return result;
}

const now = () => new Date().toISOString();
