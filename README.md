# RX Gateway

The internal readiness record for client implementations. One record per client: the seven stages, gates G1 to G8, every work item with an owner and a date, colors worked out from the records with the reason written beside each one, and a portfolio view across clients. It also tracks EDI partners and can read a tracking sheet from Google Sheets.

This is the first version: internal only, no client or partner views, no integrations except the optional read-only Sheets connection.

## Run it

Needs Node 22 or newer.

```bash
npm install
npm run db:reset     # local database with made-up sample clients
npm run dev          # http://localhost:3000
```

The database is PGlite (Postgres compiled to WebAssembly) in `.data/pglite`, so there is no database server to install. The SQL is plain Postgres, so it moves to a hosted Postgres later without changes to the schema.

Other commands: `npm test` (rules and database tests), `npm run lint` (type check), `npm run build`.

The sample clients are all invented and marked "(sample)". Never load real client data, patient data, real pricing or credentials into this repository, its tests or its seed.

## What's in it

| Page | What it shows |
|---|---|
| Dashboard | Counts by color, clients that need attention, Level 3 escalations, go-lives in the next 90 days, gates this week, hand changes in force, the pre-discovery pipeline, clients with no update in a week. Weekly refresh button. |
| Portfolio | Every client, worst first, with filters by lane, color and stage, and a workstream heat strip. |
| Client page | Summary with dates (target window, no-earlier-than from G5, committed from G7a, forecast, slip), heat map of workstreams by gate, gates with signers and sittings, escalations, client roles, and every work item with status and owner. |
| EDI partners | Per client: the ten partner stages, test matrix by transaction set and direction, spec gaps, expiries, stage rules. |
| Partner profiles | One checked profile per trading partner, reused across clients. No certificates or passwords. |
| Alerts | One alert per item per day, keeping only the most urgent reason. |
| Audit log | Every change, who made it and when. |
| Sheets | Connection status, sheet sources, Sync now, add a sheet. |

## Where the rules live

All of the readiness logic is plain TypeScript in `src/domain`, with no database or web code in it, so it can move into another app as it is:

- `template.ts`: stages, gates, signers, client roles and the standard work items.
- `schedule.ts`: working-day scheduler with forecast dates and critical path.
- `rules.ts`: every threshold in one place, with a version number. The same thresholds apply to every client.
- `evaluate.ts`: task, workstream, gate and client colors, each with reasons; escalation Levels 1 to 3.
- `edi.ts`: partner stages, test rules and which gate a partner holds.
- `portfolio.ts` and `alerts.ts`: roll-ups.

Rules worth knowing:

- Nobody types a color. A hand change needs a written reason and lapses the next Monday.
- An exception to a gate rule counts only once it has an approver.
- A third baseline needs an approver.
- G5 sets the "no earlier than" date. G7a commits the go-live date. A gate passes only when every named signer has signed.

## Google Sheets (optional)

The app reads sheets and never writes to them. Items that come from a sheet can only change their title, due date and state in the sheet.

To connect, the repository owner needs to:

1. Create a Google Cloud service account and turn on the Google Sheets API for its project.
2. Make a key for it and put it in `.env.local` as `GOOGLE_SERVICE_ACCOUNT_JSON` (the whole JSON on one line), or point `GOOGLE_APPLICATION_CREDENTIALS` at the key file. See `.env.example`.
3. Share each tracking sheet with the service account's email as Viewer. Some Google Workspace organizations block sharing outside the domain; an admin may need to allow it.
4. In the app, open Sheets, add the sheet with a mapping, and press Sync now.

`sheets.config.example.json` shows a mapping. Mappings hold tab and column names only. Keep any real mapping out of git (`sheets.config.json` is ignored).

## Moving it into the portal later

The plan is for RX Gateway to become an add-on to the existing client portal. That portal's code hasn't been reviewed yet, so this version stands alone. When it moves:

- Keep `src/domain` as it is and port the tests with it.
- Map `src/db/schema.ts` onto the portal's database and its tenancy and roles.
- Replace the acting-user setting (`RXG_ACTING_USER`) with the portal's sign-in.
- Rebuild the pages in the portal's UI library.

## Not in this version

Client and partner views, HubSpot or Asana sync, email or chat notifications, sign-in, SQL restore or data ingestion tools.
