/**
 * Campus comparison layer for the Calendar Dashboard: Australia (AUS), Malaysia (MY), Indonesia (ID).
 *
 * Source of truth: https://github.com/edix904/vtac-calendar (dashboard/PrincipalDates.js).
 * Needs Normalise.js and NormaliseRules.js. Called from syncCalendars_() in Code.js:
 *
 *   const pd = pdEnrich_(ss, allRows, C, windowEnd);   // fills PD_EVENT_HEADERS columns in place
 *   ... pd.dayValues(date) -> values for PD_DAY_HEADERS
 *
 * For every principal-date event it adds the campus, normalised milestone / teaching period /
 * title, flags for each campus it applies to (its own campus, campuses named in the title, and
 * campuses listing the same milestone for the same period on the same day), and the campus's
 * academic week. Academic weeks are derived the same way for all three campuses from the
 * normalised events (teaching starts / ends, mid-semester break, swot vac, final assessments),
 * so weeks compare like for like. Titles no rule recognises go to the Normalise_Review tab;
 * manual classifications go in Normalise_Overrides.
 */

const PD_SHEETS = { REVIEW: 'Normalise_Review', OVERRIDES: 'Normalise_Overrides', WEEKS: 'Academic_Weeks' };
const PD_CAMPUSES = ['AUS', 'MY', 'ID'];
const PD_CATEGORY = 'Principal date';

const PD_EVENT_HEADERS = [
  'Campus', 'Is AUS', 'Is MY', 'Is ID', 'Shared With', 'Milestone', 'Teaching Period', 'Period Codes',
  'Normalised Title', 'Milestone Time', 'Classified', 'Academic Period', 'Academic Phase', 'Academic Week',
];
const PD_DAY_HEADERS = [].concat(...PD_CAMPUSES.map(c => [
  `${c} Principal Dates`, `${c} Academic Period`, `${c} Academic Phase`, `${c} Academic Week`,
]));
const PD_REVIEW_HEADERS = ['Raw Title', 'Campus', 'Calendar', 'First Date', 'Last Date', 'Count', 'Guessed Milestone', 'Seen By Sync'];
const PD_OVERRIDE_HEADERS = ['Raw Title', 'Milestone', 'Teaching Period', 'Phase', 'Exclude', 'Note'];
const PD_WEEK_HEADERS = [
  'Campus', 'Academic Period', 'Period Code', 'Teaching Period', 'Year', 'Week Start', 'Week End',
  'Week Index', 'Academic Phase', 'Academic Week', 'Principal Dates',
];
const PD_PHASE_LABELS = {
  orientation: 'Orientation', teaching: 'Teaching', break: 'Mid-semester break', swot: 'Swot vac',
  exams: 'Exams', gap: 'Non-teaching',
};

/** Campus of a calendar: names mentioning Malaysia / Indonesia, otherwise Australia (blank for Personal). */
function pdCampusOf_(calName, category) {
  if (/malaysia/i.test(calName)) return 'MY';
  if (/indonesia/i.test(calName)) return 'ID';
  return category === 'Personal' ? '' : 'AUS';
}

function pdDayKey_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function pdAddDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function pdMonday_(d) { return pdAddDays_(d, -((d.getDay() + 6) % 7)); }
function pdAsDate_(v) {
  const d = v instanceof Date ? v : new Date(v);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ---------------------------------------------------------------- overrides / review tabs

function pdReadOverrides_(ss) {
  let sh = ss.getSheetByName(PD_SHEETS.OVERRIDES);
  if (!sh) {
    sh = ss.insertSheet(PD_SHEETS.OVERRIDES);
    sh.getRange(1, 1, 1, PD_OVERRIDE_HEADERS.length).setValues([PD_OVERRIDE_HEADERS])
      .setFontWeight('bold').setBackground('#e8eaed');
    sh.getRange(2, 1, 1, PD_OVERRIDE_HEADERS.length).setValues([[
      '(example) Some new title exactly as the calendar shows it', 'Census date', 'Semester 1', '', false,
      'Rows here win over the rules. Phase: teaching_start, teaching_end, break_start, break_end, swot_start, swot_end, exams_start, exams_end, orientation_start.',
    ]]).setFontColor('#888888');
    sh.setFrozenRows(1);
    return {};
  }
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, PD_OVERRIDE_HEADERS.length).getValues().forEach(r => {
    const raw = pdClean_(r[0]);
    if (!raw || /^\(example\)/i.test(raw) || !(String(r[1]).trim() || r[4] === true)) return;
    out[raw.toLowerCase()] = {
      milestone: String(r[1]).trim() || 'Excluded', period: String(r[2]).trim(),
      phase: String(r[3]).trim(), exclude: r[4] === true,
    };
  });
  return out;
}

function pdWriteReview_(ss, review, now) {
  const rows = Object.keys(review).map(k => review[k])
    .sort((a, b) => b.last - a.last)
    .map(x => [x.raw, x.campus, x.calendar, x.first, x.last, x.count, x.guess, now]);
  writeTable_(ss, PD_SHEETS.REVIEW, PD_REVIEW_HEADERS, rows,
    { 'First Date': 'yyyy-mm-dd', 'Last Date': 'yyyy-mm-dd', 'Seen By Sync': 'yyyy-mm-dd hh:mm' });
}

// ---------------------------------------------------------------- main entry

/**
 * Fills the PD_EVENT_HEADERS columns of every Events row (in place) and returns helpers for
 * the Days tab. Also rewrites the Normalise_Review and Academic_Weeks tabs.
 */
function pdEnrich_(ss, rows, C, windowEnd) {
  const loaded = pdLoadRules_();
  const rules = loaded.rules;
  const overrides = pdReadOverrides_(ss);
  const now = new Date();
  const review = {};
  const items = [];

  rows.forEach(r => {
    const campus = pdCampusOf_(String(r[C['Calendar']]), r[C['Category']]);
    PD_EVENT_HEADERS.forEach(h => { r[C[h]] = ''; });
    r[C['Campus']] = campus;
    PD_CAMPUSES.forEach(c => { r[C['Is ' + c]] = campus === c; });
    if (r[C['Category']] !== PD_CATEGORY || r[C['Status']] === 'cancelled') return;
    const n = pdNormalise_(String(r[C['Title']] || ''), rules, overrides);
    const start = pdAsDate_(r[C['Start Date']]);
    const end = r[C['End Date (incl.)']] ? pdAsDate_(r[C['End Date (incl.)']]) : start;
    r[C['Milestone']] = n.exclude ? 'Excluded' : n.milestone;
    r[C['Teaching Period']] = n.periodNames;
    r[C['Period Codes']] = n.periodCodes;
    r[C['Normalised Title']] = n.title;
    r[C['Milestone Time']] = n.time;
    r[C['Classified']] = n.classified;
    if (!n.classified) {
      const key = campus + '|' + pdClean_(n.raw).toLowerCase();
      const x = review[key] || (review[key] = {
        raw: pdClean_(n.raw), campus, calendar: r[C['Calendar']], first: start, last: start, count: 0, guess: n.milestone,
      });
      x.count++;
      if (start < x.first) x.first = start;
      if (start > x.last) x.last = start;
    }
    if (!n.exclude) items.push({ r, campus, start, end, n });
  });

  pdMarkShared_(items, C);
  const weeks = pdAcademicWeeks_(items, rules);
  const lookup = pdWeekLookup_(weeks);

  // Event-level academic week (its own campus; prefer the instance for one of its own periods).
  items.forEach(it => {
    const hit = lookup.get(it.campus, it.start, it.n.periods.map(p => p.code));
    if (hit) {
      it.r[C['Academic Period']] = hit.label;
      it.r[C['Academic Phase']] = PD_PHASE_LABELS[hit.phase];
      it.r[C['Academic Week']] = hit.weekNo || '';
    }
  });

  // Day-level principal dates per campus (normalised titles).
  const byDay = {};
  items.forEach(it => {
    for (let d = it.start; d <= it.end; d = pdAddDays_(d, 1)) {
      const k = it.campus + '|' + pdDayKey_(d);
      const list = byDay[k] || (byDay[k] = []);
      const t = it.n.title + (it.n.time ? ` (${it.n.time})` : '');
      if (list.indexOf(t) < 0) list.push(t);
    }
  });

  pdWriteReview_(ss, review, now);
  pdWriteWeeks_(ss, weeks, items);
  console.log(`Normalisation rules: ${loaded.source}; ${items.length} principal dates, ` +
    `${Object.keys(review).length} unclassified titles, ${weeks.length} academic periods`);

  return {
    rulesSource: loaded.source,
    unclassified: Object.keys(review).length,
    dayValues(d) {
      const out = [];
      PD_CAMPUSES.forEach(c => {
        const hit = lookup.get(c, d, []);
        out.push((byDay[c + '|' + pdDayKey_(d)] || []).join('; '),
          hit ? hit.label : '', hit ? PD_PHASE_LABELS[hit.phase] : '', hit && hit.weekNo ? hit.weekNo : '');
      });
      return out;
    },
  };
}

// ---------------------------------------------------------------- shared events

/**
 * An event is shared with another campus when that campus lists the same milestone on the same
 * day for an overlapping teaching period (or, with no period, the same detail, e.g. a holiday).
 */
function pdMarkShared_(items, C) {
  const index = {};
  items.forEach(it => {
    const k = it.n.milestone + '|' + pdDayKey_(it.start);
    (index[k] || (index[k] = [])).push(it);
  });
  const periodSet = it => it.n.periods.map(p => p.period.toLowerCase());
  items.forEach(it => {
    const flags = {};
    flags[it.campus] = true;
    it.n.campuses.forEach(c => { flags[c] = true; });
    const mine = periodSet(it);
    (index[it.n.milestone + '|' + pdDayKey_(it.start)] || []).forEach(o => {
      if (o.campus === it.campus) return;
      const theirs = periodSet(o);
      const same = mine.length || theirs.length
        ? mine.some(p => theirs.indexOf(p) >= 0)
        : it.n.detail.toLowerCase() === o.n.detail.toLowerCase();
      if (same) flags[o.campus] = true;
    });
    PD_CAMPUSES.forEach(c => { it.r[C['Is ' + c]] = !!flags[c]; });
    it.r[C['Shared With']] = PD_CAMPUSES.filter(c => flags[c] && c !== it.campus).join(', ');
  });
}

// ---------------------------------------------------------------- academic weeks

/**
 * One instance per campus x main teaching period (main_periods in the rules) x teaching start,
 * with week-by-week phases from the normalised milestones.
 */
function pdAcademicWeeks_(items, rules) {
  const out = [];
  PD_CAMPUSES.forEach(campus => {
    const main = rules.mainPeriods[campus];
    if (!main) return;
    const own = items.filter(it => it.campus === campus && it.n.classified && it.n.phase);
    const codes = {};
    own.forEach(it => it.n.periods.forEach(p => { if (p.code && main.test(p.code)) codes[p.code] = p.period; }));
    Object.keys(codes).forEach(code => {
      const has = it => it.n.periods.some(p => p.code === code);
      const mine = own.filter(has).sort((a, b) => a.start - b.start);
      const starts = mine.filter(it => it.n.phase === 'teaching_start').map(it => it.start)
        .filter((d, i, a) => i === 0 || d - a[i - 1] > 60 * 864e5);
      starts.forEach((start, i) => {
        const limit = i + 1 < starts.length ? starts[i + 1] : pdAddDays_(start, 300);
        const inWin = mine.filter(it => it.start >= pdAddDays_(start, -28) && it.start < limit);
        const first = ph => (inWin.find(it => it.n.phase === ph && it.start >= pdAddDays_(start, ph === 'orientation_start' ? -28 : 0)) || {}).start;
        const inst = {
          campus, code, period: codes[code], year: start.getFullYear(),
          label: `${codes[code]} ${start.getFullYear()}`, start,
          orientation: first('orientation_start'),
          teachEnd: first('teaching_end') || first('exams_and_teaching_end'),
          breaks: [], swot: null, exams: null,
        };
        if (inst.orientation && inst.orientation >= start) inst.orientation = null;
        if (!inst.teachEnd) return; // not enough of this period is known yet
        // Older pages sometimes list the break / swot vac without a period code: use those
        // when they fall inside this period (break during teaching, swot vac just after it).
        const loose = own.filter(it => !it.n.periods.some(p => p.code) &&
          it.start >= start && it.start <= pdAddDays_(inst.teachEnd, 21));
        const pick = (ph, list) => (list.find(it => it.n.phase === ph && it.start >= start) || {}).start;
        const phaseEvents = inWin.filter(it => it.start >= start).concat(
          loose.filter(it => /^break_/.test(it.n.phase) ? it.start <= inst.teachEnd : it.start >= pdAddDays_(inst.teachEnd, -3)))
          .sort((a, b) => a.start - b.start);
        let bs = null;
        phaseEvents.forEach(it => {
          if (it.n.phase === 'break_start') bs = it.start;
          if (it.n.phase === 'break_end' && bs) { inst.breaks.push([bs, it.start]); bs = null; }
        });
        const ss = pick('swot_start', phaseEvents), se = pick('swot_end', phaseEvents);
        if (ss) inst.swot = [ss, se && se >= ss ? se : pdAddDays_(ss, 6)];
        const es = first('exams_start');
        const ee = first('exams_end') || first('exams_and_teaching_end');
        if (es) inst.exams = [es, ee && ee >= es ? ee : pdAddDays_(es, 13)];
        inst.weeks = pdBuildWeeks_(inst);
        out.push(inst);
      });
    });
  });
  return out;
}

function pdBuildWeeks_(inst) {
  const overlaps = (a, b, iv) => iv && a <= iv[1] && b >= iv[0];
  const last = [inst.teachEnd, inst.swot && inst.swot[1], inst.exams && inst.exams[1]]
    .filter(Boolean).reduce((m, d) => (d > m ? d : m));
  const weeks = [];
  let n = 0;
  let w = pdMonday_(inst.orientation || inst.start);
  for (let idx = 1; w <= last && idx < 60; w = pdAddDays_(w, 7), idx++) {
    const wEnd = pdAddDays_(w, 6);
    let phase;
    if (wEnd < inst.start) phase = 'orientation';
    else if (inst.breaks.some(b => overlaps(w, wEnd, b) && b[0] <= pdAddDays_(w, 2))) phase = 'break';
    else if (w <= inst.teachEnd) phase = 'teaching';
    else if (overlaps(w, wEnd, inst.swot)) phase = 'swot';
    else if (overlaps(w, wEnd, inst.exams)) phase = 'exams';
    else phase = 'gap';
    weeks.push({ start: w, end: wEnd, index: idx, phase, weekNo: phase === 'teaching' ? ++n : '' });
  }
  return weeks;
}

/** Semesters win over terms/intakes when two periods overlap on a day; then the earlier start. */
function pdPriority_(code) { return /^(MI-)?S\d/.test(code) ? 0 : 1; }

function pdWeekLookup_(instances) {
  const byCampus = {};
  instances.forEach(inst => (byCampus[inst.campus] || (byCampus[inst.campus] = [])).push(inst));
  Object.keys(byCampus).forEach(c => byCampus[c].sort((a, b) => pdPriority_(a.code) - pdPriority_(b.code) || a.start - b.start));
  return {
    get(campus, day, preferCodes) {
      const list = byCampus[campus] || [];
      const d = pdAsDate_(day);
      let best = null;
      for (const inst of list) {
        const wk = inst.weeks.find(x => d >= x.start && d <= x.end);
        if (!wk) continue;
        const hit = { label: inst.label, code: inst.code, phase: wk.phase, weekNo: wk.weekNo };
        if (preferCodes.indexOf(inst.code) >= 0) return hit;
        if (!best) best = hit;
      }
      return best;
    },
  };
}

function pdWriteWeeks_(ss, instances, items) {
  const rows = [];
  instances.sort((a, b) => PD_CAMPUSES.indexOf(a.campus) - PD_CAMPUSES.indexOf(b.campus) || a.start - b.start)
    .forEach(inst => inst.weeks.forEach(w => {
      const titles = items.filter(it => it.campus === inst.campus && it.start >= w.start && it.start <= w.end &&
        it.n.periods.some(p => p.code === inst.code)).map(it => it.n.milestone);
      rows.push([inst.campus, inst.label, inst.code, inst.period, inst.year, w.start, w.end, w.index,
        PD_PHASE_LABELS[w.phase], w.weekNo, titles.filter((t, i, a) => a.indexOf(t) === i).join('; ')]);
    }));
  writeTable_(ss, PD_SHEETS.WEEKS, PD_WEEK_HEADERS, rows, { 'Week Start': 'yyyy-mm-dd', 'Week End': 'yyyy-mm-dd' });
}

if (typeof module !== 'undefined') {
  module.exports = { pdCampusOf_, pdMarkShared_, pdAcademicWeeks_, pdBuildWeeks_, pdWeekLookup_ };
}
