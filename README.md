# Haul Book

A small web app you run on your own computer. It turns **ELD / telematics mileage reports** into
**ProMiles FuelTaxOnline trip summary imports** (the TRIPSUMMARY2 CSV template), so IFTA mileage
doesn't have to be retyped by hand.

- **Drop reports in the portal,** or copy them into a watched **input folder** to convert them
  automatically.
- It detects which system each report came from and reads the company and unit # where the file
  has them. Anything missing, you pick from a saved list or type in.
- It writes **one ProMiles file per company** (FuelTaxOnline imports a file under one customer),
  named by company, unit # and month, into an output folder of your choice. You can also download
  it from the portal.
- It remembers your companies, trucks and each truck's last odometer reading, so the next month
  needs less typing. A **Companies** tab manages them, and a **History** tab logs every report
  converted (dates, odometers, miles), with a page per truck.
- If a company's files suddenly come from a different ELD system, it holds them and asks you
  first instead of importing silently.

Everything runs locally in Docker: nothing is uploaded anywhere, and there is no login.

| Source system | Status |
|---|---|
| **Wialon**: IFTA Single Unit Mileage Report (CSV) | ✅ supported: unit # from the file name, company picked or typed |
| **Bellfam ELD**: IFTA Mileage By State (CSV) | ✅ supported: company and unit # read from the file |
| **Ezlogz**: Mileage Report (CSV) | ✅ supported: unit # read from the file, company picked or typed |
| **HOS 247**: IFTA Mileage By State (CSV) | ✅ supported: same layout as Bellfam ELD, so the company's source decides, or you pick |
| **Motive**: IFTA Trip Report, detail by vehicle (CSV) | ✅ supported: unit #s and odometers read from the file (several trucks per file are fine), company picked or typed |
| **Motive**: Distance summary by vehicle (CSV) | ✅ supported: unit #s read from the file; it has no dates, so you give the period (the month before the export is offered) |
| **Swift ELD**: IFTA Report (Excel .xls) | ✅ supported: company and unit #s read from the file (several trucks per file are fine) |
| **Vista ELD**: IFTA Report (Excel .xls) | ✅ supported: same workbook as Swift ELD, so the company's source decides, or you pick |

Sample exports from other ELD systems are welcome. See [Contributing](#contributing).

## Requirements

The app itself always runs inside Docker containers, and you start and stop them with `make`. So
your computer only needs three things: **Docker**, **make** and **git**. Node, npm, Postgres and
Redis all live inside the containers. Allow about 4 GB of disk for the images.

| | Docker | make + git | Run `make` from |
|---|---|---|---|
| **Linux** | Docker Engine + compose plugin (or Docker Desktop) | distro packages | any terminal |
| **macOS** | Docker Desktop | Xcode command line tools | Terminal |
| **Windows** | Docker Desktop, with **or without** WSL 2 | Git for Windows + GNU make | **Git Bash** (or a WSL Ubuntu terminal) |

## Setup

Every OS ends with the same two commands:

```bash
make setup   # once: creates .env, builds the images, installs dependencies, creates the database
make up      # starts the portal → http://localhost:3100
```

`make setup` is safe to re-run. `make down` stops the portal; your data is kept.

### Linux

1. Install Docker Engine and the compose plugin by following
   [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) for your distro.
   Then let your user run docker without `sudo`, and log out and back in:

   ```bash
   sudo usermod -aG docker "$USER"
   ```

2. Install make and git:

   ```bash
   sudo apt install -y make git    # Debian / Ubuntu
   sudo dnf install -y make git    # Fedora
   ```

3. Get the project and start it:

   ```bash
   git clone https://github.com/twosixtynineusa/haul_book.git
   cd haul_book
   make setup
   make up
   ```

### macOS

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)
   (or `brew install --cask docker`) and start it once.
2. Install make and git with Apple's command line tools:

   ```bash
   xcode-select --install
   ```

3. Clone, `make setup`, `make up`, as for Linux step 3.

### Windows

There are two ways to run it on Windows. Both use the same containers and the same `make`
commands.

- **A. Git Bash.** This works whether or not your PC has WSL 2, including Docker Desktop on its
  Hyper-V engine. Apart from installing Docker Desktop once, it needs no administrator rights.
- **B. WSL 2 (Ubuntu).** This option needs WSL 2, and installing WSL needs administrator rights.
  Code reloads faster, so it is the better choice if you will change the code.

#### A. Git Bash (with or without WSL 2)

> **No administrator rights needed, except once for Docker Desktop.** Git, make and Haul Book all
> install into your own user account. Only Docker Desktop has to be installed by an administrator,
> because Windows requires it for the virtualization Docker uses. If `docker --version` already
> works in a terminal, that's done and you can skip step 1.

1. **Docker Desktop (administrator, once).** Whoever manages the PC installs Docker Desktop from
   [docs.docker.com/desktop/setup/install/windows-install](https://docs.docker.com/desktop/setup/install/windows-install/)
   (or `winget install -e --id Docker.DockerDesktop` in an administrator PowerShell). Then they
   add your Windows account to the **docker-users** group (Computer Management → Local Users and
   Groups → Groups → docker-users). Sign out and back in, start Docker Desktop and accept its
   terms. From then on you use Docker without admin rights.

   Docker Desktop uses one of two engines, under **Settings → General → Use the WSL 2 based
   engine**:
   - **On** (default): needs WSL 2. Docker Desktop installs it if your PC supports it.
   - **Off**: the Hyper-V engine, without WSL 2. This needs Windows 10/11 **Pro, Enterprise or
     Education** with virtualization enabled; Windows Home always needs WSL 2. In this mode, check
     **Settings → Resources → File sharing**. The project folder and your input/output folders
     must be under a listed path; `C:\Users` is shared by default.
2. **Install Git for Windows and GNU make for your account only.** In a normal (not
   administrator) PowerShell:

   ```powershell
   winget install -e --id Git.Git --scope user
   winget install -e --id ezwinports.make --scope user
   ```

   Neither asks for admin rights. Without winget:
   - **Git:** run the installer from [git-scm.com](https://git-scm.com/download/win). If it asks
     for administrator rights, cancel that prompt and choose to install for your user only.
   - **make:** download `make-4.4.1-without-guile-w32-bin.zip` from
     [ezwinports on SourceForge](https://sourceforge.net/projects/ezwinports/files/) and unzip it
     to `%LOCALAPPDATA%\Programs\make`. Then add its `bin` folder to your **user** `Path`: Start →
     "Edit environment variables for your account". That needs no admin either.
3. **Open Git Bash** from the Start menu. If it was already open, close it and open a new one so
   it finds `make`. Check that all three tools answer:

   ```bash
   docker --version && docker compose version && make --version
   ```

4. **Get the project and start it.** Keep it in your user folder: creating folders directly on
   `C:\` can need admin rights. In Git Bash, `~` is your Windows user folder (`C:\Users\<you>`):

   ```bash
   cd ~
   git clone https://github.com/twosixtynineusa/haul_book.git
   cd haul_book
   make setup
   make up
   ```

5. Open <http://localhost:3100> in your browser. To use folders of your own for reports and
   converted files, see [Configure the folders](#configure-the-folders).

**Command Prompt (cmd) and PowerShell work too.** In the project folder, `make <target>` in cmd (or
`.\make <target>` in PowerShell) runs `make.bat`, which starts the same `make` inside Git Bash for
you. Git for Windows and GNU make from steps 2 and 3 are still needed. For targets that take
quoted values, such as `make sql Q="…"`, use Git Bash directly.

#### B. WSL 2 (Ubuntu)

1. Install Docker Desktop as in A.1, with **Use the WSL 2 based engine** turned on.
2. Install Ubuntu (this step needs administrator rights). In PowerShell, run the command below,
   restart if asked, then open **Ubuntu** from the Start menu and create a user name and password:

   ```powershell
   wsl --install -d Ubuntu
   ```

3. In Docker Desktop, go to **Settings → Resources → WSL integration** and turn on **Ubuntu**.
4. In the Ubuntu terminal, install make and git, then clone the project **inside Ubuntu's home
   folder**, not under `/mnt/c`, because file watching is much faster there:

   ```bash
   sudo apt update && sudo apt install -y make git
   cd ~
   git clone https://github.com/twosixtynineusa/haul_book.git
   cd haul_book
   make setup
   make up
   ```

5. Open <http://localhost:3100> in your normal Windows browser. `explorer.exe .` opens the
   project folder in Windows Explorer.

On either route, `.env` can be edited with Notepad. Windows line endings and quoted paths are
handled.

## Configure the folders

Settings live in `.env` in the project folder. After changing it, run `make restart`.

| Setting | Default | What it is |
|---|---|---|
| `OUTPUT_DIR` | `./output` | Where converted ProMiles files are saved, ready to import |
| `INPUT_DIR` | `./input` | The watched folder: reports dropped here convert by themselves |
| `INPUT_SCAN_SECONDS` | `30` | How often the input folder is checked |
| `WEB_PORT` / `API_PORT` | `3100` / `3000` | Ports on your machine for the portal and its API |
| `DB_PORT` | `5433` | Host port for your own database tools (optional) |

Relative paths are relative to the project folder. For anywhere else, use an absolute path:

```dotenv
# Linux / macOS
OUTPUT_DIR=/home/you/HaulBook/ProMiles-import
INPUT_DIR=/home/you/HaulBook/Inbox

# Windows, Git Bash (A): a normal Windows path; / or \ both work
OUTPUT_DIR=C:/Users/you/Documents/HaulBook/ProMiles-import
INPUT_DIR=C:\Users\you\Documents\HaulBook\Inbox

# Windows, WSL 2 (B): the same C:\Users\you\Documents\HaulBook folders, seen from Ubuntu
OUTPUT_DIR=/mnt/c/Users/you/Documents/HaulBook/ProMiles-import
INPUT_DIR=/mnt/c/Users/you/Documents/HaulBook/Inbox
```

Spaces in paths are fine. `make output-dir` and `make input-dir` print the folders in use.
Docker Desktop (macOS, or Windows on the Hyper-V engine) can only reach folders under a shared
path; your user folder is shared by default.

## Using it

1. **Add mileage reports.** Drop one or more CSV or Excel exports on the portal. For Wialon, run
   the **IFTA Single Unit Mileage Report** and export it as CSV, keeping Wialon's file name,
   because the unit # is read from it (`22_IFTA_Single_Unit_Mileage_Report_….csv` → unit 22).
   For Bellfam ELD or HOS 247, export the **IFTA Mileage By State** CSV for one vehicle and period; the
   carrier and unit # are read from the file, and miles are rounded to whole miles per state.
   Both systems export the same layout: a company's first file asks which one it came from, and
   later files for that company use the same answer.
   For Ezlogz, export the **Mileage Report** CSV for one unit (any number of months); the unit #
   is read from the file, the company isn't in it, and each month becomes its own trip.
   For Motive, export the **IFTA trip report detail by vehicle** CSV
   (`…trip_reports_detail_by_vehicle.csv`) or the **distance summary by vehicle**
   (`…distance_summary_by_vehicle.csv`). Either may hold several trucks: each converts with its
   own unit #. The trip report also carries real odometer readings and dates. The distance
   summary has neither, so you enter the period it covers (inside one quarter); the month
   before it was exported is offered in one click. It becomes one trip per truck for that period.
   For Swift ELD or Vista ELD, export the **IFTA report** as Excel (`IFTA_Report.xls`). The
   company and unit #s are read from its "All trucks" sheet, and each truck becomes one trip for
   the report's period, miles rounded to whole miles per state. Both systems export the same
   workbook: a company's first file asks which one it came from, and later files use that answer.
2. **Company & unit.** Each file shows its source format (detected, or picked from a dropdown) and
   its company and unit #. Fields read from the file are marked. A file with no company is
   matched **by its unit #** to the one saved company running that truck (marked "by unit #"),
   and the company's approved source settles a layout two systems share. If the unit # is saved
   under several companies, you pick which. The company and unit # fields are drop-down lists of
   the saved ones (the arrow shows them all, typing narrows them), and you can type a new one.
   New companies and units are saved when you convert. "Use for all files" fills in one company
   for every file.
   - **ProMiles unit #.** A truck seen for the first time also gets a field for the unit #
     ProMiles knows it by, filled in with its own truck # (Motive's `Volvo 01` might be `2011`
     in ProMiles). Change it if needed; converting saves it on the truck, and its later files
     use it without asking. In the input folder, a file with a new truck always waits in
     **Waiting for you** until you confirm it. Two trucks of one company can't share one.
3. **Review trips.** There is one trip per truck per month, with its period, states and miles. You
   get a warning if the state miles don't add up to the report's own total.
   - **Begin odometer** is optional. If you enter a truck's reading once, later months carry it
     forward (plus the miles driven). Motive files carry real odometer readings, so their trips
     start there by themselves ("From the file") unless you type one. Where it ends is saved, so
     the truck's next conversion starts there by itself ("Saved: end of …"). Typing a value
     overrides the saved one. With nothing typed or saved, `1` is written: ProMiles requires a
     value, and `1` imports fine.
4. **Convert & save.** The file is written to your output folder and listed on the Dashboard's
   **Output folder** card with a download link. Each converted report is logged on the **History** tab.
5. **Import into ProMiles.** In FuelTaxOnline, select that company as the customer, open
   **Import Data**, choose the file and upload it.

Output files are named `<Company>_unit-<N>_<YYYY-MM>.csv`, for example
`ACME-TRUCKING-LLC_unit-22_2026-10.csv`. Several trucks or months look like
`…_units-22-25_2026-10_to_2026-12.csv`. The unit #s are the ProMiles ones; when a truck's differs
from its truck # in the source, both show: `ACME-TRUCKING-LLC_unit-2011_from-Volvo-01_2026-10.csv`.
Files are never overwritten; a repeat gets `_2`, `_3` and so on. A ProMiles file is only ever deleted when you delete or convert again the input-folder
file it came from (see below).

### Input folder (automatic conversion)

The worker checks `INPUT_DIR` every `INPUT_SCAN_SECONDS`, whether or not the portal is open:

```
Inbox/
├── 22_IFTA_Single_Unit_Mileage_Report_….csv        ← no company known: waits in the portal
├── ACME TRUCKING LLC/                              ← subfolder name = the company
│   └── 25_IFTA_Single_Unit_Mileage_Report_….csv    ← converts by itself
├── archive/2026-11-07/…                            ← sources that were converted
└── failed/                                         ← files you "Set aside"
```

- A file is picked up once it has stopped changing between two scans, so a file still being
  copied is never read.
- Wialon files carry no company name. Drop them in a **subfolder named after the company**, or
  the company is filled in when exactly **one saved company** has that unit #. When several
  do, the file waits and the portal asks which.
- If something is missing, the file stays put and a **Waiting for you** card appears at the top
  of the Dashboard asking for it. Fill it in and click **Convert**.
- Converted sources move to `archive/<date>/`; a source report is never deleted. Dropping the
  same file again archives it as a duplicate instead of converting it twice.
- A new file can take up to two scan intervals to appear. The ⟳ button on the Dashboard's
  **Input folder** card checks now; its folder button shows where the folder is and copies the
  path.

The **Input folder** card lists the latest files that came through, each with its download and
three ways to undo it:

- **Correct** (pencil): change the company, truck #, source or dates, then **Save & convert
  again**.
- **Convert again** (circular arrow): run the file again as it is, for example after fixing the
  company's approved source or a truck's odometer.
- **Delete** (bin): remove the row together with the ProMiles file and the history entries it
  produced. The same file can then be dropped and converted again.

Converting again replaces the ProMiles file and history the file produced before, and starts
at the same odometer as the first time. In every case the original report stays in `archive/`.

### Companies tab

The **Companies** tab lists every saved company with its trucks. When a file is converted, its
company and unit # are added automatically, whether they were read from the file or picked by you.

- **Search** by company name, USDOT #, truck #, ProMiles unit #, VIN or plate.
- **Every delete, merge or move asks first** in the app's own dialog, listing exactly what goes
  (the truck, its saved odometer, the ProMiles file, the history entry, …) and what stays.
- **Company details:** name, USDOT #, IFTA account #, contact, phone, email and notes.
  - Renaming changes the spelling conversions match from then on.
  - **Merge** folds two spellings of one carrier into one. The trucks move across; where both
    have the same unit #, the later odometer is kept.
  - **Delete** removes the company and its trucks. Converted files are never touched.
- **Trucks:** truck #, ProMiles unit # (blank = the same as the truck #), VIN, plate and notes,
  plus the saved odometer, which you can correct. Each truck also shows when it was last
  converted, from which source, and through which date. A changed ProMiles unit # applies from
  the next conversion; files already written keep what they had (**Convert again** in the input
  folder rewrites one).
  - **Move** (the arrows button, or "Move" on the truck's page) takes a truck to another saved
    company with its odometer, details and history. If that company already has the same
    truck #, the two become one truck (the later odometer is kept). A company with no approved
    source yet takes the truck's last one. ProMiles files already written aren't changed, and
    files converted for the truck stay converted.
  **Click a unit #** to open the truck's page: its company and approved source, its details
  (editable), what its reports add up to, and every report converted for it.
- **Approved source:** the one ELD system a company's files come from. Picking another replaces
  it.

**Switching ELD providers:** a company has one approved source. Its first converted file
approves that source (for example Wialon). If a file for that company later arrives from a different source (for example EZ Logs),
it is **not converted automatically**:
- a warning appears on the Dashboard: in the input folder card, or on the uploaded file;
- the file waits until you click **Confirm**;
- confirming converts it and makes the new source the approved one, **replacing** the old, so
  that company's later files from it convert on their own (and files from the old one now wait).

You can also change the approved source on the Companies tab.

### History tab

Every report written to a ProMiles file, from an upload or the input folder, is logged: when,
the company and unit #, the source and file names, the dates it covers, the odometer at its start
and end, and its total miles. Open a row to see its trips (usually one per month); click the unit #
to open the truck's page. Search by company, unit #, source, file name or state.

## Everyday commands

| Command | What it does |
|---|---|
| `make up` / `make down` | Start / stop the portal (your data and files are kept) |
| `make restart` | Apply `.env` changes |
| `make logs` · `make logs-worker` | Follow the logs (everything · the input-folder worker) |
| `make db-backup` / `make db-restore` | Save / restore the saved companies, trucks, inbox and history (`backup-*.sql`) |
| `make rebuild` | After `git pull`: rebuild images, reinstall dependencies, apply database changes |
| `make update` | Pull the latest version and rebuild, **only if there is one**; otherwise just make sure the portal is up |
| `make schedule-setup` / `make schedule-remove` | Run `make update` every day at 3 am / stop doing that |
| `make clean` | Remove containers **and the database** (asks first; converted files are kept) |
| `make help` | Every command |

### Automatic updates

`make update` checks GitHub for new commits on your branch (`git fetch`).
- **New commits:** it runs `git pull`, then `make down`, `make rebuild` and `make up`.
- **No new commits:** it pulls and rebuilds nothing, and only makes sure the portal is running.
- **It never overwrites your work.** It pulls nothing when the folder has uncommitted changes or
  commits of its own; it says so and leaves the portal running. Add `DRY_RUN=1` to see what it
  would do.

`make schedule-setup` runs it **every day at 3 am** as you, with no administrator rights. Running it
again replaces the job, and `make schedule-remove` removes it.

| Where you run make | What it creates |
|---|---|
| Windows (Git Bash, or `make` from cmd) | A Task Scheduler task, "Haul Book update", that runs `make.bat update-scheduled` while you're logged on. A console window shows briefly at 3 am. |
| WSL 2 Ubuntu | The same Windows task, running make inside your WSL distro (cron in WSL only runs while WSL is open). |
| Linux / macOS | A line in your crontab (`crontab -l` shows it). |

Each scheduled run is appended to `update.log` in the project folder (the last 5000 lines are kept).
For it to work unattended:
- The computer must be on, and you logged on (Windows), at 3 am; a missed run waits for the next
  day.
- **Docker Desktop must be running.** Turn on "Start Docker Desktop when you sign in".
- `git fetch` mustn't need a password. This repository is public, so an `https://` clone needs
  none. An SSH clone needs a key without a passphrase, or one loaded in an agent that the job can
  reach. Otherwise the log says `git fetch failed` and the current version keeps running.

## Troubleshooting

- **Port already in use:** set `WEB_PORT` / `API_PORT` / `DB_PORT` in `.env`, then `make restart`.
- **`make ps` shows containers restarting after Docker was restarted:** run `make down`, then
  `make up`.
- **Windows: `make` says "This make needs Git Bash":** you ran `make` in PowerShell, or outside the
  project folder. In PowerShell type `.\make <target>` in the project folder, or use cmd or Git
  Bash. If `make.bat` says Git Bash or GNU make wasn't found, install them (Setup, steps A.2 and
  A.3) and open a new window.
- **Windows: `make setup` stops with "additional privileges requested: pass --allow=fs.read=…"**
  (or the help shows `033[0;34m`): this is a Docker build permission, not Windows admin rights,
  and your copy predates the fix. Run `git pull`, then `make setup` again; it's safe to re-run. If
  you run `docker compose build` yourself instead of `make`, set `BUILDX_BAKE_ENTITLEMENTS_FS=0`
  first.
- **Windows: `make: command not found` in Git Bash:** close Git Bash and open a new window after
  installing make. If it's still missing, run `winget install -e --id ezwinports.make` again.
- **Windows: `docker` not found, or "cannot connect to the Docker daemon":** start Docker
  Desktop and wait until it says it is running. For WSL 2 (B), also turn on WSL integration for
  Ubuntu (step B.3) and reopen the terminal.
- **Windows (Hyper-V engine): "Mounts denied" or empty folders in the containers:** add the
  project folder and your input/output folders under Docker Desktop's **Settings → Resources →
  File sharing**.
- **Windows, WSL 2: slow, or not picking up code changes:** the project is probably under
  `/mnt/c`. Clone it into `~` inside Ubuntu instead. Only `INPUT_DIR` / `OUTPUT_DIR` should
  point at `/mnt/c`.

## Development

Development is Docker-only as well: every command runs in a container through `make`.

| Command | |
|---|---|
| `make ci` | Every CI check, in Docker: lint, format, typecheck, tests (including Postgres), builds. Run it before you push |
| `make test-all` | API tests (Jest, against Postgres) and web tests (Vitest) |
| `make format-api` · `make format-web` | Auto-format |
| `make migrate NAME=x` | Create and apply a database migration after editing `apps/api/prisma/schema.prisma` |
| `make shell-db` · `make sql Q="…"` · `make studio` | psql prompt · one SQL statement · Prisma Studio (<http://localhost:5555>) |
| `make lock` | Regenerate lockfiles after editing a `package.json` (then `make rebuild`) |

**Stack:** Next.js 15 / React 19 portal (:3100) · NestJS 11 API (:3000) and a BullMQ worker that
scans the input folder · PostgreSQL 18 via Prisma 6 · Redis 7 · shared Zod contracts
(`packages/shared`). More in [Tech_Stack.md](Tech_Stack.md).

```
packages/shared/   HTTP contracts (Zod) + constants shared by the API and the portal
apps/api/          NestJS API + worker: importers (one per source system), the ProMiles
                   writer, the saved company/unit list, the input folder
apps/web/          Next.js portal (one page)
docs/              File-format reference: docs/data-contracts.md
```

### Contributing

- **A new source system** needs a real sample export (one truck, one month, original file name).
  Open an issue with it, with company names and anything private removed. The steps to add an
  importer are in [ROADMAP.md](ROADMAP.md) → "Source importers".
- Keep `make ci` green. A change to an input or output format updates
  [docs/data-contracts.md](docs/data-contracts.md) and adds a test fixture.
- Agent and contributor rules are in [CLAUDE.md](CLAUDE.md). Planned work is in
  [ROADMAP.md](ROADMAP.md) and shipped work in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Alex Karnafel. Use it, change it, fork it. Haul Book is not affiliated with
ProMiles, Wialon or any ELD provider; their names are used only to describe the file formats it
reads and writes.
