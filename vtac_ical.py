#!/usr/bin/env python3
"""Scrape VTAC key dates (https://vtac.edu.au/dates) into a subscribable iCalendar feed.

Unofficial. VTAC only publishes these dates as HTML tables; this script turns them into
an RFC 5545 .ics file. Edit the CONFIG block below to change which events you get.

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
TIMED_EVENT_MINUTES = 30

# Dates in these columns don't become events (they duplicate the Offer rounds table),
# but their text, minus the dates, is still used in the row label (e.g. "November round").
SKIP_DATE_COLUMNS = {"Eligible for offers"}

# Ignored entirely: no events, no label text. Any cell containing "$" is also never a label.
IGNORE_COLUMNS = {"Apply by", "Fee"}

# ISO-8601 durations before the event, e.g. ["P1D", "PT2H"]. Rules can override per event.
DEFAULT_ALARMS: list[str] = []

# Applied in order to every parsed event. Filters (case-insensitive regex, all present must match):
#   match    anywhere in "section | table | column | title"
#   column / table / section
# Actions:
#   exclude: True         drop the event (final, no further rules run)
#   title: "...{title}"   rewrite the title
#   prefix: "..."         prepend to the title (once)
#   alarms: [...]         replace the alarms (ISO-8601 durations)
#   all_day: True         drop the time
#   categories: [...]     add CATEGORIES
RULES: list[dict] = [
    # Interstate change-of-preference deadlines (keep the Victorian/IB ones).
    {"match": r"SA/NT|ACT/NSW|Queensland", "exclude": True},
    # Soft "recommended" date; the real deadline is kept.
    {"match": r"Recommended document submission", "exclude": True},
    {"column": r"^close$|closes$", "prefix": "⏰ ", "alarms": ["P7D", "P1D"], "categories": ["Deadline"]},
    {"column": r"^offers released$", "prefix": "🎓 ", "categories": ["Offers"]},
    {"table": r"^results and atar$", "prefix": "📊 ", "alarms": ["PT12H"], "categories": ["Results"]},
    # --- Examples (uncomment to use) ---
    # {"match": r"Post-school applicants", "exclude": True},   # only current Year 12 rounds
    # {"section": r"mid-year", "exclude": True},               # skip mid-year intake sections
    # {"column": r"^open$|opens$", "exclude": True},           # deadlines only, no "opens"
    # {"match": r".", "all_day": True},                        # everything as all-day events
    # {"table": r"^course applications$", "title": "VTAC: {title}"},
]
# ===================================================================================

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MONTH_RE = "|".join(MONTHS)
TIME_RE = r"\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}\s*noon|noon|midday|midnight"
DATE_RE = re.compile(
    rf"\b(?P<day>\d{{1,2}})\s+(?P<month>{MONTH_RE})\b(?:\s+(?P<year>\d{{4}}))?"
    rf"(?:\s*\(\s*(?P<time>{TIME_RE})\s*\))?",
    re.IGNORECASE,
)
FILTER_KEYS = ("match", "column", "table", "section")
ACTION_KEYS = ("exclude", "title", "prefix", "alarms", "all_day", "categories")


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
            rs = max(1, int(cell.get("rowspan", 1) or 1))
            cs = max(1, int(cell.get("colspan", 1) or 1))
            for dr in range(rs):
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
    """(start month, year) from e.g. 'August 2026 - January 2027' -> (8, 2026)."""
    m = re.search(rf"\b({MONTH_RE})\b", heading, re.IGNORECASE)
    y = re.search(r"\b(\d{4})\b", heading)
    month = MONTHS.index(m.group(1).capitalize()) + 1 if m else today.month
    year = int(y.group(1)) if y else today.year
    return month, year


def parse_time(s: str | None) -> time | None:
    if not s:
        return None
    s = s.lower().replace(".", "").strip()
    if "noon" in s or s == "midday":
        return time(12, 0)
    if s == "midnight":
        return time(23, 59)  # deadline semantics: end of that day
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*([ap])m", s)
    if not m:
        return None
    h, mi = int(m.group(1)) % 12, int(m.group(2) or 0)
    if m.group(3) == "p":
        h += 12
    return time(h, mi)


def strip_dates(text: str) -> str:
    text = DATE_RE.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" :;,-–—")


# ---------------------------------------------------------------- parsing
def parse(html: str, today: date | None = None) -> tuple[list[dict], str | None]:
    today = today or date.today()
    soup = BeautifulSoup(html, "html.parser")
    m = re.search(r"Last Updated:?\s*(\d{1,2}\s+\w+\s+\d{4})", soup.get_text(" "), re.IGNORECASE)
    last_updated = m.group(1) if m else None

    events: list[dict] = []
    for table in soup.find_all("table", class_="table"):
        heading = table.find_previous("h2") or table.find_previous("h1")
        section = re.sub(r"\s+", " ", heading.get_text("")).strip() if heading else ""
        anchor_month, anchor_year = section_anchor(section, today)

        head_tr = table.select_one("thead tr")
        if head_tr is None:
            continue
        headers, _ = expand_rows([head_tr])
        headers = headers[0]
        body_trs = [tr for tr in table.find_all("tr") if tr.find_parent("thead") is None]
        grid, copied = expand_rows(body_trs)
        if not grid:
            continue
        ncols = max(len(headers), len(grid[0]))
        headers += [""] * (ncols - len(headers))
        for row, mask in zip(grid, copied):
            row += [""] * (ncols - len(row))
            mask += [False] * (ncols - len(mask))
        table_name = headers[0]

        first_col = [row[0] for row in grid if row[0]]
        header_first = bool(first_col) and sum(bool(DATE_RE.search(t)) for t in first_col) > len(first_col) / 2

        for row, mask in zip(grid, copied):
            # Row label: non-date text, excluding ignored columns, fee cells and
            # date cells (text trailing a date there is that date's qualifier).
            parts: list[str] = []
            for col, text in zip(headers, row):
                if not text or col in IGNORE_COLUMNS or "$" in text:
                    continue
                if DATE_RE.search(text) and col not in SKIP_DATE_COLUMNS:
                    continue
                part = strip_dates(text)
                if part and part not in parts:
                    parts.append(part)
            label = " · ".join(parts)

            for col, text, was_copied in zip(headers, row, mask):
                if was_copied or col in IGNORE_COLUMNS or col in SKIP_DATE_COLUMNS:
                    continue
                matches = list(DATE_RE.finditer(text))
                for i, dm in enumerate(matches):
                    month = MONTHS.index(dm.group("month").capitalize()) + 1
                    if dm.group("year"):
                        year = int(dm.group("year"))
                    else:
                        year = anchor_year if month >= anchor_month else anchor_year + 1
                    try:
                        d = date(year, month, int(dm.group("day")))
                    except ValueError:
                        continue
                    end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                    qualifier = strip_dates(text[dm.end():end])
                    if not label:
                        title = col
                    elif header_first:
                        title = f"{col} — {label}"
                    else:
                        title = f"{label} — {col}"
                    if qualifier:
                        title += f" ({qualifier})"
                    events.append({
                        "section": section, "table": table_name, "column": col,
                        "title": title, "date": d, "time": parse_time(dm.group("time")),
                    })
    return events, last_updated


# ---------------------------------------------------------------- rules
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


def apply_rules(events: list[dict], rules: list[dict]) -> list[dict]:
    validate_rules(rules)
    kept = []
    for ev in events:
        ev = dict(ev, base_title=ev["title"], alarms=list(DEFAULT_ALARMS), categories=[])
        excluded = False
        for rule in rules:
            haystacks = {
                "match": f"{ev['section']} | {ev['table']} | {ev['column']} | {ev['title']}",
                "column": ev["column"], "table": ev["table"], "section": ev["section"],
            }
            if not all(re.search(rule[k], haystacks[k], re.IGNORECASE) for k in FILTER_KEYS if k in rule):
                continue
            if rule.get("exclude"):
                excluded = True
                break
            if "title" in rule:
                ev["title"] = rule["title"].format(title=ev["title"])
            if "prefix" in rule and not ev["title"].startswith(rule["prefix"]):
                ev["title"] = rule["prefix"] + ev["title"]
            if "alarms" in rule:
                ev["alarms"] = list(rule["alarms"])
            if rule.get("all_day"):
                ev["time"] = None
            for cat in rule.get("categories", []):
                if cat not in ev["categories"]:
                    ev["categories"].append(cat)
        if not excluded:
            kept.append(ev)
    kept.sort(key=lambda e: (e["date"], e["time"] or time(0), e["title"]))
    return kept


# ---------------------------------------------------------------- output
def build_calendar(events: list[dict], last_updated: str | None) -> Calendar:
    cal = Calendar()
    cal.add("prodid", "-//edix904//vtac-ical//EN")
    cal.add("version", "2.0")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", CALENDAR_NAME)
    cal.add("x-wr-timezone", str(TZ))
    cal.add("x-wr-caldesc", f"Unofficial VTAC key dates scraped from {URL} "
                            f"(page last updated: {last_updated or 'unknown'}).")
    cal.add("refresh-interval", timedelta(hours=12), parameters={"VALUE": "DURATION"})
    cal.add("x-published-ttl", "PT12H")

    stamp = datetime.now(timezone.utc).replace(microsecond=0)
    seen: Counter = Counter()
    for ev in events:
        key = f"{ev['section']}|{ev['base_title']}"
        seen[key] += 1
        uid = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        if seen[key] > 1:
            uid += f"-{seen[key]}"

        e = Event()
        e.add("uid", f"{uid}@vtac-ical")
        e.add("dtstamp", stamp)
        e.add("summary", ev["title"])
        if ev["time"]:
            start = datetime.combine(ev["date"], ev["time"], tzinfo=TZ)
            e.add("dtstart", start)
            e.add("dtend", start + timedelta(minutes=TIMED_EVENT_MINUTES))
            when = ev["time"].strftime("%H:%M")
        else:
            e.add("dtstart", ev["date"])
            e.add("dtend", ev["date"] + timedelta(days=1))
            e.add("transp", "TRANSPARENT")
            when = "all day"
        e.add("description", f"{ev['table']} › {ev['column']} · {when}\n{ev['section']}\n{URL}")
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="vtac.ics", help="output .ics path (default: vtac.ics)")
    ap.add_argument("--dry-run", action="store_true", help="print kept events, write nothing")
    ap.add_argument("--min-events", type=int, default=5,
                    help="fail without writing if fewer events survive (default: 5)")
    ap.add_argument("--html", metavar="FILE", help="parse a saved copy of the page instead of fetching")
    args = ap.parse_args(argv)

    if args.html:
        with open(args.html, encoding="utf-8") as f:
            html = f.read()
    else:
        resp = requests.get(URL, headers={"User-Agent": USER_AGENT}, timeout=30)
        resp.raise_for_status()
        html = resp.text

    parsed, last_updated = parse(html)
    events = apply_rules(parsed, RULES)
    print(f"Parsed {len(parsed)} dates, {len(events)} kept after rules "
          f"(page last updated: {last_updated or 'unknown'})", file=sys.stderr)

    if args.dry_run:
        for ev in events:
            when = ev["time"].strftime("%H:%M") if ev["time"] else "     "
            print(f"{ev['date']:%a %d %b %Y}  {when}  {ev['title']}")
        return 0

    if len(events) < args.min_events:
        print(f"ERROR: only {len(events)} events (< --min-events {args.min_events}); "
              f"page layout may have changed. Not overwriting {args.out}.", file=sys.stderr)
        return 1

    write_atomic(args.out, build_calendar(events, last_updated).to_ical())
    return 0


if __name__ == "__main__":
    sys.exit(main())
