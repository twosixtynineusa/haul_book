# ROADMAP — Haul Book

> Only work **not yet built**. When an item ships, delete it here and add a dated CHANGELOG entry.
>
> **Last groomed:** 2026-11-07

## Next — source importers (new providers)

Every provider with a sample export is built (Wialon, Bellfam ELD, Ezlogz, HOS 247, Motive,
Swift ELD, Vista ELD). When a sample from a new provider arrives (kept locally, git-ignored,
MANUAL_TODO §B):

1. Add `importers/<provider>.ts` implementing `Importer`:
   - `detect()` is a cheap, never-throwing check on the raw bytes (header row, sheet name, …).
   - `read()` returns trips per month (or per period) and state, plus the **company name and
     unit #** when the file or its name carries them.
2. Add its id to `SOURCE_FORMATS` / `SourceFormatIdSchema` (`packages/shared/src/contracts/sources.ts`)
   and register it in `importers/index.ts`. A provider listed before its importer exists gets
   `available: false` and an importer whose `read()` explains it isn't built yet.
3. Add a **made-up** export in the exact same format (never the real sample): a file in
   `apps/api/test/fixtures/`, or for Excel a builder in `test/helpers/` using `xls-writer.ts`;
   a spec; and a hand-derived golden ProMiles file.
4. Document the format in `docs/data-contracts.md` and log it in CHANGELOG.

- **Modern Excel (.xlsx) reading:** `conversion/xls.ts` reads legacy `.xls` (BIFF8) only. The
  first provider exporting `.xlsx` needs a reader for it (a zip of XML sheets).

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
