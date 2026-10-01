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

The CSV uses the layout of the Calendar Dashboard Data **Backfill** tab (`Calendar Name, Title, Start Date, End Date (incl.), Source, Source URL`). Each row links to the snapshot it came from. The backfill runs from 2023-01-01 up to (not including) the first date in `vtac.ics`, so it never overlaps the live feed. Within each cycle, the newest snapshot that lists a milestone wins. Snapshots are cached in `.wayback-cache/`.

## How it works

- `vtac_ical.py` fetches the page and expands each table, honouring rowspans and stacked headers. It infers missing years from the section heading, names events with `NAMES`, filters them with `RULES`, removes duplicates and writes `vtac.ics`.
- `.github/workflows/vtac-calendar.yml` runs every day at 20:17 UTC (about 6–7am Melbourne). It commits `vtac.ics` only when something other than the `DTSTAMP` timestamps changed.
- Event UIDs come from the section and canonical name, not the date or time. When VTAC moves a date, the event moves instead of being duplicated.
- If the page can't be fetched, or fewer than 5 events survive, the script exits with an error and **doesn't overwrite** `vtac.ics`. The workflow fails and GitHub sends you a failure email.

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
