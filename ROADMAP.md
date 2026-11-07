# ROADMAP — Haul Book

> Only work **not yet built**. When an item ships, delete it here and add a dated CHANGELOG entry.
>
> **Last groomed:** 2026-11-07

## Next — source importers (one per ELD provider)

The portal already lists these formats in its "Source format" picker as **coming soon**.
Placeholder importers live in `apps/api/src/conversion/importers/placeholders.ts`. Each one
needs a real sample export first (see MANUAL_TODO §B). To build one:

1. Add `importers/<provider>.ts` implementing `Importer`:
   - `detect()` is a cheap, never-throwing check on the raw bytes (header row, sheet name, …).
   - `read()` returns trips per month and state, plus the **company name and unit #** when the
     file or its name carries them.
2. Register it in `importers/index.ts` and set `available: true` in `SOURCE_FORMATS`
   (`packages/shared/src/contracts/sources.ts`).
3. Add the sample to `apps/api/test/fixtures/` under its original name, plus a spec. Add a golden
   ProMiles output once one has imported cleanly.
4. Document the format in `docs/data-contracts.md` (contracts 3–5) and log it in CHANGELOG.

| Provider | Placeholder id | Known so far | To build |
|---|---|---|---|
| **EZ Logs** | `ez-logs` | nothing yet | Get a sample IFTA / state-mileage export (CSV or Excel). Find the columns for state, miles, dates, unit and company, then write detection and the reader. |
| **Motive Fleet** (formerly KeepTruckin) | `motive` | nothing yet | Same. Motive's IFTA reports usually include the vehicle/unit and carrier name, so check that the company and unit can come from the file. |
| **Vista ELD** | `vista-eld` | nothing yet | Same. |

- **Excel (.xlsx / .xls) reading:** uploads are already accepted; reading them needs a parser
  library in the API (e.g. `exceljs` or SheetJS). Pick it when the first Excel-based provider is
  built (prefer a maintained one), then `make lock` and `make ci`.

## Next — portal

- **Input folder notifications:** a desktop or email alert when a file lands in "needs input", so
  nobody has to keep the portal open.
- **Quarter guard:** warn when an upload mixes months from different quarters. Month trips never
  cross a quarter themselves, but ProMiles' "force trips into year/quarter" option would then be
  wrong.
- **Pull straight from Wialon:** run the IFTA Single Unit Mileage Report through the Wialon Remote
  API instead of exporting CSVs by hand (needs an API token; see MANUAL_TODO).

## Later

- **Fuel purchases import:** a converter for ProMiles' fuel purchase template.
- **Conversion history:** record each conversion (files, company, units, output) in Postgres for an
  audit trail.
