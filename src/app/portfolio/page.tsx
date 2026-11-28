import Link from "next/link";
import { today } from "@/domain/calendar";
import { STAGE_LABEL, WORKSTREAM_LABEL } from "@/domain/template";
import { STAGES, WORKSTREAMS, type Color } from "@/domain/types";
import { loadRows } from "@/server/load";
import { Cell, ColorBadge, Empty, ProjectLink, Trend, fmtDate } from "@/components/ui";
import { one, type SP } from "@/components/flash";

export const dynamic = "force-dynamic";

export default async function Portfolio({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lane = one(sp.lane) ?? "delivery";
  const color = one(sp.color) as Color | undefined;
  const stage = one(sp.stage);
  const all = await loadRows(today());
  const rows = all.filter((r) =>
    (lane === "archived" ? r.snapshot.project.archived : !r.snapshot.project.archived && r.evaluation.lane === lane) &&
    (!color || r.color === color) && (!stage || r.snapshot.project.stage === stage));
  const wsShown = WORKSTREAMS.filter((k) => rows.some((r) => r.evaluation.workstreams.some((w) => w.key === k)));

  const sel = "rounded-md border border-line bg-white px-2 py-1 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Portfolio</h1>
      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">Lane
          <select name="lane" defaultValue={lane} className={sel}>
            <option value="delivery">In delivery</option>
            <option value="pre_discovery">Pre-discovery</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="grid gap-1">Color
          <select name="color" defaultValue={color ?? ""} className={sel}>
            <option value="">Any</option><option value="red">Red</option><option value="yellow">Yellow</option><option value="green">Green</option>
          </select>
        </label>
        <label className="grid gap-1">Stage
          <select name="stage" defaultValue={stage ?? ""} className={sel}>
            <option value="">Any</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white">Filter</button>
        <Link href="/portfolio" className="py-1.5 text-xs">Clear</Link>
      </form>

      {rows.length === 0 ? <Empty>No clients match.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-card text-left text-xs text-gray-600">
              <tr>
                <th className="p-2">Client</th><th className="p-2">Color</th><th className="p-2">Trend</th><th className="p-2">Stage</th>
                <th className="p-2">Next gate</th><th className="p-2">Go-live</th><th className="p-2">Slip</th><th className="p-2">Critical open</th>
                {wsShown.map((k) => <th key={k} className="p-2" title={WORKSTREAM_LABEL[k]}>{short(WORKSTREAM_LABEL[k])}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const p = r.snapshot.project;
                const e = r.evaluation;
                return (
                  <tr key={p.id} className="align-top">
                    <td className="p-2"><ProjectLink id={p.id} name={p.name} client={p.clientName} /></td>
                    <td className="p-2"><ColorBadge color={r.color} title={e.computed.reasons.join("\n")} /></td>
                    <td className="p-2"><Trend trend={r.trend} /></td>
                    <td className="p-2">{STAGE_LABEL[p.stage]}</td>
                    <td className="p-2">{e.nextGate ? <span className="flex items-center gap-1">{e.nextGate.gate.key} <ColorBadge color={e.nextGate.effective} small /></span> : "None"}</td>
                    <td className="p-2">{r.goLive ? <>{fmtDate(r.goLive.date)}<span className="block text-xs text-gray-500">{r.goLive.label}</span></> : "Not set"}</td>
                    <td className="p-2">{e.slipDays == null ? "" : e.slipDays > 0 ? `${e.slipDays} days` : "None"}</td>
                    <td className="p-2">{r.criticalOpen}</td>
                    {wsShown.map((k) => {
                      const w = e.workstreams.find((x) => x.key === k);
                      return <td key={k} className="p-1">{w ? <Cell color={w.effective} title={w.reasons.join("\n")} /> : <span className="block text-center text-xs text-gray-300">n/a</span>}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">Hover a color to see why. Counts by color, never averages.</p>
    </div>
  );
}

function short(s: string) {
  return s.length > 12 ? s.split(/[ ,&]+/)[0] : s;
}
