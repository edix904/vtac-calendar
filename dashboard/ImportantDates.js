/**
 * Important_Dates tab for the Calendar Dashboard: every unique event once, with a theme and 1/0
 * flags for the campuses it applies to, so a report can filter on one campus (e.g. Is MY = 1) and
 * get every date relevant to it, whichever calendar the date came from. Opening and closing dates
 * of the same thing are one row spanning the period, ready for a Gantt chart or a "between" filter.
 *
 * Source of truth: https://github.com/edix904/vtac-calendar (dashboard/ImportantDates.js).
 * Needs Code.js (writeTable_, semesterInfo_), Normalise.js (pdClean_, PD_CODE_RE,
 * PD_CAMPUS_MENTION), PrincipalDates.js (pdCampusOf_, pdDayKey_, pdAddDays_, PD_CAMPUSES) and
 * ImportantDatesRules.js (ID_RULES_EMBEDDED). Called from syncCalendars_() after pdEnrich_() has
 * filled the campus columns of the Events rows:
 *
 *   idWriteImportantDates_(ss, allRows, C, historyStart, windowEnd)   // -> summary for the log
 *
 * Rules and review: dashboard/important_dates_rules.json (fetched from GitHub on every sync,
 * falling back to the embedded copy) holds the theme rules and the corrections ("decisions") of
 * the daily Claude review (dashboard/review/REVIEW.md). After writing the tab, the sync commits a
 * snapshot of its inputs and output to dashboard/snapshot/ for that review, when the script
 * property GITHUB_TOKEN holds a token that can write to the repository.
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
 *
 * Review decisions (all keyed by listing key "CAMPUS|YYYY-MM-DD|title"):
 *   exclude {key}            leave the listing out
 *   unpair {key}             never pair the listing automatically
 *   pair {open, close, milestone?, title?}   make one period of two listings of a campus
 *   merge {keys: [...]}      the events holding these listings are one event
 *   separate {keys: [...]}   the events holding these listings are never merged
 *   set {key, theme?, title?}                theme or wording of the event holding the listing
 *   add {campus | campuses, start, end?, title, milestone?, theme?, time?, source}  a missing date
 * Each takes a "reason", shown in the Review Note column.
 */

const ID_SHEET = 'Important_Dates';
const ID_HEADERS = [
  'Event ID', 'Start Date', 'End Date (incl.)', 'Days', 'Theme', 'Event', 'Type', 'Milestone', 'Is Period',
  'Teaching Period', 'Start Time', 'End Time', 'Is AUS', 'Is MY', 'Is ID', 'Is Shared', 'Campuses',
  'AUS Title', 'MY Title', 'ID Title', 'Source Calendars', 'Review Note',
];
const ID_RULES_URL = 'https://raw.githubusercontent.com/edix904/vtac-calendar/main/dashboard/important_dates_rules.json';
const ID_SNAPSHOT_REPO = 'edix904/vtac-calendar';
const ID_SNAPSHOT_DIR = 'dashboard/snapshot';
const ID_CLOSED = 'University closed';
const ID_OPEN_HOLIDAY = 'Public holiday (university open)';
const ID_OTHER = 'Other';
// Calendar categories listed, in the order their wording is preferred.
const ID_CATEGORY_RANK = { 'Principal date': 0, 'Monash holiday': 1, 'Semester': 2, 'VTAC date': 3, 'Non-university holiday': 4 };
const ID_VTAC_TIME = /^(.*\S)\s*\(([^()]*(?:\d|noon|midday|midnight)[^()]*)\)$/i;
const ID_PERIOD_VERB = /^(.*\S)\s+(opens?|starts?|begins?|commences?|closes?|ends?)$/i;
const ID_OPENING = /^(open|start|begin|commence)/i;
// Milestones that close a period of another name (summer and intake terms end exams and teaching together).
const ID_CLOSES = { 'final assessments and teaching end': 'Final assessments' };
const ID_MAX_SPAN = 366;  // days from an opening to its closing (a two-semester intake such as S2-S1-02 is ~305)

// ---------------------------------------------------------------- entry point

/** Writes the Important_Dates tab (events from historyStart on) and the review snapshot; returns a log summary. */
function idWriteImportantDates_(ss, rows, C, historyStart, windowEnd) {
  const loaded = idLoadRules_();
  const items = rows.map(r => idItem_(r, C)).filter(it => it && !(historyStart && it.end < historyStart));
  const built = idBuild_(items, loaded.rules, windowEnd);
  // Times stay as written ("10am"); Sheets would otherwise turn only some of them into time values.
  writeTable_(ss, ID_SHEET, ID_HEADERS, built.events.map(idSheetRow_), {
    'Event ID': '@', 'Start Date': 'yyyy-mm-dd', 'End Date (incl.)': 'yyyy-mm-dd', 'Start Time': '@', 'End Time': '@',
  });
  let snapshot;
  try {
    snapshot = idExportSnapshot_(items, built, loaded, windowEnd);
  } catch (e) {
    snapshot = 'FAILED ' + e.message;
    console.error(e.stack || e);
  }
  return `${built.events.length} (rules ${loaded.source}, review decisions ${built.applied}/${built.decisionCount}, ` +
    `flagged ${built.events.filter(e => e.flags.length).length}, snapshot ${snapshot})`;
}

/** Rules from GitHub, or the embedded copy if GitHub can't be reached. Returns {rules, json, source}. */
function idLoadRules_() {
  try {
    const res = UrlFetchApp.fetch(ID_RULES_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const json = JSON.parse(res.getContentText('UTF-8'));
      return { rules: idCompileRules_(json), json, source: 'GitHub ' + (json.version || '') };
    }
  } catch (e) {
    console.warn('Important dates rules: GitHub fetch failed (' + e.message + '); using embedded copy');
  }
  return { rules: idCompileRules_(ID_RULES_EMBEDDED), json: ID_RULES_EMBEDDED, source: 'embedded ' + (ID_RULES_EMBEDDED.version || '') };
}

function idCompileRules_(json) {
  const d = json.decisions || {};
  const list = k => (d[k] || []).map((x, i) => Object.assign({ kind: k, index: i }, x));
  return {
    version: json.version || '',
    themes: json.themes || [],
    themeRules: (json.theme_rules || []).map(r => ({ re: new RegExp(r.pattern, 'i'), theme: r.theme })),
    standalone: (json.standalone || []).map(p => new RegExp(p, 'i')),
    decisions: {
      exclude: list('exclude'), unpair: list('unpair'), pair: list('pair'), merge: list('merge'),
      separate: list('separate'), set: list('set'), add: list('add'),
    },
  };
}

// ---------------------------------------------------------------- listings

function idUnique_(list) { return list.filter((v, i, a) => v && a.indexOf(v) === i); }

/** 'YYYY-MM-DD' (snapshot, decisions) or a Date -> local midnight Date. */
function idDate_(v) {
  if (v instanceof Date) return v;
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Fills a listing's derived fields from its own (also used on snapshot listings by review_check.js). */
function idHydrate_(it) {
  it.start = idDate_(it.start);
  it.end = idDate_(it.end) || it.start;
  if (it.end < it.start) it.end = it.start;
  it.day = pdDayKey_(it.start);
  it.endDay = pdDayKey_(it.end);
  it.key = it.key || [it.campus, it.day, it.title].join('|');
  it.keys = it.keys || [it.key];
  it.calNames = it.calNames || [];
  it.periods = it.periods || [];
  it.codes = it.codes || [];
  it.parts = it.parts || [];
  it.mentions = it.mentions || [];
  it.notes = it.notes || [];
  it.time = it.time || '';
  it.endTime = it.endTime || '';
  it.detailText = it.detailText || '';
  it.mKey = it.milestone.toLowerCase();
  it.detail = it.detailText.toLowerCase();
  it.pKeys = it.periods.map(p => p.toLowerCase());
  it.type = it.milestone === ID_CLOSED ? ID_CLOSED : it.category === 'Non-university holiday' ? ID_OPEN_HOLIDAY : it.category;
  it.rank = (it.category in ID_CATEGORY_RANK ? ID_CATEGORY_RANK[it.category] : 5) * 10 + Math.max(0, PD_CAMPUSES.indexOf(it.campus));
  return it;
}

/** The milestone's detail ("Semester 1 (S1-01)") and its "<period> (<code>)" pieces. */
function idDetail_(title, milestone, codes) {
  const detailText = title.toLowerCase().indexOf(milestone.toLowerCase() + ': ') === 0 ? title.slice(milestone.length + 2) : '';
  const parts = [];
  if (codes.length) {
    for (const m of detailText.matchAll(new RegExp('([^,]+?)\\s*' + PD_CODE_RE.source, 'g'))) {
      if (codes.indexOf(m[2]) >= 0) parts.push({ name: m[1].trim(), code: m[2] });
    }
  }
  return { detailText, parts };
}

/** One Events row as a listing, or null when it is not an important date. */
function idItem_(r, C) {
  const category = String(r[C['Category']]);
  const start = r[C['Start Date']];
  if (!(category in ID_CATEGORY_RANK) || r[C['Status']] === 'cancelled') return null;
  if (!(start instanceof Date) || isNaN(start)) return null;   // undated rows are reported by the sync
  const endIncl = r[C['End Date (incl.)']];
  const raw = pdClean_(r[C['Title']]);
  const calName = String(r[C['Calendar']]);
  const campus = String(r[C['Campus']] || '') || pdCampusOf_(calName, category);
  let milestone, title = raw, time = '', periods = [], codes = [], classified = true;
  if (category === 'Principal date') {
    milestone = String(r[C['Milestone']] || '');
    if (milestone === 'Excluded') return null;
    title = String(r[C['Normalised Title']] || '') || raw;
    milestone = milestone || title;
    time = String(r[C['Milestone Time']] || '');
    periods = String(r[C['Teaching Period']] || '').split(';').map(s => s.trim()).filter(Boolean);
    codes = String(r[C['Period Codes']] || '').split(';').map(s => s.trim()).filter(Boolean);
    classified = r[C['Classified']] !== false;
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
  const { detailText, parts } = idDetail_(title, milestone, codes);
  return idHydrate_({
    campus, category, calNames: [calName], start, end: endIncl instanceof Date ? endIncl : start, title, milestone,
    detailText, time, periods, codes, parts, classified,
    mentions: PD_CAMPUSES.filter(c => PD_CAMPUS_MENTION[c].test(raw)),
  });
}

/** Listings for an "add" decision (one per campus). */
function idAddedItems_(d) {
  const campuses = d.campuses || (d.campus ? [d.campus] : []);
  const title = String(d.title || '');
  const milestone = String(d.milestone || title.split(':')[0]).trim();
  const codes = d.codes || [];
  const { detailText, parts } = idDetail_(title, milestone, codes);
  return campuses.map(campus => idHydrate_({
    campus, category: d.category || 'Principal date', calNames: ['Review'], start: d.start, end: d.end || d.start,
    title, milestone, detailText, time: d.time || '', periods: d.periods || [], codes, parts, classified: true,
    mentions: [], notes: [idNote_(d)],
  }));
}

function idNote_(d) { return `Review ${d.kind}${d.reason ? ': ' + d.reason : ''}`; }

// ---------------------------------------------------------------- build

/**
 * Listings -> events. Returns {events, applied, decisionCount, unused}; each event has the row
 * fields plus keys (listing keys), flags (for the review) and notes (review decisions applied).
 */
function idBuild_(items, rules, windowEnd) {
  const D = rules.decisions;
  const used = new Set();
  const use = d => used.add(d.kind + ':' + d.index);

  // Exact repeats first, so a listing given by two calendars counts once (keeping the preferred wording).
  let listings = [];
  const exact = {};
  items.slice().sort(idCompare_).forEach(it => {
    const k = [it.campus, it.day, it.endDay, it.title.toLowerCase()].join('|');
    if (exact[k]) {
      exact[k].calNames = idUnique_(exact[k].calNames.concat(it.calNames));
      exact[k].keys = idUnique_(exact[k].keys.concat(it.keys));
    } else listings.push(exact[k] = Object.assign({}, it, { keys: it.keys.slice(), notes: it.notes.slice() }));
  });

  const has = (it, key) => it.keys.indexOf(key) >= 0;
  const find = key => listings.find(it => has(it, key));
  D.exclude.forEach(d => {
    const before = listings.length;
    listings = listings.filter(it => !has(it, d.key));
    if (listings.length < before) use(d);
  });
  D.add.forEach(d => { const added = idAddedItems_(d); if (added.length) { use(d); listings = listings.concat(added); } });
  D.unpair.forEach(d => { const it = find(d.key); if (it) { it.noPair = true; it.notes.push(idNote_(d)); use(d); } });

  // Pairs the review made, then the automatic ones.
  const forced = [];
  D.pair.forEach(d => {
    const open = find(d.open), close = find(d.close);
    if (!open || !close || open === close || open.campus !== close.campus) return;
    const verb = open.milestone.match(ID_PERIOD_VERB);
    const base = d.milestone || (verb ? verb[1] : open.milestone);
    const shared = open.codes.filter(c => close.codes.indexOf(c) >= 0);
    const p = idPeriod_(base, open, close, shared.length ? shared : open.codes);
    if (d.title) Object.assign(p, idRetitle_(p, d.title));
    p.notes.push(idNote_(d));
    forced.push(p);
    listings = listings.filter(it => it !== open && it !== close);
    use(d);
  });
  listings = forced.concat(idPairPeriods_(listings));

  const groups = idGroup_(listings, D, use);
  const events = groups.map(members => idEvent_(members, rules, D, use));
  idFlag_(events, windowEnd, rules);
  events.sort((a, b) => a.start - b.start || a.event.localeCompare(b.event));
  const seen = {};
  events.forEach(e => {
    const base = idHash_([pdDayKey_(e.start), pdDayKey_(e.end), e.event.toLowerCase()].join('|'));
    let id = base;
    for (let i = 2; seen[id]; i++) id = base + '-' + i;
    seen[id] = true;
    e.id = id;
  });
  const all = [].concat(...Object.keys(D).map(k => D[k]));
  return {
    events, applied: used.size, decisionCount: all.length,
    unused: all.filter(d => !used.has(d.kind + ':' + d.index)).map(d => ({ kind: d.kind, index: d.index })),
  };
}

function idHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(x => ('0' + (x & 0xff).toString(16)).slice(-2)).join('').slice(0, 12);
}

/** A new wording for a listing or period (keeps the milestone when the title still starts with it). */
function idRetitle_(it, title) {
  const { detailText } = idDetail_(title, it.milestone, []);
  return { title, detailText, detail: detailText.toLowerCase() };
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

/** One period from an opening, its closing and the codes they share (none: paired by detail). */
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
    keys: idUnique_(open.keys.concat(close.keys)),
    notes: open.notes.concat(close.notes),
    classified: open.classified !== false && close.classified !== false,
  });
}

/** The thing a one-day listing opens or closes: {base, opening} or null. */
function idVerb_(it) {
  if (ID_CLOSES[it.mKey]) return { base: ID_CLOSES[it.mKey], opening: false };
  const m = it.milestone.match(ID_PERIOD_VERB);
  return m ? { base: m[1], opening: ID_OPENING.test(m[2]) } : null;
}

/** Replaces each campus's paired openings and closings with period listings (see the header). */
function idPairPeriods_(listings) {
  const out = [], byThing = {};
  listings.forEach(it => {
    const v = !it.isPeriod && !it.noPair && idVerb_(it);
    if (!v) { out.push(it); return; }
    const k = it.campus + '|' + v.base.toLowerCase();
    const g = byThing[k] || (byThing[k] = { base: v.base, opens: [], closes: [] });
    (v.opening ? g.opens : g.closes).push(it);
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
      const byClose = periods.get(p.open) || periods.set(p.open, new Map()).get(p.open);
      (byClose.get(p.close) || byClose.set(p.close, []).get(p.close)).push(p.code);
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

/** Groups listings into events: [[listing, ...], ...]. Review merges first; separates block merges. */
function idGroup_(items, decisions, use) {
  decisions = decisions || { merge: [], separate: [] };
  use = use || (() => {});
  items = items.slice().sort(idCompare_);
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const campuses = items.map(it => [it.campus]);
  const keys = items.map(it => it.keys.slice());
  const blocked = (a, b) => decisions.separate.some(d => {
    const inA = d.keys.some(k => keys[a].indexOf(k) >= 0), inB = d.keys.some(k => keys[b].indexOf(k) >= 0);
    if (inA && inB) use(d);
    return inA && inB;
  });
  const join = (a, b) => {
    parent[b] = a;
    campuses[a] = idUnique_(campuses[a].concat(campuses[b]));
    keys[a] = keys[a].concat(keys[b]);
  };
  decisions.merge.forEach(d => {
    const ids = idUnique_(d.keys.map(k => items.findIndex(it => it.keys.indexOf(k) >= 0)).filter(i => i >= 0).map(String)).map(Number);
    if (ids.length < 2) return;
    ids.slice(1).forEach(i => { const a = find(ids[0]), b = find(i); if (a !== b) join(a, b); });
    use(d);
  });
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
        if (blocked(a, b)) continue;
        join(a, b);
      }
    }
  });
  pairs(idSameWithinCampus_);     // first, so each campus's listings of an event are one group
  pairs(idSameAcrossCampuses_);   // then join campuses, never two groups of the same campus
  const groups = {};
  items.forEach((it, i) => (groups[find(i)] || (groups[find(i)] = [])).push(it));
  return Object.keys(groups).map(k => groups[k]);
}

function idThemeOf_(rules, milestone, title) {
  for (const r of rules.themeRules) if (r.re.test(milestone)) return r.theme;
  for (const r of rules.themeRules) if (r.re.test(title)) return r.theme;
  return ID_OTHER;
}

/** An event from its listings, with the review's theme / wording changes. */
function idEvent_(members, rules, D, use) {
  members = members.slice().sort(idCompare_);
  const p = members[0];
  const keys = idUnique_([].concat(...members.map(m => m.keys)));
  const notes = idUnique_([].concat(...members.map(m => m.notes)));
  let title = p.title, theme = idThemeOf_(rules, p.milestone, p.title);
  D.set.forEach(d => {
    if (keys.indexOf(d.key) < 0) return;
    if (d.theme) theme = d.theme;
    if (d.title) title = d.title;
    notes.push(idNote_(d));
    use(d);
  });
  const campuses = PD_CAMPUSES.filter(c => members.some(m => m.campus === c || m.mentions.indexOf(c) >= 0));
  return {
    id: '', start: p.start, end: p.end, days: Math.round((p.end - p.start) / 864e5) + 1, theme, event: title,
    type: p.type, milestone: p.milestone, isPeriod: p.isPeriod || p.end > p.start,
    periods: idUnique_([].concat(...members.map(m => m.periods))), startTime: p.time, endTime: p.endTime, campuses,
    titles: PD_CAMPUSES.map(c => idUnique_(members.filter(m => m.campus === c).map(m => m.title)).join('; ')),
    calendars: idUnique_([].concat(...members.map(m => m.calNames))),
    keys, notes, flags: [], members,
  };
}

/** Flags that point the review at events the rules may have got wrong. */
function idFlag_(events, windowEnd, rules) {
  const standalone = e => (rules.standalone || []).some(re => re.test(e.milestone) || re.test(e.event));
  // Same milestone and dates at other campuses but not merged: maybe one event worded differently.
  const sameDates = {};
  const datesKey = e => [pdDayKey_(e.start), pdDayKey_(e.end), e.milestone.toLowerCase()].join('|');
  events.forEach(e => (sameDates[datesKey(e)] || (sameDates[datesKey(e)] = [])).push(e));
  events.forEach(e => {
    if (e.theme === ID_OTHER) e.flags.push('theme-other');
    if (e.members.some(m => m.classified === false)) e.flags.push('unclassified-title');
    const v = !e.isPeriod && !standalone(e) && idVerb_(e.members[0]);
    if (v) {
      e.flags.push(v.opening ? 'opening-without-closing' : 'closing-without-opening');
      if (v.opening && windowEnd && (windowEnd - e.start) / 864e5 < ID_MAX_SPAN) e.flags.push('closing-may-be-after-window');
    }
    if (sameDates[datesKey(e)].some(o => o !== e && !o.campuses.some(c => e.campuses.indexOf(c) >= 0))) {
      e.flags.push('possible-cross-campus-duplicate');
    }
  });
}

function idSheetRow_(e) {
  return [
    e.id, e.start, e.end, e.days, e.theme, e.event, e.type, e.milestone, e.isPeriod ? 1 : 0, e.periods.join('; '),
    e.startTime, e.endTime, ...PD_CAMPUSES.map(c => (e.campuses.indexOf(c) >= 0 ? 1 : 0)),
    e.campuses.length > 1 ? 1 : 0, e.campuses.join(', '), ...e.titles, e.calendars.join('; '), e.notes.join(' | '),
  ];
}

// ---------------------------------------------------------------- snapshot for the review

/** The snapshot files: {path: content}. One record per line, so git diffs show what changed. */
function idSnapshotFiles_(items, built, loaded, windowEnd) {
  const day = d => pdDayKey_(d);
  const lines = (head, list) => '{\n' + head + '"records": [\n' + list.map(x => JSON.stringify(x)).join(',\n') + '\n]}\n';
  const events = built.events.map(e => ({
    id: e.id, start: day(e.start), end: day(e.end), theme: e.theme, event: e.event, milestone: e.milestone,
    period: e.isPeriod ? 1 : 0, campuses: e.campuses.join(','), keys: e.keys, flags: e.flags, notes: e.notes,
  }));
  const listings = items.slice().sort(idCompare_).map(it => ({
    key: it.key, campus: it.campus, category: it.category, calendars: it.calNames, start: day(it.start), end: day(it.end),
    title: it.title, milestone: it.milestone, detailText: it.detailText, time: it.time, periods: it.periods,
    codes: it.codes, parts: it.parts, mentions: it.mentions, classified: it.classified !== false,
  }));
  const status = {
    window_end: windowEnd ? day(pdAddDays_(windowEnd, -1)) : '', rules: loaded.source, events: events.length,
    listings: listings.length, flagged: events.filter(e => e.flags.length).length,
    review_decisions_applied: built.applied, review_decisions_total: built.decisionCount, unused_decisions: built.unused,
  };
  return {
    [ID_SNAPSHOT_DIR + '/events.json']: lines('', events),
    [ID_SNAPSHOT_DIR + '/listings.json']: lines('', listings),
    [ID_SNAPSHOT_DIR + '/status.json']: JSON.stringify(status, null, 1) + '\n',
  };
}

/** Commits the changed snapshot files to main in one commit (GitHub git data API). */
function idExportSnapshot_(items, built, loaded, windowEnd) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return 'skipped (no GITHUB_TOKEN)';
  const files = idSnapshotFiles_(items, built, loaded, windowEnd);
  const api = (method, path, body) => {
    const res = UrlFetchApp.fetch('https://api.github.com/repos/' + ID_SNAPSHOT_REPO + path, {
      method, muteHttpExceptions: true, contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      payload: body ? JSON.stringify(body) : undefined,
    });
    const code = res.getResponseCode();
    if (code === 404 && method === 'get') return null;
    if (code >= 300) throw new Error(`GitHub ${method.toUpperCase()} ${path}: HTTP ${code} ${res.getContentText().slice(0, 200)}`);
    return JSON.parse(res.getContentText());
  };
  // Unchanged files have the same git blob id; compare with what main holds now.
  const remote = {};
  (api('get', '/contents/' + ID_SNAPSHOT_DIR + '?ref=main') || []).forEach(f => { remote[f.path] = f.sha; });
  const changed = Object.keys(files).filter(path => {
    const bytes = Utilities.newBlob(files[path]).getBytes();
    const header = Utilities.newBlob('blob ' + bytes.length + '\u0000').getBytes();
    const sha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, header.concat(bytes))
      .map(x => ('0' + (x & 0xff).toString(16)).slice(-2)).join('');
    return remote[path] !== sha;
  });
  if (!changed.length) return 'unchanged';
  for (let attempt = 1; ; attempt++) {
    const head = api('get', '/git/ref/heads/main').object.sha;
    const baseTree = api('get', '/git/commits/' + head).tree.sha;
    const tree = api('post', '/git/trees', {
      base_tree: baseTree, tree: changed.map(path => ({ path, mode: '100644', type: 'blob', content: files[path] })),
    }).sha;
    const commit = api('post', '/git/commits', {
      message: `Dashboard snapshot ${pdDayKey_(new Date())}: ${built.events.length} important dates`, tree, parents: [head],
    }).sha;
    try {
      api('patch', '/git/refs/heads/main', { sha: commit });
      return `committed ${changed.length} file(s)`;
    } catch (e) {
      if (attempt >= 2) throw e;   // main moved under us (e.g. the review pushed): rebuild on the new head once
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = { idItem_, idHydrate_, idBuild_, idCompileRules_, idPairPeriods_, idGroup_, idSheetRow_, idSnapshotFiles_, ID_HEADERS };
}
