// Server-side loading for the pages: read the records, run the rules, build rows.
// Nothing here writes, so every page can call it freely.

import { today, type ISODate } from "@/domain/calendar";
import { evaluateProject } from "@/domain/evaluate";
import { buildRow, sortRows, type PortfolioRow } from "@/domain/portfolio";
import { getDb } from "@/db/client";
import * as repo from "@/db/repo";

export async function loadRows(asOf: ISODate = today()): Promise<PortfolioRow[]> {
  const db = await getDb();
  const [snaps, prev] = await Promise.all([repo.loadSnapshots(db), repo.previousColors(db, asOf)]);
  return sortRows(snaps.map((s) => buildRow(s, evaluateProject(s, asOf), prev.get(s.project.id) ?? null)));
}

export async function loadRow(projectId: string, asOf: ISODate = today()): Promise<PortfolioRow | null> {
  const db = await getDb();
  const [snaps, prev] = await Promise.all([repo.loadSnapshots(db, [projectId]), repo.previousColors(db, asOf)]);
  const s = snaps[0];
  return s ? buildRow(s, evaluateProject(s, asOf), prev.get(s.project.id) ?? null) : null;
}
