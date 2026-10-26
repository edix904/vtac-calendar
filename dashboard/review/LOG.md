# Important dates review log

Newest first. Each entry: date, the snapshot commit reviewed, what changed in
`dashboard/important_dates_rules.json`, and anything that needs the user (suggested themes, a
Days forward change, a normaliser pull request).

## 2026-10-27: snapshot f7f6dc9

No rules changes. events.json is identical to 22e84c2 (only status.json changed; 29 decisions all applied, none unused; 1074 events). `review_check.js` shows no PROBLEM lines; `test_important_dates.js` passes. Worklist: the same 30 items; none has a provable partner, so all stay under "Needs a source" as listed in the 2026-10-20 third-run entry.
Official pages: **still not reachable** (monash.edu principal-dates HTTP 403; web.archive.org tunnel closed). Please allow monash.edu, monash.edu.my and web.archive.org. Normaliser: no pull request needed.

## 2026-10-26: snapshot 22e84c2

No rules changes. events.json is identical to 52be268 (only status.json changed; 29 decisions all applied, none unused; 1074 events, 75 flagged). `review_check.js` shows no PROBLEM lines; `test_important_dates.js` passes. Worklist: the same 30 items; none has a provable partner, so all stay under "Needs a source" as listed in the 2026-10-20 third-run entry.
Official pages: **still not reachable** (monash.edu principal-dates HTTP 403; web.archive.org unreachable). Please allow monash.edu, monash.edu.my and web.archive.org. Normaliser: no pull request needed.

## 2026-10-24: snapshot 52be268

No rules changes. events.json is identical to 92e07ab (only status.json changed; 29 decisions all applied, none unused; 1074 events, 75 flagged). `review_check.js` shows no PROBLEM lines and no new events, theme or campus changes; `test_important_dates.js` passes. Worklist: the same 30 items; none has a provable partner, so all stay under "Needs a source" as listed in the 2026-10-20 third-run entry.
Official pages: **still not reachable** (monash.edu principal-dates and monash.edu/indonesia HTTP 403 Cloudflare challenge; web.archive.org closes the tunnel). Please allow monash.edu, monash.edu.my and web.archive.org.
Left: daylight saving `theme-other` (8; suggest a theme such as "Other dates"); 37 `possible-cross-campus-duplicate` are academic AUS/MY same-date rows with different intake labels. Normaliser: no pull request needed.

## 2026-10-23: snapshot 92e07ab

No rules changes. events.json is identical to 580cdb6 (only status.json changed; 29 decisions all applied, none unused; 1074 events, 75 flagged). `review_check.js` shows no PROBLEM lines and no new events, theme or campus changes; `test_important_dates.js` passes. Worklist: the same 30 items; none has a provable partner, so all stay under "Needs a source" as listed in the 2026-10-20 third-run entry.
Official pages: **still not reachable** (monash.edu principal-dates, monash.edu.my and monash.edu/indonesia HTTP 403; web.archive.org closes the tunnel). Please allow monash.edu, monash.edu.my and web.archive.org.
Left: daylight saving `theme-other` (8; suggest a theme such as "Other dates"); 37 `possible-cross-campus-duplicate` are academic AUS/MY same-date rows with different intake labels. Normaliser: no pull request needed.

## 2026-10-22: snapshot 580cdb6

No rules changes. events.json is identical to dafce7f (only status.json changed; 29 decisions all applied, none unused; 1074 events, 75 flagged). `review_check.js` shows no PROBLEM lines and no new events, theme or campus changes; `test_important_dates.js` passes. Worklist: the same 30 items; none has a provable partner, so all stay under "Needs a source" as listed in the 2026-10-20 third-run entry.
Official pages: **still not reachable** (monash.edu principal-dates HTTP 403; web.archive.org closes the tunnel). Please allow monash.edu, monash.edu.my and web.archive.org.
Left: daylight saving `theme-other` (8; suggest a theme such as "Other dates"); 37 `possible-cross-campus-duplicate` are academic AUS/MY same-date rows with different intake labels. Normaliser: no pull request needed.

## 2026-10-21 (second run): snapshot dafce7f

No rules changes. Snapshot events.json is identical to 6204594 (only status.json changed; 29 decisions all applied, none unused; 1074 events). `review_check.js` shows no PROBLEM lines and no new events, theme or campus changes; `test_important_dates.js` passes. Worklist: the same 30 items as the previous entry, none with a provable partner, so all stay under "Needs a source" as listed in the third-run entry of 2026-10-20.
Official pages: **still not reachable** (monash.edu principal-dates HTTP 403; web.archive.org closes the tunnel). Please allow monash.edu, monash.edu.my and web.archive.org.
Left: daylight saving `theme-other` (8; suggest a theme such as "Other dates"); 37 `possible-cross-campus-duplicate` are academic AUS/MY same-date rows with different intake labels. Normaliser: no pull request needed.

## 2026-10-21: snapshot 6204594

No rules changes (29 decisions, all applied, none unused; 1074 events, 75 flagged). `review_check.js` shows no PROBLEM lines and no new events, theme or campus changes. Worklist: 30 items, all the same rows as the earlier entries below; none has a provable partner, so each stays under "Needs a source" as listed in the third-run entry (row numbers 1-30 map to those lines; items 2, 5, 6, 7 were rechecked against listings and candidate partners are other campuses/rounds, not proven).
Official pages: **still not reachable**. monash.edu principal-dates returns HTTP 403 and web.archive.org closes the tunnel. Please allow monash.edu, monash.edu.my and web.archive.org.
The sync's window now ends 2027-10-21, but listings hold no 2027 scholarship, graduation, NOV12, Summer A or Allocate+ dates, so the `closing-may-be-after-window` rows still have no closing in the feed.
Left: daylight saving `theme-other` (8; suggest a theme such as "Other dates"); remaining `possible-cross-campus-duplicate` (37) are academic AUS/MY same-date rows with different intake labels. Normaliser: no pull request needed.

## 2026-10-20 (manual, from the interactive session): graduation applications

Checked the 5 remaining one-day graduation-application rows against Wayback copies of the
official pages (the routine's environment can't reach monash.edu or web.archive.org). Their other
dates are not published:
- 2023 page (web.archive.org/web/20230727072932) and Oct 2025 page (web.archive.org/web/20251016142420)
  list only the September/October and December Australian rounds' openings and closings, never the
  October openings of the next April/May rounds.
- 2024 archive page (web.archive.org/web/20260325113921, .../archive/2024) lists the December round
  opening (1 Aug 2024) with no closing.
Recorded as 5 `unpair` decisions (an `unpair` now also clears the missing-partner flag) and 1
`separate` (2024-01-15 April-in-Malaysia vs May-in-Australia closings). Graduation applications are
now 15 periods plus these 5 single dates; a Gantt chart filtered on Is Period = 1 shows one bar per round.

## 2026-10-20 (third run): snapshot 006a368

9 decisions (23 total, all applied; no unused): 3 `pair`, 2 `merge`, 4 `separate`. Events 1080 -> 1074; flags 96 -> 82 (closing-without-opening 22 -> 17, opening-without-closing 21 -> 18, possible-cross-campus-duplicate 47 -> 39).
- `pair`: MY mid-semester break S1 2024 (04-01 to 04-05); AUS graduate research scholarships Round 1 (2025-09-01 to 2026-03-31) and Round 2 (2025-11-03 to 2026-05-31). The source labels these openings with the previous year (see the 1 Sep to 31 Mar and 1 Nov to 31 May rows already paired for 2024/2025).
- `merge`: MY Summer A (2026-01-30) and Summer B (2026-02-06) teaching ends into the AUS periods.
- `separate`: same-day different holidays 2023-04-08, 2026-03-20, 2026-03-23, 2026-06-01 (MY/ID, AUS/MY); their flags cleared.

Official pages: **not reachable**. monash.edu principal-dates returns HTTP 403 (Cloudflare challenge) and web.archive.org closes the tunnel, so nothing could be added from them. Please allow those domains (monash.edu, monash.edu.my, web.archive.org). `backfill/*.csv` and the .ics feeds hold no partners for the items below.

Needs a source (row: what is missing):
- AUS 2023-01-15 grad applications close May round: opening (2022). MY 2024-01-15 close April; AUS 2024-01-15 close May: openings (2023) not in any source. AUS/MY 2026-01-15 close April/May: opening (2025) not in snapshot.
- AUS 2024-08-01 grad applications open December round: closing absent.
- AUS 2025-12-08 grad ceremonies start December round: end absent. ID 2026-11-21 ceremonies start November round: end absent (MY 2026-11-29 is another campus's round, not proven).
- MY 2023-01-20, AUS 2023-01-27, AUS 2024-01-24 teaching ends (Oct/Nov intake 2022-23): openings pre-date the sources.
- AUS 2023-01-27 Allocate+ preference entry closes S1: opening absent (MY opens 2023-01-06 is another campus, different date).
- AUS 2023-03-31 and 2023-05-31 scholarship closes (Round 1/2, 2023): openings (2022) absent. AUS 2024-04-05 Round 3/2024 open: close (2024-08-31) absent. AUS 2026-09-01 Round 1/2026 open and 2026-11-01 Round 2/2026 open: closings (Mar/May 2027) beyond the window; 2026-11-01 is `closing-may-be-after-window`.
- Allocate+ adjustment opens: AUS 2024-09-16 Summer A, 2024-10-07 Summer B, 2025-09-15 NOV12, 2026-09-14 Summer B (SSB-02), 2026-10-05 Summer B: closings absent.
- AUS 2024-11-14 Orientation starts NOV12: end absent. AUS 2024-11-18, 2025-11-03, 2026-11-02, 2026-11-23 teaching starts (NOV12/Summer A): ends absent or beyond window. AUS 2024-12-23 mid-semester break starts NOV12: end absent.
- MY 2024-12-31 Re-enrolment (late) ends: the 2024-11-30 start already pairs with the 2024-12-13 end; the 12-31 end conflicts, so no pairing without a source.
- MY 2025-02-14 final assessments and teaching end Oct intake: start absent. AUS 2025-02-14, 2025-05-30, 2026-05-29 teaching ends (Summer A/SS-S1 variants), AUS 2026-07-27 teaching starts (S2-SS-02 variants), MY 2026-10-30 FY-32 ends, AUS 2026-11-27 MO-TP6 ends: partner with matching label not in the snapshot.
- Days forward of about 450 would be needed for the 4 `closing-may-be-after-window` rows.

Left: daylight saving `theme-other` (8; suggest a theme such as "Other dates" if the user wants them out of Other); academic AUS/MY same-date duplicates (different intake labels). Normaliser: no pull request needed.

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
