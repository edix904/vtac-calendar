// node dashboard/test_important_dates.js
// Checks how ImportantDates.js turns Events rows into one row per event (or period) with campus flags.
// Loads Normalise.js, PrincipalDates.js and ImportantDates.js into one context, as Apps Script
// does; Code.js is not in this repo, so its semesterInfo_() is stubbed with the phases it knows.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.TZ = 'Australia/Melbourne';
const ctx = vm.createContext({
  console,
  Date, // rows are built out here; instanceof Date must see the same constructor
  TZ: 'Australia/Melbourne',
  Utilities: {
    formatDate: d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-'),
    DigestAlgorithm: { MD5: 'md5' },
    computeDigest: (_, s) => [...require('crypto').createHash('md5').update(s).digest()],
  },
  semesterInfo_: labels => ({
    phase: labels.some(l => /\bweek\b|break|swot|exam|result|orientation/i.test(l)) ? 'Teaching' : 'Non-teaching',
  }),
});
['Normalise.js', 'PrincipalDates.js', 'ImportantDates.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }));

const H = ['Calendar', 'Category', 'Title', 'Status', 'Start Date', 'End Date (incl.)', 'Campus',
  'Milestone', 'Normalised Title', 'Milestone Time', 'Teaching Period', 'Period Codes'];
const C = Object.fromEntries(H.map((h, i) => [h, i]));
const CAL = { AUS: 'Monash principal dates', MY: 'Monash Malaysia principal dates', ID: 'Monash Indonesia principal dates' };
const day = s => new Date(s + 'T00:00:00');
const fmt = d => ctx.Utilities.formatDate(d);
let n = 0;
// A principal date as pdEnrich_() leaves it; period names and codes come from the title.
const pd = (campus, date, milestone, title, time = '') => {
  const parts = [...title.matchAll(/([^:,]+?)\s*\(([A-Z][A-Z0-9+]*(?:-[A-Z0-9+]+)+|[A-Z]{2,}\d{1,3})\)/g)];
  return [CAL[campus], 'Principal date', title + ' #' + n++, 'confirmed', day(date), day(date), campus, milestone, title,
    time, parts.map(p => p[1].trim()).join('; '), parts.map(p => p[2]).join('; ')];
};
const other = (calendar, category, date, title, end = date) =>
  [calendar, category, title, 'confirmed', day(date), day(end), category === 'Personal' ? '' : 'AUS', '', '', '', '', ''];

const rows = [
  pd('AUS', '2026-03-31', 'Census date', 'Census date: Semester 1 (S1-01)'),
  pd('MY', '2026-03-31', 'Census date', 'Census date: Semester 1 (S1-01)'),
  pd('ID', '2026-03-31', 'Census date', 'Census date: Semester 1 (S1-01)'),
  other('Monash holidays', 'Monash holiday', '2026-04-03', 'Good Friday'),
  pd('AUS', '2026-04-03', 'University closed', 'University closed: Good Friday'),
  pd('MY', '2026-04-03', 'University closed', 'University closed: Good Friday'),
  pd('MY', '2026-03-20', 'University closed', 'University closed: Hari Raya Aidilfitri Day 1'),
  other('Monash holidays', 'Monash holiday', '2026-03-20', 'Some Australian holiday'),
  pd('AUS', '2026-01-06', 'Fees due', 'Fees due: Summer B (SSB-01), Semester 1 (S1-01)'),
  pd('MY', '2026-01-06', 'Fees due', 'Fees due: Semester 1 (S1-01)'),
  pd('AUS', '2026-01-06', 'Fees due', 'Fees due: Semester 2 (S2-01)'),
  pd('MY', '2026-05-01', 'Graduation ceremonies', 'Graduation ceremonies'),
  pd('AUS', '2026-06-01', 'Excluded', 'Something the rules drop'),
  other('Semester summary view', 'Semester', '2026-03-02', 'Week 1', '2026-03-06'),
  other('Semester summary view', 'Semester', '2026-08-31', 'Monash Business School’s mid-semester tests', '2026-09-11'),
  other('VTAC key dates', 'VTAC date', '2026-12-17', 'VTAC offers: Dec round (7am)'),
  other('VTAC key dates', 'VTAC date', '2026-12-17', 'VTAC offers: Dec round (7am)'),
  other('NON University holidays', 'Non-university holiday', '2026-11-03', 'Melbourne Cup'),
  other('My calendar', 'Personal', '2026-04-03', 'Dentist'),
  // Periods: Allocate+ open / close, same dates at two campuses, different dates at another.
  pd('AUS', '2025-11-17', 'Allocate+ preference entry opens', 'Allocate+ preference entry opens: Semester 1 (S1-01)', '10am'),
  pd('AUS', '2025-12-01', 'Allocate+ preference entry closes', 'Allocate+ preference entry closes: Semester 1 (S1-01)', '5pm'),
  pd('MY', '2025-11-17', 'Allocate+ preference entry opens', 'Allocate+ preference entry opens: Semester 1 (S1-01)', '10am'),
  pd('MY', '2025-12-01', 'Allocate+ preference entry closes', 'Allocate+ preference entry closes: Semester 1 (S1-01)', '5pm'),
  pd('ID', '2025-11-17', 'Allocate+ preference entry opens', 'Allocate+ preference entry opens: Semester 1 (S1-01)'),
  pd('ID', '2025-11-28', 'Allocate+ preference entry closes', 'Allocate+ preference entry closes: Semester 1 (S1-01)'),
  // Teaching: a Semester 1 + Full year opening splits into two periods by code.
  pd('AUS', '2026-03-02', 'Teaching starts', 'Teaching starts: Semester 1 (S1-01), Full year (FY-01)'),
  pd('AUS', '2026-06-05', 'Teaching ends', 'Teaching ends: Semester 1 (S1-01)'),
  pd('AUS', '2026-07-27', 'Teaching starts', 'Teaching starts: Semester 2 (S2-01)'),
  pd('AUS', '2026-10-23', 'Teaching ends', 'Teaching ends: Semester 2 (S2-01), Full year (FY-01)'),
  // A two-semester intake runs about ten months.
  pd('AUS', '2025-07-28', 'Teaching starts', 'Teaching starts: Semester 2 - Semester 1 (S2-S1-02)'),
  pd('AUS', '2026-05-29', 'Teaching ends', 'Teaching ends: Semester 2 - Semester 1 (S2-S1-02)'),
  // Intake terms close exams and teaching together.
  pd('MY', '2026-02-02', 'Final assessments start', 'Final assessments start: October intake (OCT-MY-01)'),
  pd('MY', '2026-02-13', 'Final assessments and teaching end', 'Final assessments and teaching end: October intake (OCT-MY-01)'),
  // An opening whose closing is not published yet stays a one-day row.
  pd('MY', '2026-08-03', 'Course transfer applications open', 'Course transfer applications open: Semester 1 (S1-01)'),
  // A closing after the next year's opening belongs to that opening, not to the year before.
  pd('AUS', '2025-08-01', 'Graduation applications open', 'Graduation applications open: May round (Australia)'),
  pd('AUS', '2026-08-01', 'Graduation applications open', 'Graduation applications open: May round (Australia)'),
  pd('AUS', '2026-09-15', 'Graduation applications close', 'Graduation applications close: May round (Australia)'),
  // VTAC: an opening with no detail takes the next closing; the later closings stay single.
  other('VTAC key dates', 'VTAC date', '2026-08-03', 'VTAC applications open (9am)'),
  other('VTAC key dates', 'VTAC date', '2026-09-28', 'VTAC applications close: Timely (5pm)'),
  other('VTAC key dates', 'VTAC date', '2026-10-15', 'VTAC applications close: Late (5pm)'),
];

const HEADERS = vm.runInContext('ID_HEADERS', ctx); // a top-level const, not a context property
const items = rows.map(r => ctx.idItem_(r, C)).filter(Boolean);
const out = ctx.idGroup_(ctx.idPairPeriods_(items)).map(g => Object.fromEntries(ctx.idRow_(g).map((v, i) => [HEADERS[i], v])));
const find = (date, event) => out.filter(r => fmt(r['Start Date']) === date && r.Event === event);
const span = r => [fmt(r['Start Date']), fmt(r['End Date (incl.)']), r.Days, r['Is Period']];

let bad = 0;
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  bad++;
  console.log('FAIL', label, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
};
const flags = r => r && [r['Is AUS'], r['Is MY'], r['Is ID'], r['Is Shared'], r.Campuses];

check('census shared by all three, listed once', find('2026-03-31', 'Census date: Semester 1 (S1-01)').map(flags),
  [[1, 1, 1, 1, 'AUS, MY, ID']]);
const gf = find('2026-04-03', 'University closed: Good Friday');
check('holiday + AUS closure + MY closure is one event', gf.map(flags), [[1, 1, 0, 1, 'AUS, MY']]);
check('Good Friday sources', gf.map(r => r['Source Calendars']),
  ['Monash principal dates; Monash holidays; Monash Malaysia principal dates']);
check('Good Friday type', gf.map(r => [r.Type, r['Is Period'], r.Days]), [['University closed', 0, 1]]);
check('different closures on one day stay apart', out.filter(r => fmt(r['Start Date']) === '2026-03-20')
  .map(r => [r.Event, r.Campuses]).sort(),
  [['University closed: Hari Raya Aidilfitri Day 1', 'MY'], ['University closed: Some Australian holiday', 'AUS']]);
const fees = out.filter(r => fmt(r['Start Date']) === '2026-01-06');
check('MY fees join one AUS fees event only', fees.map(r => [r.Event, r.Campuses, r['MY Title']]).sort(), [
  ['Fees due: Semester 2 (S2-01)', 'AUS', ''],
  ['Fees due: Summer B (SSB-01), Semester 1 (S1-01)', 'AUS, MY', 'Fees due: Semester 1 (S1-01)'],
]);
check('Malaysia-only event', find('2026-05-01', 'Graduation ceremonies').map(flags), [[0, 1, 0, 0, 'MY']]);
check('excluded milestone left out', out.some(r => /rules drop/.test(r.Event)), false);
check('teaching-week labels left out', out.some(r => r.Event === 'Week 1'), false);
check('other semester items kept, multi-day', find('2026-08-31', 'Monash Business School’s mid-semester tests').map(r =>
  [...span(r), r.Type, r.Campuses]), [['2026-08-31', '2026-09-11', 12, 1, 'Semester', 'AUS']]);
check('VTAC repeat listed once, time split off', find('2026-12-17', 'VTAC offers: Dec round').map(r =>
  [r['Start Time'], r.Milestone]), [['7am', 'VTAC offers']]);
check('non-university holiday', find('2026-11-03', 'Public holiday (university open): Melbourne Cup').map(r => r.Type),
  ['Public holiday (university open)']);
check('personal events left out', out.some(r => /Dentist/.test(r.Event)), false);

const alloc = find('2025-11-17', 'Allocate+ preference entry: Semester 1 (S1-01)');
check('Allocate+ open + close is one period per distinct span', alloc.map(r =>
  [...span(r), r.Milestone, r['Start Time'], r['End Time'], r.Campuses]).sort(), [
  ['2025-11-17', '2025-11-28', 12, 1, 'Allocate+ preference entry', '', '', 'ID'],
  ['2025-11-17', '2025-12-01', 15, 1, 'Allocate+ preference entry', '10am', '5pm', 'AUS, MY'],
]);
check('no one-day Allocate+ rows left', out.some(r => /^Allocate\+ preference entry (opens|closes)/.test(r.Event)), false);
check('teaching periods split by code', out.filter(r => r.Milestone === 'Teaching').map(r => [r.Event, ...span(r)]).sort(), [
  ['Teaching: Full year (FY-01)', '2026-03-02', '2026-10-23', 236, 1],
  ['Teaching: Semester 1 (S1-01)', '2026-03-02', '2026-06-05', 96, 1],
  ['Teaching: Semester 2 (S2-01)', '2026-07-27', '2026-10-23', 89, 1],
  ['Teaching: Semester 2 - Semester 1 (S2-S1-02)', '2025-07-28', '2026-05-29', 306, 1],
]);
check('final assessments closed by "final assessments and teaching end"',
  find('2026-02-02', 'Final assessments: October intake (OCT-MY-01)').map(r => [...span(r), r.Campuses]),
  [['2026-02-02', '2026-02-13', 12, 1, 'MY']]);
check('unpaired opening stays a one-day row', find('2026-08-03', 'Course transfer applications open: Semester 1 (S1-01)')
  .map(span), [['2026-08-03', '2026-08-03', 1, 0]]);
check('closing pairs with the latest opening before it', out.filter(r => /^Graduation applications/.test(r.Event))
  .map(r => [r.Event, ...span(r)]).sort(), [
  ['Graduation applications open: May round (Australia)', '2025-08-01', '2025-08-01', 1, 0],
  ['Graduation applications: May round (Australia)', '2026-08-01', '2026-09-15', 46, 1],
]);
check('VTAC applications period', out.filter(r => /^VTAC applications/.test(r.Event))
  .map(r => [r.Event, ...span(r), r['Start Time'], r['End Time']]).sort(), [
  ['VTAC applications close: Late', '2026-10-15', '2026-10-15', 1, 0, '5pm', ''],
  ['VTAC applications: Timely', '2026-08-03', '2026-09-28', 57, 1, '9am', '5pm'],
]);
check('row count', out.length, 22);

console.log(bad ? `${bad} checks failed` : `all checks passed (${out.length} rows from ${rows.length} Events rows)`);
process.exit(bad ? 1 : 0);
