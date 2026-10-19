# Important dates review (daily, Claude routine)

The Calendar Dashboard Google Sheet's **Important_Dates** tab lists every university date once, with a
theme and campus flags (`Is AUS` / `Is MY` / `Is ID`). A report filters it by campus (e.g. `Is MY = 1`),
groups it by theme, and draws periods (`Is Period = 1`, start to end) on a Gantt chart. The rules in
`dashboard/ImportantDates.js` get most of it right. This review catches what they miss, and records each
correction in `dashboard/important_dates_rules.json`. The next sync (6am and 9am Melbourne) applies it.

## How the pieces fit

- The 6am sync writes the tab and commits a snapshot to `dashboard/snapshot/`:
  - `listings.json`: every input date, one per campus and source, with its **key** `CAMPUS|YYYY-MM-DD|title`.
  - `events.json`: the resulting rows, each with the `keys` of its listings, `flags` and review `notes`.
  - `status.json`: counts, the sync's look-ahead end (`window_end`) and any `unused_decisions`.
- `dashboard/important_dates_rules.json` holds `themes`, `theme_rules`, `standalone` and `decisions`.
  You edit **only** this file and `dashboard/review/LOG.md`.
- `node dashboard/review_check.js` checks the rules file and shows what your changes do to the snapshot.
- Sources, for checking dates: `monash-malaysia.ics`, `monash-indonesia.ics`, `vtac.ics`,
  `backfill/*.csv` (history), `principal_dates_rules.json` (title normalisation, used by the feeds).
  The Australian principal dates, Monash holidays and Semester summary come from Google calendars;
  you only see them in the snapshot.

## Each run

1. `git pull`. Read `dashboard/review/LOG.md`: the last entry names the snapshot commit it reviewed.
2. If the newest commit touching `dashboard/snapshot/` is older than 2 days, the sync or its export is
   broken. Add a LOG entry saying so (with the date of the last snapshot), commit, push, stop.
3. See what changed: `git diff <last reviewed snapshot commit> HEAD -- dashboard/snapshot/events.json`.
   On the first run, review everything.
4. Run `node dashboard/review_check.js` and work through **every item of its Worklist** (each
   one-day opening or closing, with candidate partners). Each item must end in exactly one of: a
   decision, a `standalone` pattern, or a line under "Needs a source" in your LOG entry saying
   what is missing and where you looked. Do not stop at "no partner in the repo": try the official
   pages with `curl -sL` (see below). If the network blocks them (HTTP 403 / `host_not_allowed`),
   say so once in the LOG so the user can allow those domains, and carry on with the rest.
   Then review, in this order. Read `events.json` with `jq`/`python`; don't load it into context whole.
   - **New and changed events** since the last review: right theme, sensible title, right campuses, dates
     match the source.
   - **Flags**:
     - `theme-other`: give it a theme. Prefer a `theme_rules` pattern that covers the milestone in general;
       use a `set` decision only for a one-off.
     - `opening-without-closing` / `closing-without-opening`: **the goal is one row (one Gantt bar) per
       period**, e.g. each graduation application round from its opening to its closing. Find the
       partner:
       1. Under other wording or at another campus (one campus's page may list a round's opening and
          another campus's page its closing; "Graduation ceremonies start: March ceremonies end at
          Kuala Lumpur" is really an end) → `pair` (works across campuses).
       2. Missing from the snapshot: look in the repo's sources (`backfill/*.csv`, the `.ics` feeds),
          then the official pages if the network allows: monash.edu/students/admin/dates/principal-dates
          (and its archive pages), monash.edu.my and monash.edu/indonesia principal dates, and their
          Wayback Machine copies (web.archive.org). Found it → `add` it with the exact URL as `source`;
          the sync then pairs it. Never estimate a date.
       3. A deadline on its own (nothing opens or closes it) → add its milestone to `standalone`.
       4. Not published anywhere you can reach → leave it, and list it under "Needs a source" in the
          LOG (one line each: row, what is missing, where you looked).
     - `closing-may-be-after-window`: the closing may exist in a source feed after `window_end`. The sync
       does not store feed dates past its look-ahead (Config → Days forward). Do **not** add those dates;
       mention in the LOG if a Days forward of 450 would be needed.
     - `possible-cross-campus-duplicate`: the same milestone on the same dates at another campus, not merged
       because the wording differs. If it is the same event (e.g. the same public holiday), `merge` the
       listings. If they are different (two different holidays on one day), add `separate` with both
       listings' keys; that clears the flag.
     - `unclassified-title`: the title normaliser did not recognise it; check theme and wording.
   - **Wrong merges or pairings**: an event that joins two different things → `separate` or `unpair`.
   - **Missing dates** you can prove from a source file: `add`, with `source` naming the file (or an
     official monash.edu / vtac.edu.au URL) and the line or section.
   - Same-day different holidays at two campuses (`possible-cross-campus-duplicate`): `separate`
     them so the flag clears.
   - `status.json` → `unused_decisions`: decisions that no longer match anything (the source changed).
     Remove them, or update their keys.
5. Edit `dashboard/important_dates_rules.json`, then run `node dashboard/review_check.js`. It must show no
   `PROBLEM` lines; read its preview (removed / new events, theme and campus changes) and make sure every
   change is intended. Also run `node dashboard/test_important_dates.js` (must pass).
6. Set `"version"` to today's date (Melbourne) if you changed anything.
7. Add a LOG entry (newest first), commit both files with the message
   `Important dates review YYYY-MM-DD: <n> decisions, <short summary>`, and push to `main`
   (`git pull --rebase` and retry if the push is rejected). If nothing needed changing, still add a
   one-line LOG entry so the next run knows what was reviewed.

## Decisions

Keys are copied exactly from `listings.json` (`key`) or `events.json` (`keys`). Every decision needs a
`reason` (shown in the sheet's Review Note column) and `added` (today's date).

| Decision | Shape | Effect |
| :- | :- | :- |
| `exclude` | `{key}` | Leave the listing out (not a real date, or a duplicate the rules can't see) |
| `unpair` | `{key}` | Never pair this listing automatically |
| `pair` | `{open, close, milestone?, title?}` | One period from two listings of the same campus |
| `merge` | `{keys: [...]}` | The events holding these listings are one event (any campuses) |
| `separate` | `{keys: [...]}` | Never merge the events holding these listings |
| `set` | `{key, theme?, title?}` | Theme or wording of the event holding the listing |
| `add` | `{campus` or `campuses, start, end?, title, milestone?, theme?, time?, source}` | A date missing from the sources |

## Themes

Teaching periods, Orientation, Census dates, Fees, Timetables, Assessments, Results, Graduations,
Scholarships, Course transfers, Re-enrolment, University closed, Public holidays, VTAC, Other.
Keep `Other` for things that really fit nowhere (e.g. daylight saving). Adding a theme is the
user's call: suggest it in the LOG instead.

## Do not

- Edit anything except `dashboard/important_dates_rules.json` and `dashboard/review/LOG.md` on `main`.
- Invent or estimate dates. Every `add` needs a source.
- Change `principal_dates_rules.json`, the feeds or code. If the title normaliser is wrong (a pattern
  that keeps needing decisions), push a branch `claude/…` with the fix and its tests
  (`python -m unittest test_principal_dates.py`, `node dashboard/test_normalise.js`), open a pull
  request, and link it in the LOG.
