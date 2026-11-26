// Where each partner's transaction sets stand, as an ordered level for the
// partner-by-set heat map. A set's own status wins; when the sheet says no more
// than "Not started" for it, the partner's own status stands in, and the cell
// says so. Pure.

import type { SheetPartner } from "./sheetboard";
import { TRANSACTION_SETS } from "./edi";

export const SET_LEVELS = ["Not started", "In build", "Testing", "Certified", "Live"] as const;
export type SetLevel = 0 | 1 | 2 | 3 | 4;

/** Reads status words ("Build & Connect", "Testing", "Live") as a level, or null when they say the work is out of scope. */
export function levelOfText(s: string | null | undefined): SetLevel | null {
  const t = (s ?? "").toLowerCase();
  if (/out of scope|not needed|n\/a|terminated|removed/.test(t)) return null;
  if (/\bnot live\b/.test(t)) return /test/.test(t) ? 2 : /build|map|connect|set ?up/.test(t) ? 1 : 0;
  if (/\b(live|production)\b/.test(t)) return 4;
  if (/certif|passed|approved|signed off/.test(t)) return 3;
  if (/test/.test(t)) return 2;
  if (/build|map|connect|set ?up|config|develop|in progress/.test(t)) return 1;
  return 0;
}

export interface SetCell {
  level: SetLevel;
  failed: boolean;
  /** True when the set's own status said nothing, so the partner's status gave the level. */
  fromPartner: boolean;
  /** "850 in, 850 out": the directions in the cell. */
  detail: string;
  words: string | null;
}

export interface SetRow {
  partner: SheetPartner;
  /** Null when the partner is out of scope. */
  level: SetLevel | null;
  cells: Record<string, SetCell | undefined>;
}

export interface SetGrid { columns: string[]; rows: SetRow[]; outOfScope: SheetPartner[] }

export function setGrid(partners: SheetPartner[]): SetGrid {
  const used = new Set(partners.flatMap((p) => p.sets.map((s) => s.transaction)));
  const order = (x: string) => { const i = (TRANSACTION_SETS as readonly string[]).indexOf(x); return i < 0 ? 100 + Number(x) : i; };
  const columns = [...used].sort((a, b) => order(a) - order(b));
  const rows: SetRow[] = [];
  const outOfScope: SheetPartner[] = [];
  for (const p of partners) {
    const pl = levelOfText(p.sheetStatus ?? p.stageLabel);
    if (pl === null) { outOfScope.push(p); continue; }
    const cells: SetRow["cells"] = {};
    for (const col of columns) {
      const mine = p.sets.filter((s) => s.transaction === col);
      if (!mine.length) continue;
      const levels = mine.map((s) => {
        const own: SetLevel = s.live ? 4 : s.testStatus === "passed" ? 3 : s.testStatus === "failed" ? 2 : (levelOfText(s.sheetStatus) ?? 0);
        return { own, s };
      });
      // A set in two directions is only as far along as its slower half.
      const low = levels.reduce((a, b) => (b.own < a.own ? b : a));
      const fromPartner = low.own === 0 && pl > 0;
      cells[col] = {
        level: fromPartner ? pl : low.own, failed: mine.some((s) => s.testStatus === "failed"), fromPartner,
        detail: mine.map((s) => s.label).join(", "), words: mine.map((s) => s.sheetStatus).filter(Boolean).join("; ") || null,
      };
    }
    rows.push({ partner: p, level: pl, cells });
  }
  return { columns, rows, outOfScope };
}
