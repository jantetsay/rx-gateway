// Pulls a sheet into the readiness record. One way only: the app reads the
// sheet and never writes to it. Rows the sheet owns (title, date, state) can't
// be edited in the app; owner, evidence and blockers can, because the sheet
// doesn't hold them.

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { audit, newId } from "@/db/repo";
import * as t from "@/db/schema";
import { readTabs } from "./google";
import { codeOf } from "@/domain/streams";
import { mapPartnerRows, mappingSchema, mapProgressRows, mapSetRows, mapTaskRows, PROGRESS_STEPS, type ItemProgress } from "./mapping";

export type TabReader = (spreadsheetId: string, tabs: string[]) => Promise<Map<string, string[][]>>;

export interface SyncResult {
  ok: boolean;
  message: string;
  tasks: { added: number; updated: number; removed: number };
  partners: { added: number; updated: number; removed: number };
  sets: { added: number; updated: number; removed: number; unmatched: string[] };
  /** Items that took Built, Released, Demoed or Accepted from a progress tab. */
  progress: number;
}

export async function syncSource(db: DB, sourceId: string, actorId: string | null, reader: TabReader = readTabs): Promise<SyncResult> {
  const [src] = await db.select().from(t.sheetSources).where(eq(t.sheetSources.id, sourceId));
  if (!src) throw new Error("No such sheet source");
  const result: SyncResult = { ok: false, message: "", tasks: { added: 0, updated: 0, removed: 0 }, partners: { added: 0, updated: 0, removed: 0 }, sets: { added: 0, updated: 0, removed: 0, unmatched: [] }, progress: 0 };
  try {
    const mapping = mappingSchema.parse(src.mapping);
    const values = await reader(src.spreadsheetId, mapping.tabs.map((x) => x.tab));
    const users = await db.select().from(t.users);
    const userByName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));
    const seen = new Set<string>();
    const seenPartners = new Set<string>();
    const seenSets = new Set<string>();
    const prefix = `${src.id}:`;
    const now = new Date().toISOString();

    for (const tab of mapping.tabs) {
      const rows = values.get(tab.tab) ?? [];
      if (tab.kind === "tasks") {
        for (const r of mapTaskRows(tab, rows)) {
          const ref = prefix + r.ref;
          seen.add(ref);
          const fields = {
            title: r.title, status: r.status, dueDate: r.dueDate, completedAt: r.completedAt, description: r.notes,
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
      } else if (tab.kind === "edi_partners") {
        for (const p of mapPartnerRows(tab, rows)) {
          const ref = prefix + p.ref;
          seenPartners.add(ref);
          const [existing] = await db.select().from(t.ediPartners).where(and(eq(t.ediPartners.projectId, src.projectId), eq(t.ediPartners.sourceRef, ref)));
          const fields = { nextStep: p.nextStep, nextStepDate: p.nextStepDate, sheetStatus: p.status, ...(p.lastContact ? { lastContact: p.lastContact } : {}) };
          if (existing) {
            // The sheet fills a method the app has none for; a method set in the app stays.
            await db.update(t.ediPartners).set({ ...fields, ...(p.method && !existing.method ? { method: p.method } : {}) }).where(eq(t.ediPartners.id, existing.id));
            result.partners.updated++;
          } else {
            await db.insert(t.ediPartners).values({
              id: newId(), projectId: src.projectId, name: p.name, type: p.type ?? "customer", method: p.method, inPhaseOne: "tbd", stage: p.defaultStage,
              source: "sheet", sourceRef: ref, ...fields,
            });
            result.partners.added++;
          }
        }
      }
    }

    // Transaction sets come after partners, so a set can find a partner this read added.
    const setTabs = mapping.tabs.filter((x) => x.kind === "edi_sets");
    if (setTabs.length) {
      const partners = await db.select({ id: t.ediPartners.id, name: t.ediPartners.name, ref: t.ediPartners.sourceRef }).from(t.ediPartners)
        .where(eq(t.ediPartners.projectId, src.projectId));
      // A partner from this source wins over a same-named one from another.
      const byName = new Map<string, string>();
      for (const p of [...partners].sort((a, b) => Number(!!a.ref?.startsWith(prefix)) - Number(!!b.ref?.startsWith(prefix)))) byName.set(p.name.trim().toLowerCase(), p.id);
      const unmatched = new Set<string>();
      for (const tab of setTabs) {
        for (const x of mapSetRows(tab, values.get(tab.tab) ?? [])) {
          const partnerId = byName.get(x.partner.toLowerCase());
          if (!partnerId) { unmatched.add(x.partner); continue; }
          const ref = prefix + x.ref;
          seenSets.add(ref);
          const fields = { testStatus: x.testStatus, prodStatus: x.prodStatus, sheetStatus: x.status };
          const [existing] = await db.select().from(t.ediTests)
            .where(and(eq(t.ediTests.partnerId, partnerId), eq(t.ediTests.transaction, x.transaction), eq(t.ediTests.direction, x.direction)));
          if (existing) {
            // A row someone logged in the app keeps its own result; the sheet only adds its status words.
            await db.update(t.ediTests).set(existing.sourceRef ? { ...fields, sourceRef: ref } : { sheetStatus: x.status }).where(eq(t.ediTests.id, existing.id));
            result.sets.updated++;
          } else {
            await db.insert(t.ediTests).values({ id: newId(), partnerId, transaction: x.transaction, direction: x.direction, ...fields, sourceRef: ref });
            result.sets.added++;
          }
        }
      }
      result.sets.unmatched = [...unmatched].sort();
    }
    const mySets = (await db.select({ id: t.ediTests.id, ref: t.ediTests.sourceRef }).from(t.ediTests)).filter((x) => x.ref?.startsWith(prefix) && !seenSets.has(x.ref));
    if (mySets.length) {
      await db.delete(t.ediTests).where(inArray(t.ediTests.id, mySets.map((x) => x.id)));
      result.sets.removed = mySets.length;
    }

    // Progress tabs fill Built, Released, Demoed and Accepted on this source's items, by code; the first tab with a value wins.
    const progress = new Map<string, ItemProgress>();
    for (const tab of mapping.tabs) {
      if (tab.kind !== "item_progress") continue;
      for (const [code, p] of mapProgressRows(tab, values.get(tab.tab) ?? [])) {
        const have = progress.get(code) ?? { built: null, released: null, demoed: null, accepted: null };
        for (const step of PROGRESS_STEPS) have[step] ??= p[step];
        progress.set(code, have);
      }
    }
    for (const ref of seen) {
      const code = codeOf(ref);
      const p = (code && progress.get(code)) || { built: null, released: null, demoed: null, accepted: null };
      if (PROGRESS_STEPS.some((s) => p[s])) result.progress++;
      await db.update(t.tasks).set(p).where(and(eq(t.tasks.projectId, src.projectId), eq(t.tasks.sourceRef, ref)));
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
    // A partner gone from this source leaves too, unless someone has logged tests or gaps against it in the app.
    const myPartners = await db.select({ id: t.ediPartners.id, ref: t.ediPartners.sourceRef }).from(t.ediPartners)
      .where(and(eq(t.ediPartners.projectId, src.projectId), eq(t.ediPartners.source, "sheet")));
    const goneP = myPartners.filter((x) => x.ref?.startsWith(prefix) && !seenPartners.has(x.ref)).map((x) => x.id);
    if (goneP.length) {
      const used = new Set([
        // Only tests logged in the app count; rows a sheet supplied go with their partner.
        ...(await db.select({ id: t.ediTests.partnerId, ref: t.ediTests.sourceRef }).from(t.ediTests).where(inArray(t.ediTests.partnerId, goneP))).filter((x) => !x.ref).map((x) => x.id),
        ...(await db.select({ id: t.specGaps.partnerId }).from(t.specGaps).where(inArray(t.specGaps.partnerId, goneP))).map((x) => x.id),
      ]);
      const drop = goneP.filter((id) => !used.has(id));
      if (drop.length) {
        await db.delete(t.ediTests).where(inArray(t.ediTests.partnerId, drop));
        await db.delete(t.ediPartners).where(inArray(t.ediPartners.id, drop));
      }
      result.partners.removed = drop.length;
    }
    result.ok = true;
    const sets = result.sets.added + result.sets.updated;
    result.message = `Read ${result.tasks.added + result.tasks.updated} items and ${result.partners.added + result.partners.updated} partners`
      + (setTabs.length ? `, ${sets} transaction sets` : "")
      + (mapping.tabs.some((x) => x.kind === "item_progress") ? `. Progress found for ${result.progress} item${result.progress === 1 ? "" : "s"}` : "")
      + (result.sets.unmatched.length ? `. No partner named ${result.sets.unmatched.slice(0, 3).join(", ")}${result.sets.unmatched.length > 3 ? ` and ${result.sets.unmatched.length - 3} more` : ""}` : "");
  } catch (err) {
    result.message = err instanceof Error ? err.message : "Sync failed";
  }
  await db.update(t.sheetSources).set({ lastSyncedAt: now(), lastResult: result.message }).where(eq(t.sheetSources.id, sourceId));
  await audit(db, actorId, result.ok ? "sync" : "sync_failed", "sheet_source", sourceId, { projectId: src.projectId, after: result });
  return result;
}

const now = () => new Date().toISOString();
