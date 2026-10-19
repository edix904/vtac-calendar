// node dashboard/test_normalise.js [extra.json]
// Checks the Apps Script port against normalise_cases.json (and optionally a list of
// {raw, milestone, title, period_codes, time} produced by principal_dates.py).
const fs = require('fs');
const path = require('path');
const { pdCompileRules_, pdNormalise_ } = require('./Normalise.js');
const root = path.join(__dirname, '..');
const rules = pdCompileRules_(JSON.parse(fs.readFileSync(path.join(root, 'principal_dates_rules.json'), 'utf8')));
let cases = JSON.parse(fs.readFileSync(path.join(root, 'normalise_cases.json'), 'utf8')).cases;
if (process.argv[2]) cases = cases.concat(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
let bad = 0;
for (const c of cases) {
  const n = pdNormalise_(c.raw, rules);
  const got = [n.milestone, n.title, n.periodCodes, n.time];
  const want = [c.milestone, c.title, c.period_codes, c.time];
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    if (bad++ < 25) console.log('MISMATCH', JSON.stringify(c.raw), '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
  }
  const again = pdNormalise_(n.title + (n.time ? ` (${n.time})` : ''), rules);
  if (!again.classified || again.title !== n.title || again.time !== n.time) {
    if (bad++ < 25) console.log('NOT IDEMPOTENT', JSON.stringify(n.title), '->', JSON.stringify(again.title), again.classified);
  }
}
console.log(`${cases.length - bad}/${cases.length} cases match`);
process.exit(bad ? 1 : 0);
