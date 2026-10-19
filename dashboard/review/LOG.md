# Important dates review log

Newest first. Each entry: date, the snapshot commit reviewed, what changed in
`dashboard/important_dates_rules.json`, and anything that needs the user (suggested themes, a
Days forward change, a normaliser pull request).

## 2026-10-20 (second run): snapshot 006a368

No rules changes. Event changes since 2cd41a4 (1100 -> 1080) are only the effects of the 14 existing decisions, all applied (no unused decisions). `review_check.js` shows no PROBLEM lines, no new events and no theme or campus changes. Remaining flags (96 flagged) are the same set as the first review: daylight saving `theme-other` (8), unpaired openings/closings without a published partner, 4 `closing-may-be-after-window` (Days forward of about 450 would be needed), and same-day different holidays at MY/ID. Nothing new provable from the sources.

## 2026-10-20: snapshot 2cd41a4 (first full review)

14 decisions: 7 `pair` (Malaysia graduation ceremonies, 2023-2025: the source's "ceremonies end" row is the close of the period, labelled "start"), 7 `merge` (same public holiday at two campuses: 2023-01-02 AUS/MY New Year replacement; 2026 Chinese New Year, Hari Raya Aidilfitri days 1-2, Labour Day, Hari Raya Haji, Wesak at MY/ID). Events 1100 -> 1086.

Left as is:
- Daylight saving (8 `theme-other`): no suitable theme; suggest adding a theme (e.g. "Other dates"/"Calendar") if the user wants them out of Other.
- 2026-03-20/23 and 2026-06-01 MY/ID holidays and 2023-04-08: different holidays on the same day. `separate` cannot silence the flag because the rules never attempted to merge them, so the flag persists.
- Academic AUS/MY same-date duplicates (orientation, census, mid-semester break, assessment timetables): different intake labels, source wording; not merged.
- Unpaired openings/closings (teaching, Allocate+, scholarships, graduation applications): partners are not published or are labelled differently without proof; four 2026 openings (Summer A, NOV12, ID graduation) have `closing-may-be-after-window`; Days forward of about 450 would be needed to see their closings.
- Normaliser: no pull request needed this run.

## 2026-10-20: setup

No review yet. The first run reviews the whole snapshot.
