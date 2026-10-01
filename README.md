# VTAC Key Dates calendar (.ics)

A subscribable calendar of VTAC (Victorian Tertiary Admissions Centre) key dates: application deadlines, change-of-preference windows, ATAR release and offer rounds.

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
| **Apple Calendar** (macOS) | **File → New Calendar Subscription…** → paste either URL. Set *Auto-refresh* to *Every day*. On iPhone, open the `webcal://` link, or go to Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar |
| **Outlook** (web / new Outlook) | **Add calendar** → **Subscribe from web** → paste the https URL |

### Caveats

- **Refresh lag.** Google refreshes subscribed calendars on its own schedule, often every 12–24 hours, and you can't force it. Outlook is similar. Apple follows the auto-refresh setting you choose.
- **Reminders.** The feed includes alarms: 7 days and 1 day before deadlines, and 12 hours before results. **Google Calendar and Outlook ignore alarms in subscribed calendars**, so set default notifications on the subscribed calendar instead (Google: calendar settings → *Event notifications*). Apple Calendar honours the embedded alarms.
- Times are Melbourne time (AET), and your calendar converts them to your time zone. Events with no time on the VTAC page are all-day and show as "free".

## How it works

- `vtac_ical.py` fetches the page, expands each table (rowspans included) and turns each date into an event. The year is inferred from the section heading when the page omits it. It then applies `RULES` and writes `vtac.ics`.
- `.github/workflows/vtac-calendar.yml` runs every day at 20:17 UTC (about 6–7am Melbourne). It only commits `vtac.ics` when something other than the `DTSTAMP` timestamps changed, so the history shows only real date changes.
- Event UIDs are based on the section and title, not the date. When VTAC moves a date, the existing event moves in your calendar instead of being duplicated.
- If the page can't be fetched, or fewer than 5 events survive (for example, because VTAC redesigned the page), the script exits with an error and **doesn't overwrite** `vtac.ics`. The workflow fails and GitHub sends you a failure email, while subscribers keep the last good calendar.

## Customising: `RULES`

The config block at the top of `vtac_ical.py` contains an ordered `RULES` list. Each rule has one or more **filters**, which are case-insensitive regexes. All the filters in a rule must match for it to apply:

| Filter | Matched against |
|---|---|
| `match` | `"section \| table \| column \| title"` |
| `column` | column header, e.g. `Close`, `Change of preference closes`, `Offers released` |
| `table` | table name (first header cell), e.g. `Course applications`, `Results and ATAR` |
| `section` | the `<h2>` heading, e.g. `Key Dates & Fees: August 2026 - January 2027 …` |

and one or more **actions**:

| Action | Effect |
|---|---|
| `exclude: True` | drop the event (no later rules run) |
| `title: "VTAC: {title}"` | rewrite the title |
| `prefix: "⏰ "` | prepend to the title (applied once only) |
| `alarms: ["P7D", "PT2H"]` | replace the alarms (ISO-8601 durations before the event) |
| `all_day: True` | drop the time and make it an all-day event |
| `categories: ["Deadline"]` | add categories |

The defaults exclude the interstate change-of-preference deadlines and the "recommended" document date. They also tag deadlines (⏰), offers (🎓) and results (📊). Some examples:

```python
# Only care about current Year 12 rounds
{"match": r"Post-school applicants", "exclude": True},

# Skip mid-year intake sections
{"section": r"mid-year", "exclude": True},

# Deadlines only: drop every "Open"/"opens" event
{"column": r"^open$|opens$", "exclude": True},

# A 2-hour heads-up on offer releases
{"column": r"^offers released$", "alarms": ["PT2H"]},

# Everything as all-day events
{"match": r".", "all_day": True},
```

Other settings in the same block: `SKIP_DATE_COLUMNS` (columns whose dates only feed the label), `IGNORE_COLUMNS`, `DEFAULT_ALARMS`, `TIMED_EVENT_MINUTES` and `CALENDAR_NAME`.

### Preview changes locally

```bash
pip install -r requirements.txt
python vtac_ical.py --dry-run
```

This prints one line per kept event, e.g. `Mon 28 Sep 2026  17:00  ⏰ Timely applications for 2027 courses — Close`, and writes nothing. To avoid hitting VTAC repeatedly while you tweak rules, save the page once and use `--html dates.html`.

Other options: `--out PATH` (default `vtac.ics`) and `--min-events N` (default 5).

## Manual refresh

On GitHub: **Actions → Update VTAC calendar → Run workflow**. Or from a terminal:

```bash
gh workflow run vtac-calendar.yml -R edix904/vtac-calendar
```
