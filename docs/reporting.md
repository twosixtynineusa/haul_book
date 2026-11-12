# Saved conversion data and company reports — v1

**Introduced:** 2026-11-12. This contract covers the database copy of ProMiles exports,
company/truck file views, and company PDF reports. The ProMiles CSV format itself is unchanged.

## Stored exports

- Every successful portal or inbox conversion saves the exact UTF-8 CSV text in
  `stored_outputs`, once per output filename. `version = 1`; `trips` contains structured
  exported trips: ProMiles unit, inclusive dates, Begin Odo, mode, distance unit, and ordered
  state legs with distance, toll distance, empty, off-road and permitting fields.
- The CSV snapshot and its `conversions` history rows are written in one database transaction.
  History remains one row per source file and truck. Each history trip also receives its exact
  exported values under `promiles`; existing summaries and real/placeholder odometer semantics
  are preserved. Previews never write history or snapshots.
- History's company and truck links continue to follow merges and moves. `outputFile` links
  history to the immutable CSV snapshot. A multi-truck CSV is stored once, and may appear on
  several truck pages; downloading it returns the entire original company file.
- Downloads prefer the saved database copy, so removing a host output file does not remove
  its download or report data. Filenames still pass the existing safe-name validation.
  Existing database names are reserved when generating new output filenames.
- Explicitly deleting or reprocessing an inbox conversion removes its history and deletes its
  saved CSV when no remaining conversion references it, consistent with existing undo behavior.
  Deleting a company/truck preserves historical snapshots, with history links set null.
- Source CSV/XLS bytes are still archived on disk, not copied to the database. The database
  stores everything exported to ProMiles, not extra fields discarded by the importer.

## Existing conversions

At service startup, existing safe-named CSVs in `OUTPUT_DIR` are read and archived idempotently.
Only recognized Haul Book TRIPSUMMARY2 exports are accepted. Original file modification time is
retained. This does not re-convert source reports, create history, or change saved odometers.
Existing history trips receive detail only when exactly one exported truck/period matches and
the distance agrees. An unavailable or ambiguous older export remains summary-only; never
invent state distances. CSVs without history are retained, but not assigned to a company by
filename guessing. Database backups now include CSV snapshots.

## File views

- Dashboard: upload/conversion flow, files needing attention, and **Rescan input folder**.
  The latter queues the normal worker scan; the two-scan settling rule still applies.
- Company and truck pages: filtered input activity, correction/reprocess/delete controls,
  saved CSV downloads, and conversion history. The company page also offers a PDF report.
- `GET /api/v1/inbox?companyId=…[&truckId=…]` filters before selecting results; historical output
  links survive company renames/merges. Scoped activity is not restricted to the global last 25.
- `GET /api/v1/outputs?companyId=…[&truckId=…]` lists database exports associated by history IDs,
  not filename prefixes. A CSV spanning trucks remains the same complete file on each page.

## PDF reports

`GET /api/v1/history/companies/:id/report.pdf[?from=YYYY-MM-DD][&to=YYYY-MM-DD]`
returns a downloadable PDF built on demand from the database, without reading source files.
A missing company returns 404; invalid or reversed dates return 400. Empty UI dates are omitted.

- Include only trips fully contained in the requested dates. Leave dates unset for all periods.
  Do not prorate partially overlapping monthly/quarterly summaries; count and disclose exclusions.
- For a linked truck and identical trip period, use its latest saved conversion (timestamp, then
  ID as deterministic tie-breaker). Historical deleted trucks fall back to their original number.
- Different overlapping periods for the same truck are flagged. In that case withhold aggregate
  totals instead of double-counting mileage; still show each distinct trip for review.
- Keep miles and kilometres separate. Company totals include summary-only history; state totals
  use only available exact state legs, with an explicit warning for missing older detail.
- Show company name, USDOT/IFTA account, date selection, truck/ProMiles numbers, trip dates,
  odometers, source/output filenames, state distances and page numbers. An unknown odometer
  stays unknown; explain that the CSV used placeholder 1.
- PDFs use embedded DejaVu Sans fonts (license under `apps/api/assets/fonts/LICENSE`) for
  consistent rendering. They are generated downloads, not additional database records.

## Change management

Bump this document's version when snapshot shape, report inclusion/deduplication, or download
semantics change. Add regression tests for the changed behavior and render a fictional PDF for
visual verification. Never commit a customer report or database backup.
