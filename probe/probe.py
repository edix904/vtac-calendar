"""One-off: fetch MY/ID principal-dates pages (live + archives + Wayback history) into probe/pages."""
import os, re, sys
sys.path.insert(0, os.getcwd())
import monash_fetch as mf
out = "probe/pages"; os.makedirs(out, exist_ok=True)
log = open("probe/log.txt", "w")
def save(name, html, src):
    open(os.path.join(out, name), "w", encoding="utf-8").write(f"<!-- source: {src} -->\n" + html)
    log.write(f"{name}\t{src}\t{len(html)}\n"); log.flush()
def route_test(url):
    for n, fn in (("requests", mf.via_requests), ("browser", mf.via_browser)):
        h = fn(url); log.write(f"ROUTE {n} {url}: {'OK' if h and mf.looks_ok(h) else 'FAIL'} len={len(h or '')}\n")
MY = "https://www.monash.edu.my/student-services/student-admin/principal-dates-for-monash-university-malaysia"
ID = "https://www.monash.edu/indonesia/important-dates/principal-dates"
AU = "https://www.monash.edu/students/admin/dates/principal-dates"
for u in (MY, ID, AU): route_test(u)
for name, u in (("my_current.html", MY), ("id_current.html", ID)):
    try:
        h, s = mf.fetch_html(u); save(name, h, s)
        if name.startswith("my"):
            links = sorted(set(re.findall(r'href="([^"]*principal-dates[^"]*)"', h)))
            log.write("MY LINKS\n" + "\n".join(links) + "\n")
            for l in links:
                if l.startswith("/"): l = "https://www.monash.edu.my" + l
                m = re.search(r"(20\d\d)", l)
                if m and "monash.edu.my" in l and l.rstrip("/") != MY:
                    try:
                        h2, s2 = mf.fetch_html(l); save(f"my_archive_{m.group(1)}_{abs(hash(l))%1000}.html", h2, s2)
                    except Exception as e: log.write(f"FAIL {l}: {e}\n")
    except Exception as e: log.write(f"FAIL {u}: {e}\n")
# Wayback history: newest snapshot per calendar year
for tag, u in (("id", ID), ("my", MY)):
    ts = mf.wayback_snapshots(u)
    log.write(f"WAYBACK {tag}: {len(ts)} snapshots {ts[:1]}..{ts[-1:]}\n")
    by_year = {}
    for t in ts: by_year.setdefault(t[:4], []).append(t)
    for y, lst in sorted(by_year.items()):
        if int(y) < 2022: continue
        # newest snapshot in the year, plus one from mid-year (pages sometimes drop past months)
        picks = sorted(set([lst[-1], lst[len(lst)//2], lst[0]]))
        for t in picks:
            h = mf.wayback_get(t, u)
            if h: save(f"{tag}_wb_{t}.html", h, f"https://web.archive.org/web/{t}/{u}")
            else: log.write(f"FAIL wayback {tag} {t}\n")
log.close()
