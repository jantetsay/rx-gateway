import Link from "next/link";
import { today } from "@/domain/calendar";
import { buildLanding } from "@/domain/portfolio";
import { STAGE_LABEL } from "@/domain/template";
import { loadRows } from "@/server/load";
import { weeklyRefresh } from "./actions";
import { Card, ColorBadge, Empty, ProjectLink, Reasons, Stat, Trend, fmtDate } from "@/components/ui";
import { Flash, one, type SP } from "@/components/flash";
import { Submit } from "@/components/submit";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const asOf = today();
  const rows = await loadRows(asOf);
  const L = buildLanding(rows, asOf);
  const goLives = [...L.goLives.within30.map((r) => [r, "30"] as const), ...L.goLives.within60.map((r) => [r, "60"] as const), ...L.goLives.within90.map((r) => [r, "90"] as const)];

  return (
    <div className="space-y-6">
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Readiness dashboard</h1>
          <p className="text-sm text-gray-600">As of {fmtDate(asOf)}. Clients in delivery, worst first.</p>
        </div>
        <form action={weeklyRefresh}>
          <input type="hidden" name="back" value="/" />
          <Submit tone="quiet">Run weekly refresh</Submit>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Red" value={L.counts.red} tone="red" />
        <Stat label="Yellow" value={L.counts.yellow} tone="yellow" />
        <Stat label="Green" value={L.counts.green} tone="green" />
        <Stat label="In pre-discovery" value={L.pipelineCount} />
        <Stat label="Level 3 escalations" value={L.topEscalations.length} tone={L.topEscalations.length ? "red" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Needs attention" className="lg:col-span-2">
          {L.redYellow.length === 0 ? <Empty>Every client in delivery is green.</Empty> : (
            <ul className="divide-y divide-line">
              {L.redYellow.map((r) => (
                <li key={r.snapshot.project.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ColorBadge color={r.color} />
                      <ProjectLink id={r.snapshot.project.id} name={r.snapshot.project.name} client={r.snapshot.project.clientName} />
                    </div>
                    <div className="mt-1"><Reasons reasons={r.evaluation.computed.reasons} max={3} /></div>
                  </div>
                  <div className="text-right text-xs text-gray-600">
                    <div>{STAGE_LABEL[r.snapshot.project.stage]}</div>
                    <div>Next gate {r.evaluation.nextGate?.gate.key ?? "none"}</div>
                    <Trend trend={r.trend} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Level 3 escalations">
          {L.topEscalations.length === 0 ? <Empty>None open.</Empty> : (
            <ul className="space-y-3 text-sm">
              {L.topEscalations.slice(0, 8).map(({ row, escalation: e }) => (
                <li key={e.key}>
                  <Link href={`/projects/${row.snapshot.project.id}#escalations`} className="font-semibold">{row.snapshot.project.clientName}</Link>
                  <div>{e.title}</div>
                  <div className="text-xs text-gray-600">Decision: {e.decision}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Go-lives in the next 90 days">
          {goLives.length === 0 ? <Empty>None with a committed or target date.</Empty> : (
            <ul className="space-y-2 text-sm">
              {goLives.map(([r, band]) => (
                <li key={r.snapshot.project.id} className="flex items-center justify-between gap-2">
                  <Link href={`/projects/${r.snapshot.project.id}`}>{r.snapshot.project.clientName}</Link>
                  <span className="text-xs text-gray-600">{fmtDate(r.goLive?.date)} · {r.goLive?.label} · within {band} days</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Gates in the next five working days">
          {L.gatesThisWeek.length === 0 ? <Empty>None planned.</Empty> : (
            <ul className="space-y-2 text-sm">
              {L.gatesThisWeek.map((g) => (
                <li key={`${g.row.snapshot.project.id}-${g.gate}`} className="flex items-center justify-between gap-2">
                  <Link href={`/projects/${g.row.snapshot.project.id}#gates`}>{g.row.snapshot.project.clientName} · {g.gate}</Link>
                  <span className="text-xs text-gray-600">{fmtDate(g.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Hand changes and exceptions in force">
          {L.overridesInForce.length === 0 ? <Empty>None.</Empty> : (
            <ul className="space-y-2 text-sm">
              {L.overridesInForce.map((r) => (
                <li key={r.snapshot.project.id}>
                  <Link href={`/projects/${r.snapshot.project.id}`}>{r.snapshot.project.clientName}</Link>
                  <div className="text-xs text-gray-600">
                    {r.evaluation.overridesInForce.length} hand change(s), {r.evaluation.exceptionsInForce.length} approved exception(s)
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pre-discovery pipeline" action={<Link href="/portfolio?lane=pre_discovery" className="text-xs">See all</Link>}>
          {L.pipeline.length === 0 ? <Empty>No deals in pre-discovery.</Empty> : (
            <ul className="space-y-2 text-sm">
              {L.pipeline.map((r) => (
                <li key={r.snapshot.project.id} className="flex items-center justify-between gap-2">
                  <Link href={`/projects/${r.snapshot.project.id}`}>{r.snapshot.project.clientName}</Link>
                  <span className="flex items-center gap-2 text-xs text-gray-600">Target {fmtDate(r.snapshot.project.targetWindowEnd)} <ColorBadge color={r.color} small /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="No update in over a week">
          {L.stale.length === 0 ? <Empty>Every client was updated this week.</Empty> : (
            <ul className="space-y-2 text-sm">
              {L.stale.map((r) => (
                <li key={r.snapshot.project.id} className="flex justify-between gap-2">
                  <Link href={`/projects/${r.snapshot.project.id}`}>{r.snapshot.project.clientName}</Link>
                  <span className="text-xs text-gray-600">Last update {fmtDate(r.evaluation.lastUpdate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
