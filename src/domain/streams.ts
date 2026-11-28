// Which business work stream an item belongs to (Payables, Receivables,
// Purchasing, Sales, Warehouse and the rest), for a tracking sheet that has no
// work-stream column. Pure, so the rule can be tested and explained.
//
// The rule, in order; the first match wins:
//  1. An explicit tag in the title: "(AP", "AP #", "(AR", "AR #", or a title
//     that starts with "AP " or "AR ".
//  2. The sheet tab: a tab about data migration puts its items in Data migration.
//  3. The item's code or title prefix: T1, T2… or "Training" is Training;
//     M1…, V1…, "Milestone" or "Validation" is Go-live and validation; a code
//     or title that says EDI is EDI.
//  4. Keywords in the item's name (the part before the colon), then in the
//     whole title, checked Payables, Receivables, Purchasing, Warehouse, Sales.
//  5. Anything left is Unassigned.

export const STREAMS = [
  { key: "ap", label: "Accounts Payable", short: "Payables" },
  { key: "ar", label: "Accounts Receivable", short: "Receivables" },
  { key: "purchasing", label: "Purchasing", short: "Purchasing" },
  { key: "sales", label: "Sales", short: "Sales" },
  { key: "warehouse", label: "Warehouse and inventory", short: "Warehouse" },
  { key: "edi", label: "EDI", short: "EDI" },
  { key: "data", label: "Data migration", short: "Data" },
  { key: "training", label: "Training", short: "Training" },
  { key: "golive", label: "Go-live and validation", short: "Go-live" },
  { key: "unassigned", label: "Unassigned", short: "Unassigned" },
] as const;
export type StreamKey = (typeof STREAMS)[number]["key"];

/** The streams every client shows a card for, even with nothing in them. */
export const CORE_STREAMS: StreamKey[] = ["ap", "ar", "purchasing", "sales", "warehouse"];

export const STREAM_LABEL: Record<StreamKey, string> = Object.fromEntries(STREAMS.map((s) => [s.key, s.label])) as Record<StreamKey, string>;
export const isStream = (v: string | undefined | null): v is StreamKey => STREAMS.some((s) => s.key === v);

const KEYWORDS: [StreamKey, RegExp][] = [
  ["ap", /\b(payables?|vouchers?|remittance)\b/i],
  ["ar", /\b(receivables?|invoices?|payments?|statements?|credit memos?|aging|collections?|credit hold)\b/i],
  ["purchasing", /\b(purchas\w*|POs?|vendors?|suppliers?|backorders?|lead times?|reorder)\b/i],
  ["warehouse", /\b(warehouse|inventory|rack|shelf|zones?|receiving|serials?|serialization|cycle counts?|pick\w*|quarantine|DSCSA|lots?|shipping labels?|bins?)\b/i],
  ["sales", /\b(sales|SO|orders?|storefront|customers?|contracts?|pric\w*|freight|quotes?|promo\w*|products?)\b/i],
];

export function streamOf(x: { title: string; tab?: string | null; code?: string | null }): StreamKey {
  const title = x.title.trim();
  const code = (x.code ?? "").trim();
  if (/\(AP\b|\bAP #|^AP\b|\baccounts payable\b/i.test(title)) return "ap";
  if (/\(AR\b|\bAR #|^AR\b|\baccounts receivable\b/i.test(title)) return "ar";
  if (x.tab && /migration/i.test(x.tab)) return "data";
  if (/^T\d/i.test(code) || /^training\b/i.test(title)) return "training";
  if (/^[MV]\d/i.test(code) || /^(milestone|validation)\b/i.test(title)) return "golive";
  if (/^EDI\b/i.test(code) || /\bEDI\b/.test(title)) return "edi";
  const name = title.split(":")[0];
  for (const text of [name, title]) for (const [k, re] of KEYWORDS) if (re.test(text)) return k;
  return "unassigned";
}

/** A sheet item's code, from its source reference ("src:Tab!D37" gives "D37"). */
export function codeOf(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const key = ref.slice(ref.indexOf("!") + 1);
  return key.split(/\s|#/)[0] || null;
}
