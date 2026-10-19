// node dashboard/test_important_dates.js
// Checks how ImportantDates.js turns Events rows into one row per event with campus flags.
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
  'Milestone', 'Normalised Title', 'Milestone Time', 'Teaching Period'];
const C = Object.fromEntries(H.map((h, i) => [h, i]));
const CAL = { AUS: 'Monash principal dates', MY: 'Monash Malaysia principal dates', ID: 'Monash Indonesia principal dates' };
const day = s => new Date(s + 'T00:00:00');
let n = 0;
const pd = (campus, date, milestone, title, period = '', time = '') =>
  [CAL[campus], 'Principal date', title + ' #' + n++, 'confirmed', day(date), day(date), campus, milestone, title, time, period];
const other = (calendar, category, date, title, end = date) =>
  [calendar, category, title, 'confirmed', day(date), day(end), category === 'Personal' ? '' : 'AUS', '', '', '', ''];

const rows = [
  pd('AUS', '2026-03-31', 'Census date', 'Census date: Semester 1 (S1-01)', 'Semester 1'),
  pd('MY', '2026-03-31', 'Census date', 'Census date: Semester 1 (S1-01)', 'Semester 1'),
  pd('ID', '2026-03-31', 'Census date', 'Census date: Semester 1 (S1-01)', 'Semester 1'),
  other('Monash holidays', 'Monash holiday', '2026-04-03', 'Good Friday'),
  pd('AUS', '2026-04-03', 'University closed', 'University closed: Good Friday'),
  pd('MY', '2026-04-03', 'University closed', 'University closed: Good Friday'),
  pd('MY', '2026-03-20', 'University closed', 'University closed: Hari Raya Aidilfitri Day 1'),
  other('Monash holidays', 'Monash holiday', '2026-03-20', 'Some Australian holiday'),
  pd('AUS', '2026-01-06', 'Fees due', 'Fees due: Summer B (SSB-01), Semester 1 (S1-01)', 'Summer B; Semester 1'),
  pd('MY', '2026-01-06', 'Fees due', 'Fees due: Semester 1 (S1-01)', 'Semester 1'),
  pd('AUS', '2026-01-06', 'Fees due', 'Fees due: Semester 2 (S2-01)', 'Semester 2'),
  pd('MY', '2026-05-01', 'Graduation ceremonies', 'Graduation ceremonies'),
  pd('AUS', '2026-06-01', 'Excluded', 'Something the rules drop'),
  other('Semester summary view', 'Semester', '2026-03-02', 'Week 1', '2026-03-06'),
  other('Semester summary view', 'Semester', '2026-08-31', 'Monash Business School’s mid-semester tests', '2026-09-11'),
  other('VTAC key dates', 'VTAC date', '2026-12-17', 'VTAC offers: Dec round (7am)'),
  other('VTAC key dates', 'VTAC date', '2026-12-17', 'VTAC offers: Dec round (7am)'),
  other('NON University holidays', 'Non-university holiday', '2026-11-03', 'Melbourne Cup'),
  other('My calendar', 'Personal', '2026-04-03', 'Dentist'),
];

const HEADERS = vm.runInContext('ID_HEADERS', ctx); // a top-level const, not a context property
const groups = ctx.idGroup_(rows.map(r => ctx.idItem_(r, C)).filter(Boolean));
const out = groups.map(g => Object.fromEntries(ctx.idRow_(g).map((v, i) => [HEADERS[i], v])));
const find = (date, event) => out.filter(r => ctx.Utilities.formatDate(r['Start Date']) === date && r.Event === event);

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
  ['Monash principal dates; Monash Malaysia principal dates; Monash holidays']);
check('Good Friday type', gf.map(r => r.Type), ['University closed']);
check('different closures on one day stay apart', out.filter(r => ctx.Utilities.formatDate(r['Start Date']) === '2026-03-20')
  .map(r => [r.Event, r.Campuses]).sort(),
  [['University closed: Hari Raya Aidilfitri Day 1', 'MY'], ['University closed: Some Australian holiday', 'AUS']]);
const fees = out.filter(r => ctx.Utilities.formatDate(r['Start Date']) === '2026-01-06');
check('MY fees join one AUS fees event only', fees.map(r => [r.Event, r.Campuses, r['MY Title']]).sort(), [
  ['Fees due: Semester 2 (S2-01)', 'AUS', ''],
  ['Fees due: Summer B (SSB-01), Semester 1 (S1-01)', 'AUS, MY', 'Fees due: Semester 1 (S1-01)'],
]);
check('Malaysia-only event', find('2026-05-01', 'Graduation ceremonies').map(flags), [[0, 1, 0, 0, 'MY']]);
check('excluded milestone left out', out.some(r => /rules drop/.test(r.Event)), false);
check('teaching-week labels left out', out.some(r => r.Event === 'Week 1'), false);
check('other semester items kept', find('2026-08-31', 'Monash Business School’s mid-semester tests').map(r =>
  [ctx.Utilities.formatDate(r['End Date (incl.)']), r.Type, r.Campuses]), [['2026-09-11', 'Semester', 'AUS']]);
check('VTAC repeat listed once, time split off', find('2026-12-17', 'VTAC offers: Dec round').map(r => [r.Time, r.Milestone]),
  [['7am', 'VTAC offers']]);
check('non-university holiday', find('2026-11-03', 'Public holiday (university open): Melbourne Cup').map(r => r.Type),
  ['Public holiday (university open)']);
check('personal events left out', out.some(r => /Dentist/.test(r.Event)), false);
check('row count', out.length, 10);

console.log(bad ? `${bad} checks failed` : `all checks passed (${out.length} events from ${rows.length} rows)`);
process.exit(bad ? 1 : 0);
