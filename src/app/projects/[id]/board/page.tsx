// The detail behind each KPI tile and work-stream card on the dashboard: every
// open, past-due, due-soon or undated item grouped by work stream, with the
// stream-by-week heat map; one work stream's items as a plain list; or every
// EDI partner with its transaction-set heat map.
// Read only; partners are edited on the EDI page.

import Link from "next/link";
import { notFound } from "next/navigation";
import { today } from "@/domain/calendar";
import { buildSheetBoards, type SheetBoard, type SheetItem, type SheetPartner } from "@/domain/sheetboard";
import { STREAMS, STREAM_LABEL, isStream, type StreamKey } from "@/domain/streams";
import { setGrid } from "@/domain/setlevels";
import { SetHeatMap, StreamHeatMap } from "@/components/heatmaps";
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

function PartnerView({ projectId, partners, filter, only }: { projectId: string; partners: SheetPartner[]; filter: PFilter; only: string | null }) {
  const late = partners.filter((x) => x.daysLate > 0);
  const onTime = partners.filter((x) => x.daysLate === 0 && x.nextStepDate);
  const undated = partners.filter((x) => !x.nextStepDate);
  const picked = only ? partners.find((x) => x.id === only) ?? null : null;
  const shown = picked ? [picked] : partners.filter((x) => filter === "all" || (filter === "late" ? x.daysLate > 0 : x.type === filter));
  const base = `/projects/${projectId}/board?view=partners`;
  const grid = setGrid(partners.filter((x) => filter === "all" || (filter === "late" ? x.daysLate > 0 : x.type === filter)));
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

      <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">Partners by transaction set</h2>
        <p className="mb-3 text-xs text-gray-600">Each row is a partner, each column a transaction set. Darker is further along, from not started to live. A red edge means the partner is past its next step. Click a row or cell for that partner.</p>
        <SetHeatMap grid={grid} hrefFor={(pid) => `${base}${filter !== "all" ? `&filter=${filter}` : ""}&partner=${pid}#partner-table`} />
      </div>

      {picked && (
        <p className="text-sm">Showing {picked.name} only. <Link href={`${base}${filter !== "all" ? `&filter=${filter}` : ""}#partner-table`}>Show every partner</Link></p>
      )}
      <div id="partner-table" className="scroll-mt-4 overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
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
                    {x.sheetStatus ? <><div className="font-semibold">{x.sheetStatus}</div><div className="text-xs text-gray-500">App stage {x.stage}. {x.stageLabel}</div></>
                      : <div>{x.stage}. {x.stageLabel}</div>}
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

function ItemTable({ items }: { items: SheetItem[] }) {
  return (
    <table className="w-full min-w-[40rem] text-sm">
      <thead className="bg-card text-left text-xs uppercase tracking-wide text-gray-600">
        <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Tab</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Days late</th><th className="px-3 py-2">Owner</th></tr>
      </thead>
      <tbody className="divide-y divide-line">
        {items.map((i) => (
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
  );
}

/** How a progress cell reads: yes, no, a date, or the sheet's own word (N/R, DEFER). Never color alone. */
function Step({ v }: { v: string | null }) {
  if (!v) return <span className="text-gray-300" aria-label="Not in the sheet">—</span>;
  const t = v.trim();
  if (/^(yes|y|true|done|x|✓|✔)$/i.test(t)) return <span className="inline-flex items-center gap-1 font-semibold text-ok"><span aria-hidden>✓</span>Yes</span>;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return <span className="inline-flex items-center gap-1 font-semibold text-ok"><span aria-hidden>✓</span>{fmtDate(t.slice(0, 10))}</span>;
  if (/^(no|n|false)$/i.test(t)) return <span className="text-gray-500">No</span>;
  return <span className="text-gray-700">{t}</span>;
}

const STEPS = [["built", "Built"], ["released", "Released"], ["demoed", "Demoed"], ["accepted", "Accepted"]] as const;

/** One work stream's items as a plain list: name, a short description, due date, then Built, Released, Demoed and Accepted. Soonest first. */
function StreamList({ projectId, view, items, stream, week, board }: { projectId: string; view: View; items: SheetItem[]; stream: StreamKey; week: string | null; board: SheetBoard }) {
  const base = `/projects/${projectId}/board?view=${view}`;
  const shown = items.filter((i) => i.stream === stream && (!week || i.week === week))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.name.localeCompare(b.name));
  const late = shown.filter((i) => i.daysLate > 0).length;
  const anyProgress = shown.some((i) => STEPS.some(([k]) => i.progress[k]));
  const weekLabel = week === "nodate" ? "with no due date" : week ? `due the week of ${fmtDate(week)}${board.heat.columns[0]?.key === week ? " or earlier" : ""}` : null;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {shown.length} {VIEWS[view].toLowerCase()} item{shown.length === 1 ? "" : "s"}{weekLabel ? ` ${weekLabel}` : ""}
        {late > 0 && <span className="ml-1 font-semibold text-bad">· {late} past due</span>}
        {weekLabel && <> · <Link href={`${base}&stream=${stream}`}>Show every week</Link></>}
        {" · "}<Link href={base}>All work streams</Link>
      </p>
      {shown.length === 0 ? <p className="rounded-xl border border-line bg-white p-5 text-sm text-gray-500 shadow-sm">Nothing here.</p> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-3 py-2">Due</th>
                {STEPS.map(([k, l]) => <th key={k} className="w-24 px-3 py-2">{l}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((i) => (
                <tr key={i.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{i.name}{i.blocked && <span className="ml-2 rounded bg-bad-bg px-1.5 text-[11px] font-semibold text-bad">Blocked</span>}</div>
                    {i.description && <p className="mt-0.5 text-sm text-gray-600">{i.description}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {i.due ? <div className="font-semibold">{fmtDate(i.due)}</div> : <span className="text-gray-400">No due date</span>}
                    {i.daysLate > 0 && <div className="text-xs font-semibold text-bad">Past due, {wd(i.daysLate)}</div>}
                  </td>
                  {STEPS.map(([k]) => <td key={k} className="whitespace-nowrap px-3 py-3"><Step v={i.progress[k]} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!anyProgress && shown.length > 0 && <p className="text-xs text-gray-500">The sheet has no Built, Released, Demoed or Accepted for these items yet. A dash means the sheet says nothing.</p>}
    </div>
  );
}

function ItemView({ projectId, view, items, stream, week, board }: { projectId: string; view: View; items: SheetItem[]; stream: StreamKey | null; week: string | null; board: SheetBoard }) {
  const base = `/projects/${projectId}/board?view=${view}`;
  const byWeek = week ? items.filter((i) => i.week === week) : items;
  const shown = stream ? byWeek.filter((i) => i.stream === stream) : byWeek;
  const groups = STREAMS.map((s) => ({ ...s, items: shown.filter((i) => i.stream === s.key) })).filter((g) => g.items.length);
  const weekLabel = week === "nodate" ? "no due date" : week ? `due the week of ${fmtDate(week)}${board.heat.columns[0]?.key === week ? " or earlier" : ""}` : null;
  return (
    <div className="space-y-4">
      {view === "open" && (
        <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">When each stream&apos;s work is due</h2>
          <p className="mb-3 text-xs text-gray-600">Darker means more open items. Click a cell to list just those items below.</p>
          <StreamHeatMap heat={board.heat} hrefFor={(st, w) => `${base}&stream=${st}${w ? `&week=${w}` : ""}#items`} />
        </div>
      )}

      <nav id="items" className="flex scroll-mt-4 flex-wrap gap-2 text-xs" aria-label="Filter by work stream">
        {[null, ...STREAMS.map((s) => s.key)].map((k) => {
          const n = k ? byWeek.filter((i) => i.stream === k).length : byWeek.length;
          if (k && !n && k !== stream) return null;
          const on = k === stream;
          return (
            <Link key={k ?? "all"} href={`${base}${k ? `&stream=${k}` : ""}${week ? `&week=${week}` : ""}#items`} aria-current={on ? "page" : undefined}
              className={`rounded-full border px-3 py-1 font-semibold no-underline ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-navy/40"}`}>
              {k ? STREAM_LABEL[k] : "All streams"} · {n}
            </Link>
          );
        })}
      </nav>
      {weekLabel && <p className="text-sm">Showing items {weekLabel}. <Link href={`${base}${stream ? `&stream=${stream}` : ""}#items`}>Show every week</Link></p>}

      {groups.length === 0 ? <p className="rounded-xl border border-line bg-white p-5 text-sm text-gray-500 shadow-sm">Nothing here.</p> : groups.map((g) => {
        const late = g.items.filter((i) => i.daysLate > 0).length;
        return (
          <section key={g.key} className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="text-base font-bold">{g.label}</h2>
              <span className="text-xs text-gray-600">{g.items.length} item{g.items.length === 1 ? "" : "s"}{late ? <span className="ml-2 font-semibold text-bad">{late} past due</span> : null}</span>
            </div>
            <ItemTable items={g.items} />
          </section>
        );
      })}
      <p className="text-xs text-gray-500">The sheet has no work-stream column, so each item&apos;s stream comes from its title: an AP or AR tag first, then the tab (Data Migration), then the code (T for Training, M and V for Go-live), then words like vendor, invoice, inventory or order. Anything that fits none is Unassigned.</p>
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
  const rawS = one(sp.stream);
  const stream: StreamKey | null = isStream(rawS) ? rawS : null;
  const week = one(sp.week) ?? null;
  const only = one(sp.partner) ?? null;
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
        <h1 className="text-2xl font-bold">{VIEWS[view]}{stream && view !== "partners" ? ` · ${STREAM_LABEL[stream]}` : ""} · {client}</h1>
        <p className="text-sm text-gray-600">As of {fmtDate(asOf)}, from the client&apos;s tracking sheet.</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Detail views">
        {(Object.keys(VIEWS) as View[]).map((v) => {
          const on = v === view;
          return (
            <Link key={v} href={`/projects/${id}/board?view=${v}${stream && v !== "partners" ? `&stream=${stream}` : ""}`} aria-current={on ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold no-underline ${on ? "border-navy text-navy" : "border-transparent text-gray-600 hover:text-navy"}`}>
              {VIEWS[v]} <span className="ml-1 rounded-full bg-card px-1.5 text-xs">{count(v)}</span>
            </Link>
          );
        })}
      </nav>

      {!b ? <p className="text-sm text-gray-500">This client has no tracking sheet yet. Add one on <Link href="/settings/sheets">Sheets</Link>.</p>
        : view === "partners" ? <PartnerView projectId={id} partners={b.partners} filter={filter} only={only} />
        : stream ? <StreamList projectId={id} view={view} items={lists![view]} stream={stream} week={week} board={b} />
        : <ItemView projectId={id} view={view} items={lists![view]} stream={stream} week={week} board={b} />}
    </div>
  );
}
