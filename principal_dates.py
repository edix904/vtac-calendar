#!/usr/bin/env python3
"""Monash Malaysia and Monash Indonesia principal dates as subscribable .ics feeds.

Unofficial. Monash publishes these only as HTML tables (behind a Cloudflare browser check,
see monash_fetch.py). This script parses them, normalises every title with the shared
rules in principal_dates_rules.json (the same rules the Calendar Dashboard sheet applies to
the Australian dates), and writes monash-malaysia.ics / monash-indonesia.ics.

Usage:
    python principal_dates.py                        # both campuses, writes the .ics files
    python principal_dates.py --campus MY --dry-run  # preview, write nothing
    python principal_dates.py --campus ID --html saved.html --dry-run
    python principal_dates.py --normalise "Mid-semester break: begins for semester one (S1-01)"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from bs4 import BeautifulSoup
from icalendar import Calendar, Event

HERE = os.path.dirname(os.path.abspath(__file__))
RULES_PATH = os.path.join(HERE, "principal_dates_rules.json")

CAMPUSES = {
    "MY": {
        "name": "Monash Malaysia principal dates",
        "url": "https://www.monash.edu.my/student-services/student-admin/principal-dates-for-monash-university-malaysia",
        "out": "monash-malaysia.ics",
        "tz": "Asia/Kuala_Lumpur",
    },
    "ID": {
        "name": "Monash Indonesia principal dates",
        "url": "https://www.monash.edu/indonesia/important-dates/principal-dates",
        "out": "monash-indonesia.ics",
        "tz": "Asia/Jakarta",
    },
}

MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
MONTH_RE = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
WEEKDAY_RE = r"(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\.?"

# ============================================================================ normalising
# The algorithm below is mirrored in the dashboard's Apps Script (Normalise.js). Keep the two
# in step; test_principal_dates.py and dashboard tests share normalise_cases.json.

CODE_RE = re.compile(r"\(([A-Z][A-Z0-9+]*(?:-[A-Z0-9+]+)+|[A-Z]{2,}\d{1,3})\)")
TIME_RE = re.compile(
    r"(?:\s*\b(?:at|by|from)\b)?\s*\b(\d{1,2}(?:[.:]\d{2})?\s*[ap]\.?\s?m\b\.?|12\s*noon|noon|midday|midnight)"
    r"(?:\s*\([^)]*\btime\)|\s+(?:AEST|AEDT|MYT|WIB|Melbourne time|Malaysia time))?", re.I)
VERB_RE = re.compile(r"^(opens?|closes?|begins?|ends?|starts?|commences?|released?|published)\b\s*(?:for\s+(?:the\s+)?)?", re.I)
CAMPUS_MENTION = {"AUS": r"\((?:Australia|Clayton|Melbourne)\)", "MY": r"\(Malaysia\)", "ID": r"\(Indonesia\)"}
NUMBER_WORDS = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6"}


def load_rules(path: str = RULES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        rules = json.load(f)
    for key in ("milestones", "titles", "period_names"):
        for r in rules[key]:
            r["_re"] = re.compile(r["pattern"], re.I)
    for r in rules["periods"]:
        r["_re"] = re.compile(r["code"])
    rules["_exclude"] = [re.compile(p, re.I) for p in rules.get("exclude", [])]
    for r in rules.get("rewrites", []):
        r["_re"] = re.compile(r["pattern"], re.I)
        r["_repl"] = re.sub(r"\$(\d)", r"\\\1", r["replace"])
    return rules


def clean_space(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace(" ", " ")).strip()


def fmt_time(raw: str) -> str:
    s = raw.lower().replace(" ", "").replace(".m", "m").rstrip(".")
    if "noon" in s or s == "midday":
        return "12pm"
    if s == "midnight":
        return "11:59pm"
    m = re.fullmatch(r"(\d{1,2})(?:[.:](\d{2}))?\.?([ap])m", s.replace(".", ":", 1) if re.match(r"\d{1,2}\.\d{2}", s) else s)
    if not m:
        return raw
    h, mi, ap = int(m.group(1)), m.group(2), m.group(3)
    return f"{h}{':' + mi if mi and mi != '00' else ''}{ap}m"


def sentence_case(s: str) -> str:
    s = clean_space(s).strip(" :;,.-")
    return s[:1].upper() + s[1:] if s else s


def period_name(code: str, before: str, rules: dict) -> str:
    """Canonical name for a period code; falls back to the name written before it."""
    for r in rules["periods"]:
        m = r["_re"].search(code)
        if m:
            name = r["period"]
            for i, g in enumerate(m.groups(), 1):
                name = name.replace(f"${i}", g or "")
            return name
    for r in rules["period_names"]:
        if r["_re"].search(before):
            return r["period"]
    name = re.sub(r"\b(one|two|three|four|five|six)\b", lambda mm: NUMBER_WORDS[mm.group(1).lower()], before, flags=re.I)
    name = re.sub(r"^(monash indonesia|the)\s+", "", name, flags=re.I)
    return sentence_case(name)


def extract_periods(text: str, rules: dict) -> list[dict]:
    out, prev_end = [], 0
    for m in CODE_RE.finditer(text):
        code = m.group(1)
        before = text[prev_end:m.start()]
        before = re.split(r",|\band\b|:|\bfor\b|\bfrom\b|\bin\b", before, flags=re.I)[-1]
        before = re.sub(r"\((?:extended|northern)\)", lambda mm: mm.group(0), before).strip()
        year = re.match(r"\s*(20\d\d)\b", text[m.end():])
        if not any(p["code"] == code for p in out):
            out.append({"code": code, "period": period_name(code, before, rules),
                        "year": int(year.group(1)) if year else None})
        prev_end = m.end()
    if not out:
        for r in rules["period_names"]:
            if r["_re"].search(text):
                out.append({"code": "", "period": r["period"], "year": None})
    return out


@dataclass
class Normalised:
    raw: str
    milestone: str
    classified: bool
    title: str
    periods: list = field(default_factory=list)
    time: str = ""
    detail: str = ""
    note: str = ""
    phase: str = ""
    campuses: list = field(default_factory=list)
    exclude: bool = False

    @property
    def period_codes(self) -> str:
        return "; ".join(p["code"] for p in self.periods if p["code"])

    @property
    def period_names(self) -> str:
        seen = []
        for p in self.periods:
            if p["period"] not in seen:
                seen.append(p["period"])
        return "; ".join(seen)


def candidates(head: str, detail: str) -> list[tuple[str, str]]:
    """(text to match, leftover detail) pairs, most specific first. A verb or phrase at the
    start of the detail can belong to the milestone: 'Mid-semester break: begins for S1',
    'Results released: Deferred and supplementary for S1', 'Course transfers: Applications open'."""
    out: list[tuple[str, str]] = []

    def expand(h: str, d: str) -> None:
        fm = re.match(r"^(.*?)\s+for\s+(?:the\s+)?(.+)$", d, re.I)
        if fm and not CODE_RE.search(fm.group(1)):
            out.append((f"{h} {fm.group(1)}", fm.group(2)))
        if d:
            out.append((f"{h} {CODE_RE.sub('', d)}", d if CODE_RE.search(d) else ""))
        out.append((h, d))

    vm = VERB_RE.match(detail)
    if vm:
        expand(f"{head} {vm.group(1)}", detail[vm.end():])
    expand(head, detail)
    if not detail:
        # No colon: the milestone may wrap the period, e.g. "October intake (OCT-MY-01) ends".
        out.append((CODE_RE.sub("", head), ""))
    return out


def _match_milestone(cands: list[tuple[str, str]], rules: dict):
    for text, residual in cands:
        key = clean_space(text).strip(" :;,.-")
        for r in rules["milestones"]:
            if r["_re"].search(key):
                return r, residual
    return None, None


def normalise(raw: str, rules: dict, overrides: dict | None = None) -> Normalised:
    """Split a principal-dates title into milestone / teaching periods / time and build a
    consistent title: '<Milestone>: <Period> (<code>), <Period> (<code>)'."""
    text = clean_space(raw)
    for r in rules.get("rewrites", []):
        text = clean_space(r["_re"].sub(r["_repl"], text))
    own = re.search(r"\s+\((\d{1,2}(?::\d{2})?[ap]m)\)$", text)  # our own ' (10am)' suffix
    if own:
        text = text[:own.start()]
    parts = re.split(r"(?<=[a-z0-9)])\.\s+(?=[A-Z])", text, maxsplit=1)
    first = parts[0].rstrip(".").strip()
    note = parts[1].strip() if len(parts) > 1 else ""

    tm = TIME_RE.search(first)
    time_s = fmt_time(tm.group(1)) if tm else (own.group(1) if own else "")
    if tm:
        first = clean_space(first[:tm.start()] + first[tm.end():])
    first = re.sub(r"\s*\((?:Melbourne|Malaysia|Indonesia|Jakarta) time\)", "", first, flags=re.I)

    if ":" in first:
        head, detail = (clean_space(x) for x in first.split(":", 1))
    else:
        head, detail = first, ""
    cands = candidates(head, detail)

    phase, exclude, classified = "", False, True
    ov = (overrides or {}).get(clean_space(raw).lower())
    rule, residual = None, detail
    if ov:
        milestone = ov["milestone"]
        phase = ov.get("phase", "")
        exclude = bool(ov.get("exclude"))
    else:
        rule, residual = _match_milestone(cands, rules)
        if rule is None:
            residual = detail
            for r in rules["titles"]:
                if r["_re"].search(first):
                    rule = r
                    # Bare holiday names ("Hari Raya Haji") become the detail of "University closed".
                    residual = first if (r["milestone"] == "University closed" and not detail
                                         and not re.match(r"^university", first, re.I)) else detail
                    break
        if rule:
            milestone, phase = rule["milestone"], rule.get("phase", "")
        else:
            milestone, classified = sentence_case(CODE_RE.sub("", head)), False
    exclude = exclude or any(x.search(text) for x in rules["_exclude"])

    periods = extract_periods(first, rules)
    if ov and ov.get("period"):
        periods = [{"code": p["code"], "period": ov["period"], "year": p["year"]} for p in periods] or \
                  [{"code": "", "period": ov["period"], "year": None}]

    # Detail shown after the colon: the periods if any, otherwise what the milestone didn't use.
    if periods and any(p["code"] for p in periods):
        shown = ", ".join(f"{p['period']} ({p['code']})" if p["code"] else p["period"] for p in periods)
    else:
        d = re.sub(r"^(?:for\s+)?(?:the\s+)?", "", residual or "", flags=re.I)
        d = re.sub(r"\s*\((?:a|an|the|or|see|except)\b[^)]*\)\s*$", "", d, flags=re.I)
        d = re.sub(r"^\s*20\d\d\s*$", "", d)
        d = re.sub(r"\s+20\d\d$", "", d)
        shown = sentence_case(d)
        if periods and (not shown or re.fullmatch(r"(semester|full[- ]year)\b.*", shown, re.I)):
            shown = "; ".join(dict.fromkeys(p["period"] for p in periods))
    title = milestone + (f": {shown}" if shown else "")
    campuses = [c for c, pat in CAMPUS_MENTION.items() if re.search(pat, text, re.I)]
    return Normalised(raw=raw, milestone=milestone, classified=classified, title=title, periods=periods,
                      time=time_s, detail=shown, note=note, phase=phase, campuses=campuses, exclude=exclude)


# ============================================================================ parsing pages
@dataclass
class RawEvent:
    start: date
    end: date
    title: str
    section: str


def _section_label(table) -> str:
    for el in table.find_all_previous(["button", "h2", "h3", "h4", "a", "strong"], limit=60):
        t = clean_space(el.get_text(" "))
        if re.search(r"\b20\d\d\b", t) and re.search(r"semester|intake|full year|principal dates", t, re.I) \
                and len(t) < 80:
            return t
    return ""


def _page_year(soup) -> int | None:
    for el in [soup.find("h1"), soup.find("title")]:
        if el:
            m = re.search(r"\b(20\d\d)\b", el.get_text(" "))
            if m:
                return int(m.group(1))
    return None


def parse_page(html: str, today: date | None = None) -> tuple[list[RawEvent], list[str]]:
    """Events from every Day/Date/Description table (MY) or 'Thu 01 | Description' table (ID).
    Medicine (Year/Clayton/Malaysia) and rotation tables are skipped. Returns (events, warnings)."""
    today = today or date.today()
    soup = BeautifulSoup(html, "html.parser")
    for s in soup(["script", "style"]):
        s.decompose()
    page_year = _page_year(soup)
    events, warnings, seen = [], [], set()
    for table in soup.find_all("table"):
        rows = [[clean_space(c.get_text(" ")) for c in tr.find_all(["td", "th"])] for tr in table.find_all("tr")]
        rows = [r for r in rows if any(r)]
        if not rows:
            continue
        header = [c.lower() for c in rows[0]]
        id_style = bool(re.match(rf"^{WEEKDAY_RE}\s+\d", next((r[0] for r in rows if len(r) == 2), ""), re.I))
        if not (header[:3] == ["day", "date", "description"] or id_style):
            continue
        section = _section_label(table)
        sm = re.search(r"\b(20\d\d)\b", section)
        year = int(sm.group(1)) if sm else (page_year or today.year)
        last_month = None
        for r in rows:
            if len(r) == 1 or (len(set(r)) == 1):
                mm = re.fullmatch(rf"{MONTH_RE}\.?(?:\s+(20\d\d))?", r[0], re.I)
                if mm:
                    month = MONTHS.index(next(m for m in MONTHS if m.startswith(mm.group(1).lower()[:3])))+1
                    if mm.group(2):
                        year = int(mm.group(2))
                    elif last_month and month < last_month:
                        year += 1
                    last_month = month
                continue
            if [c.lower() for c in r[:3]] == ["day", "date", "description"]:
                continue
            if id_style and len(r) >= 2:
                date_cell, desc = r[0], " ".join(r[1:])
                date_cell = re.sub(rf"^{WEEKDAY_RE}\s*", "", date_cell, flags=re.I)
            elif len(r) >= 3:
                date_cell, desc = r[1], " ".join(r[2:])
            else:
                continue
            if not desc or last_month is None:
                continue
            if re.search(r"\bTBC\b|\bTBA\b", date_cell, re.I):
                continue
            days = [int(x) for x in re.findall(r"\d{1,2}", date_cell)]
            if not days:
                warnings.append(f"no day in {date_cell!r} for {desc!r}")
                continue
            try:
                start = date(year, last_month, days[0])
                end = start
                if len(days) > 1 and days[1] > days[0]:
                    end = date(year, last_month, days[1])
            except ValueError:
                warnings.append(f"bad date {date_cell!r} {last_month}/{year} for {desc!r}")
                continue
            key = (start, end, desc.lower())
            if key in seen:  # semester views overlap
                continue
            seen.add(key)
            events.append(RawEvent(start, end, desc, section))
    events.sort(key=lambda e: (e.start, e.title))
    return events, warnings


# ============================================================================ output
def uid_for(campus: str, ev: RawEvent, n: Normalised, repeat: int) -> str:
    """Stable per (campus, year, normalised title): a moved date updates the event in place."""
    key = f"{campus}|{ev.start.year}|{n.title}|{n.time}"
    h = hashlib.sha1(key.encode()).hexdigest()[:16]
    return f"{h}{'' if repeat == 1 else f'-{repeat}'}@monash-principal-dates"


def build_events(raw: list[RawEvent], rules: dict, campus: str) -> list[tuple[RawEvent, Normalised]]:
    out = []
    for ev in raw:
        n = normalise(ev.title, rules)
        if not n.exclude:
            out.append((ev, n))
    return out


def build_calendar(items, campus: str, source: str) -> Calendar:
    info = CAMPUSES[campus]
    cal = Calendar()
    cal.add("prodid", "-//edix904//monash-principal-dates//EN")
    cal.add("version", "2.0")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", info["name"].replace("principal dates", "Principal Dates").replace("Monash", "Monash", 1))
    cal.add("x-wr-timezone", info["tz"])
    cal.add("x-wr-caldesc", f"Unofficial copy of {info['url']} with consistent titles. Source: {source}.")
    cal.add("refresh-interval", timedelta(hours=12), parameters={"VALUE": "DURATION"})
    cal.add("x-published-ttl", "PT12H")
    stamp = datetime.now(timezone.utc).replace(microsecond=0)
    counts: dict[str, int] = {}
    for ev, n in items:
        title = n.title + (f" ({n.time})" if n.time else "")
        base = f"{campus}|{ev.start.year}|{n.title}|{n.time}"
        counts[base] = counts.get(base, 0) + 1
        e = Event()
        e.add("uid", uid_for(campus, ev, n, counts[base]))
        e.add("dtstamp", stamp)
        e.add("summary", title)
        e.add("dtstart", ev.start)
        e.add("dtend", ev.end + timedelta(days=1))
        e.add("transp", "TRANSPARENT")
        desc = [f"Official wording: {ev.title}"]
        if n.time:
            desc.append(f"Time: {n.time} (local time unless stated)")
        if ev.section:
            desc.append(f"Section: {ev.section}")
        desc.append(info["url"])
        e.add("description", "\n".join(desc))
        e.add("url", info["url"])
        e.add("categories", [n.milestone])
        cal.add_component(e)
    return cal


def write_atomic(path: str, data: bytes) -> None:
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".pd-", suffix=".ics")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def count_events(path: str) -> int | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().count("BEGIN:VEVENT")


def report(campus: str, issues: list[str]) -> None:
    gha = os.environ.get("GITHUB_ACTIONS") == "true"
    for msg in issues:
        print(f"::warning title={campus} principal dates::{msg}" if gha else f"WARNING [{campus}]: {msg}", file=sys.stderr)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if gha and summary and issues:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### {campus} principal dates: notes\n\n" + "\n".join(f"- {m}" for m in issues) + "\n\n")


def run_campus(campus: str, args, rules: dict) -> int:
    info = CAMPUSES[campus]
    if args.html:
        with open(args.html, encoding="utf-8") as f:
            html = f.read()
        source = "saved page"
    else:
        from monash_fetch import fetch_html
        try:
            html, source = fetch_html(info["url"], allow_wayback=not args.no_wayback)
        except RuntimeError as e:
            print(f"ERROR [{campus}]: {e}. Not overwriting {info['out']}.", file=sys.stderr)
            return 1
    raw, warnings = parse_page(html)
    items = build_events(raw, rules, campus)
    unclassified = sorted({n.raw for _, n in items if not n.classified})
    issues = warnings + [f"unclassified title (kept as written): {t!r}" for t in unclassified]
    if source.startswith("http"):
        issues.insert(0, f"live page blocked; used Wayback snapshot {source}")
    print(f"[{campus}] parsed {len(raw)} dates, {len(items)} kept, {len(unclassified)} unclassified ({source})",
          file=sys.stderr)
    report(campus, issues)
    if args.dry_run:
        for ev, n in items:
            flag = "" if n.classified else "  [unclassified]"
            print(f"{ev.start:%a %d %b %Y}  {n.title}{f' ({n.time})' if n.time else ''}{flag}")
        return 0
    out = args.out if args.out and len(args.campus) == 1 else info["out"]
    if len(items) < args.min_events:
        print(f"ERROR [{campus}]: only {len(items)} events; page layout may have changed. Not overwriting {out}.",
              file=sys.stderr)
        return 1
    prev = count_events(out)
    if prev and not args.allow_drop and len(items) < prev * 0.5:
        print(f"ERROR [{campus}]: {len(items)} events vs {prev} in {out}; not overwriting (use --allow-drop).",
              file=sys.stderr)
        return 1
    write_atomic(out, build_calendar(items, campus, source).to_ical())
    return 2 if source.startswith("http") else 0


def main(argv=None) -> int:
    """Exit 0 OK; 1 a campus was not written; 2 written from a Wayback snapshot (live page blocked)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--campus", nargs="+", choices=sorted(CAMPUSES), default=sorted(CAMPUSES))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--html", help="parse a saved page (use with a single --campus)")
    ap.add_argument("--out", help="output path (single campus only)")
    ap.add_argument("--min-events", type=int, default=20)
    ap.add_argument("--allow-drop", action="store_true")
    ap.add_argument("--no-wayback", action="store_true", help="fail instead of falling back to the Wayback Machine")
    ap.add_argument("--normalise", metavar="TITLE", help="print how one title is normalised and exit")
    args = ap.parse_args(argv)
    rules = load_rules()
    if args.normalise:
        n = normalise(args.normalise, rules)
        print(json.dumps({k: v for k, v in n.__dict__.items()}, indent=2, ensure_ascii=False, default=str))
        return 0
    codes = [run_campus(c, args, rules) for c in args.campus]
    return max(codes)


if __name__ == "__main__":
    sys.exit(main())
