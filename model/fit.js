#!/usr/bin/env node
/* Refits PM Copilot's match model on everything in data/, grades past forecasts, writes:
 *   model/params.json  — ME constants for pm-copilot.user.js (applied by tools/release.js)
 *   model/report.md    — fit quality, forecast grades, tactic usage, training progress
 *
 * Usage: node model/fit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readLines = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const dir = d => (fs.existsSync(path.join(DATA, d)) ? fs.readdirSync(path.join(DATA, d)).map(f => path.join(DATA, d, f)) : []);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const sig = x => 1 / (1 + Math.exp(-x));
const pct = v => `${Math.round(v * 100)}%`;

// Must mirror simulate() in pm-copilot.user.js (zones already include style/home/numbers, as observed).
const PASS_FX = { Short: { w: 1, pen: 0 }, Mixed: { w: 0.6, pen: 0.02 }, Long: { w: 0.3, pen: 0.05 }, Direct: { w: 0.15, pen: 0.07 } };
const LANES = ['L', 'C', 'R'], MIRROR = { L: 'R', C: 'C', R: 'L' };
function lambda(A, B, passing, P) {
  const midA = (A.mid.L + 2 * A.mid.C + A.mid.R) / 4, midB = (B.mid.L + 2 * B.mid.C + B.mid.R) / 4;
  const p = sig((midA - midB) / P.K_MID);
  const fx = PASS_FX[passing] || PASS_FX.Short;
  const attacks = P.BASE * (fx.w * p + (1 - fx.w) * 0.5);
  const w = LANES.map(l => Math.max(0.5, A.att[l] + 0.5 * A.mid[l]) ** 2);
  const tw = w[0] + w[1] + w[2];
  let g = 0;
  LANES.forEach((l, i) => {
    g += attacks * (w[i] / tw) * sig((A.att[l] * (1 - fx.pen) - B.def[MIRROR[l]]) / P.K_BEAT) * 2 * sig((A.att[l] - B.gk) / P.K_GK);
  });
  return Math.max(g, 1e-6);
}
const logPois = (l, k) => { let f = 0; for (let i = 2; i <= k; i++) f += Math.log(i); return -l + k * Math.log(l) - f; };
function wdl(a, b) {
  const P = (l, k) => Math.exp(logPois(l, k));
  let w = 0, d = 0, l = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = P(a, i) * P(b, j); if (i > j) w += p; else if (i === j) d += p; else l += p; }
  return { w, d, l };
}

// ---------- load reports ----------
const complete = s => s?.zones && ['def', 'mid', 'att'].every(k => LANES.every(l => Number.isFinite(s.zones[k]?.[l]))) && Number.isFinite(s.zones.gk);
const reports = dir('reports').filter(f => f.endsWith('.json')).map(readJson);
const games = reports.filter(r => r.score && r.sides?.length === 2 && r.sides.every(complete));
const date = r => { const [d, m, y] = String(r.date || '').split('/').map(Number); return y ? new Date(y, m - 1, d) : null; };

// ---------- fit ----------
const ll = P => games.reduce((s, r) => s + [0, 1].reduce((t, i) => t + logPois(lambda(r.sides[i].zones, r.sides[1 - i].zones, r.sides[i].passing, P), r.score[i]), 0), 0);
const meanGoals = games.length ? games.reduce((s, r) => s + r.score[0] + r.score[1], 0) / (2 * games.length) : 1;
const llNull = games.reduce((s, r) => s + logPois(meanGoals, r.score[0]) + logPois(meanGoals, r.score[1]), 0);
const grid = [];
for (const BASE of [4, 5, 6, 7, 8, 9, 10, 12]) for (const K_BEAT of [0.75, 1, 1.25, 1.5, 2, 2.5, 3]) for (const K_GK of [0.75, 1, 1.25, 1.5, 2, 3, 4, 6]) for (const K_MID of [1, 1.5, 2, 3, 4, 6, 8]) {
  const P = { BASE, K_BEAT, K_GK, K_MID };
  grid.push({ P, ll: games.length ? ll(P) : 0 });
}
grid.sort((a, b) => b.ll - a.ll);
const best = grid[0];
// Prefer the smoothest curves that are statistically as good (within 1 log-lik point): less overconfident.
const robust = grid.filter(g => g.ll >= best.ll - 1).sort((a, b) => b.P.K_BEAT - a.P.K_BEAT || b.P.K_GK - a.P.K_GK || b.P.K_MID - a.P.K_MID)[0];
const MIN_GAMES = 12;
const params = games.length >= MIN_GAMES
  ? { ...robust.P, fittedOn: games.length, logLik: +robust.ll.toFixed(2), bestLogLik: +best.ll.toFixed(2), nullLogLik: +llNull.toFixed(2), best: best.P, fittedAt: new Date().toISOString() }
  : { BASE: 8, K_BEAT: 2, K_GK: 3, K_MID: 2, fittedOn: games.length, note: `fewer than ${MIN_GAMES} complete reports — kept defaults`, fittedAt: new Date().toISOString() };
fs.mkdirSync(path.join(ROOT, 'model'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'model', 'params.json'), JSON.stringify(params, null, 2) + '\n');

// ---------- grade forecasts ----------
const decisions = readLines(path.join(DATA, 'decisions.jsonl'));
const lastPerMatch = new Map();
for (const d of decisions) lastPerMatch.set(`${d.match.date}|${d.match.home}|${d.match.away}`, d);
const graded = [];
for (const d of lastPerMatch.values()) {
  const r = reports.find(x => x.date === d.match.date && norm(x.sides?.[0]?.team) === norm(d.match.home) && norm(x.sides?.[1]?.team) === norm(d.match.away) && x.score);
  if (!r) continue;
  const us = d.weAreHome ? 0 : 1;
  const gf = r.score[us], ga = r.score[1 - us];
  const res = gf > ga ? 'w' : gf === ga ? 'd' : 'l';
  const brier = f => ['w', 'd', 'l'].reduce((s, k) => s + ((f[k] || 0) - (k === res ? 1 : 0)) ** 2, 0);
  const pund = d.pundits && (d.weAreHome ? { w: d.pundits.home, d: d.pundits.draw, l: d.pundits.away } : { w: d.pundits.away, d: d.pundits.draw, l: d.pundits.home });
  const ourSide = r.sides[us];
  // the game labels shapes its own way, so compare who actually started and the style
  const started = new Set((ourSide.players || []).map(p => String(p.id)));
  const sameXI = (d.plan.slots || []).filter(s => started.has(String(s.id))).length;
  graded.push({ d, r, gf, ga, res, brier: brier(d.forecast), brierPundits: pund ? brier(pund) : null, playedPlan: sameXI >= 10 && ourSide.style === d.plan.style, sameXI });
}

// ---------- tactics seen in the data ----------
const AT_KEYS = ['Pressing', 'Counter Attack', 'Marking', 'Offside Trap', 'High Balls', 'One-on-Ones', 'Keeping Style', 'Long Shots', 'First Time Shots', 'Tackling'];
const atTable = AT_KEYS.map(k => {
  const by = {};
  for (const r of games) r.sides.forEach((s, i) => {
    const v = s.stats?.[k];
    if (!v) return;
    const gd = r.score[i] - r.score[1 - i];
    (by[v] = by[v] || { n: 0, gd: 0, avg: 0 }).n++;
    by[v].gd += gd;
    by[v].avg += s.zones.avg || 0;
  });
  return [k, Object.entries(by).map(([v, x]) => `${v} ${x.n}× (avg rating ${(x.avg / x.n).toFixed(1)}, goal diff ${(x.gd / x.n).toFixed(1)})`).join(' · ')];
}).filter(([, s]) => s);

// ---------- training progress from player time series ----------
const progress = dir('players').filter(f => f.endsWith('.jsonl')).map(f => {
  const rows = readLines(f).filter(x => x.sk);
  if (rows.length < 2) return null;
  const a = rows[0], b = rows[rows.length - 1];
  const days = (new Date(b.date) - new Date(a.date)) / 864e5;
  const gained = Object.keys(b.sk).reduce((s, k) => s + Math.max(0, (b.sk[k] || 0) - (a.sk[k] || 0)), 0);
  return days > 0 ? { name: b.name, age: b.age, potential: b.potential, days, gained, perWeek: gained / days * 7 } : null;
}).filter(Boolean).sort((a, b) => b.perWeek - a.perWeek);

// ---------- growth per potential grade (skill points per full-strength session) ----------
// Each player snapshot carries the exact gain from his latest training; dedupe by training date.
const DENOMS = ['Terrible', 'Very Bad', 'Bad', 'Low', 'Passable', 'Good', 'Very Good', 'Excellent', 'Formidable', 'World Class'];
const PRIOR = [0.05, 0.08, 0.11, 0.14, 0.17, 0.21, 0.25, 0.3, 0.34, 0.38], PRIOR_WEIGHT = 5;
const clubByDate = new Map(dir('club').filter(f => f.endsWith('.json')).map(f => [path.basename(f, '.json'), readJson(f)]));
const samples = DENOMS.map(() => []);
for (const f of dir('players').filter(f => f.endsWith('.jsonl'))) {
  const seen = new Set();
  for (const row of readLines(f)) {
    const club = clubByDate.get(row.date);
    const key = club?.training?.lastDate || row.date;
    const gain = (row.last || []).reduce((s, l) => s + (l.delta || 0), 0);
    const g = DENOMS.indexOf(row.potential);
    if (seen.has(key) || g < 0 || !gain || !row.last?.length) continue;
    seen.add(key);
    const staffSkills = (club?.training?.staff || []).map(s => norm(s.skill));
    const trained = norm(row.last[0].skill);
    const factor = staffSkills.includes(trained) ? 1 : 0.75;
    // skills already at 18+ grow slower (and 20 not at all) — those sessions say little about the rate
    const level = row.sk?.[{ handling: 'HAN', 'out of area': 'CRO', reflexes: 'REF', agility: 'AGI', tackling: 'TCK', heading: 'HEA', passing: 'PAS', positioning: 'POS', finishing: 'FIN', technique: 'TEC', speed: 'SPE', strength: 'STR' }[trained]] ?? 0;
    if (level >= 18) continue;
    samples[g].push(gain / factor);
  }
}
const growth = PRIOR.map((p, g) => +((p * PRIOR_WEIGHT + samples[g].reduce((s, x) => s + x, 0)) / (PRIOR_WEIGHT + samples[g].length)).toFixed(3));
params.growth = growth;
params.growthSamples = samples.map(s => s.length);
fs.writeFileSync(path.join(ROOT, 'model', 'params.json'), JSON.stringify(params, null, 2) + '\n');

// ---------- report ----------
const lines = [];
lines.push(`# PM Copilot model report`, '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from ${reports.length} reports (${games.length} with full zone ratings).`, '');
lines.push('## Goal model', '');
if (params.note) lines.push(`_${params.note}._`, '');
else {
  lines.push(`| | BASE | K_BEAT | K_GK | K_MID | log-lik |`, `|---|---|---|---|---|---|`);
  lines.push(`| **Released (robust)** | ${params.BASE} | ${params.K_BEAT} | ${params.K_GK} | ${params.K_MID} | ${params.logLik} |`);
  lines.push(`| Best fit | ${best.P.BASE} | ${best.P.K_BEAT} | ${best.P.K_GK} | ${best.P.K_MID} | ${best.ll.toFixed(2)} |`);
  lines.push(`| Constant-rate baseline | | | | | ${llNull.toFixed(2)} |`, '');
  lines.push(`Mean goals per team per game: ${meanGoals.toFixed(2)}. The released set is the smoothest one within 1 log-lik point of the best fit (less overconfident).`, '');
}
lines.push('## Forecast grades', '');
if (!graded.length) lines.push('_No graded matches yet — each decision is graded once its report is harvested._', '');
else {
  const mb = graded.reduce((s, g) => s + g.brier, 0) / graded.length;
  const pg = graded.filter(g => g.brierPundits != null);
  const pb = pg.length ? pg.reduce((s, g) => s + g.brierPundits, 0) / pg.length : null;
  lines.push(`Brier score (lower is better): **model ${mb.toFixed(3)}**${pb != null ? ` vs pundits ${pb.toFixed(3)}` : ''} over ${graded.length} match${graded.length > 1 ? 'es' : ''}.`, '');
  lines.push('| Date | Match | Result | Forecast W/D/L | Plan | Played plan? |', '|---|---|---|---|---|---|');
  for (const g of graded) lines.push(`| ${g.d.match.date} | ${g.d.match.home} – ${g.d.match.away} | ${g.r.score.join('-')} (${g.res.toUpperCase()}) | ${pct(g.d.forecast.w)} / ${pct(g.d.forecast.d)} / ${pct(g.d.forecast.l)} | ${g.d.plan.formation} ${g.d.plan.style}/${g.d.plan.passing} | ${g.playedPlan ? 'yes' : 'no'} (${g.sameXI}/11 of the planned XI, played ${g.r.sides[g.d.weAreHome ? 0 : 1].style}) |`);
  lines.push('');
}
lines.push('## Advanced tactics seen', '', 'How often each setting was used across all harvested matches, with the side\'s average player rating and goal difference. Descriptive only — strong teams choose differently.', '');
lines.push(atTable.length ? atTable.map(([k, s]) => `- **${k}**: ${s}`).join('\n') : '_No data yet._', '');
// ground & weather: goals and home results by conditions (needs reports harvested with weather)
const byWeather = {};
for (const r of games) {
  const w = r.weather || 'unknown';
  const b = (byWeather[w] = byWeather[w] || { n: 0, goals: 0, homeWins: 0, homeZone: 0, awayZone: 0 });
  b.n++; b.goals += r.score[0] + r.score[1]; b.homeWins += r.score[0] > r.score[1] ? 1 : 0;
  b.homeZone += r.sides[0].zones.avg || 0; b.awayZone += r.sides[1].zones.avg || 0;
}
lines.push('## Ground & weather', '', '| Weather | Games | Goals/game | Home win % | Avg rating home / away |', '|---|---|---|---|---|',
  ...Object.entries(byWeather).sort((a, b) => b[1].n - a[1].n).map(([w, b]) => `| ${w} | ${b.n} | ${(b.goals / b.n).toFixed(2)} | ${pct(b.homeWins / b.n)} | ${(b.homeZone / b.n).toFixed(1)} / ${(b.awayZone / b.n).toFixed(1)} |`), '');
lines.push('## Growth per potential grade', '', 'Skill points per full-strength league training (prior blended with observed sessions; prior counts as 5 sessions).', '');
lines.push('| Potential | Prior | Fitted | Sessions observed |', '|---|---|---|---|', ...DENOMS.map((d, g) => `| ${d} | ${PRIOR[g]} | ${growth[g]} | ${samples[g].length} |`), '');
lines.push('## Training progress', '');
lines.push(progress.length ? ['| Player | Age | Potential | Skill points / week |', '|---|---|---|---|', ...progress.map(p => `| ${p.name} | ${p.age} | ${p.potential || ''} | ${p.perWeek.toFixed(2)} |`)].join('\n') : '_Needs at least two harvests on different days._', '');
fs.writeFileSync(path.join(ROOT, 'model', 'report.md'), lines.join('\n') + '\n');

console.log(JSON.stringify({ reports: reports.length, games: games.length, params, graded: graded.length }, null, 1));
