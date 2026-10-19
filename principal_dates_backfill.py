#!/usr/bin/env python3
"""Backfill Monash Malaysia / Indonesia principal dates into the dashboard's Backfill layout.

The Calendar Dashboard sync only stores feed events from the day a feed is added onwards, so
earlier dates come from this CSV instead (like backfill/vtac_backfill.csv). Titles are
normalised exactly as in the live .ics feeds, so history lines up with the feed.

Sources
  MY  the yearly archive pages (2023, 2024, 2025; the 2023 page lives at '.../principal-dates-2013')
      and the current page.
  ID  the current page only: older Indonesia pages are not online or in the Wayback Machine.

Where pages overlap (the 2025 page also lists January 2026), the newer page wins.

Usage:
    python principal_dates_backfill.py --until 2026-10-20               # fetch pages (needs a browser)
    python monash_fetch.py <urls> --out-dir pages/ && \
    python principal_dates_backfill.py --pages pages/ --until 2026-10-20  # from saved pages
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import date

import principal_dates as pd

MY_ARCHIVE = "https://www.monash.edu.my/student-services/student-admin/semester-principal-dates/"
SOURCES = {
    "MY": [
        (2023, MY_ARCHIVE + "principal-dates-2013"),
        (2024, MY_ARCHIVE + "principal-dates-2024"),
        (2025, MY_ARCHIVE + "principal-dates-2025"),
        (9999, pd.CAMPUSES["MY"]["url"]),
    ],
    "ID": [
        (9999, pd.CAMPUSES["ID"]["url"]),
    ],
}
HEADER = ["Calendar Name", "Title", "Start Date", "End Date (incl.)", "Source", "Source URL"]
SOURCE_PREFIX = "Monash principal dates page"  # rows starting with this are replaced by the dashboard


def saved_name(url: str) -> str:
    """File name monash_fetch.py uses for a URL."""
    return re.sub(r"[^A-Za-z0-9]+", "_", url.split("://", 1)[-1]).strip("_")[:150] + ".html"


def load(url: str, pages_dir: str | None) -> tuple[str, str]:
    if pages_dir:
        path = os.path.join(pages_dir, saved_name(url))
        with open(path, encoding="utf-8") as f:
            html = f.read()
        m = re.match(r"<!-- source: (\S+) -->", html)
        return html, (m.group(1) if m else "live")
    from monash_fetch import fetch_html
    return fetch_html(url)


def rows_for(campus: str, rules: dict, since: date, until: date, pages_dir: str | None) -> list[list[str]]:
    info = pd.CAMPUSES[campus]
    pages = []
    for year, url in SOURCES[campus]:
        html, src = load(url, pages_dir)
        raw, warnings = pd.parse_page(html)
        for w in warnings:
            print(f"WARNING [{campus} {url}]: {w}", file=sys.stderr)
        items = pd.build_events(raw, rules, campus)
        if items:
            pages.append((year, url, src, items))
    pages.sort(key=lambda p: p[0], reverse=True)  # newest first
    out, covered_from = [], None
    for year, url, src, items in pages:
        first = min(e.start for e, _ in items)
        label = "current page" if year == 9999 else f"{year} archive page"
        for ev, n in items:
            if covered_from and ev.start >= covered_from:
                continue  # a newer page covers this date
            if not (since <= ev.start < until):
                continue
            title = n.title + (f" ({n.time})" if n.time else "")
            link = url if src == "live" else src
            out.append([info["name"], title, ev.start.isoformat(), ev.end.isoformat(),
                        f"{SOURCE_PREFIX} ({campus}), {label}", link])
        covered_from = first if covered_from is None else min(first, covered_from)
    unclassified = sorted({n.raw for _, _, _, its in pages for _, n in its if not n.classified})
    for t in unclassified:
        print(f"WARNING [{campus}]: unclassified title: {t!r}", file=sys.stderr)
    out.sort(key=lambda r: (r[2], r[1]))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", default="2023-01-01")
    ap.add_argument("--until", required=True, help="first day the feeds are synced (exclusive end)")
    ap.add_argument("--pages", help="directory of pages saved by monash_fetch.py")
    ap.add_argument("--out", default="backfill/monash_my_id_backfill.csv")
    a = ap.parse_args(argv)
    rules = pd.load_rules()
    since, until = date.fromisoformat(a.since), date.fromisoformat(a.until)
    rows = []
    for campus in ("MY", "ID"):
        r = rows_for(campus, rules, since, until, a.pages)
        print(f"{campus}: {len(r)} rows", file=sys.stderr)
        rows += r
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    print(f"wrote {len(rows)} rows to {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
