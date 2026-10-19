# VTAC Key Dates calendar (.ics)

A subscribable calendar of VTAC (Victorian Tertiary Admissions Centre) key dates: application deadlines, change-of-preference deadlines, ATAR release and offer rounds. It also includes a historical backfill from 2023 for comparing years.

VTAC only publishes these dates as HTML tables at <https://vtac.edu.au/dates>. This repo scrapes that page once a day and publishes the result as `vtac.ics`. It's **unofficial** and has no connection to VTAC. Always check the source page before acting on a date.

## Subscribe

**Subscription URL:**

```
https://raw.githubusercontent.com/edix904/vtac-calendar/main/vtac.ics
```

The Apple / webcal form is:

```
webcal://raw.githubusercontent.com/edix904/vtac-calendar/main/vtac.ics
```

| App | How |
|---|---|
| **Google Calendar** (web) | Left sidebar → **Other calendars** → **+** → **From URL** → paste the https URL → **Add calendar** |
| **Apple Calendar** (macOS) | **File → New Calendar Subscription…** → paste either URL. Set *Auto-refresh* to *Every day*. On iPhone, open the `webcal://` link |
| **Outlook** (web / new Outlook) | **Add calendar** → **Subscribe from web** → paste the https URL |

### Caveats

- **Refresh lag.** Google refreshes subscribed calendars on its own schedule, often every 12–24 hours, and you can't force it. Outlook is similar.
- **Reminders.** Deadlines carry alarms 7 days and 1 day before. **Google Calendar and Outlook ignore alarms in subscribed calendars**, so set default notifications on the subscribed calendar instead. Apple Calendar honours them.

## Event names

Every event is an **all-day event with the VTAC time in the title**, so it sits in Google Calendar's all-day bar. Titles follow one fixed pattern, so the same milestone has the same title every year:

```
VTAC <milestone>[: <detail>] (<time, Melbourne>)
```

| Milestone | Titles |
|---|---|
| Course applications | `VTAC applications open` · `VTAC applications close: Timely` / `Late` / `Very late` / `January` · `VTAC applications open: January` |
| Equity schemes (SEAS) & scholarships | `VTAC equity & scholarships open` / `close` |
| Supporting documents | `VTAC documents due: <rounds>` |
| Results | `VTAC ATARs released: VCE` / `IB` · `VTAC ATAR statements: VCE` / `IB` |
| Change of preference | `VTAC preferences close: <round>` |
| Offers | `VTAC offers: <round>` |
| Mid-year intake | the same names with `VTAC mid-year …` (e.g. `VTAC mid-year applications close`); rounds are named by month (`Jun round 1`, `Jul round 2`) |

Rounds are written `Nov round`, `Dec round`, `Jan round 1`, `Jan round 2`, `Feb round 1` and so on. To group by milestone across years, strip the trailing time, e.g. `REGEXREPLACE(title, " \([^)]*\)$", "")`.

Deliberately left out:
- **Change-of-preference openings.** Preferences reopen at the moment each offer round is released, so these duplicate the `VTAC offers` events.
- **Interstate and IB-only deadlines.**
- **"Recommended" document dates.**
- **Eligible-applicant breakdowns.** When applicant groups have different deadlines for the same round (e.g. `VTAC preferences close: Jan round 1` for post-school vs Year 12), each date is a separate event with the same title.
- **Fees, payments and offer-permission dates.**

The rules that produce these names are the `NAMES` table in `vtac_ical.py`. If VTAC adds a row the table doesn't recognise, the event still appears under a generic `VTAC <row> — <column>` title, and the run log shows a `WARNING: no NAMES entry …` line.

## Historical backfill (2023 onwards)

`backfill.py` rebuilds past years from Wayback Machine snapshots of `vtac.edu.au/dates` and `vtac.edu.au/dates.html`. It uses the same parser, `NAMES` and `RULES` as the live feed, so historical titles match the live calendar exactly. Older pages split dates by applicant type; the backfill keeps domestic Year 12 and post-school dates and drops international and Graduate Entry Teaching.

```bash
python backfill.py        # writes backfill/vtac_backfill.csv
```

The CSV uses the layout of the Calendar Dashboard Data **Backfill** tab (`Calendar Name, Title, Start Date, End Date (incl.), Source, Source URL`). Each row links to the snapshot it came from. The snapshot list is saved to `.wayback-cache/index.txt`. If the Wayback Machine is down, which happens often, the backfill uses the saved list; `--offline` skips the archive entirely. By default the backfill runs from 2023-01-01 up to (not including) the first date in `vtac.ics`. The committed CSV was built with `--until 2026-10-01`, the day the feed was added to the Calendar Dashboard sync, because that sync only stores feed events from its first run onwards. The dashboard script embeds these rows (`VtacBackfill.js`) and writes them to its Backfill tab. Within each cycle, the newest snapshot that lists a milestone wins. Snapshots are cached in `.wayback-cache/`.

## How it works

- `vtac_ical.py` fetches the page and expands each table, honouring rowspans and stacked headers. It infers missing years from the section heading, names events with `NAMES`, filters them with `RULES`, removes duplicates and writes `vtac.ics`.
- `.github/workflows/vtac-calendar.yml` runs every day at 20:17 UTC (about 6–7am Melbourne). It commits `vtac.ics` only when something other than the `DTSTAMP` timestamps changed.
- Event UIDs come from the admissions cycle (e.g. `2027`, `mid-year 2026`) and the canonical name, not the date, the time or VTAC's heading text. When VTAC moves a date or rewords a heading, the event updates instead of being duplicated.

## When VTAC changes the page

The workflow runs `test_vtac_ical.py` and then `vtac_ical.py --strict`. What happens depends on how much of the page still parses:

| Situation | Calendar | Workflow |
|---|---|---|
| Everything recognised | Published | Passes |
| Some events need attention: no `NAMES` entry (generic title such as `VTAC Standard applications — Closes`), an offer round that can't be named, or a date more than ~13 months behind or ~18 months ahead | **Published**, so new dates aren't lost | **Fails**, so GitHub emails you. The run summary lists each problem |
| Fewer than 5 events, or less than half as many as the current `vtac.ics` | **Not overwritten**; subscribers keep the last good copy | **Fails** |
| The page can't be fetched | Not overwritten | Fails |

To fix a "needs attention" run, add or adjust a `NAMES` entry, check it with `python vtac_ical.py --dry-run`, then push. If a big drop is genuine (VTAC removed a whole table on purpose), use **Actions → Update VTAC calendar → Run workflow** and tick *allow_drop*.

Formats already handled:
- **Dates:** `3 August`, `3rd Aug`, `August 3`, `Aug 3, 2027`, `Sept`, with or without a year.
- **Times:** `5pm`, `5:15pm`, `5.15pm`, `5 pm`, `12 noon`, `midday`, `midnight`, `17:00`, plus extra text like `(VTAC account 2pm)` or `(9am AEST)`.
- **Offer rounds:** `February offer round 1`, `Feb round 1`, `January offer round one`, and unnamed mid-year `Round 1/2/3` (named by release month).
- **Wrong explicit years:** a year that falls outside its section is corrected. VTAC has published such typos.
- **Headings:** with only an intake year (`for courses commencing in 2028`), or no heading at all.
- **Page layouts:** split by applicant type (2022), tabs (2023–24) and single tables (2025+). `test_vtac_ical.py` covers these cases.

GitHub disables scheduled workflows after 60 days without repository activity, and VTAC can go months without changing a date. The workflow therefore commits `.github/heartbeat` after 45 quiet days.

## Customising: `RULES`

`RULES` in `vtac_ical.py` runs after naming. Each rule has filters, which are case-insensitive regexes, and every filter in a rule must match:

| Filter | Matched against |
|---|---|
| `match` | `"section \| table \| column \| row \| qualifier \| title"` |
| `column` / `table` / `section` | the source column header, table name and section heading |
| `qualifier` | text after the date in the same cell, e.g. `SA/NT students` |

Actions: `exclude: True`, `title: "… {title}"`, `prefix: "…"`, `alarms: ["P7D"]`, `categories: [...]`. Examples:

```python
{"section": r"mid-year", "exclude": True},             # skip the mid-year intake
{"match": r"VTAC applications open", "exclude": True}, # deadlines only
{"match": r"VTAC offers", "prefix": "🎓 "},            # emoji on offer days
```

Renaming a milestone means editing `NAMES`. Re-run `backfill.py` afterwards so the history keeps matching.

### Preview changes locally

```bash
pip install -r requirements.txt
python vtac_ical.py --dry-run
```

This prints one line per kept event, e.g. `Mon 28 Sep 2026  VTAC applications close: Timely (5pm)`, and writes nothing. To avoid hitting VTAC repeatedly, use `--html saved-page.html`.

## Manual refresh

On GitHub: **Actions → Update VTAC calendar → Run workflow**, or:

```bash
gh workflow run vtac-calendar.yml -R edix904/vtac-calendar
```

# Monash Malaysia & Indonesia principal dates (.ics)

Two more subscribable calendars, built the same way as the VTAC one: the principal dates of
[Monash University Malaysia](https://www.monash.edu.my/student-services/student-admin/principal-dates-for-monash-university-malaysia)
and [Monash University Indonesia](https://www.monash.edu/indonesia/important-dates/principal-dates), scraped daily. Unofficial.

| Calendar | Subscription URL |
|---|---|
| **Monash Malaysia** | `https://raw.githubusercontent.com/edix904/vtac-calendar/main/monash-malaysia.ics` |
| **Monash Indonesia** | `https://raw.githubusercontent.com/edix904/vtac-calendar/main/monash-indonesia.ics` |

Subscribe as for VTAC (Google Calendar: **Other calendars → + → From URL**). Events are all-day; a time, if any, is in brackets at the end of the title.

## Consistent names across campuses and years

Each campus words the same milestone differently, and the wording changes between years
("Mid-semester break: begins for semester one", "Mid-semester break starts: Semester one";
"Allocate+ adjustment: opens 10am", "Allocate+ adjustment opens at 10am"). Every title is
rewritten to one pattern:

```
<Milestone>: <Teaching period> (<code>)[, <Teaching period> (<code>)] [(time)]
```

e.g. `Mid-semester break starts: Semester 1 (S1-01)`, `Allocate+ adjustment opens: Semester 1 (S1-01) (10am)`,
`University closed: Hari Raya Aidilfitri Day 1`. Explanatory sentences after the first full stop
go in the event description with the official wording.

The rules live in **`principal_dates_rules.json`** (data, not code) and are shared:
`principal_dates.py` uses them for the feeds, and the Calendar Dashboard sheet fetches the same
file on every sync to normalise all three campuses, including the Australian dates. Check a title with:

```bash
python principal_dates.py --normalise "Mid-semester break: begins for semester one (S1-01)"
```

A title that no rule recognises still appears, with its own wording; the run log notes it, and
the dashboard lists it on its **Normalise_Review** tab. A weekly scheduled Claude task reads that
tab and proposes new rules in a pull request. `normalise_cases.json` holds the expected results
that both implementations are tested against.

## How it works

- `monash_fetch.py` loads the pages with headless Chromium: they sit behind a Cloudflare browser
  check that plain HTTP requests fail. If that fails it falls back to the newest Wayback snapshot.
- `principal_dates.py` reads every Day/Date/Description table (Malaysia: Semester 1, Semester 2 and
  October intake views, deduplicated; the Medicine and Year 5 rotation tables are skipped) and the
  single full-year table (Indonesia). TBC dates are skipped until they get a date.
- `.github/workflows/principal-dates.yml` runs daily at 20:41 UTC and on rule changes, and commits
  the .ics files only when something other than `DTSTAMP` changed. It fails (so GitHub emails you)
  when a page can't be fetched, parses to fewer than 20 events, drops by more than half, or was
  only available from the Wayback Machine.
- Event UIDs come from campus + year + normalised title, so a moved date updates the event.

## History for the dashboard

`principal_dates_backfill.py` writes `backfill/monash_my_id_backfill.csv` (Backfill tab layout) from
the Malaysia archive pages for 2023–2025 plus the current pages, up to the day the feeds were added
to the dashboard. Older Indonesia pages are not online or archived, so Indonesia starts in 2026.

## Calendar Dashboard integration (`dashboard/`)

`dashboard/Normalise.js`, `dashboard/PrincipalDates.js` and `dashboard/ImportantDates.js` are copied into the dashboard's Apps
Script project; `dashboard/build_embeds.py` generates `NormaliseRules.js` (fallback copy of the
rules) and `CampusBackfill.js` (the backfill rows). The sync then adds:

- **Events** columns: `Campus`, `Is AUS` / `Is MY` / `Is ID` (true for the event's campus, campuses named
  in the title, and campuses that list the same milestone for the same teaching period on the same
  day), `Shared With`, `Milestone`, `Teaching Period`, `Period Codes`, `Normalised Title`,
  `Milestone Time`, `Classified`, and the event's `Academic Period` / `Phase` / `Week`.
- **Days** columns per campus: `<campus> Principal Dates`, `Academic Period`, `Academic Phase`, `Academic Week`.
- **Academic_Weeks** tab: one row per campus × teaching period × week (Orientation, Teaching 1–12,
  Mid-semester break, Swot vac, Exams), derived the same way for every campus from the normalised
  teaching start / end, break, swot vac and final assessment dates, so weeks compare like for like.
  For Australia this matches the Semester summary calendar's week numbers exactly (2023–2026).
- **Normalise_Overrides** tab: manual classifications (exact title → milestone / period / phase / exclude) that win over the rules.
- **Important_Dates** tab (`dashboard/ImportantDates.js`): each event once, with `Is AUS` / `Is MY` / `Is ID`
  (1 or 0), `Is Shared` and `Campuses`, so a report filtered on `Is MY = 1` gets every Malaysia-relevant date,
  including ones that come from the Australian calendars. It lists principal dates of all three campuses,
  Monash holidays (as `University closed: …`), non-university holidays, VTAC dates and Semester summary items
  other than week labels. A campus's listings of one event (e.g. the Monash holidays calendar and the
  principal dates both closing the university that day) become one row, and campuses join an event by
  the `Shared With` rule above. `Event` shows one wording; `AUS Title` / `MY Title` / `ID Title` keep each
  campus's own.
  Openings and closings are one **period** row (`Is Period` = 1) from `Start Date` to `End Date (incl.)`,
  e.g. `Allocate+ preference entry opens` + `… closes` for Semester 1 (S1-01) →
  `Allocate+ preference entry: Semester 1 (S1-01)`, with `Start Time` / `End Time` and `Days`. They pair
  per teaching period code (so a Semester 1 + Full year teaching start gives two periods), never past
  the next opening of the same code; ones without a partner stay one-day rows. Use it for Gantt charts
  or to filter activity between `Start Date` and `End Date (incl.)`.
  Each row has a **Theme** (Teaching periods, Orientation, Census dates, Fees, Timetables, Assessments,
  Results, Graduations, Scholarships, Course transfers, Re-enrolment, University closed, Public holidays,
  VTAC, Other) from `theme_rules` in `dashboard/important_dates_rules.json`, which the sync fetches from
  `main` on every run (fallback: the embedded copy in `ImportantDatesRules.js`).

### Daily Claude review

The rules miss things, so a scheduled Claude routine reviews the output every morning
(`dashboard/review/REVIEW.md`):

1. The 6am sync commits a snapshot of its inputs and output to `dashboard/snapshot/` (needs a GitHub
   token in the script property `GITHUB_TOKEN`: fine-grained, this repository only, Contents read/write).
   Rows the rules are unsure about carry flags there (an opening without its closing, a possible
   cross-campus duplicate, theme Other, …).
2. The routine reviews new and flagged events and commits corrections (`decisions`, `theme_rules`,
   `standalone`) to `dashboard/important_dates_rules.json` on `main`, with an entry in
   `dashboard/review/LOG.md`. `node dashboard/review_check.js` validates the file and previews its effect.
3. The 9am sync applies them; the sheet's **Review Note** column shows which decision changed a row.

Revert a review commit to undo its corrections.

Tests: `python -m unittest test_principal_dates.py`, `node dashboard/test_normalise.js` and
`node dashboard/test_important_dates.js`; `node dashboard/review_check.js` checks the review rules against the
latest snapshot.
