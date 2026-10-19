// node dashboard/review_check.js [--show N]
// For the Important_Dates review (dashboard/review/REVIEW.md): checks dashboard/important_dates_rules.json
// and previews its effect by rebuilding the events from the last sync's listings
// (dashboard/snapshot/listings.json) with ImportantDates.js, as the next sync will.
// Prints problems (exit 1), unused decisions, and how the events differ from dashboard/snapshot/events.json.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.TZ = 'Australia/Melbourne';
const root = path.join(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const show = Number((process.argv.indexOf('--show') >= 0 && process.argv[process.argv.indexOf('--show') + 1]) || 15);

const ctx = vm.createContext({
  console, Date,
  TZ: 'Australia/Melbourne',
  Utilities: {
    formatDate: d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-'),
    DigestAlgorithm: { MD5: 'md5' },
    computeDigest: (_, s) => [...require('crypto').createHash('md5').update(s).digest()],
  },
});
['Normalise.js', 'PrincipalDates.js', 'ImportantDates.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }));

const problems = [];
let json, rules;
try {
  json = read('dashboard/important_dates_rules.json');
  rules = ctx.idCompileRules_(json);
} catch (e) {
  console.log('PROBLEM important_dates_rules.json does not load: ' + e.message);
  process.exit(1);
}
const listings = read('dashboard/snapshot/listings.json').records;
const before = read('dashboard/snapshot/events.json').records;
const status = read('dashboard/snapshot/status.json');
const keys = new Set(listings.map(l => l.key));

// Themes and keys the decisions refer to.
const themes = new Set(json.themes || []);
(json.theme_rules || []).forEach(r => { if (!themes.has(r.theme)) problems.push(`theme_rules: unknown theme "${r.theme}"`); });
const D = json.decisions || {};
const need = (kind, i, k) => { if (!keys.has(k)) problems.push(`decisions.${kind}[${i}]: no listing with key "${k}"`); };
Object.keys(D).forEach(kind => (D[kind] || []).forEach((d, i) => {
  if (!d.reason) problems.push(`decisions.${kind}[${i}]: missing reason`);
  if (d.theme && !themes.has(d.theme)) problems.push(`decisions.${kind}[${i}]: unknown theme "${d.theme}"`);
  if (kind === 'pair') { need(kind, i, d.open); need(kind, i, d.close); }
  else if (kind === 'merge' || kind === 'separate') (d.keys || []).forEach(k => need(kind, i, k));
  else if (kind === 'add') {
    if (!d.title || !d.start || !(d.campus || d.campuses)) problems.push(`decisions.add[${i}]: needs title, start and campus(es)`);
    if (!d.source) problems.push(`decisions.add[${i}]: needs a source (URL or repo file)`);
  } else need(kind, i, d.key);
}));

// Rebuild as the next sync would.
const items = listings.map(l => ctx.idHydrate_(Object.assign({}, l, { calNames: l.calendars, keys: undefined })));
const windowEnd = status.window_end ? new Date(status.window_end + 'T00:00:00') : null;
if (windowEnd) windowEnd.setDate(windowEnd.getDate() + 1);
const built = ctx.idBuild_(items, rules, windowEnd);
const after = built.events.map(e => ({
  id: e.id, start: ctx.Utilities.formatDate(e.start), end: ctx.Utilities.formatDate(e.end), theme: e.theme, event: e.event,
  campuses: e.campuses.join(','), flags: e.flags, notes: e.notes,
}));

const unused = built.unused.map(u => `decisions.${u.kind}[${u.index}] matched nothing`);
const byId = list => new Map(list.map(e => [e.id, e]));
const b = byId(before), a = byId(after);
const removed = before.filter(e => !a.has(e.id));
const added = after.filter(e => !b.has(e.id));
const retheme = after.filter(e => b.has(e.id) && b.get(e.id).theme !== e.theme);
const recampus = after.filter(e => b.has(e.id) && b.get(e.id).campuses !== e.campuses);
const fmt = e => `${e.start}${e.end !== e.start ? '..' + e.end : ''} [${e.campuses}] ${e.event} (${e.theme})`;
const list = (label, xs, f) => {
  console.log(`${label}: ${xs.length}`);
  xs.slice(0, show).forEach(x => console.log('  ' + f(x)));
  if (xs.length > show) console.log(`  ... ${xs.length - show} more (--show N)`);
};

problems.forEach(p => console.log('PROBLEM ' + p));
unused.forEach(u => console.log('UNUSED  ' + u));
console.log(`\nRules ${json.version}; decisions applied ${built.applied}/${built.decisionCount}; ` +
  `events ${before.length} -> ${after.length}; listings ${listings.length} (snapshot of sync, window to ${status.window_end})`);
list('Events no longer present', removed, fmt);
list('New events', added, fmt);
list('Theme changes', retheme, e => `${fmt(e)} was ${b.get(e.id).theme}`);
list('Campus changes', recampus, e => `${fmt(e)} was [${b.get(e.id).campuses}]`);
// Worklist: every one-day opening or closing, with listings that could be its other half
// (same thing, opposite verb, any campus or wording, within a year in the right direction).
const verbOf = m => (m.match(/^(.*\S)\s+(opens?|starts?|begins?|commences?|closes?|ends?)$/i) || []);
const work = built.events.filter(e => e.flags.some(f => /without-(opening|closing)/.test(f)));
const partnerOf = e => {
  const [, base, verb] = verbOf(e.milestone);
  if (!base) return [];
  const opening = /^(open|start|begin|commence)/i.test(verb);
  const day = ctx.Utilities.formatDate(e.start);
  return listings.filter(l => {
    const [, b, v] = verbOf(l.milestone);
    if (!b || b.toLowerCase() !== base.toLowerCase() || /^(open|start|begin|commence)/i.test(v) === opening) return false;
    const gap = (new Date(l.start) - new Date(day)) / 864e5;
    return opening ? gap >= 0 && gap <= 366 : gap <= 0 && gap >= -366;
  }).map(l => `${l.key}`);
};
console.log(`\nWorklist (${work.length}): each needs a decision, a standalone pattern, or a "Needs a source" LOG line`);
work.forEach((e, i) => {
  const c = partnerOf(e);
  console.log(`${i + 1}. ${fmt({ start: ctx.Utilities.formatDate(e.start), end: ctx.Utilities.formatDate(e.end),
    campuses: e.campuses.join(','), event: e.event, theme: e.theme })}  keys: ${e.keys.join(' ; ')}`);
  console.log(c.length ? '   candidate partners: ' + c.slice(0, 6).join(' ; ') + (c.length > 6 ? ` (+${c.length - 6})` : '')
    : '   no candidate partner in the snapshot: look in backfill/*.csv, the .ics feeds, then the official pages');
});

const flagCount = {};
after.forEach(e => e.flags.forEach(f => { flagCount[f] = (flagCount[f] || 0) + 1; }));
console.log('Flags after: ' + (Object.keys(flagCount).map(f => `${f} ${flagCount[f]}`).join(', ') || 'none'));
process.exit(problems.length ? 1 : 0);
