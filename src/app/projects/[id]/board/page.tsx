// The detail behind each KPI tile on the dashboard: every open item, past-due
// item, item due soon, undated item, or every EDI partner, as a full list.
// Read only; partners are edited on the EDI page.

import Link from "next/link";
import { notFound } from "next/navigation";
import { today } from "@/domain/calendar";
import { buildSheetBoards, type SheetItem, type SheetPartner } from "@/domain/sheetboard";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { loadRow } from "@/server/load";
import { fmtDate } from "@/components/ui";
import { one, type SP } from "@/components/flash";

export const dynamic = "force-dynamic";

const VIEWS = {
  open: "Open",
  pastdue: "Past due",
  soon: "Due in 2 weeks",
  nodate: "No due date",
  partners: "EDI partners",
} as const;
type View = keyof typeof VIEWS;

const PFILTERS = { all: "All", late: "Late", customer: "Customers", supplier: "Suppliers" } as const;
type PFilter = keyof typeof PFILTERS;

const wd = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

function LateBadge({ daysLate, due }: { daysLate: number; due: string | null }) {
  const late = daysLate > 0;
  const tone = late ? "border-bad/30 bg-bad-bg text-bad" : due ? "border-ok/30 bg-ok-bg text-ok" : "border-line bg-card text-gray-600";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {late ? `${daysLate}d late` : due ? "On time" : "No date"}
    </span>
  );
}

const SET_TONE = { passed: "border-ok/30 bg-ok-bg text-ok", failed: "border-bad/30 bg-bad-bg text-bad", not_run: "border-line bg-card text-gray-600" } as const;
const SET_WORD = { passed: "passed", failed: "failed", not_run: "not tested" } as const;

function Sets({ sets }: { sets: SheetPartner["sets"] }) {
  if (sets.length === 0) return <span className="text-gray-400">None yet</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {sets.map((x) => (
        <span key={x.label} title={`${x.label}: ${SET_WORD[x.testStatus]}${x.live ? ", live" : ""}`} className={`whitespace-nowrap rounded border px-1.5 text-[11px] ${SET_TONE[x.testStatus]}`}>
          {x.label}{x.live ? " · live" : ""}
        </span>
      ))}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "ok" }) {
  const c = tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : "text-navy";
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</div>
      <div className={`mt-1 font-serif text-3xl font-bold leading-none ${c}`}>{value}</div>
    </div>
  );
}

function PartnerView({ projectId, partners, filter }: { projectId: string; partners: SheetPartner[]; filter: PFilter }) {
  const late = partners.filter((x) => x.daysLate > 0);
  const onTime = partners.filter((x) => x.daysLate === 0 && x.nextStepDate);
  const undated = partners.filter((x) => !x.nextStepDate);
  const shown = partners.filter((x) => filter === "all" || (filter === "late" ? x.daysLate > 0 : x.type === filter));
  const base = `/projects/${projectId}/board?view=partners`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Partners" value={partners.length} />
        <Stat label="Late" value={late.length} tone={late.length ? "bad" : "ok"} />
        <Stat label="On time" value={onTime.length} tone="ok" />
        <Stat label="No next-step date" value={undated.length} />
      </div>

      <nav className="flex flex-wrap gap-2 text-xs" aria-label="Filter partners">
        {(Object.keys(PFILTERS) as PFilter[]).map((k) => {
          const n = k === "all" ? partners.length : k === "late" ? late.length : partners.filter((x) => x.type === k).length;
          const on = k === filter;
          return (
            <Link key={k} href={k === "all" ? base : `${base}&filter=${k}`} aria-current={on ? "page" : undefined}
              className={`rounded-full border px-3 py-1 font-semibold no-underline ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-navy/40"}`}>
              {PFILTERS[k]} · {n}
            </Link>
          );
        })}
      </nav>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        {shown.length === 0 ? <p className="p-5 text-sm text-gray-500">No partners match.</p> : (
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-3 py-2">Partner</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Next step</th>
                <th className="px-3 py-2">Due</th><th className="px-3 py-2">Days late</th><th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Last contact</th><th className="px-3 py-2">Transaction sets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((x) => (
                <tr key={x.id} className={x.daysLate > 0 ? "bg-bad-bg/30" : ""}>
                  <td className="px-3 py-2 align-top">
                    <Link href={`/projects/${projectId}/edi`} className="font-semibold">{x.name}</Link>
                    <div className="text-xs text-gray-600">{x.type === "supplier" ? "Supplier" : "Customer"}{x.method ? ` · ${x.method}` : ""}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div>{x.stage}. {x.stageLabel}</div>
                    {x.blocker && <div className="text-xs text-bad">Blocked: {x.blocker}</div>}
                  </td>
                  <td className="px-3 py-2 align-top">{x.nextStep ?? <span className="text-gray-400">None in the sheet</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{x.nextStepDate ? fmtDate(x.nextStepDate) : "—"}</td>
                  <td className="px-3 py-2 align-top"><LateBadge daysLate={x.daysLate} due={x.nextStepDate} />{x.daysLate > 0 && <div className="mt-0.5 text-[11px] text-gray-500">{wd(x.daysLate)}</div>}</td>
                  <td className="px-3 py-2 align-top">{x.owner ?? <span className="text-gray-400">None</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{x.lastContact ? fmtDate(x.lastContact) : "—"}</td>
                  <td className="px-3 py-2 align-top"><Sets sets={x.sets} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-500">Days late counts working days past the next-step date. Open a partner to change its stage, next step or tests.</p>
    </div>
  );
}

function ItemView({ projectId, view, items, tab }: { projectId: string; view: View; items: SheetItem[]; tab: string | null }) {
  const tabs = [...new Set(items.map((i) => i.tab))].sort();
  const shown = tab ? items.filter((i) => i.tab === tab) : items;
  const base = `/projects/${projectId}/board?view=${view}`;
  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-xs" aria-label="Filter by tab">
          {[null, ...tabs].map((k) => {
            const on = k === tab;
            const n = k ? items.filter((i) => i.tab === k).length : items.length;
            return (
              <Link key={k ?? "all"} href={k ? `${base}&tab=${encodeURIComponent(k)}` : base} aria-current={on ? "page" : undefined}
                className={`rounded-full border px-3 py-1 font-semibold no-underline ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-navy/40"}`}>
                {k ?? "All tabs"} · {n}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        {shown.length === 0 ? <p className="p-5 text-sm text-gray-500">Nothing here.</p> : (
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-gray-600">
              <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Tab</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Days late</th><th className="px-3 py-2">Owner</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((i) => (
                <tr key={i.id} className={i.daysLate > 0 ? "bg-bad-bg/30" : ""}>
                  <td className="px-3 py-2 align-top">{i.title}{i.blocked && <span className="ml-2 rounded bg-bad-bg px-1.5 text-[11px] font-semibold text-bad">Blocked</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top text-gray-600">{i.tab}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{i.due ? fmtDate(i.due) : "—"}</td>
                  <td className="px-3 py-2 align-top"><LateBadge daysLate={i.daysLate} due={i.due} /></td>
                  <td className="px-3 py-2 align-top">{i.owner ?? <span className="text-gray-400">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default async function BoardDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const asOf = today();
  const row = await loadRow(id, asOf);
  if (!row) notFound();
  const sources = (await (await getDb()).select().from(t.sheetSources)).filter((x) => x.projectId === id);
  const b = buildSheetBoards([row], sources, asOf)[0];
  const raw = one(sp.view);
  const view: View = raw && raw in VIEWS ? (raw as View) : "partners";
  const rawF = one(sp.filter);
  const filter: PFilter = rawF && rawF in PFILTERS ? (rawF as PFilter) : "all";
  const tab = one(sp.tab) ?? null;
  const client = row.snapshot.project.clientName;

  const lists: Record<Exclude<View, "partners">, SheetItem[]> | null = b ? {
    open: b.open,
    pastdue: b.pastDue,
    soon: b.dueSoon,
    nodate: b.open.filter((i) => !i.due),
  } : null;
  const count = (v: View) => (!b ? 0 : v === "partners" ? b.partners.length : lists![v].length);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-xs">Back to the dashboard</Link>
        <h1 className="text-2xl font-bold">{VIEWS[view]} · {client}</h1>
        <p className="text-sm text-gray-600">As of {fmtDate(asOf)}, from the client&apos;s tracking sheet.</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Detail views">
        {(Object.keys(VIEWS) as View[]).map((v) => {
          const on = v === view;
          return (
            <Link key={v} href={`/projects/${id}/board?view=${v}`} aria-current={on ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold no-underline ${on ? "border-navy text-navy" : "border-transparent text-gray-600 hover:text-navy"}`}>
              {VIEWS[v]} <span className="ml-1 rounded-full bg-card px-1.5 text-xs">{count(v)}</span>
            </Link>
          );
        })}
      </nav>

      {!b ? <p className="text-sm text-gray-500">This client has no tracking sheet yet. Add one on <Link href="/settings/sheets">Sheets</Link>.</p>
        : view === "partners" ? <PartnerView projectId={id} partners={b.partners} filter={filter} />
        : <ItemView projectId={id} view={view} items={lists![view]} tab={tab} />}
    </div>
  );
}
