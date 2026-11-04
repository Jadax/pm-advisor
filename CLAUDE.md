# PM Copilot

Made with ❤ by Tushant Sharma

Single-file Tampermonkey userscript: `pm-copilot.user.js` (one IIFE) for pmanager.org (Planetarium Manager, football). User's team: Joburg Vikings (manager Jadax). Public repo: github.com/Jadax/pm-advisor — Tampermonkey self-updates from raw.githubusercontent (`@updateURL`). No build step, no test suite. Durable knowledge lives here, compressed; per-version history is `git log` + `model/CHANGELOG.md`.

## Active rules
- After any edit: `node --check pm-copilot.user.js` (and `node --check model/fit.js` if touched).
- Grep for an existing helper before adding one; match the surrounding style; comments only for non-obvious WHY.
- Escape scraped text before `innerHTML` (`esc()`); everything renders via string templates.
- Money/number strings are European (`$1.231.313`, `0,132`) — always `num()`.
- Never hammer the site: sequential fetches with `sleep(80–150)` between them.
- In-game actions (orders, events, lectures, training, renewals) only through the autopilot and only behind their `prefs.auto*` switches. Never bids, purchases, staff hires or facility builds — those stay advice.
- Claude never enters the user's password; if the browser pane is signed out, ask the user to sign in.

## Ship workflow (every shipped change, unless told otherwise)
1. Bump BOTH `// @version` and `const VERSION` (Tampermonkey only updates on a higher version).
2. `node --check pm-copilot.user.js`.
3. Add a dated entry to `model/CHANGELOG.md` when the change comes from data.
4. `git add -A && git commit -m "vX.Y.Z: <what and why>"` then `git push`.

## Learning (all in the browser)
- `autoPilot` order: refresh → scout → `learn()` → orders → `recordDecision()` → events → lecture → training → contracts. Learning runs before decisions on purpose.
- `learn()`: daily `crawlDivision` (every division report + rosters; `pruneReports` caps storage at 600, keeps own + next opponent), `recordGrowth` (per-session training gains by potential grade, deduped by player|lastDate, skips skills ≥18), `gradeMatches` (decision vs report, Brier vs pundits), `calibrateModel` (grid search, robust pick within 1 log-lik of best; needs 30+ reports).
- `goalRate()` is the single goal formula — used by `simulate()` and by both calibrations (`calibrateModel` in the script, `model/fit.js` offline). Change it in one place and keep `fit.js`'s `lambda` identical.
- `db.model` (ME constants + growth table) is applied at load by `applyModel`; the built-in `ME`/`GROWTH` are only starting values.

## File map (grep names; line numbers drift)
- Parsers: `parseSquadPage`, `parseTrainingPage`, `parseEconomyPage`, `parseAcademyPage`, `parseInfoPage` (stadium or club), `parseSponsorsPage`, `parseFixturesPage`, `parseNextMatchPage`, `parseReportPage` (zones from `#ratings .rz-vs[title]`, ATs from `#stats`, players `.mr-pp[data-jog]`, weather), `parseLineupPage` (live only — client-rendered), `parseTeamPage` (`ver_equipa`, `&vjog=1` roster), `parsePlayerPage` (own details / scouted skills), `parseContractsPage`, `parseOpponentPage` (`prox_adv.asp`, last-20 formations), `parseLecturePage`, `parseEventsPage`, `parseStaffPage` (`eqtecnica.asp`, `fase=1` wages), `parseMarketPage` (`procurar.asp` results). Router: `ROUTES` + `ingest`.
- Model: `roleSkill`, `posFactor`, `slotScore`, `bestXI` (Hungarian), `zonesFor`, `calibration` (model pts → stars), `toStars`, `evalATs`/`decideATs` (in-game AT rules), `sideMult`, `goalRate`, `simulate`, `opponentModel` (engine zone stars from reports, last-20 shape, quality-grade/scouted skills), `computePlan`, `shown` (25% pundit blend).
- Training history: `recordGrowth` (runs on every training-page parse; needs the squad first) → `db.history[id] = {sessions, snaps}` + growth samples; `playerRate` (own measured rate blended with grade), `trainingFactor` (share of a full session our setup delivers). `projectSkills` = rate × `SESSIONS` × factor.
- Player value: `GROWTH`, `projectSkills`, `valuePath` (@26 + 5-season path), `careerWeight`/`seasonGain` (retirement-weighted 5-season gain), `talentBonus`, `rankCandidates`, `badgeMarketRows`.
- Recruitment: `scanQueries`/`scanMarket` (search `procurar.asp?action=proc_jog` GET, 30/page via `pid`, skill filters from our starters + price cap; free agents `lista_livres.asp`, page = `gid`), `mergeListings` (`db.scan`), `buyCaps` (share of funds, `prefs.buyPct`), `fairPriceModel`, `slotImpact` (+1 rating → expected points per slot), `recruitBoard` (Best buys / Best value / Worth saving for / By position), `fetchValues`, `runScan`. `AUCTION_RATIO` = fee/Value from completed transfers.
- Actions: `applyXI`/`applyPlan` (page's own `setPlayer`/`removePlayer`), `withFrame` (hidden same-origin iframe), `applyOrders`, `autoTraining`, `autoRenew`, `planEvents`/`autoEvents` (POST `eventos.asp?action=guardar`; own events tracked in `db.myEvents`, recognised by `SCRIPT_EVENT_RE`), `autoLecture` (`lectureChoice` = change × (2p−1)).
- Advice: `trainingAdvice`, `clubAdvice`, `staffAdvice`, `scoutingAdvice`.
- UI: `render`, `view*` per tab, `sec`/`chip`/`list` helpers, `PAGE_TAB` (tab per page).

## Invariants (each broke once)
- `plantel.asp` ignores the team id — other teams' players come from `ver_equipa.asp?equipa=ID&vjog=1` (grades only; skills hidden unless scouted).
- Starting Eleven must be applied via the page's own functions and the hidden holder rows re-created; `customselectmenu` must be initialised on new dropdowns before `setPlayer`, or it throws.
- `setSelect` dispatches a native `change` (jQuery `trigger` misses native listeners) then refreshes `selectmenu`.
- Lecture buttons disappear once a lecture is given — `parseLecturePage().available` guards double lectures.
- `prox_adv.asp` counts run into the next formation (`×194-4-2`) — keep the lazy regex.
- Report formation labels ("5-2-3") don't match ours — compare starting XI ids, not labels.
- No foreign-player limit in lineups (checked 2026-11-04); `parseAcademyPage().minNational` watches the federation's "Minimum Number of National Players" in case a referendum adds one.
- Best value ranks on net cost (fee − discounted `resaleShare` after `RESALE_YEARS` + a season of wages); Best buys respect `prefs.maxBuyAge` (default 29).
- A listing's "Ask. Price" is the auction floor, not the cost — always budget on expected cost (`AUCTION_RATIO` × Value, never below the ask).

## Offline tools (optional, for Claude's deeper analysis)
`tools/harvest.js` (run in a signed-in browser tab; read-only; writes via `tools/server.py` into `data/`), `model/fit.js` (same fit + grades + weather/AT/growth tables → `model/report.md`), `tools/release.js` (writes `model/params.json` into the script's starting values). `data/` is git-ignored.
