#!/usr/bin/env python3
"""Scrape VTAC key dates (https://vtac.edu.au/dates) into a subscribable iCalendar feed.

Unofficial. VTAC only publishes these dates as HTML tables; this script turns them into
an RFC 5545 .ics file of all-day events with the time in the title, named consistently
(see NAMES) so the same milestone has the same title every year.

Usage:
    python vtac_ical.py                 # writes vtac.ics
    python vtac_ical.py --dry-run       # preview kept events, write nothing
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import tempfile
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from icalendar import Alarm, Calendar, Event, vDuration

# ============================================================================ CONFIG
URL = "https://vtac.edu.au/dates"
USER_AGENT = "vtac-ical/1.0 (+https://github.com/edix904/vtac-calendar)"
TZ = ZoneInfo("Australia/Melbourne")  # all VTAC times are AET
CALENDAR_NAME = "VTAC Key Dates"

# Dates in these columns don't become events (they duplicate the Offer rounds table),
# but their text, minus the dates, feeds the row label (e.g. "November round").
SKIP_DATE_COLUMNS = {"Eligible for offers", "Eligible for offers in", "Eligible for offers on"}

# Ignored entirely: no events, no label text. Any cell containing "$" is also never a label.
IGNORE_COLUMNS = {"Apply by", "Pay by", "Fee", "Eligible applicants", "First round of eligible offers"}

# Older pages split dates by applicant type. Keep domestic Year 12 and post-school only,
# which is what the current single-table page covers.
EXCLUDE_GROUPS = r"international|^IY12$|^GET$|graduate entry"

# ISO-8601 durations before the event (all-day events start at midnight), e.g. ["P1D"].
DEFAULT_ALARMS: list[str] = []

# Canonical titles. First match wins; filters are case-insensitive regexes over
#   table / column / row (the row's label text) / section / qualifier (text after the date)
# and every filter present must match. "name" may use {rounds} (offer rounds named in the
# row, normalised to e.g. "Nov round", "Jan round 1", "Feb rounds"). name=None drops the
# event. Unmatched events keep a generic "VTAC {row} — {column}" title and are reported.
NAMES: list[dict] = [
    # Course applications
    {"table": r"^course applications", "row": r"^timely|^applications for courses commencing", "column": r"^open",
     "name": "VTAC applications open"},
    {"table": r"^course applications", "row": r"^applications for courses commencing", "column": r"^close",
     "name": "VTAC applications close: Timely"},
    {"table": r"^course applications", "row": r"^timely", "column": r"^close", "name": "VTAC applications close: Timely"},
    {"table": r"^course applications", "row": r"^late", "column": r"^close", "name": "VTAC applications close: Late"},
    {"table": r"^course applications", "row": r"^very late", "column": r"^close", "name": "VTAC applications close: Very late"},
    {"table": r"^course applications", "row": r"^(late|very late)", "column": r"^open", "name": None},
    {"table": r"^course applications", "row": r"january|subsequent rounds", "column": r"^open",
     "name": "VTAC applications open: January"},
    {"table": r"^course applications", "row": r"january|subsequent rounds", "column": r"^close",
     "name": "VTAC applications close: January"},
    # (events in mid-year sections get "VTAC mid-year ..." automatically; see canonical_name)
    {"table": r"^course applications", "row": r"mid-?year", "column": r"^open", "name": "VTAC applications open"},
    {"table": r"^course applications", "row": r"mid-?year", "column": r"^close", "name": "VTAC applications close"},
    # SEAS / equity schemes and scholarships (separate tables before 2025, combined since)
    {"table": r"seas|equity|scholarship", "row": r"recommended|guaranteed", "name": "VTAC equity & scholarships: docs recommended"},
    {"table": r"seas|equity|scholarship", "column": r"^open", "name": "VTAC equity & scholarships open"},
    {"table": r"seas|equity|scholarship", "column": r"^(close|submit by)", "name": "VTAC equity & scholarships close"},
    # Personal statement / supporting documentation
    {"table": r"personal statement|supporting doc", "row": r"edit", "name": None},
    {"table": r"personal statement|supporting doc", "name": "VTAC documents due: {rounds}"},
    # Results
    {"table": r"results|atar$", "row": r"change of address|NHT", "name": None},
    {"table": r"results|atar$", "row": r"^vce", "column": r"online|available|released", "name": "VTAC ATARs released: VCE"},
    {"table": r"results|atar$", "row": r"^vce", "column": r"statement|^post$", "name": "VTAC ATAR statements: VCE"},
    {"table": r"results|atar$", "row": r"^ib", "column": r"online|available|released", "name": "VTAC ATARs released: IB"},
    {"table": r"results|atar$", "row": r"^ib", "column": r"statement|^post$", "name": "VTAC ATAR statements: IB"},
    {"table": r"results|atar$", "name": None},
    # Change of preference (column names vary: Open/Close, From/To, "Change of preference opens")
    {"table": r"change of preference", "column": r"open|^from$", "name": "VTAC preferences open: {rounds}"},
    {"table": r"change of preference", "column": r"close|^to$", "name": "VTAC preferences close: {rounds}"},
    # Offer rounds
    {"table": r"^(domestic )?offer|^offers$", "column": r"released|emailed", "name": "VTAC offers: {rounds}"},
]

# Applied in order to every named event. Filters (case-insensitive regex, all present must match):
#   match      anywhere in "section | table | column | row | qualifier | title"
#   column / table / section / qualifier
# Actions:
#   exclude: True         drop the event (final, no further rules run)
#   title: "...{title}"   rewrite the title (before the time is appended)
#   prefix: "..."         prepend to the title (once)
#   alarms: [...]         replace the alarms (ISO-8601 durations)
#   categories: [...]     add CATEGORIES
RULES: list[dict] = [
    # Summary/admin tables on older pages that duplicate or don't matter.
    {"table": r"^key dates$|^for consideration|^payments?$|^permissions|^changing permission|international", "exclude": True},
    # International-applicant rows inside domestic tables.
    {"match": r"\binternational\b", "exclude": True},
    # Interstate change-of-preference deadlines (keep ones that cover Victorian/VCE students).
    {"qualifier": r"^(?!.*\b(vic|vce|victorian)).*\b(SA/NT|SA|NT|WA|ACT|NSW|Queensland|Qld|Tas|Tasmanian?)\b", "exclude": True},
    # IB-only change-of-preference windows.
    {"qualifier": r"^IB\b|IB applicants only", "exclude": True},
    # Soft "recommended" date; the real deadline is kept.
    {"match": r"recommended", "exclude": True},
    # Change of preference reopens when each offer round is released, so these just
    # duplicate the offer dates.
    {"column": r"open|^from$", "table": r"change of preference", "exclude": True},
    {"match": r"VTAC (applications|equity & scholarships|preferences) close|documents due",
     "alarms": ["P7D", "P1D"], "categories": ["Deadline"]},
    {"match": r"VTAC offers", "categories": ["Offers"]},
    {"match": r"VTAC ATAR", "categories": ["Results"]},
    # --- Examples (uncomment to use) ---
    # {"section": r"mid-year", "exclude": True},               # skip mid-year intake sections
    # {"match": r"VTAC applications open", "exclude": True},   # deadlines only
    # {"match": r"VTAC offers", "prefix": "🎓 "},
]
# ===================================================================================

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
# Full or abbreviated month names ("Sept", "Aug.").
MONTH_RE = (r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?"
            r"|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?![a-z])\.?")
TIME_TOKEN = (r"\d{1,2}(?:[:.]\d{2})?\s*[ap]\.?m\.?|\d{1,2}\s*noon|noon|midday|midnight"
              r"|(?:[01]?\d|2[0-3]):[0-5]\d")
# "3 August", "3rd Aug", "August 3", "Aug 3, 2027", each with an optional year and "(time)".
DATE_RE = re.compile(
    rf"\b(?:(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\s+(?P<month>{MONTH_RE})"
    rf"|(?P<month2>{MONTH_RE})\s+(?P<day2>\d{{1,2}})(?:st|nd|rd|th)?(?!\d))"
    rf"(?:,?\s+(?P<year>\d{{4}}))?"
    rf"(?:\s*\((?:[^()]*?\s)?(?P<time>{TIME_TOKEN})(?:\s[^()]*)?\))?",
    re.IGNORECASE,
)
ROUND_RE = re.compile(
    rf"\b(?:(?P<m1>{MONTH_RE}|mid-?year)\s+(?:and|&)\s+)?(?P<m2>{MONTH_RE}|mid-?year)\s+"
    rf"(?:offers?\s+)?(?P<word>rounds?)(?:\s+(?P<n>\d+|one|two|three|four|five))?",
    re.IGNORECASE,
)


def month_num(name: str) -> int:
    return [m[:3].lower() for m in MONTHS].index(name[:3].lower()) + 1


def date_parts(dm) -> tuple[int, int, int | None]:
    """(day, month, explicit year or None) from a DATE_RE match, either word order."""
    day = int(dm.group("day") or dm.group("day2"))
    month = month_num(dm.group("month") or dm.group("month2"))
    return day, month, int(dm.group("year")) if dm.group("year") else None
GROUP_IDS = {"CY12": "Year 12", "IY12": "IY12", "NY12": "Post-school", "GET": "GET"}
GROUP_HEADING_RE = re.compile(r"year 12|non year 12|post-school|graduate entry", re.IGNORECASE)
FILTER_KEYS = ("match", "column", "table", "section", "qualifier")
NAME_FILTER_KEYS = ("table", "column", "row", "section", "qualifier")
ACTION_KEYS = ("exclude", "title", "prefix", "alarms", "categories")


# ---------------------------------------------------------------- HTML helpers
def cell_text(cell) -> str:
    for br in cell.find_all("br"):
        br.replace_with(" ")
    # Text is split across <span>s mid-word, so join with no separator.
    text = re.sub(r"\s+", " ", cell.get_text("")).strip()
    text = re.sub(r"(?<=[\w)])[*^]+", "", text)  # footnote markers
    return text.strip()


def expand_rows(rows) -> tuple[list[list[str]], list[list[bool]]]:
    """Expand <tr>s into a rectangular grid honouring rowspan/colspan.

    Returns (grid, copied) where copied[r][c] is True for cells filled from a span
    of an earlier cell (they're used for labels only, never to emit dates)."""
    grid: dict[tuple[int, int], str] = {}
    copied: dict[tuple[int, int], bool] = {}
    width = 0
    for r, tr in enumerate(rows):
        c = 0
        for cell in tr.find_all(["th", "td"], recursive=False):
            while (r, c) in grid:
                c += 1
            text = cell_text(cell)
            rs = max(1, int(re.sub(r"\D", "", str(cell.get("rowspan", 1))) or 1))
            cs = max(1, int(re.sub(r"\D", "", str(cell.get("colspan", 1))) or 1))
            for dr in range(rs if rs < len(rows) + 1 else 1):
                for dc in range(cs):
                    grid[(r + dr, c + dc)] = text
                    copied[(r + dr, c + dc)] = (dr, dc) != (0, 0)
            c += cs
            width = max(width, c)
    nrows = len(rows)
    out = [[grid.get((r, c), "") for c in range(width)] for r in range(nrows)]
    mask = [[copied.get((r, c), False) for c in range(width)] for r in range(nrows)]
    return out, mask


def section_anchor(heading: str, today: date) -> tuple[int, int]:
    """(start month, year) of a section, used to infer missing years.

    'August 2026 - January 2027' -> (8, 2026). With only a year it's read as the intake:
    'courses commencing in 2028' -> (7, 2027), 'mid-year 2028' -> (4, 2028). With only a
    month, the year putting that month nearest the present is used. With neither, the
    admissions cycle in progress (starting July) is assumed."""
    m = re.search(rf"\b({MONTH_RE})", heading, re.IGNORECASE)
    y = re.search(r"\b(20\d{2})\b", heading)
    if m and y:
        return month_num(m.group(1)), int(y.group(1))
    if y:
        year = int(y.group(1))
        return (4, year) if re.search(r"mid-?year", heading, re.IGNORECASE) else (7, year - 1)
    if m:
        month = month_num(m.group(1))
        pivot = today - timedelta(days=60)
        year = min((today.year - 1, today.year, today.year + 1),
                   key=lambda yy: abs((date(yy, month, 1) - pivot).days))
        return month, year
    return 7, today.year if today.month >= 7 else today.year - 1


def parse_time(s: str | None) -> time | None:
    if not s:
        return None
    s = s.lower().replace(" ", "").strip()
    if "noon" in s or s == "midday":
        return time(12, 0)
    if s == "midnight":
        return time(23, 59)  # deadline semantics: end of that day
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s)  # 24-hour
    if m:
        return time(int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"(\d{1,2})(?:[:.](\d{2}))?\.?([ap])\.?m\.?", s)
    if not m:
        return None
    h, mi = int(m.group(1)) % 12, int(m.group(2) or 0)
    if m.group(3) == "p":
        h += 12
    return time(h, mi)


def fmt_time(t: time) -> str:
    h = t.hour % 12 or 12
    return f"{h}{t.minute and f':{t.minute:02d}' or ''}{'am' if t.hour < 12 else 'pm'}"


def resolve_date(dm, anchor_month: int, anchor_year: int) -> date | None:
    """Date for a DATE_RE match. A missing year is inferred from the section's start
    (month, year). An explicit year wins unless it puts the date outside the section's
    13-month window while the inferred year doesn't (VTAC has published such typos)."""
    day, month, explicit = date_parts(dm)
    inferred = anchor_year if month >= anchor_month else anchor_year + 1
    year = explicit or inferred
    try:
        d = date(year, month, day)
        if year != inferred:
            start = date(anchor_year, anchor_month, 1)
            if not (start <= d < start + timedelta(days=396)):
                d = date(inferred, month, d.day)
        return d
    except ValueError:
        return None


def strip_dates(text: str) -> str:
    text = DATE_RE.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" :;,-–—()")


def norm_rounds(text: str) -> str:
    """'December offer round and January offer round 1' -> 'Dec round & Jan round 1'."""
    out: list[str] = []
    for m in ROUND_RE.finditer(text):
        months = [x for x in (m.group("m1"), m.group("m2")) if x]
        abbrev = [("Mid-year" if x.lower().startswith("mid") else MONTHS[month_num(x) - 1][:3]) for x in months]
        plural = m.group("word").lower() == "rounds" or len(months) > 1
        if plural:
            s = " & ".join(abbrev) + " rounds"
        else:
            # A lone "January round" (2023) or "June round" (mid-year 2023) is round 1,
            # matching later years' numbering.
            n = (m.group("n") or ("1" if abbrev[0] in ("Jan", "Jun") else "")).lower()
            n = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5"}.get(n, n)
            s = f"{abbrev[0]} round" + (f" {n}" if n else "")
        if s not in out:
            out.append(s)
    if not out and re.search(r"\ball offer rounds\b", text, re.IGNORECASE):
        out.append("All rounds")
    return " & ".join(out)


def table_group(table) -> str:
    for a in table.parents:
        if a.get("id") in GROUP_IDS:
            return GROUP_IDS[a["id"]]
    h2 = table.find_previous("h2")
    if h2 and GROUP_HEADING_RE.search(h2.get_text(" ")):
        return re.sub(r"\s+", " ", h2.get_text(" ")).strip()
    return ""


def dated_heading(table) -> str:
    """Nearest preceding heading that names a month and a year (falls back to h1)."""
    for h in table.find_all_previous(["h1", "h2", "h3", "h4"]):
        t = re.sub(r"\s+", " ", h.get_text("")).strip()
        if re.search(rf"\b({MONTH_RE})\b", t, re.IGNORECASE) and re.search(r"\b\d{4}\b", t):
            return t
    h1 = table.find_previous("h1")
    return re.sub(r"\s+", " ", h1.get_text("")).strip() if h1 else ""


def is_mid_year(table, section: str) -> bool:
    """True if the dated section heading, or any heading between it and the table, says mid-year."""
    for h in table.find_all_previous(["h1", "h2", "h3", "h4"]):
        t = re.sub(r"\s+", " ", h.get_text("")).strip()
        if re.search(r"mid-?year", t, re.IGNORECASE):
            return True
        if t == section:
            break
    return False


# ---------------------------------------------------------------- parsing
def parse(html: str, today: date | None = None) -> tuple[list[dict], str | None]:
    """Raw events: one per date cell. Keys: section, group, mid_year, table, column, row,
    qualifier, title (generic), date, time."""
    today = today or date.today()
    soup = BeautifulSoup(html, "html.parser")
    for s in soup(["script", "style"]):
        s.decompose()
    m = re.search(r"Last Updated:?\s*(\d{1,2}\s+\w+\s+\d{4})", soup.get_text(" "), re.IGNORECASE)
    last_updated = m.group(1) if m else None

    events: list[dict] = []
    for table in soup.find_all("table", class_="table"):
        group = table_group(table)
        if group and re.search(EXCLUDE_GROUPS, group, re.IGNORECASE):
            continue
        section = dated_heading(table)
        mid_year = is_mid_year(table, section)
        anchor_month, anchor_year = section_anchor(section, today)

        trs = [tr for tr in table.find_all("tr") if tr.find_parent("table") is table]
        grid, copied = expand_rows(trs)
        if not grid:
            continue
        width = len(grid[0])
        header_rows = [
            (tr.find_parent("thead") is not None
             or all(c.name == "th" for c in tr.find_all(["th", "td"], recursive=False)))
            and not any(DATE_RE.search(t) for t in grid[i])
            for i, tr in enumerate(trs)
        ]

        # Split into blocks at each header row (older pages stack several tables in one).
        blocks: list[tuple[list[str], list[int]]] = []
        headers: list[str] = []
        for i, is_head in enumerate(header_rows):
            if is_head:
                cells = [t for t in grid[i]]
                if len(set(cells)) == 1:  # full-width caption row: one name, unnamed date column
                    cells = [cells[0]] + ["Date"] * (width - 1)
                headers = cells
                blocks.append((headers, []))
            elif blocks:
                blocks[-1][1].append(i)
            else:
                headers = [""] * width
                blocks.append((headers, [i]))

        for headers, rows in blocks:
            if not rows:
                continue
            table_name = headers[0]
            first_col = [grid[r][0] for r in rows if grid[r][0]]
            header_first = bool(first_col) and sum(bool(DATE_RE.search(t)) for t in first_col) > len(first_col) / 2

            for r in rows:
                row, mask = grid[r], copied[r]
                # Row label: non-date text, excluding ignored/unnamed columns, fee cells,
                # notes, and date cells (text trailing a date there is its qualifier).
                parts: list[str] = []
                for c, (col, text) in enumerate(zip(headers, row)):
                    if (not text or col in IGNORE_COLUMNS or "$" in text or text.startswith(">>")
                            or (c > 0 and (not col or text == col))):
                        continue
                    if DATE_RE.search(text) and col not in SKIP_DATE_COLUMNS:
                        continue
                    part = strip_dates(text)
                    if part and part not in parts:
                        parts.append(part)
                label = " · ".join(parts)
                # Dates in "Eligible for offers" columns, used to look up the round name
                # when the cell has only a date (mid-year tables).
                eligible = [resolve_date(dm, anchor_month, anchor_year)
                            for col, text in zip(headers, row) if col in SKIP_DATE_COLUMNS
                            for dm in DATE_RE.finditer(text)]

                for c, (col, text, was_copied) in enumerate(zip(headers, row, mask)):
                    if (was_copied or col in IGNORE_COLUMNS or col in SKIP_DATE_COLUMNS
                            or (c > 0 and (not col or text == col))):
                        continue
                    matches = list(DATE_RE.finditer(text))
                    for i, dm in enumerate(matches):
                        d = resolve_date(dm, anchor_month, anchor_year)
                        if d is None:
                            continue
                        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                        qualifier = strip_dates(text[dm.end():end])
                        if not label:
                            title = col
                        elif header_first:
                            title = f"{col} — {label}"
                        else:
                            title = f"{label} — {col}"
                        events.append({
                            "section": section, "group": group, "mid_year": mid_year,
                            "table": table_name, "column": col, "row": label,
                            "qualifier": qualifier, "title": title,
                            "date": d, "time": parse_time(dm.group("time")),
                            "eligible": [x for x in eligible if x],
                        })

    for e in events:
        # Main-cycle dates run late July to February; anything 1 April - 25 July is mid-year
        # intake even when the page doesn't say so (e.g. March 2023).
        d = e["date"]
        if (re.search(r"mid-?year", e["row"], re.IGNORECASE) or 4 <= d.month <= 6
                or (d.month == 7 and d.day <= 25)):
            e["mid_year"] = True

    # Offer rounds labelled just "Round 1/2/3" (mid-year 2024) are named by release month,
    # e.g. "Jun round 1", "Jul round 1", "Jul round 2", as other years label them.
    unnamed = sorted((e for e in events if re.search(r"released|emailed", e["column"], re.IGNORECASE)
                      and re.fullmatch(r"round \d+", e["row"], re.IGNORECASE)),
                     key=lambda e: (e["section"], e["date"]))
    per_month: Counter = Counter()
    relabel = {}
    for e in unnamed:
        per_month[(e["section"], e["date"].year, e["date"].month)] += 1
        relabel[(e["section"], e["row"])] = (
            f"{MONTHS[e['date'].month - 1]} round {per_month[(e['section'], e['date'].year, e['date'].month)]}")
    for e in events:
        if (e["section"], e["row"]) in relabel and re.search(r"released|emailed", e["column"], re.IGNORECASE):
            e["row"] = relabel[(e["section"], e["row"])]

    # Name the round for rows that only give the offer date (e.g. "Eligible for offers: 23 June").
    offers = {(e["section"], e["date"]): e["row"] for e in events
              if re.search(r"released|emailed", e["column"], re.IGNORECASE) and e["row"]}
    for e in events:
        if e["eligible"] and not ROUND_RE.search(e["row"]):
            names = [offers[(e["section"], d)] for d in e["eligible"] if (e["section"], d) in offers]
            if names:
                e["row"] = " · ".join([e["row"]] * bool(e["row"]) + names)
    return events, last_updated


# ---------------------------------------------------------------- naming + rules
def _matches(rule: dict, keys, hay: dict) -> bool:
    return all(re.search(rule[k], hay[k], re.IGNORECASE) for k in keys if k in rule)


def canonical_name(ev: dict) -> tuple[str | None, bool]:
    """(name, matched). name None means drop. matched is False when no NAMES entry fits, or
    the entry needs {rounds} and no round could be recognised in the row (the row text is
    used instead), so the title won't line up with other years."""
    hay = {k: ev[k] for k in NAME_FILTER_KEYS}
    for rule in NAMES:
        if _matches(rule, NAME_FILTER_KEYS, hay):
            if rule["name"] is None:
                return None, True
            rounds = norm_rounds(f"{ev['row']} {ev['qualifier']}")
            matched = bool(rounds) or "{rounds}" not in rule["name"]
            name = rule["name"].format(rounds=rounds or ev["row"])
            ev["issue"] = "" if matched else "round not recognised"
            if ev["mid_year"] and "mid-year" not in name.lower() and not re.search(
                    r"\b(Apr|May|Jun|Jul|Mid-year) round", name):
                name = name.replace("VTAC ", "VTAC mid-year ", 1)
            return name, matched
    ev["issue"] = "no NAMES entry"
    return f"VTAC {ev['title']}", False


def validate_rules(rules: list[dict]) -> None:
    for i, rule in enumerate(rules):
        if not any(k in rule for k in FILTER_KEYS):
            raise ValueError(f"RULES[{i}] has no filter key (one of {FILTER_KEYS}): {rule}")
        unknown = set(rule) - set(FILTER_KEYS) - set(ACTION_KEYS)
        if unknown:
            raise ValueError(f"RULES[{i}] has unknown keys {sorted(unknown)}: {rule}")
        for k in FILTER_KEYS:
            if k in rule:
                re.compile(rule[k])
        for a in rule.get("alarms", []):
            vDuration.from_ical(a)


def apply_rules(events: list[dict], rules: list[dict], unmapped: list | None = None) -> list[dict]:
    """Name, filter and de-duplicate events, then sort them chronologically."""
    validate_rules(rules)
    kept, seen = [], set()
    for ev in events:
        name, matched = canonical_name(ev)
        if name is None:
            continue
        ev = dict(ev, name=name, alarms=list(DEFAULT_ALARMS), categories=[], matched=matched)
        excluded = False
        for rule in rules:
            hay = {
                "match": " | ".join([ev["section"], ev["table"], ev["column"], ev["row"],
                                     ev["qualifier"], ev["name"]]),
                "column": ev["column"], "table": ev["table"], "section": ev["section"],
                "qualifier": ev["qualifier"],
            }
            if not _matches(rule, FILTER_KEYS, hay):
                continue
            if rule.get("exclude"):
                excluded = True
                break
            if "title" in rule:
                ev["name"] = rule["title"].format(title=ev["name"])
            if "prefix" in rule and not ev["name"].startswith(rule["prefix"]):
                ev["name"] = rule["prefix"] + ev["name"]
            if "alarms" in rule:
                ev["alarms"] = list(rule["alarms"])
            for cat in rule.get("categories", []):
                if cat not in ev["categories"]:
                    ev["categories"].append(cat)
        if excluded:
            continue
        if not matched and unmapped is not None:
            unmapped.append(ev)
        key = (ev["name"], ev["date"])  # same milestone listed for several applicant groups
        if key in seen:
            continue
        seen.add(key)
        ev["title"] = ev["name"] + (f" ({fmt_time(ev['time'])})" if ev["time"] else "")
        kept.append(ev)
    kept.sort(key=lambda e: (e["date"], e["time"] or time(0), e["title"]))
    return kept


# ---------------------------------------------------------------- output
def cycle_of(ev: dict) -> str:
    """Admissions cycle: 'mid-year 2026' (Apr-Jul) or the intake year, e.g. '2027' for
    Aug 2026 - Feb 2027. Derived from the date, so it survives VTAC re-wording headings."""
    d = ev["date"]
    return f"mid-year {d.year}" if ev["mid_year"] else str(d.year + (d.month >= 7))


def event_uids(events: list[dict]) -> list[str]:
    """Stable UIDs keyed on cycle + canonical name (not the date, time or heading text), so
    a date change moves the event rather than duplicating it. Repeats get -2, -3 in date order."""
    seen: Counter = Counter()
    uids = []
    for ev in events:
        key = f"{cycle_of(ev)}|{ev['name']}"
        seen[key] += 1
        uid = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        uids.append(f"{uid}{'' if seen[key] == 1 else f'-{seen[key]}'}@vtac-ical")
    return uids


def build_calendar(events: list[dict], last_updated: str | None) -> Calendar:
    cal = Calendar()
    cal.add("prodid", "-//edix904//vtac-ical//EN")
    cal.add("version", "2.0")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", CALENDAR_NAME)
    cal.add("x-wr-timezone", str(TZ))
    cal.add("x-wr-caldesc", f"Unofficial VTAC key dates scraped from {URL} "
                            f"(page last updated: {last_updated or 'unknown'}). "
                            f"Times in titles are Melbourne time.")
    cal.add("refresh-interval", timedelta(hours=12), parameters={"VALUE": "DURATION"})
    cal.add("x-published-ttl", "PT12H")

    stamp = datetime.now(timezone.utc).replace(microsecond=0)
    for ev, uid in zip(events, event_uids(events)):
        e = Event()
        e.add("uid", uid)
        e.add("dtstamp", stamp)
        e.add("summary", ev["title"])
        e.add("dtstart", ev["date"])
        e.add("dtend", ev["date"] + timedelta(days=1))
        e.add("transp", "TRANSPARENT")
        when = f"{fmt_time(ev['time'])} Melbourne time" if ev["time"] else "no time given"
        source = f"{ev['table']} › {ev['column']}" + (f" › {ev['row']}" if ev["row"] else "")
        e.add("description", f"{when}\nSource: {source}\n{ev['section']}\n{URL}")
        e.add("url", URL)
        if ev["categories"]:
            e.add("categories", ev["categories"])
        for a in ev["alarms"]:
            alarm = Alarm()
            alarm.add("action", "DISPLAY")
            alarm.add("description", ev["title"])
            alarm.add("trigger", -vDuration.from_ical(a))
            e.add_component(alarm)
        cal.add_component(e)
    cal.add_missing_timezones()
    return cal


def write_atomic(path: str, data: bytes) -> None:
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".vtac-", suffix=".ics")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def drift_issues(events: list[dict], unmapped: list[dict], today: date) -> list[str]:
    """Signs the page changed in a way the parser only half understands."""
    issues = []
    for ev in unmapped:
        issues.append(f"{ev['issue']}: {ev['table']!r} › {ev['column']!r} › {ev['row']!r} on {ev['date']} "
                      f"-> titled {ev['title']!r}")
    lo, hi = today - timedelta(days=400), today + timedelta(days=550)
    for ev in events:
        if not lo <= ev["date"] <= hi:
            issues.append(f"date out of range: {ev['title']!r} on {ev['date']} (check year inference)")
    return issues


def count_events(path: str) -> int | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().count("BEGIN:VEVENT")


def report(issues: list[str]) -> None:
    gha = os.environ.get("GITHUB_ACTIONS") == "true"
    for msg in issues:
        print(f"::warning title=VTAC parser::{msg}" if gha else f"WARNING: {msg}", file=sys.stderr)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if gha and summary and issues:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### VTAC parser needs attention\n\n" + "\n".join(f"- {m}" for m in issues) +
                    "\n\nThe calendar was still published. Update `NAMES` / `RULES` in vtac_ical.py.\n")


def main(argv: list[str] | None = None) -> int:
    """Exit 0 = OK; 1 = nothing written (fetch failed, too few events, or a sharp drop);
    2 (--strict only) = written, but some events need attention (see warnings)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="vtac.ics", help="output .ics path (default: vtac.ics)")
    ap.add_argument("--dry-run", action="store_true", help="print kept events, write nothing")
    ap.add_argument("--min-events", type=int, default=5,
                    help="fail without writing if fewer events survive (default: 5)")
    ap.add_argument("--max-drop", type=float, default=0.5,
                    help="fail without writing if events fall by more than this fraction vs "
                         "the existing --out file (default: 0.5)")
    ap.add_argument("--allow-drop", action="store_true", help="skip the --max-drop check once")
    ap.add_argument("--strict", action="store_true",
                    help="exit 2 after writing if any event needs attention (used by the workflow)")
    ap.add_argument("--html", metavar="FILE", help="parse a saved copy of the page instead of fetching")
    args = ap.parse_args(argv)

    if args.html:
        with open(args.html, encoding="utf-8") as f:
            html = f.read()
    else:
        resp = requests.get(URL, headers={"User-Agent": USER_AGENT}, timeout=30)
        resp.raise_for_status()
        html = resp.text

    today = date.today()
    parsed, last_updated = parse(html, today=today)
    unmapped: list[dict] = []
    events = apply_rules(parsed, RULES, unmapped)
    print(f"Parsed {len(parsed)} dates, {len(events)} kept after rules "
          f"(page last updated: {last_updated or 'unknown'})", file=sys.stderr)
    issues = drift_issues(events, unmapped, today)
    report(issues)

    if args.dry_run:
        for ev in events:
            print(f"{ev['date']:%a %d %b %Y}  {ev['title']}")
        return 0

    if len(events) < args.min_events:
        print(f"ERROR: only {len(events)} events (< --min-events {args.min_events}); "
              f"page layout may have changed. Not overwriting {args.out}.", file=sys.stderr)
        return 1
    prev = count_events(args.out)
    if prev and not args.allow_drop and len(events) < prev * (1 - args.max_drop):
        print(f"ERROR: {len(events)} events vs {prev} in {args.out} (a drop of more than "
              f"{args.max_drop:.0%}); part of the page may no longer parse. Not overwriting. "
              f"If the drop is genuine, re-run with --allow-drop.", file=sys.stderr)
        return 1

    write_atomic(args.out, build_calendar(events, last_updated).to_ical())
    return 2 if issues and args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
