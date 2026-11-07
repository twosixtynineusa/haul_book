# ROADMAP — Haul Book

> Only work **not yet built**. When an item ships, delete it here and add a dated CHANGELOG entry.
>
> **Last groomed:** 2026-11-07

## Next — source importers (one per ELD provider)

The portal lists these formats in its "Source format" picker as **coming soon**. Placeholder
importers live in `apps/api/src/conversion/importers/placeholders.ts`. Real sample exports for
all of them are kept locally (git-ignored, MANUAL_TODO §B). To build one:

1. Add `importers/<provider>.ts` implementing `Importer`:
   - `detect()` is a cheap, never-throwing check on the raw bytes (header row, sheet name, …).
   - `read()` returns trips per month (or per period) and state, plus the **company name and
     unit #** when the file or its name carries them.
2. Register it in `importers/index.ts` and set `available: true` in `SOURCE_FORMATS`
   (`packages/shared/src/contracts/sources.ts`).
3. Add a **made-up** export in the exact same format to `apps/api/test/fixtures/` (never the real
   sample), a spec, and a hand-derived golden ProMiles file.
4. Document the format in `docs/data-contracts.md` and log it in CHANGELOG.

| Provider | Placeholder id | Sample format | To build |
|---|---|---|---|
| **EZLogz** | `ezlogz` | CSV: `State,Miles`, full state names, `"788.4 mi"` | Find where the company, unit # and period are (file name or header lines), then detection and the reader. |
| **Motive** | `motive` | CSVs: `distance_summary_by_vehicle` (`Vehicle,Jurisdiction,Distance (mi),Fuel (gal)`), `trip_reports_detail_by_vehicle` | Pick which report to import (the summary looks closest), and find the company and period. |
| **Swift** | `swift` | `IFTA_Report*.xls` (legacy Excel) | Needs an Excel reader first (below). |
| **Vista ELD** | `vista-eld` | `IFTA_Report*.xls` (legacy Excel) | Same; check whether Swift and Vista share one layout. |

- **Excel (.xlsx / .xls) reading:** uploads are already accepted; reading them needs a parser
  library in the API that handles legacy `.xls` (e.g. SheetJS). Pick it with the first Excel
  provider (prefer a maintained one), then `make lock` and `make ci`.

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
