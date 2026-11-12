# MANUAL_TODO — Actions Only the Owner Can Perform

> Tracks everything that requires the owner's hands. Agents cannot do these.
>
> **Protocol:** when an item is done, DELETE it from this file and record the outcome in
> CHANGELOG.md. Buildable work goes to ROADMAP.md; newly discovered human-only work goes here.
>
> **Last groomed:** 2026-11-07

---

## Section A — Setup
- [ ] Set **`OUTPUT_DIR`** in `.env` to the folder you import into ProMiles from, then run
  `make restart`. The default is `./output` in the project.
- [ ] Set **`INPUT_DIR`** in `.env` to the folder you'll drop exports into (default `./input`,
  e.g. `~/HaulBook/Inbox`), then run `make restart`. Decide whether to use **company
  subfolders** (`INPUT_DIR/<Company name>/`): they let Wialon files, which carry no company, convert
  without asking.
- [ ] Once Haul Book shows your companies and you've converted a file, remove the old Docker
  volumes left from the rename (named `fueltax_portal_*`, e.g. from Docker Desktop → Volumes).
  The database was copied out of them, and a `backup-*.sql` copy is in the project folder.

## Section B — Sample files & credentials (unblocks the ROADMAP importers)
- [ ] Real sample exports from several ELD providers are kept locally in a git-ignored folder
  (`New folder/`, or `samples/`), never committed. For each, note which ProMiles customer and
  unit # the file belongs to, so converted output can be checked, and which providers should
  become source formats. Test fixtures are made from them with company names, VINs and plates
  replaced by made-up ones.
- [ ] **Wialon Remote API token** for the "Pull straight from Wialon" roadmap item.

## Section C — Verification (data / correctness)
- [ ] Convert a **Quick E Logs**, **Forza ELD** and **Big Road** report and import each into
  FuelTaxOnline under the correct customer. Confirm "Failures: 0" and matching state miles.
  For Big Road, confirm the actual reporting period yourself (the workbook has none); correct
  any Unknown mileage in the source system and re-export before conversion.
- [ ] Import a file the portal made from a **raw Wialon export** into FuelTaxOnline and confirm
  "Imported: 1, Failures: 0" (a real export passed on 2026-11-06, so this is a formality).
- [ ] Convert a Wialon report in the portal, pick the company it belongs to, and import the
  `<Company>_unit-22_2026-10.csv` it writes under that customer in FuelTaxOnline.
- [ ] Convert a **Bellfam ELD** and a **HOS 247** report and import each
  into FuelTaxOnline under that customer. Confirm the whole-mile state legs import with
  "Failures: 0" (the export has decimals; Haul Book rounds them).
- [ ] Convert an **Ezlogz** Mileage Report, pick the company it belongs to, and import it into
  FuelTaxOnline under that customer. Confirm "Failures: 0" and that the trip dates (first to last
  day driven that month) are accepted.
- [ ] Convert a **Motive** trip report (the one with two trucks, if possible), pick the company,
  and import it into FuelTaxOnline. Confirm "Failures: 0" and that Begin Odo is the truck's real
  odometer. Before filing, check any "odometer moves with no state row" warning with the carrier:
  one real sample shows a week of miles in no state.
- [ ] Convert a **Swift ELD** and a **Vista ELD** IFTA report (`IFTA_Report.xls`), pick which
  system each came from the first time, and import each into FuelTaxOnline under that customer.
  Confirm "Failures: 0" and that the whole-mile state legs match the report.
- [ ] Convert a **Motive distance summary** (`…distance_summary_by_vehicle.csv`): enter the period
  it covers (check the offered month is the one you exported), pick the company, and import it
  into FuelTaxOnline. Confirm "Failures: 0" with one trip per truck for that period.
- [ ] After converting a few reports, open the **History** tab and a truck's page (click its unit
  #) and check the dates, odometers and miles match the ProMiles files. History starts with this
  version: reports converted before it aren't listed.
- [ ] Check each company's **approved source** on the Companies tab. Companies that had several
  approved sources kept the one approved last; change it if that's not the ELD they use now.
- [ ] Export a **quarterly** (multi-month) IFTA report for one truck, convert it, and confirm ProMiles
  imports one trip per month. Then drop two trucks' reports together and confirm both import.
- [ ] On the PC that runs Haul Book, run **`make schedule-setup`** (README → Automatic updates).
  - On Windows, check that Task Scheduler shows "Haul Book update" at 3:00.
  - The next morning, check that `update.log` shows a run ending `== exit 0 ==`.
  - Unattended runs need Docker Desktop to start at sign-in, and a `git fetch` that doesn't ask
    for a password (an `https://` clone, or an SSH key without a passphrase).
- [ ] **Windows:** on a Windows PC, follow README → Setup → Windows. Test both routes, neither of
  which has been tried on Windows yet:
  - **A. Git Bash:** ideally once with Docker Desktop's WSL 2 engine and once with it off (Hyper-V,
    on Windows Pro).
  - **B. WSL 2 Ubuntu.**

  Each time, point `INPUT_DIR` / `OUTPUT_DIR` at folders under `C:\Users\<you>\…`, ideally with a
  space in the path. Confirm `make setup`, `make up` and `make ci` work, and that a file dropped in
  the input folder converts into the output folder. Note anything the README got wrong.
  Also run `make` and `make up` from **cmd** in the project folder (it should start Git Bash via
  `make.bat`), and `.\make help` from PowerShell.
