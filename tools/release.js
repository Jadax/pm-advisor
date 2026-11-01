#!/usr/bin/env node
/* Writes model/params.json into pm-copilot.user.js (match-engine constants + growth table) and
 * bumps the patch version. Usage: node tools/release.js   (no-op if nothing changed)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const file = path.join(ROOT, 'pm-copilot.user.js');
const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'model', 'params.json'), 'utf8'));
const before = fs.readFileSync(file, 'utf8');
let src = before;

const patch = (re, text, what) => {
  if (!re.test(src)) throw new Error(`${what} not found in pm-copilot.user.js`);
  src = src.replace(re, text);
};
patch(/const ME = \{[^}]*\};/, `const ME = { BASE: ${p.BASE}, K_BEAT: ${p.K_BEAT}, K_GK: ${p.K_GK}, K_MID: ${p.K_MID} };`, 'ME constants');
if (Array.isArray(p.growth) && p.growth.length === 10) patch(/const GROWTH = \[[^\]]*\];/, `const GROWTH = [${p.growth.join(', ')}];`, 'GROWTH table');

if (src === before) {
  console.log('Model unchanged — nothing to release.');
  process.exit(0);
}
const cur = src.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)';/);
const ver = `${cur[1]}.${cur[2]}.${+cur[3] + 1}`;
src = src.replace(/const VERSION = '[\d.]+';/, `const VERSION = '${ver}';`).replace(/\/\/ @version\s+[\d.]+/, `// @version      ${ver}`);
fs.writeFileSync(file, src);
console.log(`Released ${ver} (fitted on ${p.fittedOn} games; growth samples ${(p.growthSamples || []).join('/')})`);
