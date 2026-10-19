/**
 * Important_Dates tab for the Calendar Dashboard: every unique event once, with 1/0 flags for
 * the campuses it applies to, so a report can filter on one campus (e.g. Is MY = 1) and get every
 * date relevant to it, whichever calendar the date came from. Opening and closing dates of the
 * same thing are one row spanning the period, ready for a Gantt chart or a "between" filter.
 *
 * Source of truth: https://github.com/edix904/vtac-calendar (dashboard/ImportantDates.js).
 * Needs Code.js (writeTable_, semesterInfo_), Normalise.js (pdClean_, PD_CODE_RE,
 * PD_CAMPUS_MENTION) and PrincipalDates.js (pdCampusOf_, pdDayKey_, pdAddDays_, PD_CAMPUSES).
 * Called from syncCalendars_() after pdEnrich_() has filled the campus columns of the Events rows:
 *
 *   idWriteImportantDates_(ss, allRows, C, historyStart)   // -> number of rows written
 *
 * What is listed (from the Events rows):
 *   - Principal dates of all three campuses, by normalised title; titles the rules exclude are left out.
 *   - Monash holidays, as "University closed: <holiday>".
 *   - Non-university holidays, as "Public holiday (university open): <holiday>".
 *   - VTAC dates, with the time moved to the time columns.
 *   - Semester summary items other than week / break / swot vac / exams / results labels (those
 *     phases come from each campus's principal dates; the weeks are on Days and Academic_Weeks).
 * Personal and cancelled events are left out.
 *
 * Periods (Is Period = 1): within a campus, "<X> opens / starts / begins / commences" and the next
 * "<X> closes / ends" for the same teaching period code become one row "<X>: <periods>" from the
 * opening day to the closing day, e.g. "Allocate+ preference entry: Semester 1 (S1-01)". Codes
 * pair one by one, so "Teaching starts: Semester 1 (S1-01), Full year (FY-01)" gives a Semester 1
 * period and a Full year period, each ending on its own "Teaching ends". Without codes the details
 * must match; an opening with no detail (e.g. "VTAC applications open") takes the next closing.
 * "Final assessments and teaching end" closes "Final assessments" (ID_CLOSES). A closing is only
 * looked for before the next opening of the same code (or detail) and within ID_MAX_SPAN days;
 * openings and closings left without a partner stay one-day rows.
 *
 * When two listings are the same event (one row):
 *   - Same campus: the same title on the same dates (e.g. listed by two calendars), or two
 *     "University closed" entries on the same day (the Monash holidays calendar and the
 *     principal dates both list the closure).
 *   - Different campuses: the same milestone with the same start and end days, for an overlapping
 *     teaching period or, with no period, the same detail (the rule pdMarkShared_() uses for
 *     Shared With). An event never combines two different events of one campus.
 * Is AUS / Is MY / Is ID are 1 for each campus that lists the event and each campus its title
 * names (e.g. "(Malaysia)"). Event shows one wording (principal dates first, then Australia,
 * Malaysia, Indonesia); AUS / MY / ID Title keep each campus's own wording.
 */

const ID_SHEET = 'Important_Dates';
const ID_HEADERS = [
  'Event ID', 'Start Date', 'End Date (incl.)', 'Days', 'Event', 'Type', 'Milestone', 'Is Period', 'Teaching Period',
  'Start Time', 'End Time', 'Is AUS', 'Is MY', 'Is ID', 'Is Shared', 'Campuses', 'AUS Title', 'MY Title', 'ID Title',
  'Source Calendars',
];
const ID_CLOSED = 'University closed';
const ID_OPEN_HOLIDAY = 'Public holiday (university open)';
// Calendar categories listed, in the order their wording is preferred.
const ID_CATEGORY_RANK = { 'Principal date': 0, 'Monash holiday': 1, 'Semester': 2, 'VTAC date': 3, 'Non-university holiday': 4 };
const ID_VTAC_TIME = /^(.*\S)\s*\(([^()]*(?:\d|noon|midday|midnight)[^()]*)\)$/i;
const ID_PERIOD_VERB = /^(.*\S)\s+(opens?|starts?|begins?|commences?|closes?|ends?)$/i;
const ID_OPENING = /^(open|start|begin|commence)/i;
// Milestones that close a period of another name (summer and intake terms end exams and teaching together).
const ID_CLOSES = { 'final assessments and teaching end': 'Final assessments' };
const ID_MAX_SPAN = 366;  // days from an opening to its closing (a two-semester intake such as S2-S1-02 is ~305)

/** Writes the Important_Dates tab from the (enriched) Events rows, from historyStart on; returns the number of events. */
function idWriteImportantDates_(ss, rows, C, historyStart) {
  const items = rows.map(r => idItem_(r, C)).filter(it => it && !(historyStart && it.end < historyStart));
  const out = idGroup_(idPairPeriods_(items)).map(idRow_)
    .sort((a, b) => a[1] - b[1] || String(a[4]).localeCompare(String(b[4])));
  const seen = {};
  out.forEach(r => {
    const base = idHash_([pdDayKey_(r[1]), pdDayKey_(r[2]), String(r[4]).toLowerCase()].join('|'));
    let id = base;
    for (let i = 2; seen[id]; i++) id = base + '-' + i;
    seen[id] = true;
    r[0] = id;
  });
  // Times stay as written ("10am"); Sheets would otherwise turn only some of them into time values.
  writeTable_(ss, ID_SHEET, ID_HEADERS, out, {
    'Event ID': '@', 'Start Date': 'yyyy-mm-dd', 'End Date (incl.)': 'yyyy-mm-dd', 'Start Time': '@', 'End Time': '@',
  });
  return out.length;
}

function idHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(x => ('0' + (x & 0xff).toString(16)).slice(-2)).join('').slice(0, 12);
}

function idUnique_(list) { return list.filter((v, i, a) => v && a.indexOf(v) === i); }

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
  let milestone, title = raw, time = '', periods = [], codes = [];
  if (category === 'Principal date') {
    milestone = String(r[C['Milestone']] || '');
    if (milestone === 'Excluded') return null;
    title = String(r[C['Normalised Title']] || '') || raw;
    milestone = milestone || title;
    time = String(r[C['Milestone Time']] || '');
    periods = String(r[C['Teaching Period']] || '').split(';').map(s => s.trim()).filter(Boolean);
    codes = String(r[C['Period Codes']] || '').split(';').map(s => s.trim()).filter(Boolean);
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
  const detailText = title.toLowerCase().indexOf(milestone.toLowerCase() + ': ') === 0 ? title.slice(milestone.length + 2) : '';
  // "<period> (<code>), ..." pieces of the detail, so a listing can be split by code.
  const parts = [];
  if (codes.length) {
    for (const m of detailText.matchAll(new RegExp('([^,]+?)\\s*' + PD_CODE_RE.source, 'g'))) {
      if (codes.indexOf(m[2]) >= 0) parts.push({ name: m[1].trim(), code: m[2] });
    }
  }
  return {
    category, campus, calNames: [calName], start, end, title, milestone, detailText, time, endTime: '',
    periods, codes, parts, isPeriod: false,
    type: milestone === ID_CLOSED ? ID_CLOSED : category === 'Non-university holiday' ? ID_OPEN_HOLIDAY : category,
    day: pdDayKey_(start), endDay: pdDayKey_(end),
    mKey: milestone.toLowerCase(), detail: detailText.toLowerCase(), pKeys: periods.map(p => p.toLowerCase()),
    mentions: PD_CAMPUSES.filter(c => PD_CAMPUS_MENTION[c].test(raw)),
    rank: ID_CATEGORY_RANK[category] * 10 + Math.max(0, PD_CAMPUSES.indexOf(campus)),
  };
}

// ---------------------------------------------------------------- periods

/** The listing's detail for some of its codes ("Semester 1 (S1-01), Full year (FY-01)"). */
function idDetailFor_(it, codes) {
  const parts = it.parts.filter(p => codes.indexOf(p.code) >= 0);
  return parts.length === codes.length ? parts.map(p => `${p.name} (${p.code})`).join(', ') : it.detailText;
}

/** A copy of a listing limited to some of its codes (the ones left after pairing). */
function idSubset_(it, codes) {
  const detailText = idDetailFor_(it, codes);
  const parts = it.parts.filter(p => codes.indexOf(p.code) >= 0);
  const periods = parts.length === codes.length ? idUnique_(parts.map(p => p.name)) : it.periods;
  return Object.assign({}, it, {
    codes, parts, periods, pKeys: periods.map(p => p.toLowerCase()), detailText, detail: detailText.toLowerCase(),
    title: it.milestone + (detailText ? ': ' + detailText : ''),
  });
}

/** One row from an opening, its closing and the codes they share (none: paired by detail). */
function idPeriod_(base, open, close, codes) {
  const detailText = codes.length ? idDetailFor_(open, codes) : open.detailText || close.detailText;
  const parts = open.parts.filter(p => codes.indexOf(p.code) >= 0);
  const periods = codes.length && parts.length === codes.length ? idUnique_(parts.map(p => p.name))
    : idUnique_(open.periods.concat(close.periods));
  return Object.assign({}, open, {
    end: close.end, endDay: close.endDay, milestone: base, mKey: base.toLowerCase(),
    title: base + (detailText ? ': ' + detailText : ''), detailText, detail: detailText.toLowerCase(),
    endTime: close.time, codes, parts, periods, pKeys: periods.map(p => p.toLowerCase()), isPeriod: true,
    calNames: idUnique_(open.calNames.concat(close.calNames)),
    mentions: idUnique_(open.mentions.concat(close.mentions)),
  });
}

/** Replaces each campus's paired openings and closings with period listings (see the header). */
function idPairPeriods_(items) {
  // Exact repeats first, so a listing given by two calendars pairs once (keeping the preferred wording).
  const listings = [], exact = {};
  items.slice().sort(idCompare_).forEach(it => {
    const k = [it.campus, it.day, it.endDay, it.title.toLowerCase()].join('|');
    if (exact[k]) exact[k].calNames = idUnique_(exact[k].calNames.concat(it.calNames));
    else listings.push(exact[k] = Object.assign({}, it));
  });

  const out = [], byThing = {};
  listings.forEach(it => {
    const m = ID_CLOSES[it.mKey] ? [it.milestone, ID_CLOSES[it.mKey], 'ends'] : it.milestone.match(ID_PERIOD_VERB);
    if (!m) { out.push(it); return; }
    const k = it.campus + '|' + m[1].toLowerCase();
    const g = byThing[k] || (byThing[k] = { base: m[1], opens: [], closes: [] });
    (ID_OPENING.test(m[2]) ? g.opens : g.closes).push(it);
  });

  Object.keys(byThing).forEach(k => {
    const { base, opens, closes } = byThing[k];
    [opens, closes].forEach(list => list.sort((a, b) => a.start - b.start));
    const pairs = [];           // {open, close, code}
    const pairedCodes = new Map();
    const pair = (os, cs, matches, sameThing, code) => {
      const used = new Set();
      os.forEach((o, i) => {
        const next = os.slice(i + 1).find(x => x.start > o.start && sameThing(o, x));
        const limit = pdAddDays_(o.start, ID_MAX_SPAN + 1);
        const c = cs.find(x => !used.has(x) && x.start >= o.start && x.start < limit &&
          !(next && x.start >= next.start) && matches(o, x));
        if (!c) return;
        used.add(c);
        pairs.push({ open: o, close: c, code });
        [o, c].forEach(it => (pairedCodes.get(it) || pairedCodes.set(it, []).get(it)).push(code));
      });
    };
    // With codes: one code at a time.
    idUnique_([].concat(...opens.map(o => o.codes))).forEach(code => {
      const has = it => it.codes.indexOf(code) >= 0;
      pair(opens.filter(has), closes.filter(has), () => true, () => true, code);
    });
    // Without codes: matching details; an opening with no detail takes the next closing.
    const noCode = it => !it.codes.length;
    pair(opens.filter(noCode), closes.filter(noCode),
      (o, c) => !o.detail || o.detail === c.detail, (o, x) => o.detail === x.detail, '');

    // Pairs sharing an opening and a closing are one period with all their codes.
    const periods = new Map();
    pairs.forEach(p => {
      const key = periods.get(p.open) || periods.set(p.open, new Map()).get(p.open);
      (key.get(p.close) || key.set(p.close, []).get(p.close)).push(p.code);
    });
    periods.forEach((byClose, open) => byClose.forEach((codes, close) =>
      out.push(idPeriod_(base, open, close, codes.filter(Boolean)))));
    // Openings and closings (or the codes of them) left without a partner stay as they are.
    opens.concat(closes).forEach(it => {
      const done = pairedCodes.get(it) || [];
      if (!done.length) out.push(it);
      else if (it.codes.length) {
        const left = it.codes.filter(c => done.indexOf(c) < 0);
        if (left.length) out.push(idSubset_(it, left));
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------- events

function idCompare_(a, b) { return a.day.localeCompare(b.day) || a.rank - b.rank || a.title.localeCompare(b.title); }

/** Same campus: same title and dates, or both "University closed" that day. */
function idSameWithinCampus_(a, b) {
  if (a.campus !== b.campus || a.day !== b.day) return false;
  if (a.mKey === ID_CLOSED.toLowerCase() && b.mKey === ID_CLOSED.toLowerCase()) return true;
  return a.title.toLowerCase() === b.title.toLowerCase() && a.endDay === b.endDay;
}

/** Different campuses: pdMarkShared_()'s rule (same milestone and dates; overlapping period, else same detail). */
function idSameAcrossCampuses_(a, b) {
  if (a.campus === b.campus || a.day !== b.day || a.endDay !== b.endDay || a.mKey !== b.mKey) return false;
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
  const campuses = PD_CAMPUSES.filter(c => members.some(m => m.campus === c || m.mentions.indexOf(c) >= 0));
  return [
    '', p.start, p.end, Math.round((p.end - p.start) / 864e5) + 1, p.title, p.type, p.milestone,
    p.isPeriod || p.end > p.start ? 1 : 0, idUnique_([].concat(...members.map(m => m.periods))).join('; '),
    p.time, p.endTime,
    ...PD_CAMPUSES.map(c => (campuses.indexOf(c) >= 0 ? 1 : 0)),
    campuses.length > 1 ? 1 : 0, campuses.join(', '),
    ...PD_CAMPUSES.map(c => idUnique_(members.filter(m => m.campus === c).map(m => m.title)).join('; ')),
    idUnique_([].concat(...members.map(m => m.calNames))).join('; '),
  ];
}

if (typeof module !== 'undefined') {
  module.exports = { idItem_, idPairPeriods_, idGroup_, idRow_, ID_HEADERS };
}
