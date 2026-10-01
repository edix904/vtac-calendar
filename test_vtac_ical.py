"""Regression tests for vtac_ical.py: page-layout variants seen on vtac.edu.au since 2022,
plus formats VTAC could plausibly switch to. Run: python -m unittest -v test_vtac_ical.py"""
import os
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import date, time
from io import StringIO

import vtac_ical as v

TODAY = date(2026, 9, 1)


def table(heading: str, rows: list[list[str]], thead: bool = True) -> str:
    head, body = rows[0], rows[1:]
    th = "".join(f"<th>{c}</th>" for c in head)
    tb = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in body)
    head_html = f"<thead><tr>{th}</tr></thead>" if thead else f"<tr>{th}</tr>"
    return f"<h2>{heading}</h2><table class='table'>{head_html}<tbody>{tb}</tbody></table>"


def run(html: str, today: date = TODAY):
    parsed, _ = v.parse(html, today=today)
    unmapped: list = []
    events = v.apply_rules(parsed, v.RULES, unmapped)
    return events, unmapped


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def titles(events):
    return [(e["date"].isoformat(), e["title"]) for e in events]


H27 = "Key Dates & Fees: August 2026 - January 2027 for courses commencing in 2027"


class Dates(unittest.TestCase):
    def check(self, cell, expected_date, expected_time):
        events, unmapped = run(table(H27, [["Course applications", "Open", "Close"],
                                           ["Timely applications", "3 August (9am)", cell]]))
        close = [e for e in events if "close" in e["name"]]
        self.assertEqual(len(close), 1, cell)
        self.assertEqual(close[0]["date"], expected_date, cell)
        self.assertEqual(close[0]["time"], expected_time, cell)
        self.assertFalse(unmapped)

    def test_formats(self):
        for cell, d, t in [
            ("28 September (5pm)", date(2026, 9, 28), time(17)),
            ("28 Sept (5pm)", date(2026, 9, 28), time(17)),
            ("28th Sep. (5 pm)", date(2026, 9, 28), time(17)),
            ("September 28 (5:00pm)", date(2026, 9, 28), time(17)),
            ("Sep 28, 2026 (17:00)", date(2026, 9, 28), time(17)),
            ("Monday 28 September (5.15pm AEST)", date(2026, 9, 28), time(17, 15)),
            ("12 January 2027 (12 noon)", date(2027, 1, 12), time(12)),
            ("12 January (midday)", date(2027, 1, 12), time(12)),   # year inferred
            ("4 December", date(2026, 12, 4), None),
        ]:
            self.check(cell, d, t)

    def test_year_typo_corrected(self):
        # VTAC published "13 January 2026" in the 2027 cycle.
        self.check("13 January 2026 (2pm)", date(2027, 1, 13), time(14))

    def test_heading_without_month(self):
        events, _ = run(table("Key Dates for courses commencing in 2028",
                              [["Course applications", "Open", "Close"],
                               ["Timely applications", "2 August (9am)", "13 January (5pm)"]]),
                        today=date(2028, 1, 5))
        self.assertEqual([e["date"] for e in events], [date(2027, 8, 2), date(2028, 1, 13)])

    def test_no_heading(self):
        events, _ = run("<table class='table'><thead><tr><th>Course applications</th><th>Close</th>"
                        "</tr></thead><tr><td>Timely applications</td><td>28 September</td></tr></table>",
                        today=date(2027, 1, 10))
        self.assertEqual(events[0]["date"], date(2026, 9, 28))

    def test_words_that_look_like_months(self):
        events, _ = run(table(H27, [["Change of preference opens", "Change of preference closes", "Eligible for offers"],
                                    ["3 August (9am)", "12 December (12 noon): Current VCE and IB (May sitting) students",
                                     "December round (23 December)"]]))
        self.assertEqual(titles(events), [("2026-12-12", "VTAC preferences close: Dec round (12pm)")])


class Layout(unittest.TestCase):
    def test_current_change_of_preference_table(self):
        html = table(H27, [
            ["Change of preference opens", "Change of preference c<span>loses</span>", "Eligible for offers", "Eligible applicants"],
            ["3 August (9am)", "28 October (2pm)", "November round (24 November)", "Post-school applicants"],
            ["<span>3 August (9am)</span>", "14 December (4pm): SA/NT students", "December round (23 December)", "Current Year 12 students"],
            ["23 December (10am)", "24 December (12 noon)", "January round 1 (12 January 2027)", "Current Year 12 students*"],
        ])
        self.assertEqual(titles(run(html)[0]), [
            ("2026-10-28", "VTAC preferences close: Nov round (2pm)"),
            ("2026-12-24", "VTAC preferences close: Jan round 1 (12pm)"),
        ])

    def test_rowspan_not_duplicated(self):
        html = (f"<h2>{H27}</h2><table class='table'><thead><tr><th>Course applications</th><th>Open</th>"
                "<th>Close</th><th>Fee</th></tr></thead><tbody>"
                "<tr><td>Timely applications</td><td rowspan='3'>3 August (9am)</td><td>28 September (5pm)</td><td>$83</td></tr>"
                "<tr><td>Late applications</td><td>30 October (5pm)</td><td>$166</td></tr>"
                "<tr><td>Very late applications</td><td>4 December (5pm)</td><td>$208</td></tr></tbody></table>")
        self.assertEqual(titles(run(html)[0]), [
            ("2026-08-03", "VTAC applications open (9am)"),
            ("2026-09-28", "VTAC applications close: Timely (5pm)"),
            ("2026-10-30", "VTAC applications close: Late (5pm)"),
            ("2026-12-04", "VTAC applications close: Very late (5pm)"),
        ])

    def test_offer_round_variants(self):
        html = table(H27, [["Offer rounds", "Offers released"],
                           ["November offer round^", "24 November (2pm)"],
                           ["January offer round one Domestic", "12 January 2027 (VTAC account 2pm)"],
                           ["Feb offer round 1", "3 February 2027 (2pm)"],
                           ["February offer round 2 International", "9 February 2027 (2pm)"]])
        self.assertEqual(titles(run(html)[0]), [
            ("2026-11-24", "VTAC offers: Nov round (2pm)"),
            ("2027-01-12", "VTAC offers: Jan round 1 (2pm)"),
            ("2027-02-03", "VTAC offers: Feb round 1 (2pm)"),
        ])

    def test_mid_year_unnamed_rounds(self):
        html = table("Key Dates: April 2024-July 2024 for courses commencing mid-year 2024",
                     [["Offer rounds", "Offers emailed"], ["Round 1", "25 June (VTAC account 2pm)"],
                      ["Round 2", "10 July (VTAC account 2pm)"], ["Round 3", "16 July (VTAC account 2pm)"]])
        self.assertEqual([t for _, t in titles(run(html, today=date(2024, 5, 1))[0])],
                         ["VTAC offers: Jun round 1 (2pm)", "VTAC offers: Jul round 1 (2pm)", "VTAC offers: Jul round 2 (2pm)"])


class Drift(unittest.TestCase):
    def test_renamed_row_is_flagged(self):
        events, unmapped = run(table(H27, [["Applications", "Opens", "Closes"],
                                           ["Standard applications", "2 August (9am)", "27 September (5pm)"]]))
        self.assertEqual(len(events), 2)
        issues = v.drift_issues(events, unmapped, TODAY)
        self.assertEqual(len(issues), 2)
        self.assertTrue(all(i.startswith("no NAMES entry") for i in issues))

    def test_unrecognised_round_is_flagged(self):
        events, unmapped = run(table(H27, [["Offer rounds", "Offers released"], ["Main round", "20 December (2pm)"]]))
        issues = v.drift_issues(events, unmapped, TODAY)
        self.assertEqual(len(issues), 1)
        self.assertTrue(issues[0].startswith("round not recognised"))

    def test_implausible_date_is_flagged(self):
        events, unmapped = run(table("Key Dates: August 2031 - January 2032",
                                     [["Course applications", "Close"], ["Timely applications", "28 September (5pm)"]]))
        self.assertTrue(any("out of range" in i for i in v.drift_issues(events, unmapped, TODAY)))


class Uids(unittest.TestCase):
    def test_uid_survives_heading_rewording(self):
        rows = [["Course applications", "Close"], ["Timely applications", "28 September (5pm)"]]
        a, _ = run(table("Key Dates: August 2026 - January 2027 for courses commencing in 2027", rows))
        b, _ = run(table(H27, rows))
        self.assertEqual(v.event_uids(a), v.event_uids(b))

    def test_uid_survives_date_and_time_change(self):
        a, _ = run(table(H27, [["Course applications", "Close"], ["Timely applications", "28 September (5pm)"]]))
        b, _ = run(table(H27, [["Course applications", "Close"], ["Timely applications", "2 October (4pm)"]]))
        self.assertEqual(v.event_uids(a), v.event_uids(b))


class Cli(unittest.TestCase):
    PAGE = table(H27, [["Offer rounds", "Offers released"]] +
                 [[f"February offer round {i}", f"{i + 1} February 2027 (2pm)"] for i in range(1, 7)])

    def run_main(self, html, out, *extra):
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
            f.write(html)
        try:
            with redirect_stderr(StringIO()):
                return v.main(["--html", f.name, "--out", out, *extra])
        finally:
            os.unlink(f.name)

    def test_sharp_drop_is_not_published(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "vtac.ics")
            self.assertEqual(self.run_main(self.PAGE, out), 0)
            before = read(out)
            small = table(H27, [["Offer rounds", "Offers released"]] +
                          [[f"February offer round {i}", f"{i + 1} February 2027 (2pm)"] for i in range(1, 3)])
            self.assertEqual(self.run_main(small, out, "--min-events", "1"), 1)
            self.assertEqual(read(out), before)
            self.assertEqual(self.run_main(small, out, "--min-events", "1", "--allow-drop"), 0)

    def test_strict_publishes_then_signals(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "vtac.ics")
            page = self.PAGE.replace("February offer round 6", "Bonus round")
            self.assertEqual(self.run_main(page, out, "--strict"), 2)
            self.assertTrue(os.path.exists(out))
            self.assertEqual(self.run_main(page, out), 0)  # without --strict: warn only


if __name__ == "__main__":
    unittest.main()
