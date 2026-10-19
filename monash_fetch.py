#!/usr/bin/env python3
"""Fetch a monash.edu / monash.edu.my page despite the Cloudflare browser check.

The principal-dates pages sit behind a Cloudflare challenge that plain HTTP clients
(requests, curl) fail with a 403. fetch_html() tries, in order:

  1. requests                      (works whenever Cloudflare isn't challenging)
  2. headless Chromium (Playwright) waits for the challenge to clear
  3. the newest Wayback Machine snapshot (only if allow_wayback=True)

and returns (html, source) where source is "live" or the snapshot URL. It raises when
every route fails, so the caller can fail loudly instead of publishing an empty calendar.

Usage (save pages for offline parsing / tests):
    python monash_fetch.py URL [URL ...] --out-dir pages/
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
CHALLENGE = re.compile(r"<title>\s*Just a moment|cf-challenge|challenges\.cloudflare\.com/turnstile", re.I)


def looks_ok(html: str) -> bool:
    return bool(html) and not CHALLENGE.search(html[:20000]) and "<table" in html


def via_requests(url: str) -> str | None:
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-AU,en;q=0.9"}, timeout=45)
        return r.text if r.ok else None
    except requests.RequestException:
        return None


def via_browser(url: str, wait_s: int = 60) -> str | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    proxy = os.environ.get("HTTPS_PROXY")
    exe = os.environ.get("CHROMIUM_PATH")  # e.g. /opt/pw-browsers/chromium in a sandbox
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                proxy={"server": proxy} if proxy else None,
                executable_path=exe or None,
                args=["--disable-blink-features=AutomationControlled"])
            page = browser.new_context(user_agent=UA, locale="en-AU",
                                       viewport={"width": 1366, "height": 900}).new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            for _ in range(wait_s):
                if not re.search(r"just a moment", page.title(), re.I):
                    break
                page.wait_for_timeout(1000)
            page.wait_for_timeout(1500)
            html = page.content()
            browser.close()
            return html
    except Exception as e:  # noqa: BLE001 - any browser failure falls through to the next route
        print(f"browser fetch failed for {url}: {e}", file=sys.stderr)
        return None


def wayback_snapshots(url: str, tries: int = 4) -> list[str]:
    """Timestamps of 200-status snapshots of url, oldest first."""
    for i in range(tries):
        try:
            r = requests.get("https://web.archive.org/cdx/search/cdx",
                             params={"url": url, "filter": "statuscode:200", "collapse": "digest",
                                     "fl": "timestamp"}, headers={"User-Agent": UA}, timeout=90)
            if r.ok:
                return [t for t in r.text.split() if t.isdigit()]
        except requests.RequestException:
            pass
        time.sleep(10 * 2 ** i)
    return []


def wayback_get(ts: str, url: str, tries: int = 4) -> str | None:
    for i in range(tries):
        try:
            r = requests.get(f"https://web.archive.org/web/{ts}id_/{url}", headers={"User-Agent": UA}, timeout=90)
            if r.ok and looks_ok(r.text):
                return r.text
        except requests.RequestException:
            pass
        time.sleep(10 * 2 ** i)
    return None


def via_wayback(url: str) -> tuple[str, str] | None:
    for ts in reversed(wayback_snapshots(url)[-5:]):
        html = wayback_get(ts, url)
        if html:
            return html, f"https://web.archive.org/web/{ts}/{url}"
    return None


def fetch_html(url: str, allow_wayback: bool = True) -> tuple[str, str]:
    for name, fn in (("requests", via_requests), ("browser", via_browser)):
        html = fn(url)
        if html and looks_ok(html):
            print(f"fetched {url} via {name}", file=sys.stderr)
            return html, "live"
    if allow_wayback:
        got = via_wayback(url)
        if got:
            print(f"fetched {url} via Wayback ({got[1]})", file=sys.stderr)
            return got
    raise RuntimeError(f"could not fetch {url} (Cloudflare challenge not cleared, no usable Wayback snapshot)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("urls", nargs="+")
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--no-wayback", action="store_true")
    a = ap.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    bad = 0
    for url in a.urls:
        try:
            html, src = fetch_html(url, allow_wayback=not a.no_wayback)
        except RuntimeError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            bad += 1
            continue
        name = re.sub(r"[^A-Za-z0-9]+", "_", url.split("://", 1)[-1]).strip("_")[:150] + ".html"
        with open(os.path.join(a.out_dir, name), "w", encoding="utf-8") as f:
            f.write(f"<!-- source: {src} -->\n" + html)
        print(f"{src}\t{url}\t{name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
