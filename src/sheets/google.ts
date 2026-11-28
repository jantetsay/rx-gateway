// Read-only Google Sheets access with a service account. The scope is
// spreadsheets.readonly, so this code cannot change a sheet even by mistake.
// The key comes from the environment and is never logged or stored.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function loadCredential(): ServiceAccount | null {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ?? (process.env.GOOGLE_APPLICATION_CREDENTIALS ? readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8") : null);
    if (!raw) return null;
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

/** Whether a credential is set, and the address a sheet must be shared with. */
export function credentialStatus(): { configured: boolean; shareWith: string | null } {
  const sa = loadCredential();
  return { configured: !!sa, shareWith: sa?.client_email ?? null };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

let cached: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key, "base64url");
  const res = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new SheetsError("Google refused the service account sign-in. Check the key is current and the Sheets API is enabled.");
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, exp: now + body.expires_in };
  return body.access_token;
}

export class SheetsError extends Error {}

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

/** Every value on each named tab, as displayed in the sheet, row by row. */
export async function readTabs(spreadsheetId: string, tabs: string[]): Promise<Map<string, string[][]>> {
  const sa = loadCredential();
  if (!sa) throw new SheetsError("No Google credential is set. Add a service account key (see the Sheets page).");
  const token = await accessToken(sa);
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
  for (const tab of tabs) params.append("ranges", quoteTab(tab));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 403) throw new SheetsError(`The sheet isn't shared with ${sa.client_email}. Share it as Viewer.`);
  if (res.status === 404) throw new SheetsError("No sheet with that ID, or the service account can't see it.");
  if (res.status === 400) throw new SheetsError("Google couldn't read one of the tab names. Check they match the sheet exactly.");
  if (!res.ok) throw new SheetsError(`Google Sheets answered ${res.status}.`);
  const body = (await res.json()) as { valueRanges?: { values?: string[][] }[] };
  const out = new Map<string, string[][]>();
  tabs.forEach((tab, i) => out.set(tab, body.valueRanges?.[i]?.values ?? []));
  return out;
}
