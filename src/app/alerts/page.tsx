import Link from "next/link";
import { today } from "@/domain/calendar";
import { buildAlerts, type AlertKind } from "@/domain/alerts";
import { loadRows } from "@/server/load";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND: Record<AlertKind, string> = {
  severity1: "Severity 1", escalation: "Escalation", overdue: "Overdue", blocked: "Blocked", gate_at_risk: "Gate at risk",
  test_failing: "Test failing", expiry: "Expiring", dates_moved: "Dates moved", due_soon: "Due soon",
};

export default async function Alerts() {
  const asOf = today();
  const rows = (await loadRows(asOf)).filter((r) => !r.snapshot.project.archived);
  const all = rows.flatMap((r) => buildAlerts(r.snapshot, r.evaluation, asOf).map((a) => ({ a, r })));
  const people = rows[0]?.snapshot.people;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Alerts</h1>
      <p className="text-sm text-gray-600">One alert per item per day, keeping only the most urgent reason. Severity 1 alerts go out straight away; the rest go in the daily summary.</p>
      {all.length === 0 ? <Empty>Nothing to flag today.</Empty> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {all.map(({ a, r }) => (
            <li key={a.key} className="grid gap-1 p-3 text-sm sm:grid-cols-[9rem_1fr_auto]">
              <span className={`self-start rounded px-1.5 text-xs font-semibold ${a.instant ? "bg-bad text-white" : "bg-card text-navy"}`}>{KIND[a.kind]}</span>
              <div>
                <Link href={`/projects/${a.projectId}`} className="font-semibold">{r.snapshot.project.clientName}</Link>: {a.title}
                <div className="text-xs text-gray-600">{a.detail}</div>
              </div>
              <span className="text-xs text-gray-500">To {a.recipientId ? people?.get(a.recipientId)?.name ?? "owner" : "no one named"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
