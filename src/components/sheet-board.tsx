import Link from "next/link";
import type { SheetBoard } from "@/domain/sheetboard";
import { STAGE_LABEL } from "@/domain/template";
import { ColorBadge, Reasons, Stat, fmtDate } from "@/components/ui";

const SHOW = 12;

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const late = (n: number) => (n > 0 ? `${n} working day${n === 1 ? "" : "s"} late` : "");

/** One client's work as its tracking sheet has it. */
export function SheetBoardCard({ b }: { b: SheetBoard }) {
  const p = b.row.snapshot.project;
  const c = b.counts;
  const read = b.sources.map((s) => s.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/projects/${p.id}`} className="text-lg font-bold">{p.clientName}</Link>
            <ColorBadge color={b.row.color} />
          </div>
          <p className="text-xs text-gray-600">
            {STAGE_LABEL[p.stage]} · target go-live {fmtDate(p.committedDate ?? p.targetWindowEnd)} · sheet last read {fmtTime(read)}
            {!read && <> · <Link href="/settings/sheets">press Sync now on Sheets</Link></>}
          </p>
        </div>
        <Link href={`/projects/${p.id}`} className="text-xs">Every item</Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Open items" value={c.open} />
        <Stat label="Past due" value={c.pastDue} tone={c.pastDue ? "red" : "green"} />
        <Stat label="Due in the next 2 weeks" value={c.dueSoon} tone={c.dueSoon ? "yellow" : undefined} />
        <Stat label="Open with no due date" value={c.noDate} />
        <Stat label="EDI partners past due" value={`${c.partnersPastDue} of ${c.partners}`} tone={c.partnersPastDue ? "red" : undefined} />
      </div>

      <div className="mt-3"><Reasons reasons={b.row.evaluation.computed.reasons} max={3} /></div>
      {b.openByTab.length > 1 && (
        <p className="mt-2 text-xs text-gray-600">Open by tab: {b.openByTab.map((t) => `${t.tab} ${t.open}${t.pastDue ? ` (${t.pastDue} past due)` : ""}`).join(" · ")}. Done: {c.done}.</p>
      )}
      {b.noOwners && <p className="mt-1 text-xs text-gray-600">The sheet names no owners, so none show here. Add an Owner column to the sheet and map it as &quot;owner&quot; to see who has each item.</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold">Past due, latest first</h3>
          {b.pastDue.length === 0 ? <p className="text-sm text-gray-500">Nothing past due.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500"><tr><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Due</th><th className="py-1 pr-2">Late</th><th className="py-1">Owner</th></tr></thead>
              <tbody className="divide-y divide-line">
                {b.pastDue.slice(0, SHOW).map((i) => (
                  <tr key={i.id}>
                    <td className="py-1 pr-2">{i.title}{i.blocked && <span className="ml-1 text-xs font-semibold text-bad">Blocked</span>}<span className="block text-xs text-gray-500">{i.tab}</span></td>
                    <td className="whitespace-nowrap py-1 pr-2 text-xs">{fmtDate(i.due)}</td>
                    <td className="whitespace-nowrap py-1 pr-2 text-xs font-semibold text-bad">{late(i.daysLate)}</td>
                    <td className="py-1 text-xs">{i.owner ?? "None named"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {b.pastDue.length > SHOW && <Link href={`/projects/${p.id}`} className="mt-1 block text-xs">And {b.pastDue.length - SHOW} more past due</Link>}

          <h3 className="mb-2 mt-4 text-sm font-bold">Due in the next 2 weeks</h3>
          {b.dueSoon.length === 0 ? <p className="text-sm text-gray-500">Nothing due in the next two weeks.</p> : (
            <ul className="space-y-1 text-sm">
              {b.dueSoon.slice(0, SHOW).map((i) => (
                <li key={i.id} className="flex justify-between gap-2"><span>{i.title}</span><span className="whitespace-nowrap text-xs text-gray-600">{fmtDate(i.due)}{i.owner ? ` · ${i.owner}` : ""}</span></li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-bold">EDI partners</h3>
          {b.partners.length === 0 ? <p className="text-sm text-gray-500">No EDI partners in the sheet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500"><tr><th className="py-1 pr-2">Partner</th><th className="py-1 pr-2">Next step</th><th className="py-1">Due</th></tr></thead>
              <tbody className="divide-y divide-line">
                {b.partners.map((x) => (
                  <tr key={x.id}>
                    <td className="py-1 pr-2 font-semibold"><Link href={`/projects/${p.id}/edi`}>{x.name}</Link></td>
                    <td className="py-1 pr-2 text-xs">{x.nextStep ?? "None in the sheet"}{x.owner ? ` · ${x.owner}` : ""}</td>
                    <td className={`whitespace-nowrap py-1 text-xs ${x.daysLate ? "font-semibold text-bad" : ""}`}>{fmtDate(x.nextStepDate)}{x.daysLate ? ` · ${late(x.daysLate)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
