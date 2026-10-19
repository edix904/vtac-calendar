"""Tests for principal_dates.py (python -m unittest -v test_principal_dates.py)."""
import json
import os
import re
import unittest
from datetime import date

import principal_dates as pd

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "tests", "fixtures")


def fixture(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


class RulesFile(unittest.TestCase):
    def test_rules_load_and_compile_in_both_dialects(self):
        rules = pd.load_rules()
        # Patterns must also be valid JavaScript: no Python-only syntax.
        for key in ("rewrites", "milestones", "titles", "period_names"):
            for r in rules[key]:
                self.assertNotRegex(r["pattern"], r"\(\?P<|\(\?<!|\\A|\\Z", r["pattern"])
        for r in rules["milestones"]:
            self.assertTrue(r["milestone"].strip())


class Normalise(unittest.TestCase):
    rules = pd.load_rules()

    def test_shared_cases(self):
        with open(os.path.join(HERE, "normalise_cases.json"), encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        for c in cases:
            n = pd.normalise(c["raw"], self.rules)
            with self.subTest(raw=c["raw"]):
                self.assertEqual(n.milestone, c["milestone"])
                self.assertEqual(n.title, c["title"])
                self.assertEqual(n.period_codes, c["period_codes"])
                self.assertEqual(n.time, c["time"])

    def test_variants_collapse(self):
        same = [
            ("Final assessments timetable published: Semester two (S2-01)",
             "Final assessment timetable published: semester 2 (S2-01)"),
            ("Allocate+ adjustment: opens 10am for semester one (S1-01)",
             "Allocate+ adjustment opens at 10am: Semester one (S1-01)"),
            ("Mid-semester break: begins for semester one (S1-01)",
             "Mid-semester break starts: Semester one (S1-01)"),
            ("Mid-year Orientation Week starts: Semester Two (S2-01)", "Orientation starts: Semester two (S2-01)"),
            ("Results (deferred and supplementary): released for semester one (S1-01)",
             "Deferred and supplementary assessment results released: Semester one (S1-01) 2025"),
            ("Census date: Semester 2 (S2-01). Last day to withdraw from units without incurring fees.",
             "Census date: Semester two (S2-01)"),
        ]
        for a, b in same:
            na, nb = pd.normalise(a, self.rules), pd.normalise(b, self.rules)
            self.assertEqual((na.title, na.time), (nb.title, nb.time), (a, b))

    def test_campus_mentions_and_period_year(self):
        n = pd.normalise("Graduation applications close: April round (Malaysia) and May round (Australia)", self.rules)
        self.assertEqual(sorted(n.campuses), ["AUS", "MY"])
        n = pd.normalise("Swot vac starts: October intake (OCT-MY-01) 2026", self.rules)
        self.assertEqual(n.periods[0]["year"], 2026)
        self.assertEqual(n.phase, "swot_start")

    def test_idempotent(self):
        for raw in ["Allocate+ preference entry: closes 5pm for semester one (S1-01)",
                    "University closed: Hari Raya Aidilfitri Day 1",
                    "Teaching starts: Monash Indonesia term 1 (MI-T1-6)"]:
            n = pd.normalise(raw, self.rules)
            again = pd.normalise(n.title + (f" ({n.time})" if n.time else ""), self.rules)
            self.assertEqual((again.title, again.time, again.milestone), (n.title, n.time, n.milestone))

    def test_unknown_title_is_flagged_not_dropped(self):
        n = pd.normalise("Something brand new: Semester one (S1-01)", self.rules)
        self.assertFalse(n.classified)
        self.assertEqual(n.title, "Something brand new: Semester 1 (S1-01)")


class ParseMalaysia(unittest.TestCase):
    def setUp(self):
        self.events, self.warnings = pd.parse_page(fixture("my_2026.html"))
        self.rules = pd.load_rules()

    def find(self, pattern):
        return [e for e in self.events if re.search(pattern, e.title)]

    def test_counts_and_no_medicine_tables(self):
        self.assertGreater(len(self.events), 140)
        self.assertFalse(self.find(r"Rotation|Swot Vac$|Final Assessment \(Exam\)"))
        self.assertEqual(self.warnings, [])

    def test_years_and_rollover(self):
        ts = self.find(r"^Teaching starts: Semester one")[0]
        self.assertEqual(ts.start, date(2026, 3, 2))
        jan27 = [e for e in self.find(r"October intake") if e.start.year == 2027]
        self.assertTrue(jan27, "October intake rows in 2027 should get 2027 dates")
        self.assertTrue(all(e.start >= date(2026, 9, 1) for e in self.find(r"OCT-MY-01")))

    def test_semester_views_deduplicated(self):
        titles = [(e.start, e.title) for e in self.events]
        self.assertEqual(len(titles), len(set(titles)))
        self.assertEqual(len(self.find(r"^Graduation applications close: September/October round")), 1)

    def test_tbc_rows_skipped(self):
        self.assertFalse([e for e in self.events if e.start.year == 2027 and e.start.month == 6])

    def test_all_classified(self):
        items = pd.build_events(self.events, self.rules, "MY")
        self.assertEqual([n.raw for _, n in items if not n.classified], [])


class ParseIndonesia(unittest.TestCase):
    def test_parse(self):
        events, warnings = pd.parse_page(fixture("id_2026.html"))
        self.assertEqual(warnings, [])
        self.assertGreater(len(events), 50)
        first = events[0]
        self.assertEqual((first.start, first.title), (date(2026, 1, 1), "University closed: New Year's Day"))
        rules = pd.load_rules()
        items = pd.build_events(events, rules, "ID")
        self.assertEqual([n.raw for _, n in items if not n.classified], [])
        starts = [n.title for e, n in items if n.milestone == "Teaching starts"]
        self.assertIn("Teaching starts: Semester 2 (MI-S2)", starts)


class Calendar(unittest.TestCase):
    def test_uids_stable_and_unique(self):
        rules = pd.load_rules()
        events, _ = pd.parse_page(fixture("my_2026.html"))
        items = pd.build_events(events, rules, "MY")
        cal = pd.build_calendar(items, "MY", "test").to_ical().decode()
        uids = re.findall(r"^UID:(.+?)\r?$", cal, re.M)
        self.assertEqual(len(uids), len(set(uids)))
        self.assertEqual(len(uids), len(items))
        cal2 = pd.build_calendar(items, "MY", "test").to_ical().decode()
        self.assertEqual(uids, re.findall(r"^UID:(.+?)\r?$", cal2, re.M))
        self.assertIn("SUMMARY:Teaching starts: Semester 1 (S1-01)\\, Full year (FY-01)", cal)


if __name__ == "__main__":
    unittest.main()
