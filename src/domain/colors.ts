// Status colors: the defaults, what a person may change on Settings, and the
// checks a pick must pass. The math follows the dataviz rules the defaults were
// validated with: WCAG contrast against the white chart surface, lightness steps
// in OKLab for the ordered levels, and OKLab distance (×100) between colors that
// sit side by side, with and without simulated red-green color blindness
// (Machado, Oliveira and Fernandes 2009, severity 1). Pure, so the page can run
// the same checks live while someone picks.

export type ColorKey = "lv0" | "lv1" | "lv2" | "lv3" | "lv4" | "dueSoon" | "pastDue" | "done";

export interface ColorDef {
  key: ColorKey;
  label: string;
  /** Where the color shows up, in plain words. */
  use: string;
  /** The CSS variable the app reads. */
  cssVar: string;
  default: string;
  group: "level" | "status";
}

/** In display order. Levels run light to dark, from not started to live. */
export const COLOR_DEFS: ColorDef[] = [
  { key: "lv0", label: "Not started", use: "Heat map cells for work that hasn't started", cssVar: "--color-lv-0", default: "#84b9f3", group: "level" },
  { key: "lv1", label: "In progress (in build)", use: "Heat map cells for work being built or set up", cssVar: "--color-lv-1", default: "#519ced", group: "level" },
  { key: "lv2", label: "Testing", use: "Heat map cells for work in testing", cssVar: "--color-lv-2", default: "#257de0", group: "level" },
  { key: "lv3", label: "Certified", use: "Heat map cells for work that passed testing", cssVar: "--color-lv-3", default: "#1b64be", group: "level" },
  { key: "lv4", label: "Live", use: "Heat map cells for work in production", cssVar: "--color-lv-4", default: "#0f4a96", group: "level" },
  { key: "dueSoon", label: "Due soon", use: "Card edges and markers for work due in the next few days", cssVar: "--color-st-warning", default: "#fbb315", group: "status" },
  { key: "pastDue", label: "Past due", use: "Card edges, late bars and the red edge on late partners", cssVar: "--color-st-critical", default: "#dc3c3d", group: "status" },
  { key: "done", label: "Done", use: "Card edges and markers for finished work", cssVar: "--color-st-good", default: "#0aac23", group: "status" },
];

export const COLOR_KEYS = COLOR_DEFS.map((d) => d.key);
export type StatusColors = Record<ColorKey, string>;
export const DEFAULT_COLORS = Object.fromEntries(COLOR_DEFS.map((d) => [d.key, d.default])) as StatusColors;
export const colorDef = (k: string) => COLOR_DEFS.find((d) => d.key === k);

/** "#ABC", "abc123" or "#AABBCC" to "#aabbcc"; null when it isn't a color. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let h = v.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
}

/** Saved values over the defaults; anything that isn't a color falls back to its default. */
export function mergeColors(saved: Partial<Record<string, unknown>>): StatusColors {
  const out = { ...DEFAULT_COLORS };
  for (const k of COLOR_KEYS) { const v = normalizeHex(saved[k]); if (v) out[k] = v; }
  return out;
}

// ---------- Color math ----------

const srgb = (h: string) => { const x = normalizeHex(h) ?? "#000000"; return [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255); };
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (h: string) => srgb(h).map(toLin) as [number, number, number];
const relLum = (h: string) => { const [r, g, b] = lin(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklabFromLin([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;

function simulate(h: string, kind: keyof typeof MACHADO): [number, number, number] {
  const [r, g, b] = lin(h);
  const M = MACHADO[kind];
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return [c(M[0][0] * r + M[0][1] * g + M[0][2] * b), c(M[1][0] * r + M[1][1] * g + M[1][2] * b), c(M[2][0] * r + M[2][1] * g + M[2][2] * b)];
}

/** OKLab lightness, 0 to 1. */
export const lightness = (h: string) => oklabFromLin(lin(h))[0];

/** OKLab distance ×100; with a kind, as a person with that color blindness sees the pair. */
export function deltaE(a: string, b: string, kind?: keyof typeof MACHADO): number {
  const x = oklabFromLin(kind ? simulate(a, kind) : lin(a));
  const y = oklabFromLin(kind ? simulate(b, kind) : lin(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// APCA 0.0.98G lightness contrast (Lc), ported from Color.js 0.5.2 (MIT, Lea Verou and
// Chris Lilley), itself a port of github.com/Myndex/apca-w3. The dataviz rules go by APCA
// for a word inside a colored fill. Negative means light text on a dark fill.
const apcaY = (h: string) => {
  const [r, g, b] = srgb(h).map((c) => c ** 2.4);
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  return y >= 0.022 ? y : y + (0.022 - y) ** 1.414;
};
export function apca(text: string, background: string): number {
  const [t, b] = [apcaY(text), apcaY(background)];
  if (Math.abs(b - t) < 0.0005) return 0;
  const c = 1.14 * (b > t ? b ** 0.56 - t ** 0.57 : b ** 0.65 - t ** 0.62);
  return Math.abs(c) < 0.1 ? 0 : (c - Math.sign(c) * 0.027) * 100;
}

export const SURFACE = "#ffffff";
const INKS = ["#ffffff", "#0e2a52"] as const;

/** The text color that reads best on a fill: white or deep navy, by APCA. */
export function inkOn(fill: string): string {
  return Math.abs(apca(INKS[0], fill)) >= Math.abs(apca(INKS[1], fill)) ? INKS[0] : INKS[1];
}

// ---------- Checks ----------

/**
 * mark: a status color against white. level: a heat map step against white (an ordered ramp's light end).
 * text: APCA Lc for the short bold word inside a heat map cell ("Live", "Failed"): 45, the floor for bold labels. levelStep: OKLab lightness between steps.
 * normal and cvd: OKLab distance ×100 between status colors, as seen and with red-green color blindness.
 */
export const LIMITS = { mark: 3, level: 2, unreadable: 1.5, text: 45, levelStep: 0.06, normal: 15, cvd: 8 } as const;

export interface ColorIssue {
  /** The colors the issue is about. */
  keys: ColorKey[];
  /** "fail": the color can hardly be seen or told apart. "warn": it works only because a word is always shown with it. */
  level: "fail" | "warn";
  text: string;
}

const name = (k: ColorKey) => colorDef(k)!.label;

/** Every way the picks fall short of the dataviz rules. Empty means all checks pass. */
export function checkColors(c: StatusColors): ColorIssue[] {
  const out: ColorIssue[] = [];
  for (const d of COLOR_DEFS) {
    const r = contrast(c[d.key], SURFACE);
    const floor = d.group === "level" ? LIMITS.level : LIMITS.mark;
    if (r < LIMITS.unreadable) out.push({ keys: [d.key], level: "fail", text: `${d.label} is too pale to see on white (${r.toFixed(1)}:1).` });
    else if (r < floor) out.push({ keys: [d.key], level: "warn", text: `${d.label} is ${r.toFixed(1)}:1 on white, under ${floor}:1. It still reads because the app always shows its word beside it.` });
  }
  // Levels must get darker step by step, or the heat map can't be read in order.
  const lv = COLOR_DEFS.filter((d) => d.group === "level");
  for (let i = 1; i < lv.length; i++) {
    const step = lightness(c[lv[i - 1].key]) - lightness(c[lv[i].key]);
    if (step < 0) out.push({ keys: [lv[i - 1].key, lv[i].key], level: "fail", text: `${lv[i].label} is lighter than ${lv[i - 1].label}. Levels should get darker from not started to live.` });
    else if (step < LIMITS.levelStep) out.push({ keys: [lv[i - 1].key, lv[i].key], level: "warn", text: `${lv[i - 1].label} and ${lv[i].label} are close in lightness and may be hard to tell apart.` });
  }
  // The word inside a heat map cell must stay readable.
  for (const d of lv) {
    const lc = Math.abs(apca(inkOn(c[d.key]), c[d.key]));
    if (lc < LIMITS.text) out.push({ keys: [d.key], level: "warn", text: `The word inside a ${d.label} cell scores Lc ${Math.round(lc)}, under ${LIMITS.text}, so it may be hard to read.` });
  }
  // Status colors sit side by side on the same cards.
  const pairs: [ColorKey, ColorKey][] = [["pastDue", "done"], ["dueSoon", "pastDue"], ["dueSoon", "done"]];
  for (const [a, b] of pairs) {
    const normal = deltaE(c[a], c[b]);
    const cvd = Math.min(deltaE(c[a], c[b], "protan"), deltaE(c[a], c[b], "deutan"));
    if (normal < LIMITS.normal) out.push({ keys: [a, b], level: "fail", text: `${name(a)} and ${name(b)} look too much alike.` });
    else if (cvd < LIMITS.cvd) out.push({ keys: [a, b], level: "warn", text: `${name(a)} and ${name(b)} may look alike to people with red-green color blindness. The words beside them still tell them apart.` });
  }
  return out;
}

/** The CSS that applies saved colors, for the page head. Only valid hex values get through. */
export function colorCss(c: StatusColors): string {
  const lines = COLOR_DEFS.map((d) => `${d.cssVar}:${normalizeHex(c[d.key]) ?? d.default};`);
  lv(c).forEach((fill, i) => lines.push(`--color-lv-ink-${i}:${inkOn(fill)};`));
  return `:root{${lines.join("")}}`;
}

const lv = (c: StatusColors) => [c.lv0, c.lv1, c.lv2, c.lv3, c.lv4].map((x) => normalizeHex(x) ?? "#84b9f3");
