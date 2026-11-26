// Portfolio review and dashboard landing. Counts by color, never averages.

import { calendarDaysBetween, workingDaysBetween, type ISODate } from "./calendar";
import type { Escalation, ProjectEval } from "./evaluate";
import { COLOR_RANK, type Color, type GateKey, type ProjectSnapshot } from "./types";

export interface PortfolioRow {
  snapshot: ProjectSnapshot;
  evaluation: ProjectEval;
  color: Color;
  trend: "up" | "down" | "same" | null;
  previous: Color | null;
  goLive: { date: ISODate; label: "target" | "committed" | "forecast" } | null;
  criticalOpen: number;
}

export interface Landing {
  counts: Record<Color, number>;
  pipelineCount: number;
  redYellow: PortfolioRow[];
  goLives: { within30: PortfolioRow[]; within60: PortfolioRow[]; within90: PortfolioRow[] };
  gatesThisWeek: { row: PortfolioRow; gate: GateKey; date: ISODate }[];
  topEscalations: { row: PortfolioRow; escalation: Escalation }[];
  overridesInForce: PortfolioRow[];
  pipeline: PortfolioRow[];
  stale: PortfolioRow[];
}

export function buildRow(snapshot: ProjectSnapshot, evaluation: ProjectEval, previous: Color | null): PortfolioRow {
  const p = snapshot.project;
  const color = evaluation.effective;
  const trend = previous == null ? null : COLOR_RANK[color] > COLOR_RANK[previous] ? "down" : COLOR_RANK[color] < COLOR_RANK[previous] ? "up" : "same";
  const goLive = evaluation.reference?.label === "committed"
    ? { date: evaluation.reference.date, label: "committed" as const }
    : p.targetWindowEnd ? { date: p.targetWindowEnd, label: "target" as const }
    : evaluation.forecastGoLive ? { date: evaluation.forecastGoLive, label: "forecast" as const } : null;
  const criticalOpen = [...evaluation.tasks.values()].filter((e) => e.task.critical && e.task.status !== "done").length;
  return { snapshot, evaluation, color, trend, previous, goLive, criticalOpen };
}

/** Red first, then yellow, then green; ties by nearest go-live. */
export function sortRows(rows: PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort((a, b) =>
    COLOR_RANK[b.color] - COLOR_RANK[a.color] || (a.goLive?.date ?? "9999").localeCompare(b.goLive?.date ?? "9999"));
}

export function buildLanding(rows: PortfolioRow[], asOf: ISODate): Landing {
  const delivery = rows.filter((r) => r.evaluation.lane === "delivery" && !r.snapshot.project.archived);
  const pipeline = rows.filter((r) => r.evaluation.lane === "pre_discovery" && !r.snapshot.project.archived);
  const counts: Record<Color, number> = { green: 0, yellow: 0, red: 0 };
  for (const r of delivery) counts[r.color]++;
  const within = (days: number, from: number) => delivery.filter((r) => {
    if (!r.goLive || r.goLive.label === "forecast") return false;
    const d = calendarDaysBetween(asOf, r.goLive.date);
    return d >= from && d <= days;
  });
  const gatesThisWeek: Landing["gatesThisWeek"] = [];
  for (const r of rows) {
    for (const g of r.evaluation.gates) {
      const d = g.gate.plannedDate;
      if (g.gate.result === "pending" && d && d >= asOf && workingDaysBetween(asOf, d) <= 5) gatesThisWeek.push({ row: r, gate: g.gate.key, date: d });
    }
  }
  const topEscalations = delivery.flatMap((row) => row.evaluation.escalations.filter((e) => e.level === 3 || e.severity1).map((escalation) => ({ row, escalation })));
  return {
    counts,
    pipelineCount: pipeline.length,
    redYellow: sortRows(delivery.filter((r) => r.color !== "green")),
    goLives: { within30: within(30, 0), within60: within(60, 31), within90: within(90, 61) },
    gatesThisWeek: gatesThisWeek.sort((a, b) => a.date.localeCompare(b.date)),
    topEscalations,
    overridesInForce: rows.filter((r) => r.evaluation.overridesInForce.length || r.evaluation.exceptionsInForce.length),
    pipeline: sortRows(pipeline),
    stale: rows.filter((r) => r.evaluation.stale && !r.snapshot.project.archived),
  };
}
