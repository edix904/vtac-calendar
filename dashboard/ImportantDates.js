/**
 * Important_Dates tab for the Calendar Dashboard: every unique event once, with 1/0 flags for
 * the campuses it applies to, so a report can filter on one campus (e.g. Is MY = 1) and get every
 * date relevant to it, whichever calendar the date came from.
 *
 * Source of truth: https://github.com/edix904/vtac-calendar (dashboard/ImportantDates.js).
 * Needs Code.js (writeTable_, semesterInfo_), Normalise.js (pdClean_, PD_CAMPUS_MENTION) and
 * PrincipalDates.js (pdCampusOf_, pdDayKey_, PD_CAMPUSES). Called from syncCalendars_() after
 * pdEnrich_() has filled the campus columns of the Events rows:
 *
 *   idWriteImportantDates_(ss, allRows, C, historyStart)   // -> number of rows written
 *
 * What is listed (from the Events rows):
 *   - Principal dates of all three campuses, by normalised title; titles the rules exclude are left out.
 *   - Monash holidays, as "University closed: <holiday>".
 *   - Non-university holidays, as "Public holiday (university open): <holiday>".
 *   - VTAC dates, with the time moved to the Time column.
 *   - Semester summary items other than week / break / swot vac / exams / results labels (those
 *     phases come from each campus's principal dates; the weeks are on Days and Academic_Weeks).
 * Personal and cancelled events are left out.
 *
 * When two listings are the same event (one row):
 *   - Same campus: the same title on the same dates (e.g. listed by two calendars), or two
 *     "University closed" entries on the same day (the Monash holidays calendar and the
 *     principal dates both list the closure).
 *   - Different campuses: the same milestone on the same day for an overlapping teaching period
 *     or, with no period, the same detail. This is the rule pdMarkShared_() uses for Shared With.
 *     An event never combines two different events of one campus.
 * Is AUS / Is MY / Is ID are 1 for each campus that lists the event and each campus its title
 * names (e.g. "(Malaysia)"). Event shows one wording (principal dates first, then Australia,
 * Malaysia, Indonesia); AUS / MY / ID Title keep each campus's own wording.
 */

const ID_SHEET = 'Important_Dates';
const ID_HEADERS = [
  'Event ID', 'Start Date', 'End Date (incl.)', 'Event', 'Type', 'Milestone', 'Teaching Period', 'Time',
  'Is AUS', 'Is MY', 'Is ID', 'Is Shared', 'Campuses', 'AUS Title', 'MY Title', 'ID Title', 'Source Calendars',
];
const ID_CLOSED = 'University closed';
const ID_OPEN_HOLIDAY = 'Public holiday (university open)';
// Calendar categories listed, in the order their wording is preferred.
const ID_CATEGORY_RANK = { 'Principal date': 0, 'Monash holiday': 1, 'Semester': 2, 'VTAC date': 3, 'Non-university holiday': 4 };
const ID_VTAC_TIME = /^(.*\S)\s*\(([^()]*(?:\d|noon|midday|midnight)[^()]*)\)$/i;

/** Writes the Important_Dates tab from the (enriched) Events rows, from historyStart on; returns the number of events. */
function idWriteImportantDates_(ss, rows, C, historyStart) {
  const items = rows.map(r => idItem_(r, C)).filter(it => it && !(historyStart && it.end < historyStart));
  const out = idGroup_(items).map(idRow_)
    .sort((a, b) => a[1] - b[1] || String(a[3]).localeCompare(String(b[3])));
  const seen = {};
  out.forEach(r => {
    const base = idHash_([pdDayKey_(r[1]), pdDayKey_(r[2]), String(r[3]).toLowerCase()].join('|'));
    let id = base;
    for (let i = 2; seen[id]; i++) id = base + '-' + i;
    seen[id] = true;
    r[0] = id;
  });
  writeTable_(ss, ID_SHEET, ID_HEADERS, out,
    { 'Event ID': '@', 'Start Date': 'yyyy-mm-dd', 'End Date (incl.)': 'yyyy-mm-dd' });
  return out.length;
}

function idHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(x => ('0' + (x & 0xff).toString(16)).slice(-2)).join('').slice(0, 12);
}

/** One Events row as a listing, or null when it is not an important date. */
function idItem_(r, C) {
  const category = String(r[C['Category']]);
  const start = r[C['Start Date']];
  if (!(category in ID_CATEGORY_RANK) || r[C['Status']] === 'cancelled') return null;
  if (!(start instanceof Date) || isNaN(start)) return null;   // undated rows are reported by the sync
  const endIncl = r[C['End Date (incl.)']];
  const end = endIncl instanceof Date && endIncl >= start ? endIncl : start;
  const raw = pdClean_(r[C['Title']]);
  const calName = String(r[C['Calendar']]);
  const campus = String(r[C['Campus']] || '') || pdCampusOf_(calName, category);
  let milestone, title = raw, time = '', periods = [];
  if (category === 'Principal date') {
    milestone = String(r[C['Milestone']] || '');
    if (milestone === 'Excluded') return null;
    title = String(r[C['Normalised Title']] || '') || raw;
    milestone = milestone || title;
    time = String(r[C['Milestone Time']] || '');
    periods = String(r[C['Teaching Period']] || '').split(';').map(s => s.trim()).filter(Boolean);
  } else if (category === 'Semester') {
    if (semesterInfo_([raw], start).phase !== 'Non-teaching') return null;
    milestone = raw;
  } else if (category === 'VTAC date') {
    const m = raw.match(ID_VTAC_TIME);
    if (m) { title = m[1]; time = m[2]; }
    milestone = title.split(':')[0].trim();
  } else {
    milestone = category === 'Monash holiday' ? ID_CLOSED : ID_OPEN_HOLIDAY;
    title = milestone + ': ' + raw;
  }
  const lower = title.toLowerCase();
  const detail = lower.indexOf(milestone.toLowerCase() + ': ') === 0 ? lower.slice(milestone.length + 2) : '';
  return {
    category, campus, calName, start, end, title, milestone, time, periods,
    type: milestone === ID_CLOSED ? ID_CLOSED : category === 'Non-university holiday' ? ID_OPEN_HOLIDAY : category,
    day: pdDayKey_(start), endDay: pdDayKey_(end),
    mKey: milestone.toLowerCase(), detail, pKeys: periods.map(p => p.toLowerCase()),
    mentions: PD_CAMPUSES.filter(c => PD_CAMPUS_MENTION[c].test(raw)),
    rank: ID_CATEGORY_RANK[category] * 10 + Math.max(0, PD_CAMPUSES.indexOf(campus)),
  };
}

function idCompare_(a, b) { return a.day.localeCompare(b.day) || a.rank - b.rank || a.title.localeCompare(b.title); }

/** Same campus: same title and dates, or both "University closed" that day. */
function idSameWithinCampus_(a, b) {
  if (a.campus !== b.campus || a.day !== b.day) return false;
  if (a.mKey === ID_CLOSED.toLowerCase() && b.mKey === ID_CLOSED.toLowerCase()) return true;
  return a.title.toLowerCase() === b.title.toLowerCase() && a.endDay === b.endDay;
}

/** Different campuses: pdMarkShared_()'s rule (same milestone and day; overlapping period, else same detail). */
function idSameAcrossCampuses_(a, b) {
  if (a.campus === b.campus || a.day !== b.day || a.mKey !== b.mKey) return false;
  if (a.pKeys.length || b.pKeys.length) return a.pKeys.some(p => b.pKeys.indexOf(p) >= 0);
  return a.detail === b.detail;
}

/** Groups listings into events: [[listing, ...], ...]. */
function idGroup_(items) {
  items = items.slice().sort(idCompare_);
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const campuses = items.map(it => [it.campus]);
  const byDay = {};
  items.forEach((it, i) => (byDay[it.day] || (byDay[it.day] = [])).push(i));
  const pairs = test => Object.keys(byDay).forEach(day => {
    const ids = byDay[day];
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        if (!test(items[ids[x]], items[ids[y]])) continue;
        const a = find(ids[x]), b = find(ids[y]);
        if (a === b) continue;
        if (test === idSameAcrossCampuses_ && campuses[b].some(c => campuses[a].indexOf(c) >= 0)) continue;
        parent[b] = a;
        campuses[a] = campuses[a].concat(campuses[b].filter(c => campuses[a].indexOf(c) < 0));
      }
    }
  });
  pairs(idSameWithinCampus_);     // first, so each campus's listings of an event are one group
  pairs(idSameAcrossCampuses_);   // then join campuses, never two groups of the same campus
  const groups = {};
  items.forEach((it, i) => (groups[find(i)] || (groups[find(i)] = [])).push(it));
  return Object.keys(groups).map(k => groups[k]);
}

/** An event's Important_Dates row (Event ID is filled in by the caller). */
function idRow_(members) {
  members = members.slice().sort(idCompare_);
  const p = members[0];
  const unique = list => list.filter((v, i, a) => v && a.indexOf(v) === i);
  const campuses = PD_CAMPUSES.filter(c => members.some(m => m.campus === c || m.mentions.indexOf(c) >= 0));
  return [
    '', p.start, p.end, p.title, p.type, p.milestone,
    unique([].concat(...members.map(m => m.periods))).join('; '), p.time,
    ...PD_CAMPUSES.map(c => (campuses.indexOf(c) >= 0 ? 1 : 0)),
    campuses.length > 1 ? 1 : 0, campuses.join(', '),
    ...PD_CAMPUSES.map(c => unique(members.filter(m => m.campus === c).map(m => m.title)).join('; ')),
    unique(members.map(m => m.calName)).join('; '),
  ];
}

if (typeof module !== 'undefined') {
  module.exports = { idItem_, idGroup_, idRow_, ID_HEADERS };
}
