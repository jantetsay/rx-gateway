import Link from "next/link";
import { notFound } from "next/navigation";
import { today } from "@/domain/calendar";
import type { TaskEval } from "@/domain/evaluate";
import { GATE_BY_KEY, STAGE_LABEL, WORKSTREAM_LABEL } from "@/domain/template";
import type { ClientRole, Color, TaskStatus } from "@/domain/types";
import { getDb } from "@/db/client";
import * as repo from "@/db/repo";
import { loadRow } from "@/server/load";
import { acknowledge, addOverride, nameClientRole, nameSigner, setTaskOwner, setTaskStatus, sign, sitGate } from "@/app/actions";
import { Card, Cell, ColorBadge, Empty, Reasons, Stat, Trend, fmtDate } from "@/components/ui";
import { Flash, one, type SP } from "@/components/flash";
import { Submit } from "@/components/submit";

export const dynamic = "force-dynamic";

const STATUS: [TaskStatus, string][] = [["not_started", "Not started"], ["in_progress", "In progress"], ["blocked", "Blocked"], ["done", "Done"]];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const asOf = today();
  const row = await loadRow(id, asOf);
  if (!row) notFound();
  const db = await getDb();
  const ackMap = await repo.acks(db);
  const s = row.snapshot;
  const e = row.evaluation;
  const p = s.project;
  const back = `/projects/${id}`;
  const showAll = one(sp.show) === "all";
  const people = [...s.people.values()].sort((a, b) => a.name.localeCompare(b.name));
  const person = (pid: string | null) => (pid ? s.people.get(pid)?.name ?? "Unknown" : null);
  const items = [...e.tasks.values()].filter((t) => t.task.kind !== "milestone");
  const openItems = items.filter((t) => t.task.status !== "done");

  return (
    <div className="space-y-6">
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">{STAGE_LABEL[p.stage]}{p.archived ? " · Archived" : ""}</p>
          <h1 className="text-2xl font-bold">{p.clientName}</h1>
          <p className="text-sm text-gray-600">{p.name} · {p.segment}{p.tier ? ` · Data tier ${p.tier}` : ""} · Manager: {person(p.pmId) ?? "not named"}</p>
        </div>
        <div className="flex items-center gap-3">
          <ColorBadge color={e.effective} />
          <Trend trend={row.trend} />
          {s.ediPartners.length > 0 && <Link href={`${back}/edi`} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold no-underline">EDI partners</Link>}
        </div>
      </div>

      <Card title="Summary">
        <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <div>
            <Reasons reasons={e.computed.reasons} max={8} />
            {e.override && (
              <p className="mt-2 rounded border border-warn/40 bg-warn-bg px-2 py-1 text-xs text-warn">
                Hand change to {e.override.color}: {e.override.reason}. Computed color is {e.computed.color}. Lapses {fmtDate(e.override.lapsesAt)}.
              </p>
            )}
            <OverrideForm projectId={id} scope="project" target={id} back={back} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Target window ends" value={<span className="text-lg">{fmtDate(p.targetWindowEnd)}</span>} />
            <Stat label="No earlier than (set at G5)" value={<span className="text-lg">{fmtDate(p.notEarlierThan)}</span>} />
            <Stat label="Committed (set at G7a)" value={<span className="text-lg">{fmtDate(p.committedDate)}</span>} />
            <Stat label="Forecast go-live" value={<span className="text-lg">{fmtDate(e.forecastGoLive)}</span>} tone={e.slipDays && e.slipDays > 0 ? "red" : undefined} />
            <Stat label="Slip in working days" value={e.slipDays ?? "n/a"} tone={e.slipDays && e.slipDays > 0 ? "red" : undefined} />
            <Stat label="Open items" value={openItems.length} />
          </div>
        </div>
      </Card>

      <Card title="Heat map: workstreams by gate">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="p-1">Workstream</th><th className="p-1">Now</th>
                {e.gates.map((g) => <th key={g.gate.key} className="p-1 text-center" title={g.name}>{g.gate.key}</th>)}
                <th className="p-1">Done</th><th className="p-1">Overdue</th><th className="p-1">Blocked</th><th className="p-1">No owner</th>
              </tr>
            </thead>
            <tbody>
              {e.workstreams.map((w) => (
                <tr key={w.key}>
                  <td className="p-1 font-semibold">{w.label}<span className="block font-normal text-gray-500">{person(w.ownerId) ?? "No owner"}</span></td>
                  <td className="p-1"><Cell color={w.effective} title={w.reasons.join("\n")} /></td>
                  {e.gates.map((g) => {
                    const f = g.feeding.find((x) => x.key === w.key);
                    return <td key={g.gate.key} className="p-1">{f ? <Cell color={f.color}>{g.gate.result === "passed" ? "Passed" : undefined}</Cell> : <span className="block text-center text-gray-300">·</span>}</td>;
                  })}
                  <td className="p-1">{w.pctDone}%</td>
                  <td className="p-1">{w.overdue}</td>
                  <td className="p-1">{w.blockers}</td>
                  <td className="p-1">{w.missingOwners}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">Each cell is that workstream's items due by that gate. Hover the Now color for the reasons.</p>
      </Card>

      <Card title="Gates" className="scroll-mt-4">
        <div id="gates" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {e.gates.map((g) => {
            const def = GATE_BY_KEY[g.gate.key];
            const isNext = e.nextGate?.gate.id === g.gate.id;
            return (
              <div key={g.gate.id} className={`rounded-md border p-3 ${isNext ? "border-navy" : "border-line"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-serif font-bold text-navy">{g.gate.key} {g.name}</div>
                  {g.gate.result === "passed" ? <span className="text-xs font-semibold text-ok">Passed {fmtDate(g.gate.satDate)}</span>
                    : g.gate.result === "failed" ? <span className="text-xs font-semibold text-bad">Failed {fmtDate(g.gate.satDate)}</span>
                    : <ColorBadge color={g.effective} small />}
                </div>
                <div className="text-xs text-gray-600">Planned {fmtDate(g.gate.plannedDate)}{def?.owner ? ` · Owner: ${def.owner}` : ""}</div>
                {def?.criteria && <div className="mt-1 text-xs text-gray-500">{def.criteria}</div>}
                {g.gate.result === "pending" && <div className="mt-1"><Reasons reasons={g.reasons} max={3} /></div>}
                <ul className="mt-2 space-y-1 text-xs">
                  {[...g.gate.signers].sort((a, b) => (def?.signers.indexOf(a.roleLabel) ?? 0) - (def?.signers.indexOf(b.roleLabel) ?? 0)).map((sg) => (
                    <li key={sg.id} className="flex flex-wrap items-center justify-between gap-1">
                      <span>{sg.roleLabel}: {sg.personName ?? <em className="text-bad">not named</em>}</span>
                      {g.gate.result === "pending" && (sg.signedAt ? <span className="text-ok">Signed</span> : sg.personName ? (
                        <form action={sign}><input type="hidden" name="signerId" value={sg.id} /><input type="hidden" name="back" value={`${back}#gates`} /><Submit small tone="quiet">Record signature</Submit></form>
                      ) : (
                        <form action={nameSigner} className="flex gap-1">
                          <input type="hidden" name="signerId" value={sg.id} /><input type="hidden" name="back" value={`${back}#gates`} />
                          <input name="personName" placeholder="Name" className="w-24 rounded border border-line px-1" required />
                          <Submit small tone="quiet">Name</Submit>
                        </form>
                      ))}
                    </li>
                  ))}
                </ul>
                {isNext && g.gate.result === "pending" && (
                  <form action={sitGate} className="mt-3 grid gap-2 border-t border-line pt-2 text-xs">
                    <input type="hidden" name="gateId" value={g.gate.id} /><input type="hidden" name="back" value={`${back}#gates`} />
                    {g.gate.key === "G5" && <label className="grid gap-1">No-earlier-than date<input type="date" name="notEarlierThan" className="rounded border border-line px-1" /></label>}
                    {g.gate.key === "G7a" && <label className="grid gap-1">Committed go-live date<input type="date" name="committedDate" className="rounded border border-line px-1" /></label>}
                    <div className="flex gap-2">
                      <select name="result" className="rounded border border-line px-1"><option value="passed">Passed</option><option value="failed">Failed</option></select>
                      <Submit small>Record sitting</Submit>
                    </div>
                  </form>
                )}
                {g.gate.result === "pending" && <OverrideForm projectId={id} scope="gate" target={g.gate.id} back={`${back}#gates`} compact />}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Escalations">
          <div id="escalations" />
          {e.escalations.length === 0 ? <Empty>None.</Empty> : (
            <ul className="space-y-3 text-sm">
              {e.escalations.map((x) => {
                const ack = ackMap.get(x.key);
                return (
                  <li key={x.key} className="rounded border border-line p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className={`mr-2 rounded px-1.5 text-xs font-bold ${x.level === 3 ? "bg-bad text-white" : x.level === 2 ? "bg-warn-bg text-warn" : "bg-card text-navy"}`}>Level {x.level}</span>
                        {x.title}
                      </div>
                      {ack ? <span className="text-xs text-gray-500">Acknowledged</span> : (
                        <form action={acknowledge}><input type="hidden" name="key" value={x.key} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="back" value={`${back}#escalations`} /><Submit small tone="quiet">Acknowledge</Submit></form>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      {x.daysLate ? `${x.daysLate} working days late. ` : ""}Decision: {x.decision}. Tell: {x.notify}.
                      {x.blocks.length > 0 && ` Holds: ${x.blocks.join(", ")}.`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Client roles">
          <ul className="space-y-2 text-sm">
            {(s.clientRoles as (ClientRole & { id: string })[]).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{r.roleLabel}: {r.personName ?? <em className="text-bad">not named</em>}</span>
                <form action={nameClientRole} className="flex gap-1">
                  <input type="hidden" name="roleId" value={r.id} /><input type="hidden" name="back" value={back} />
                  <input name="personName" defaultValue={r.personName ?? ""} placeholder="Name" className="w-32 rounded border border-line px-1 text-xs" />
                  <Submit small tone="quiet">Save</Submit>
                </form>
              </li>
            ))}
          </ul>
          {(s.connections.length > 0 || s.issues.some((i) => !i.closedAt)) && (
            <div className="mt-4 grid gap-3 border-t border-line pt-3 text-xs">
              {s.connections.length > 0 && (
                <div><div className="font-semibold">DSCSA connections</div>
                  <ul>{s.connections.map((c) => <li key={c.id}>{c.partnerName}: {c.status}{c.neededDayOne ? " · needed day one" : ""}</li>)}</ul></div>
              )}
              {s.issues.some((i) => !i.closedAt) && (
                <div><div className="font-semibold">Open issues</div>
                  <ul>{s.issues.filter((i) => !i.closedAt).map((i) => <li key={i.id}>Severity {i.severity}{i.compliance ? ", compliance" : ""}: {i.title}</li>)}</ul></div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="Work items" action={<Link href={showAll ? back : `${back}?show=all`} className="text-xs">{showAll ? "Hide done" : "Show done"}</Link>}>
        {e.workstreams.map((w) => {
          const list = items.filter((t) => t.task.workstream === w.key && (showAll || t.task.status !== "done"));
          if (!list.length) return null;
          return (
            <div key={w.key} className="mb-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">{WORKSTREAM_LABEL[w.key]} <ColorBadge color={w.effective} small /></h3>
              <ul className="divide-y divide-line rounded border border-line">
                {list.sort(byDue).map((t) => <ItemRow key={t.task.id} t={t} back={back} people={people} ownerName={person(t.task.ownerId)} projectId={id} />)}
              </ul>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function byDue(a: TaskEval, b: TaskEval) {
  return (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999");
}

function ItemRow({ t, back, people, ownerName, projectId }: { t: TaskEval; back: string; people: { id: string; name: string }[]; ownerName: string | null; projectId: string }) {
  const k = t.task;
  const fromSheet = k.source === "sheet";
  return (
    <li className="grid gap-2 p-2 text-sm md:grid-cols-[auto_1fr_auto]">
      <div className="pt-0.5">{k.status === "done" ? <span className="text-xs font-semibold text-ok">Done</span> : <ColorBadge color={t.color} small />}</div>
      <div>
        <div className="font-semibold">
          {k.title}
          {k.critical && <span className="ml-2 rounded bg-navy px-1 text-[10px] font-bold text-white">CRITICAL</span>}
          {k.compliance && <span className="ml-1 rounded bg-bad px-1 text-[10px] font-bold text-white">COMPLIANCE</span>}
          {fromSheet && <span className="ml-1 rounded bg-card px-1 text-[10px] text-gray-600">from sheet</span>}
        </div>
        <div className="text-xs text-gray-600">
          {k.gateKey ? `By ${k.gateKey} · ` : ""}Due {fmtDate(k.dueDate)}{t.forecastFinish && t.forecastFinish !== k.dueDate && k.status !== "done" ? ` · forecast ${fmtDate(t.forecastFinish)}` : ""}
          {t.onCriticalPath ? " · on critical path" : ""} · Owner: {ownerName ?? "none"}
        </div>
        {k.status !== "done" && <Reasons reasons={t.reasons.filter((r) => r !== "On track")} max={3} />}
        {k.blockerNote && <div className="text-xs text-bad">Blocker: {k.blockerNote}{k.blockerPlanDate ? ` (plan ${fmtDate(k.blockerPlanDate)})` : ""}</div>}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {!fromSheet && (
          <form action={setTaskStatus} className="flex gap-1">
            <input type="hidden" name="taskId" value={k.id} /><input type="hidden" name="back" value={back} />
            <select name="status" defaultValue={k.status} className="rounded border border-line px-1 text-xs">
              {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Submit small tone="quiet">Set</Submit>
          </form>
        )}
        <form action={setTaskOwner} className="flex gap-1">
          <input type="hidden" name="taskId" value={k.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="projectId" value={projectId} />
          <select name="ownerId" defaultValue={k.ownerId ?? ""} className="max-w-32 rounded border border-line px-1 text-xs">
            <option value="">No owner</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Submit small tone="quiet">Assign</Submit>
        </form>
      </div>
    </li>
  );
}

function OverrideForm({ projectId, scope, target, back, compact }: { projectId: string; scope: "project" | "gate"; target: string; back: string; compact?: boolean }) {
  return (
    <details className={compact ? "mt-2 text-xs" : "mt-3 text-sm"}>
      <summary className="cursor-pointer text-gray-600">Hand change</summary>
      <form action={addOverride} className="mt-2 grid gap-2">
        <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="target" value={target} /><input type="hidden" name="back" value={back} />
        <select name="color" className="rounded border border-line px-1" defaultValue="yellow">
          {(["green", "yellow", "red"] as Color[]).map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
        </select>
        <textarea name="reason" required minLength={5} placeholder="Why the computed color is wrong this week" className="rounded border border-line p-1" rows={2} />
        <div><Submit small>Record hand change</Submit></div>
        <p className="text-gray-500">Lapses next Monday. The reason and who set it go in the audit log.</p>
      </form>
    </details>
  );
}
