// One client's work as its tracking sheet has it: KPI tiles, a card per work
// stream, a stream-by-week heat map, the past-due list, EDI partners and what is due next.
// Status colors always come with a word or an icon, never color alone.

import Link from "next/link";
import type { SheetBoard, StreamSplit } from "@/domain/sheetboard";
import { StreamHeatMap } from "@/components/heatmaps";
import { STAGE_LABEL } from "@/domain/template";
import { ColorBadge, Reasons, fmtDate } from "@/components/ui";

const SHOW = 10;

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const wd = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

// ---------- Icons (decorative, always beside a word) ----------

const I = {
  alert: "M12 3 2 21h20L12 3Zm0 6v5m0 3v.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  nodate: "M4 5h16v15H4zM4 10h16M9 3v4m6-4v4M9 14l6 4m0-4-6 4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};
function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// ---------- KPI tile ----------

function Kpi({ label, value, sub, icon, tone, href }: { label: string; value: React.ReactNode; sub?: string; icon: string; tone: "critical" | "warning" | "neutral" | "good"; href?: string }) {
  const accent = { critical: "var(--color-st-critical)", warning: "var(--color-st-warning)", good: "var(--color-st-good)", neutral: "var(--color-navy)" }[tone];
  const numberColor = tone === "critical" ? "text-bad" : tone === "warning" ? "text-warn" : "text-navy";
  return (
    <TileShell href={href}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</span>
        <span style={{ color: accent }}><Icon d={icon} /></span>
      </div>
      <div className={`mt-1 font-serif text-4xl font-bold leading-none ${numberColor}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-600">{sub}{href ? <span className="float-right font-semibold text-navy">Details</span> : null}</div>}
    </TileShell>
  );
}

function TileShell({ href, children }: { href?: string; children: React.ReactNode }) {
  const cls = "relative block overflow-hidden rounded-xl border border-line bg-white px-4 py-3 shadow-sm";
  if (!href) return <div className={cls}>{children}</div>;
  return <Link href={href} className={`${cls} text-inherit no-underline transition hover:border-navy/40 hover:shadow-md active:scale-[0.99]`}>{children}</Link>;
}

// ---------- One card per business work stream ----------

function StreamCard({ s, href }: { s: StreamSplit; href: string }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const tone = s.pastDue ? "var(--color-st-critical)" : s.dueSoon ? "var(--color-st-warning)" : s.open ? "var(--color-navy)" : "var(--color-st-good)";
  return (
    <TileShell href={href}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: tone }} />
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{s.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-serif text-3xl font-bold leading-none text-navy">{s.open}</span>
        <span className="text-xs text-gray-600">open</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {s.pastDue > 0 ? <span className="flex items-center gap-1 font-semibold text-bad"><Icon d={I.alert} className="h-3.5 w-3.5" />{s.pastDue} past due</span> : <span className="text-gray-500">None past due</span>}
        {s.dueSoon > 0 && <span className="flex items-center gap-1 font-semibold text-warn"><Icon d={I.clock} className="h-3.5 w-3.5" />{s.dueSoon} due soon</span>}
        {s.noDate > 0 && <span className="text-gray-600">{s.noDate} undated</span>}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card" role="img" aria-label={`${s.done} of ${s.total} done`}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-series-1)" }} />
      </div>
      <div className="mt-1 text-[11px] text-gray-600">{s.total ? `${s.done} of ${s.total} done` : "Nothing in the sheet yet"}<span className="float-right font-semibold text-navy">Details</span></div>
    </TileShell>
  );
}

// ---------- The board ----------

export function SheetBoardCard({ b }: { b: SheetBoard }) {
  const p = b.row.snapshot.project;
  const c = b.counts;
  const read = b.sources.map((s) => s.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
  const pct = b.total ? Math.round((c.done / b.total) * 100) : 0;
  const maxLate = Math.max(1, ...b.pastDue.map((i) => i.daysLate));

  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-navy px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/projects/${p.id}`} className="font-serif text-2xl font-bold text-white no-underline hover:underline">{p.clientName}</Link>
              <ColorBadge color={b.row.color} />
            </div>
            <p className="mt-1 text-sm text-white/80">
              {STAGE_LABEL[p.stage]} · target go-live {fmtDate(p.committedDate ?? p.targetWindowEnd)} · sheet last read {fmtTime(read)}
              {!read && <> · <Link href="/settings/sheets" className="text-gold">press Sync now on Sheets</Link></>}
            </p>
          </div>
          <div className="min-w-56">
            <div className="flex justify-between gap-3 text-xs text-white/80"><span>Done</span><span>{c.done} of {b.total} ({pct}%)</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/20" role="img" aria-label={`${pct}% of items done`}>
              <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Open" value={c.open} sub={`of ${b.total} items`} icon={I.list} tone="neutral" href={`/projects/${p.id}/board?view=open`} />
        <Kpi label="Past due" value={c.pastDue} sub={c.open ? `${Math.round((c.pastDue / c.open) * 100)}% of open work` : undefined} icon={I.alert} tone={c.pastDue ? "critical" : "good"} href={`/projects/${p.id}/board?view=pastdue`} />
        <Kpi label="Due in 2 weeks" value={c.dueSoon} sub="next 14 days" icon={I.clock} tone={c.dueSoon ? "warning" : "neutral"} href={`/projects/${p.id}/board?view=soon`} />
        <Kpi label="No due date" value={c.noDate} sub="open, undated" icon={I.nodate} tone="neutral" href={`/projects/${p.id}/board?view=nodate`} />
        <Kpi label="EDI partners late" value={`${c.partnersPastDue}/${c.partners}`} sub="past their next step" icon={I.link} tone={c.partnersPastDue ? "critical" : "good"} href={`/projects/${p.id}/board?view=partners`} />
      </div>

      <div className="rounded-xl border border-line bg-white px-5 py-3 shadow-sm">
        <Reasons reasons={b.row.evaluation.computed.reasons} max={3} />
        {b.noOwners && <p className="mt-2 text-xs text-gray-600">The sheet names no owners, so none show here. Add an Owner column to the sheet and map it as &quot;owner&quot; to see who has each item.</p>}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-base font-bold">Open work by work stream</h3>
          <Link href={`/projects/${p.id}/board?view=open`} className="text-xs">Every open item, by stream</Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {b.byStream.map((s) => <StreamCard key={s.key} s={s} href={`/projects/${p.id}/board?view=open&stream=${s.key}`} />)}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold">When each stream&apos;s work is due</h3>
        <p className="mb-3 text-xs text-gray-600">Open items by work stream and the week they were or are due. Darker means more. Older weeks fold into the first column.</p>
        <StreamHeatMap heat={b.heat} hrefFor={(stream, week) => `/projects/${p.id}/board?view=open&stream=${stream}${week ? `&week=${week}` : ""}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-base font-bold">Past due, most overdue first</h3>
            <Link href={`/projects/${p.id}`} className="text-xs">Every item</Link>
          </div>
          {b.pastDue.length === 0 ? <p className="text-sm text-gray-500">Nothing past due.</p> : (
            <ul className="divide-y divide-line">
              {b.pastDue.slice(0, SHOW).map((i) => (
                <li key={i.id} className="grid grid-cols-[1fr_9rem] items-center gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm">{i.title}{i.blocked && <span className="ml-1 text-xs font-semibold text-bad">Blocked</span>}</div>
                    <div className="text-xs text-gray-500">{i.tab} · due {fmtDate(i.due)} · {i.owner ?? "no owner named"}</div>
                  </div>
                  <div title={`${wd(i.daysLate)} late`}>
                    <div className="h-2 rounded-r" style={{ width: `${Math.max(6, (i.daysLate / maxLate) * 100)}%`, background: "var(--color-st-critical)" }} />
                    <div className="mt-0.5 text-xs font-semibold text-bad">{wd(i.daysLate)} late</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {b.pastDue.length > SHOW && <Link href={`/projects/${p.id}`} className="mt-2 block text-xs">And {b.pastDue.length - SHOW} more past due</Link>}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-bold">EDI partners</h3><Link href={`/projects/${p.id}/board?view=partners`} className="text-xs">Partner details</Link></div>
            {b.partners.length === 0 ? <p className="text-sm text-gray-500">No EDI partners in the sheet.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {b.partners.map((x) => {
                  const late = x.daysLate > 0;
                  const tone = late ? "border-bad/30 bg-bad-bg text-bad" : x.nextStepDate ? "border-ok/30 bg-ok-bg text-ok" : "border-line bg-card text-gray-600";
                  return (
                    <li key={x.id} className="rounded-lg border border-line px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/projects/${p.id}/edi`} className="text-sm font-semibold">{x.name}</Link>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
                          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                          {late ? `${x.daysLate}d late` : x.nextStepDate ? "On track" : "No date"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-gray-600">{x.nextStep ?? "No next step in the sheet"}{x.nextStepDate ? ` · ${fmtDate(x.nextStepDate)}` : ""}{x.owner ? ` · ${x.owner}` : ""}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-bold">Due in the next 2 weeks</h3>
            {b.dueSoon.length === 0 ? <p className="text-sm text-gray-500">Nothing due in the next two weeks.</p> : (
              <ul className="space-y-2">
                {b.dueSoon.slice(0, SHOW).map((i) => (
                  <li key={i.id} className="flex items-start gap-3">
                    <span className="w-14 shrink-0 rounded-md bg-warn-bg px-1.5 py-1 text-center text-xs font-semibold text-warn">{short(i.due!)}</span>
                    <span className="text-sm">{i.title}{i.owner ? <span className="block text-xs text-gray-500">{i.owner}</span> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
