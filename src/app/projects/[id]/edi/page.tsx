import Link from "next/link";
import { notFound } from "next/navigation";
import { today } from "@/domain/calendar";
import { EDI_STAGES, FALLBACK_STAGE, partnerGate } from "@/domain/edi";
import { loadRow } from "@/server/load";
import { movePartner, resolveGap, setPartnerFields, setTest } from "@/app/actions";
import { Card, ColorBadge, Empty, Reasons, fmtDate } from "@/components/ui";
import { Flash, one, type SP } from "@/components/flash";
import { Submit } from "@/components/submit";

export const dynamic = "force-dynamic";

const TEST_STYLE = { passed: "bg-ok-bg text-ok", failed: "bg-bad-bg text-bad", not_run: "bg-card text-gray-600" } as const;
const TEST_LABEL = { passed: "Passed", failed: "Failed", not_run: "Not run" } as const;

export default async function EdiPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const row = await loadRow(id, today());
  if (!row) notFound();
  const s = row.snapshot;
  const e = row.evaluation;
  const back = `/projects/${id}/edi`;
  const people = [...s.people.values()].sort((a, b) => a.name.localeCompare(b.name));
  const name = (pid: string | null) => (pid ? s.people.get(pid)?.name ?? "Unknown" : null);
  // When the sheet marks partners in scope, show those first; "show all" brings back the rest.
  const scoped = e.partners.some((pe) => pe.partner.inPhaseOne === "yes");
  const showAll = !scoped || one(sp.scope) === "all";
  const shown = showAll ? e.partners : e.partners.filter((pe) => pe.partner.inPhaseOne === "yes");
  const shownIds = new Set(shown.map((pe) => pe.partner.id));
  const byStage = EDI_STAGES.map((label, i) => ({ stage: i + 1, label, count: s.ediPartners.filter((p) => p.stage === i + 1 && shownIds.has(p.id)).length }));

  return (
    <div className="space-y-6">
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <div>
        <Link href={`/projects/${id}`} className="text-xs">Back to {s.project.clientName}</Link>
        <h1 className="text-2xl font-bold">EDI partners · {s.project.clientName}</h1>
        <p className="text-sm text-gray-600">Partners below stage 5 hold G5; below stage 6 hold G6. Stage 6 needs every set passed and a bad file rejected; stage 8 needs compliance cleared.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
        {byStage.map((b) => (
          <div key={b.stage} className={`rounded border px-2 py-2 text-center ${b.stage === FALLBACK_STAGE ? "border-warn/40 bg-warn-bg" : "border-line bg-card"}`}>
            <div className="font-serif text-xl font-bold text-navy">{b.count}</div>
            <div className="text-[11px] leading-tight text-gray-600">{b.stage}. {b.label}</div>
          </div>
        ))}
      </div>

      {scoped && (
        <p className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
          {showAll
            ? <>Showing all {e.partners.length} partners. <Link href={back} className="font-semibold">Show only the {e.partners.filter((pe) => pe.partner.inPhaseOne === "yes").length} in scope</Link></>
            : <>Showing the {shown.length} partners marked in scope, out of {e.partners.length}. <Link href={`${back}?scope=all`} className="font-semibold">Show all {e.partners.length}</Link></>}
        </p>
      )}

      {shown.length === 0 ? <Empty>No EDI partners on this client.</Empty> : shown.map((pe) => {
        const p = pe.partner;
        const gate = partnerGate(p);
        return (
          <Card key={p.id} title={p.name} action={<span className="flex items-center gap-2 text-xs text-gray-600">{gate ? `Holds ${gate}` : ""}<ColorBadge color={pe.color} /></span>}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-2 text-sm">
                <div className="text-xs text-gray-600">
                  {p.type === "supplier" ? "Supplier" : "Customer"} · {p.method ?? "Method not set"} · Phase one: {p.inPhaseOne} · Owner: {name(p.ownerId) ?? "none"}
                  {p.dateTold ? ` · Told go-live ${fmtDate(p.dateTold)}` : ""}
                </div>
                <div className="font-semibold">Stage {p.stage}: {EDI_STAGES[p.stage - 1]}</div>
                <Reasons reasons={[...pe.reasons, ...pe.flags].filter((r, i, a) => a.indexOf(r) === i && r !== "On track")} max={6} />
                <form action={movePartner} className="flex flex-wrap gap-1 text-xs">
                  <input type="hidden" name="partnerId" value={p.id} /><input type="hidden" name="back" value={back} />
                  <select name="stage" defaultValue={p.stage} className="rounded border border-line px-1">
                    {EDI_STAGES.map((l, i) => <option key={l} value={i + 1}>{i + 1}. {l}</option>)}
                  </select>
                  <Submit small tone="quiet">Move</Submit>
                </form>
                <form action={setPartnerFields} className="grid grid-cols-2 gap-2 rounded border border-line p-2 text-xs">
                  <input type="hidden" name="partnerId" value={p.id} /><input type="hidden" name="back" value={back} />
                  <label className="col-span-2 grid gap-1">Next step<input name="nextStep" defaultValue={p.nextStep ?? ""} className="rounded border border-line px-1" /></label>
                  <label className="grid gap-1">Next-step date<input type="date" name="nextStepDate" defaultValue={p.nextStepDate ?? ""} className="rounded border border-line px-1" /></label>
                  <label className="grid gap-1">Last contact<input type="date" name="lastContact" defaultValue={p.lastContact ?? ""} className="rounded border border-line px-1" /></label>
                  <label className="grid gap-1">Owner
                    <select name="ownerId" defaultValue={p.ownerId ?? ""} className="rounded border border-line px-1">
                      <option value="">No owner</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                  <div className="grid gap-1">
                    <label className="flex items-center gap-1"><input type="checkbox" name="badFileRejected" defaultChecked={p.badFileRejected} /> Bad file rejected</label>
                    <label className="flex items-center gap-1"><input type="checkbox" name="complianceCleared" defaultChecked={p.complianceCleared} /> Compliance cleared</label>
                  </div>
                  <div className="col-span-2"><Submit small>Save partner</Submit></div>
                </form>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-gray-600">Test matrix</div>
                  {p.tests.length === 0 ? <Empty>No transaction sets yet.</Empty> : (
                    <table className="w-full text-xs">
                      <thead className="text-left text-gray-600"><tr><th className="p-1">Set</th><th className="p-1">Direction</th><th className="p-1">Test</th><th className="p-1">Prod</th><th /></tr></thead>
                      <tbody className="divide-y divide-line">
                        {p.tests.map((t) => (
                          <tr key={t.id}>
                            <td className="p-1 font-semibold">{t.transaction}</td>
                            <td className="p-1">{t.direction}</td>
                            <td className="p-1"><span className={`rounded px-1.5 ${TEST_STYLE[t.testStatus]}`}>{TEST_LABEL[t.testStatus]}</span></td>
                            <td className="p-1">{t.prodStatus === "live" ? "Live" : "Not live"}</td>
                            <td className="p-1">
                              <form action={setTest} className="flex gap-1">
                                <input type="hidden" name="partnerId" value={p.id} /><input type="hidden" name="transaction" value={t.transaction} />
                                <input type="hidden" name="direction" value={t.direction} /><input type="hidden" name="back" value={back} />
                                <select name="testStatus" defaultValue={t.testStatus} className="rounded border border-line px-1">
                                  <option value="not_run">Not run</option><option value="passed">Passed</option><option value="failed">Failed</option>
                                </select>
                                <Submit small tone="quiet">Set</Submit>
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-gray-600">Spec gaps</div>
                  {p.gaps.length === 0 ? <Empty>None logged.</Empty> : (
                    <ul className="space-y-1 text-xs">
                      {p.gaps.map((g) => (
                        <li key={g.id} className="flex items-start justify-between gap-2">
                          <span className={g.resolved ? "text-gray-400 line-through" : ""}>{g.description} · {name(g.ownerId) ?? "no owner"} · {fmtDate(g.dueDate)}</span>
                          {!g.resolved && <form action={resolveGap}><input type="hidden" name="gapId" value={g.id} /><input type="hidden" name="back" value={back} /><Submit small tone="quiet">Resolve</Submit></form>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {p.oldProvider && <div className="text-xs">Old provider: {p.oldProvider} · exit plan {fmtDate(p.exitPlanDate)}</div>}
                {(p.certExpiry || p.licenseExpiry) && <div className="text-xs">Certificate expires {fmtDate(p.certExpiry)} · License expires {fmtDate(p.licenseExpiry)}</div>}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
