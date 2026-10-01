#!/usr/bin/env python3
"""Backfill historical VTAC key dates from Wayback Machine snapshots of vtac.edu.au/dates.

Every archived copy of the page is parsed with the same parser, NAMES and RULES as the
live feed (vtac_ical.py), so historical titles match the calendar's titles exactly.
Output is a CSV in the layout of the Calendar Dashboard Data "Backfill" tab:

    Calendar Name, Title, Start Date, End Date (incl.), Source, Source URL

Usage:
    python backfill.py                      # 2023-01-01 up to the first date in vtac.ics
    python backfill.py --since 2023-01-01 --until 2026-08-01 --out backfill/vtac_backfill.csv
"""
from __future__ import annotations

import argparse
import csv
import gzip
import os
import re
import sys
import time as _time
from collections import defaultdict
from datetime import date

import requests
from icalendar import Calendar

import vtac_ical as v

CDX = "https://web.archive.org/cdx/search/cdx"
ARCHIVED_URLS = ["vtac.edu.au/dates", "vtac.edu.au/dates.html"]  # CDX matches www. and bare host
HEADERS = {"User-Agent": "vtac-ical-backfill/1.0 (+https://github.com/edix904/vtac-calendar)",
           "Accept-Encoding": "gzip"}


def get(url: str, params: dict | None = None, tries: int = 8) -> requests.Response:
    """GET with backoff; the Wayback Machine is often briefly 'Temporarily Offline'."""
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=90)
            if r.ok and "Temporarily Offline" not in r.text[:2000]:
                return r
        except requests.RequestException:
            pass
        _time.sleep(min(15 * 2 ** i, 300))
    raise RuntimeError(f"giving up on {url}")


def snapshots(since_year: int) -> list[tuple[str, str]]:
    out = []
    for u in ARCHIVED_URLS:
        r = get(CDX, {"url": u, "from": str(since_year - 1), "filter": "statuscode:200",
                      "collapse": "digest", "fl": "timestamp,original"})
        out += [tuple(line.split()) for line in r.text.splitlines() if line.strip()]
    return sorted(set(out))


def fetch(ts: str, original: str, cache: str) -> str:
    path = os.path.join(cache, f"{ts}.html")
    if not os.path.exists(path):
        r = get(f"https://web.archive.org/web/{ts}id_/{original}")
        data = r.content
        if data[:2] == b"\x1f\x8b":  # some snapshots are stored gzipped
            data = gzip.decompress(data)
        with open(path, "wb") as f:
            f.write(data)
        _time.sleep(2)
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def snap_date(ts: str) -> date:
    return date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))


def cycle(ev: dict) -> str:
    """Admissions cycle: 'mid-year 2025' (Apr-Jul) or '2026' (Aug 2025 - Feb 2026)."""
    d = ev["date"]
    return f"mid-year {d.year}" if ev["mid_year"] else str(d.year + (d.month >= 7))


def first_live_date(ics_path: str) -> date | None:
    if not os.path.exists(ics_path):
        return None
    with open(ics_path, "rb") as f:
        cal = Calendar.from_ical(f.read())
    starts = [e.decoded("dtstart") for e in cal.walk("VEVENT")]
    return min(starts) if starts else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", default="2023-01-01", type=date.fromisoformat)
    ap.add_argument("--until", type=date.fromisoformat,
                    help="exclusive end (default: first event in vtac.ics, i.e. where the live feed starts)")
    ap.add_argument("--calendar-name", default="VTAC key dates",
                    help="must match the Calendar Name in the dashboard's Config tab")
    ap.add_argument("--cache", default=".wayback-cache")
    ap.add_argument("--out", default="backfill/vtac_backfill.csv")
    args = ap.parse_args(argv)
    until = args.until or first_live_date("vtac.ics") or date.max
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    snaps = snapshots(args.since.year)
    print(f"{len(snaps)} distinct snapshots", file=sys.stderr)

    # Per cycle, the newest snapshot is authoritative (VTAC revises and drops planned dates).
    # A milestone that disappears is kept only if its date had already passed when it
    # vanished, i.e. VTAC trimmed history rather than cancelled it.
    history: dict[str, list[tuple[str, str, str, dict[str, list[dict]]]]] = defaultdict(list)
    for ts, original in snaps:
        html = fetch(ts, original, args.cache)
        parsed, last_updated = v.parse(html, today=snap_date(ts))
        unmapped: list[dict] = []
        events = v.apply_rules(parsed, v.RULES, unmapped)
        for ev in unmapped:
            print(f"  {ts}: unmapped {ev['table']!r} › {ev['column']!r} › {ev['row']!r} ({ev['date']})",
                  file=sys.stderr)
        by_cycle: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
        for ev in events:
            if ev["matched"]:
                by_cycle[cycle(ev)][ev["name"]].append(ev)
        for cyc, names in by_cycle.items():
            history[cyc].append((ts, original, last_updated or f"{ts[6:8]}/{ts[4:6]}/{ts[:4]}", names))

    best: dict[tuple[str, str], tuple[list[dict], str, str, str]] = {}
    for cyc, snaps_c in history.items():
        ts, original, last_updated, names = snaps_c[-1]
        for name, evs in names.items():
            best[(cyc, name)] = (evs, ts, original, last_updated)
        for i, (ts_i, orig_i, lu_i, names_i) in enumerate(snaps_c[:-1]):
            gone_at = snap_date(snaps_c[i + 1][0])
            for name, evs in names_i.items():
                if name not in snaps_c[i + 1][3] and (cyc, name) not in best \
                        and all(ev["date"] < gone_at for ev in evs):
                    best[(cyc, name)] = (evs, ts_i, orig_i, lu_i)
                    print(f"  {cyc}: kept {name!r} from {ts_i} (dropped from page after it passed)",
                          file=sys.stderr)

    rows = []
    for (cyc, _name), (evs, ts, original, last_updated) in best.items():
        for ev in evs:
            if not (args.since <= ev["date"] < until):
                continue
            rows.append({
                "Calendar Name": args.calendar_name,
                "Title": ev["title"],
                "Start Date": ev["date"].isoformat(),
                "End Date (incl.)": ev["date"].isoformat(),
                "Source": f"VTAC key dates page, {cyc} cycle (Wayback snapshot, page updated {last_updated})",
                "Source URL": f"https://web.archive.org/web/{ts}/{original}",
                "_cycle": cyc,
            })
    rows.sort(key=lambda r: (r["Start Date"], r["Title"]))

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[k for k in rows[0] if not k.startswith("_")] if rows else [],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r["_cycle"]] += 1
    print(f"Wrote {len(rows)} rows to {args.out} ({args.since} to {until}, exclusive): "
          + ", ".join(f"{c}: {n}" for c, n in sorted(counts.items())), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
