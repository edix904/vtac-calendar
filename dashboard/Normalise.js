/**
 * Principal-dates normalisation for the Calendar Dashboard (Australia, Malaysia, Indonesia).
 *
 * Source of truth: https://github.com/edix904/vtac-calendar (dashboard/Normalise.js). Copy this
 * file into the Apps Script project unchanged. It mirrors normalise() in principal_dates.py and
 * reads the same rules file, principal_dates_rules.json, fetched from GitHub on every sync
 * (falling back to the copy embedded in NormaliseRules.js). Both are tested against
 * normalise_cases.json.
 *
 * pdNormalise_(title, rules, overrides) ->
 *   { milestone, classified, title, periods: [{code, period, year}], periodCodes, periodNames,
 *     time, detail, phase, campuses: ['AUS'|'MY'|'ID'], exclude }
 */

const PD_RULES_URL = 'https://raw.githubusercontent.com/edix904/vtac-calendar/main/principal_dates_rules.json';
const PD_CODE_RE = /\(([A-Z][A-Z0-9+]*(?:-[A-Z0-9+]+)+|[A-Z]{2,}\d{1,3})\)/g;
const PD_TIME_RE = /(?:\s*\b(?:at|by|from)\b)?\s*\b(\d{1,2}(?:[.:]\d{2})?\s*[ap]\.?\s?m\b\.?|12\s*noon|noon|midday|midnight)(?:\s*\([^)]*\btime\)|\s+(?:AEST|AEDT|MYT|WIB|Melbourne time|Malaysia time))?/i;
const PD_VERB_RE = /^(opens?|closes?|begins?|ends?|starts?|commences?|released?|published)\b\s*(?:for\s+(?:the\s+)?)?/i;
const PD_CAMPUS_MENTION = { AUS: /\((?:Australia|Clayton|Melbourne)\)/i, MY: /\(Malaysia\)/i, ID: /\(Indonesia\)/i };
const PD_NUMBER_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' };

/** Rules from GitHub, or the embedded copy if GitHub can't be reached. Returns {rules, source}. */
function pdLoadRules_() {
  try {
    const res = UrlFetchApp.fetch(PD_RULES_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const json = JSON.parse(res.getContentText('UTF-8'));
      return { rules: pdCompileRules_(json), source: 'GitHub ' + (json.version || '') };
    }
  } catch (e) {
    console.warn('Normalisation rules: GitHub fetch failed (' + e.message + '); using embedded copy');
  }
  return { rules: pdCompileRules_(PD_RULES_EMBEDDED), source: 'embedded ' + (PD_RULES_EMBEDDED.version || '') };
}

function pdCompileRules_(json) {
  const re = (p, flags) => new RegExp(p, flags);
  const compiled = {
    version: json.version || '',
    rewrites: (json.rewrites || []).map(r => ({ re: re(r.pattern, 'gi'), replace: r.replace })),
    milestones: json.milestones.map(r => ({ re: re(r.pattern, 'i'), milestone: r.milestone, phase: r.phase || '' })),
    titles: (json.titles || []).map(r => ({ re: re(r.pattern, 'i'), milestone: r.milestone, phase: r.phase || '' })),
    periods: json.periods.map(r => ({ re: re(r.code, ''), period: r.period })),
    periodNames: json.period_names.map(r => ({ re: re(r.pattern, 'i'), period: r.period })),
    mainPeriods: Object.keys(json.main_periods || {}).filter(k => k[0] !== '_')
      .reduce((m, k) => { m[k] = re(json.main_periods[k], ''); return m; }, {}),
    exclude: (json.exclude || []).map(p => re(p, 'i')),
  };
  // Canonical names map to their own rule, so already-normalised titles stay classified.
  compiled.canonical = {};
  compiled.milestones.concat(compiled.titles).forEach(r => {
    const k = r.milestone.toLowerCase();
    if (!(k in compiled.canonical)) compiled.canonical[k] = r;
  });
  return compiled;
}

function pdClean_(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }

function pdSentenceCase_(s) {
  s = pdClean_(s).replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function pdFmtTime_(raw) {
  let s = raw.toLowerCase().replace(/ /g, '').replace(/\.m/g, 'm').replace(/\.$/, '');
  if (/noon/.test(s) || s === 'midday') return '12pm';
  if (s === 'midnight') return '11:59pm';
  if (/^\d{1,2}\.\d{2}/.test(s)) s = s.replace('.', ':');
  const m = s.match(/^(\d{1,2})(?:[.:](\d{2}))?\.?([ap])m$/);
  if (!m) return raw;
  return m[1] + (m[2] && m[2] !== '00' ? ':' + m[2] : '') + m[3] + 'm';
}

function pdPeriodName_(code, before, rules) {
  for (const r of rules.periods) {
    const m = code.match(r.re);
    if (m) return r.period.replace(/\$(\d)/g, (_, i) => m[Number(i)] || '');
  }
  for (const r of rules.periodNames) if (r.re.test(before)) return r.period;
  let name = before.replace(/\b(one|two|three|four|five|six)\b/gi, w => PD_NUMBER_WORDS[w.toLowerCase()]);
  name = name.replace(/^(monash indonesia|the)\s+/i, '');
  return pdSentenceCase_(name);
}

function pdExtractPeriods_(text, rules) {
  const out = [];
  let prevEnd = 0;
  for (const m of text.matchAll(PD_CODE_RE)) {
    const code = m[1];
    let before = text.slice(prevEnd, m.index).split(/,|\band\b|:|\bfor\b|\bfrom\b|\bin\b/i).pop().trim();
    const year = text.slice(m.index + m[0].length).match(/^\s*(20\d\d)\b/);
    if (!out.some(p => p.code === code)) {
      out.push({ code, period: pdPeriodName_(code, before, rules), year: year ? Number(year[1]) : null });
    }
    prevEnd = m.index + m[0].length;
  }
  if (!out.length) {
    for (const r of rules.periodNames) if (r.re.test(text)) out.push({ code: '', period: r.period, year: null });
  }
  return out;
}

/** [text to match, leftover detail] pairs, most specific first (see candidates() in principal_dates.py). */
function pdCandidates_(head, detail) {
  const out = [];
  const hasCode = s => new RegExp(PD_CODE_RE.source).test(s);
  const stripCodes = s => s.replace(PD_CODE_RE, '');
  const expand = (h, d) => {
    const fm = d.match(/^(.*?)\s+for\s+(?:the\s+)?(.+)$/i);
    if (fm && !hasCode(fm[1])) out.push([h + ' ' + fm[1], fm[2]]);
    if (d) out.push([h + ' ' + stripCodes(d), hasCode(d) ? d : '']);
    out.push([h, d]);
  };
  const vm = detail.match(PD_VERB_RE);
  if (vm) expand(head + ' ' + vm[1], detail.slice(vm[0].length));
  expand(head, detail);
  if (!detail) out.push([stripCodes(head), '']);
  return out;
}

function pdMatchMilestone_(cands, rules) {
  for (const [text, residual] of cands) {
    const key = pdClean_(text).replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '');
    const canon = rules.canonical[key.toLowerCase()];
    if (canon) return { rule: canon, residual }; // already a canonical name (normalised feed titles)
    for (const r of rules.milestones) if (r.re.test(key)) return { rule: r, residual };
  }
  return { rule: null, residual: null };
}

function pdNormalise_(raw, rules, overrides) {
  let text = pdClean_(raw);
  rules.rewrites.forEach(r => { text = pdClean_(text.replace(r.re, r.replace)); });
  const own = text.match(/\s+\((\d{1,2}(?::\d{2})?[ap]m)\)$/);
  if (own) text = text.slice(0, own.index);
  const split = text.match(/^(.*?(?:[a-z0-9)]))\.\s+(?=[A-Z])([\s\S]*)$/);
  let first = (split ? split[1] : text).replace(/\.+$/, '').trim();

  const tm = first.match(PD_TIME_RE);
  const time = tm ? pdFmtTime_(tm[1]) : (own ? own[1] : '');
  if (tm) first = pdClean_(first.slice(0, tm.index) + first.slice(tm.index + tm[0].length));
  first = first.replace(/\s*\((?:Melbourne|Malaysia|Indonesia|Jakarta) time\)/gi, '');

  const colon = first.indexOf(':');
  const head = colon >= 0 ? pdClean_(first.slice(0, colon)) : first;
  const detail = colon >= 0 ? pdClean_(first.slice(colon + 1)) : '';
  const cands = pdCandidates_(head, detail);

  let milestone, phase = '', exclude = false, classified = true, rule = null, residual = detail;
  const ov = overrides && overrides[pdClean_(raw).toLowerCase()];
  if (ov) {
    milestone = ov.milestone;
    phase = ov.phase || '';
    exclude = !!ov.exclude;
  } else {
    const hit = pdMatchMilestone_(cands, rules);
    rule = hit.rule;
    residual = hit.residual;
    if (!rule) {
      residual = detail;
      for (const r of rules.titles) {
        if (r.re.test(first)) {
          rule = r;
          residual = (r.milestone === 'University closed' && !detail && !/^university/i.test(first)) ? first : detail;
          break;
        }
      }
    }
    if (rule) { milestone = rule.milestone; phase = rule.phase || ''; }
    else { milestone = pdSentenceCase_(head.replace(PD_CODE_RE, '')); classified = false; }
  }
  exclude = exclude || rules.exclude.some(x => x.test(text));

  let periods = pdExtractPeriods_(first, rules);
  if (ov && ov.period) {
    periods = periods.length ? periods.map(p => ({ code: p.code, period: ov.period, year: p.year }))
      : [{ code: '', period: ov.period, year: null }];
  }

  let shown;
  if (periods.some(p => p.code)) {
    shown = periods.map(p => p.code ? `${p.period} (${p.code})` : p.period).join(', ');
  } else {
    let d = String(residual || '').replace(/^(?:for\s+)?(?:the\s+)?/i, '');
    d = d.replace(/\s*\((?:a|an|the|or|see|except)\b[^)]*\)\s*$/i, '');
    d = d.replace(/^\s*20\d\d\s*$/, '').replace(/\s+20\d\d$/, '');
    shown = pdSentenceCase_(d);
    if (periods.length && (!shown || /^(semester|full[- ]year)\b/i.test(shown))) {
      shown = periods.map(p => p.period).filter((v, i, a) => a.indexOf(v) === i).join('; ');
    }
  }
  const names = periods.map(p => p.period).filter((v, i, a) => a.indexOf(v) === i);
  return {
    raw, milestone, classified, phase, exclude, time, detail: shown,
    title: milestone + (shown ? ': ' + shown : ''),
    periods, periodCodes: periods.filter(p => p.code).map(p => p.code).join('; '), periodNames: names.join('; '),
    campuses: Object.keys(PD_CAMPUS_MENTION).filter(c => PD_CAMPUS_MENTION[c].test(text)),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { pdCompileRules_, pdNormalise_ };
}
