// The heat maps: open work by work stream and week, and EDI partners by
// transaction set. One blue hue, light to dark, so more or further along reads
// darker. Every cell has its number or its word on hover and in its link label,
// and every cell clicks through to the items behind it.

import Link from "next/link";
import type { StreamHeat } from "@/domain/sheetboard";
import { SET_LEVELS, type SetGrid } from "@/domain/setlevels";

/** Sequential blue (counts): the light end may recede toward the page. */
const SEQ = ["#b6d5f8", "#84b9f3", "#338ced", "#2370cd", "#0f4a96"];
/** Ordinal blue (levels): the light end still clears 2:1 on white. Validated with the dataviz checks. */
// Progress levels come from Settings through CSS variables (defaults in globals.css).
export const ORD = [0, 1, 2, 3, 4].map((i) => `var(--color-lv-${i})`);
const ORD_INK = [0, 1, 2, 3, 4].map((i) => `var(--color-lv-ink-${i})`);
const inkOn = (i: number) => (i >= 2 ? "#ffffff" : "#0e2a52");

function seqStep(v: number, max: number) {
  if (max <= SEQ.length) return Math.min(SEQ.length - 1, v - 1);
  return Math.min(SEQ.length - 1, Math.floor(((v - 1) / max) * SEQ.length));
}

export function StreamHeatMap({ heat, hrefFor }: { heat: StreamHeat; hrefFor: (stream: string, week: string | null) => string }) {
  if (!heat.rows.length) return <p className="text-sm text-gray-500">Nothing open.</p>;
  const firstFuture = heat.columns.findIndex((c) => !c.past);
  const pastCount = firstFuture < 0 ? heat.columns.length : firstFuture;
  const futureCount = heat.columns.length - 1 - pastCount; // last column is "No date"
  const thisWeek = heat.columns.find((c) => c.isThisWeek)?.key;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr>
              <th />
              {pastCount > 0 && <th colSpan={pastCount} className="border-b-2 pb-0.5 text-left font-semibold text-bad" style={{ borderColor: "var(--color-st-critical)" }}>Past due</th>}
              {futureCount > 0 && <th colSpan={futureCount} className="border-b-2 border-line pb-0.5 text-left font-semibold text-gray-600">This week and ahead</th>}
              <th />
              <th />
            </tr>
            <tr className="text-gray-600">
              <th className="w-44 p-1 text-left font-semibold">Work stream</th>
              {heat.columns.map((c) => (
                <th key={c.key} className={`p-1 text-center font-normal ${c.isThisWeek ? "font-bold text-navy" : ""}`}>
                  {c.label}{c.orEarlier && <span className="block text-[10px] text-gray-500">and before</span>}{c.isThisWeek && <span className="block text-[10px]">this week</span>}
                </th>
              ))}
              <th className="p-1 text-right font-semibold">Open</th>
            </tr>
          </thead>
          <tbody>
            {heat.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="p-1 text-left font-semibold"><Link href={hrefFor(r.key, null)} className="no-underline hover:underline">{r.label}</Link></th>
                {heat.columns.map((c) => {
                  const v = r.cells[c.key] ?? 0;
                  const when = c.key === "nodate" ? "with no due date" : c.isThisWeek ? "due this week" : `due the week of ${c.label}${c.orEarlier ? " or earlier" : ""}`;
                  if (!v) return <td key={c.key} className={`h-9 rounded bg-card text-center text-gray-300 ${c.key === thisWeek ? "outline outline-1 outline-navy/30" : ""}`} aria-label={`${r.label}: nothing ${when}`}>·</td>;
                  const i = seqStep(v, heat.max);
                  const label = `${r.label}: ${v} open ${when}${c.past ? ", past due" : ""}`;
                  return (
                    <td key={c.key} className="h-9 p-0">
                      <Link href={hrefFor(r.key, c.key)} title={label} aria-label={label}
                        className="flex h-9 items-center justify-center rounded text-sm font-semibold no-underline transition hover:ring-2 hover:ring-navy/50"
                        style={{ background: SEQ[i], color: inkOn(i) }}>
                        {v}
                      </Link>
                    </td>
                  );
                })}
                <td className="p-1 text-right font-semibold text-navy">{r.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>Fewer</span>
        {SEQ.map((c) => <span key={c} aria-hidden className="inline-block h-3 w-6 rounded-sm" style={{ background: c }} />)}
        <span>More open items</span>
        <span className="ml-3">Click a cell to see its items.</span>
      </div>
    </div>
  );
}

export function SetHeatMap({ grid, hrefFor }: { grid: SetGrid; hrefFor: (partnerId: string) => string }) {
  if (!grid.columns.length) {
    return <p className="text-sm text-gray-500">No transaction sets yet. Map the register&apos;s transactions tab as kind &quot;edi_sets&quot; on Sheets, or add sets on the EDI page.</p>;
  }
  const allFromPartner = grid.rows.every((r) => Object.values(r.cells).every((c) => !c || c.fromPartner || c.level === 0));
  return (
    <div>
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-700">
        {SET_LEVELS.map((l, i) => (
          <li key={l} className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-5 rounded-sm" style={{ background: ORD[i] }} />{l}</li>
        ))}
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-5 rounded-sm border-2" style={{ borderColor: "var(--color-st-critical)" }} />Partner late</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-5 rounded-sm bg-card" />Not one of its sets</li>
      </ul>
      <div className="max-h-[36rem] overflow-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-[2px] text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="text-gray-600">
              <th className="w-52 p-1 text-left font-semibold">Partner</th>
              {grid.columns.map((c) => <th key={c} className="p-1 text-center font-semibold">{c}</th>)}
              <th className="p-1 text-left font-semibold">Partner status</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map(({ partner: p, cells, level }) => {
              const late = p.daysLate > 0;
              return (
                <tr key={p.id}>
                  <th scope="row" className="p-1 text-left font-semibold">
                    <Link href={hrefFor(p.id)} className="no-underline hover:underline">{p.name}</Link>
                    {late && <span className="ml-1 rounded-full border border-bad/30 bg-bad-bg px-1.5 text-[10px] font-semibold text-bad">{p.daysLate}d late</span>}
                  </th>
                  {grid.columns.map((col) => {
                    const c = cells[col];
                    if (!c) return <td key={col} className="h-7 rounded bg-card text-center text-gray-300" aria-label={`${p.name}: ${col} not one of its sets`}>·</td>;
                    const label = `${p.name}, ${col} (${c.detail}): ${SET_LEVELS[c.level]}${c.failed ? ", a test failed" : ""}${c.fromPartner ? ", from the partner's status" : ""}${c.words ? `. Sheet says: ${c.words}` : ""}${late ? `. Partner is ${p.daysLate} working days late` : ""}`;
                    return (
                      <td key={col} className="h-7 p-0">
                        <Link href={hrefFor(p.id)} title={label} aria-label={label}
                          className="flex h-7 items-center justify-center rounded text-[11px] font-semibold no-underline transition hover:ring-2 hover:ring-navy/50"
                          style={{ background: ORD[c.level], color: ORD_INK[c.level], boxShadow: late ? "inset 0 0 0 2px var(--color-st-critical)" : undefined }}>
                          {c.failed ? "Failed" : c.level === 4 ? "Live" : ""}
                        </Link>
                      </td>
                    );
                  })}
                  <td className="p-1 text-gray-700">{p.sheetStatus ?? (level !== null ? SET_LEVELS[level] : "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {grid.outOfScope.length > 0 && <p className="mt-2 text-xs text-gray-600">Out of scope, not shown: {grid.outOfScope.map((p) => p.name).join(", ")}.</p>}
      {allFromPartner && <p className="mt-1 text-xs text-gray-600">The sheet has no progress yet for any single set, so each row takes its color from the partner&apos;s status.</p>}
    </div>
  );
}
