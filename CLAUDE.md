# PM Copilot

Made with ❤ by Tushant Sharma

Single-file Tampermonkey userscript: `pm-copilot.user.js` (one IIFE) for pmanager.org (Planetarium Manager, football). User's team: Joburg Vikings (manager Jadax). Public repo: github.com/Jadax/pm-advisor — Tampermonkey self-updates from raw.githubusercontent (`@updateURL`). No build step, no test suite. Durable knowledge lives here, compressed; per-version history is `git log` + `model/CHANGELOG.md`.

## Active rules
- After any edit: `node --check pm-copilot.user.js` (and `node --check model/fit.js` if touched).
- Grep for an existing helper before adding one; match the surrounding style; comments only for non-obvious WHY.
- Escape scraped text before `innerHTML` (`esc()`); everything renders via string templates.
- Money/number strings are European (`$1.231.313`, `0,132`) — always `num()`.
- Never hammer the site: sequential fetches with `sleep(80–150)` between them.
- In-game actions (orders, events, lectures, training, renewals, youth-team moves, the once-a-season academy speciality — the user asked for it) only through the autopilot and only behind their `prefs.auto*` switches. Never bids, purchases, staff hires or other facility builds — those stay advice.
- Claude never enters the user's password; if the browser pane is signed out, ask the user to sign in.

## Ship workflow (every shipped change, unless told otherwise)
1. Bump BOTH `// @version` and `const VERSION` (Tampermonkey only updates on a higher version).
2. `node --check pm-copilot.user.js`.
3. Add a dated entry to `model/CHANGELOG.md` when the change comes from data.
4. `git add -A && git commit -m "vX.Y.Z: <what and why>"` then `git push`.

## Learning (all in the browser)
- `autoPilot` order: refresh → scout → `learn()` → orders → `recordDecision()` → events → lecture → training → contracts. Learning runs before decisions on purpose.
- `learn()` also runs `learnRating` → `learnLanes` → `calibrateModel` → `learnShapes`. The autopilot re-runs every 30 min while a tab is open.
- `learn()`: daily `crawlDivision` (every division report + rosters; `pruneReports` caps storage at 600, keeps own + next opponent), `recordGrowth` (per-session training gains by potential grade, deduped by player|lastDate, skips skills ≥18), `gradeMatches` (decision vs report, Brier vs pundits), `calibrateModel` (grid search, robust pick within 1 log-lik of best; needs 30+ reports).
- `goalRate()` is the single goal formula — used by `simulate()` and by both calibrations (`calibrateModel` in the script, `model/fit.js` offline). Change it in one place and keep `fit.js`'s `lambda` identical.
- `db.model` (ME constants + growth table) is applied at load by `applyModel`; the built-in `ME`/`GROWTH` are only starting values.

## File map (grep names; line numbers drift)
- Parsers: `parseSquadPage`, `parseTrainingPage`, `parseEconomyPage`, `parseAcademyPage`, `parseInfoPage` (stadium or club), `parseSponsorsPage`, `parseFixturesPage`, `parseNextMatchPage`, `parseReportPage` (zones from `#ratings .rz-vs[title]`, ATs from `#stats`, players `.mr-pp[data-jog]`, weather), `parseLineupPage` (live only — client-rendered), `parseTeamPage` (`ver_equipa`, `&vjog=1` roster), `parsePlayerPage` (own details / scouted skills), `parseContractsPage`, `parseOpponentPage` (`prox_adv.asp`, last-20 formations), `parseLecturePage`, `parseEventsPage`, `parseStaffPage` (`eqtecnica.asp`, `fase=1` wages), `parseMarketPage` (`procurar.asp` results). Router: `ROUTES` + `ingest`.
- Model: `roleSkill`, `posFactor`, `slotScore`, `bestXI` (Hungarian), `zonesFor`, `calibration` (model pts → stars), `toStars`, `evalATs`/`decideATs` (in-game AT rules), `sideMult`, `goalRate`, `simulate`, `opponentModel` (engine zone stars from reports, last-20 shape, quality-grade/scouted skills), `computePlan`, `shown` (25% pundit blend).
- Training history: `recordGrowth` (runs on every training-page parse; needs the squad first) → `db.history[id] = {sessions, snaps}` + growth samples; `playerRate` (own measured rate blended with grade), `trainingFactor` (share of a full session our setup delivers). `projectSkills` = rate × `SESSIONS` × factor.
- Player value: `GROWTH`, `projectSkills`, `valuePath` (@26 + 5-season path), `careerWeight`/`seasonGain` (retirement-weighted 5-season gain), `talentBonus`, `rankCandidates`, `badgeMarketRows`.
- Recruitment: `scanQueries`/`scanMarket` (search `procurar.asp?action=proc_jog` GET, 30/page via `pid`, skill filters from our starters + price cap; free agents `lista_livres.asp`, page = `gid`), `mergeListings` (`db.scan`), `buyCaps` (share of funds, `prefs.buyPct`), `fairPriceModel`, `slotImpact` (+1 rating → expected points per slot), `recruitBoard` (Best buys / Best value / Worth saving for / By position), `fetchValues`, `runScan`. `AUCTION_RATIO` = fee/Value from completed transfers.
- Actions: `applyXI`/`applyPlan` (page's own `setPlayer`/`removePlayer`), `withFrame` (hidden same-origin iframe), `applyOrders`, `autoTraining`, `autoRenew`, `planEvents`/`autoEvents` (POST `eventos.asp?action=guardar`; own events tracked in `db.myEvents`, recognised by `SCRIPT_EVENT_RE`), `autoLecture` (`lectureChoice` = change × (2p−1)), MOTS via `applyPlan` (`Team_attitude`, behind `autoApply`), `autoYouth` (`youthMoves`: 17–18s outside the XI → youth team via `plantel.asp?action=despromover&to=y`; keeps 14 players + a spare GK), `autoSpeciality` (`specialityPlan`: POST `academia.asp?action=nova_especialidade`, `especialidade` = `SPEC_ID`, then submits the confirmation form; only when promotions remain, no change yet this season, and funds ≥ fee + a season of upkeep + buffer).
- Advice: `trainingAdvice`, `clubAdvice`, `staffAdvice`, `scoutingAdvice`.
- UI: `render`, `view*` per tab, `sec`/`chip`/`list` helpers, `PAGE_TAB` (tab per page).

## Invariants (each broke once)
- `plantel.asp` ignores the team id — other teams' players come from `ver_equipa.asp?equipa=ID&vjog=1` (grades only; skills hidden unless scouted).
- Starting Eleven must be applied via the page's own functions and the hidden holder rows re-created; `customselectmenu` must be initialised on new dropdowns before `setPlayer`, or it throws.
- `setSelect` dispatches a native `change` (jQuery `trigger` misses native listeners) then refreshes `selectmenu`.
- Lecture buttons disappear once a lecture is given — `parseLecturePage().available` guards double lectures.
- `prox_adv.asp` counts run into the next formation (`×194-4-2`) — keep the lazy regex.
- Report formation labels ("5-2-3") don't match ours — compare starting XI ids, not labels.
- Squad tiers: row `data-sq` 0 main / 1 B / 3 youth (`p.tier`); youth players can't play — `squadPool` drops them. Youth train at 100% every league round without playing; B team gets reduced training and none from 22 (manual §8–9).
- Academy speciality: one-off fee on the page (`New Speciality`, $1M) + upkeep ≈ 2× academy weekly (manual ratio); spec skill 10–20, other non-physicals capped at 8; promoted positions random.
- `ROLE_W` mirrors the game's Quality (6.2 + 1.41·Σprimaries + 0.52·Σsecondaries + 0.19·Σphysicals, r 0.999 on our squad's `data-q`) — refit from `data-q` before changing weights.
- Next match home/away comes from the fixture list — the next-match pundit line doesn't always name the home side first.
- MOTS/PIC = ±`MOTS_STARS` on every zone; `motsPlan` spends the season's 2 on the best remaining fixtures; own uses are tracked in `db.mots` (reports don't show attitude). `Team_attitude` options: Normal / Play it Cool / Match of the Season.
- Availability: squad-row `.sq-st [title]` icons ("Injured for N days", "Currently Unhappy", suspensions) → `p.injuredDays`/`suspended`/`unhappy`; `squadPool` drops anyone still out on match day.
- Condition = the game's Affected Quality fit (`formFactor`/`fitFactor`); form scale is Very Bad…Very Good ("Normal" is not a DENOM). Team integration via `tiShift`; own rating ratios via `learnRating` (`db.model.rating`, applied to `ROLE_W` by `applyRating`); shape effects via `learnShapes` (`db.model.shapeFx`, used in `simulate`).
- Patch scripts: in JS `String.replace`, `$` in the replacement becomes `# PM Copilot

Made with ❤ by Tushant Sharma

Single-file Tampermonkey userscript: `pm-copilot.user.js` (one IIFE) for pmanager.org (Planetarium Manager, football). User's team: Joburg Vikings (manager Jadax). Public repo: github.com/Jadax/pm-advisor — Tampermonkey self-updates from raw.githubusercontent (`@updateURL`). No build step, no test suite. Durable knowledge lives here, compressed; per-version history is `git log` + `model/CHANGELOG.md`.

## Active rules
- After any edit: `node --check pm-copilot.user.js` (and `node --check model/fit.js` if touched).
- Grep for an existing helper before adding one; match the surrounding style; comments only for non-obvious WHY.
- Escape scraped text before `innerHTML` (`esc()`); everything renders via string templates.
- Money/number strings are European (`$1.231.313`, `0,132`) — always `num()`.
- Never hammer the site: sequential fetches with `sleep(80–150)` between them.
- In-game actions (orders, events, lectures, training, renewals, youth-team moves, the once-a-season academy speciality — the user asked for it) only through the autopilot and only behind their `prefs.auto*` switches. Never bids, purchases, staff hires or other facility builds — those stay advice.
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
- Actions: `applyXI`/`applyPlan` (page's own `setPlayer`/`removePlayer`), `withFrame` (hidden same-origin iframe), `applyOrders`, `autoTraining`, `autoRenew`, `planEvents`/`autoEvents` (POST `eventos.asp?action=guardar`; own events tracked in `db.myEvents`, recognised by `SCRIPT_EVENT_RE`), `autoLecture` (`lectureChoice` = change × (2p−1)), MOTS via `applyPlan` (`Team_attitude`, behind `autoApply`), `autoYouth` (`youthMoves`: 17–18s outside the XI → youth team via `plantel.asp?action=despromover&to=y`; keeps 14 players + a spare GK), `autoSpeciality` (`specialityPlan`: POST `academia.asp?action=nova_especialidade`, `especialidade` = `SPEC_ID`, then submits the confirmation form; only when promotions remain, no change yet this season, and funds ≥ fee + a season of upkeep + buffer).
- Advice: `trainingAdvice`, `clubAdvice`, `staffAdvice`, `scoutingAdvice`.
- UI: `render`, `view*` per tab, `sec`/`chip`/`list` helpers, `PAGE_TAB` (tab per page).

## Invariants (each broke once)
- `plantel.asp` ignores the team id — other teams' players come from `ver_equipa.asp?equipa=ID&vjog=1` (grades only; skills hidden unless scouted).
- Starting Eleven must be applied via the page's own functions and the hidden holder rows re-created; `customselectmenu` must be initialised on new dropdowns before `setPlayer`, or it throws.
- `setSelect` dispatches a native `change` (jQuery `trigger` misses native listeners) then refreshes `selectmenu`.
- Lecture buttons disappear once a lecture is given — `parseLecturePage().available` guards double lectures.
- `prox_adv.asp` counts run into the next formation (`×194-4-2`) — keep the lazy regex.
- Report formation labels ("5-2-3") don't match ours — compare starting XI ids, not labels.
- Squad tiers: row `data-sq` 0 main / 1 B / 3 youth (`p.tier`); youth players can't play — `squadPool` drops them. Youth train at 100% every league round without playing; B team gets reduced training and none from 22 (manual §8–9).
- Academy speciality: one-off fee on the page (`New Speciality`, $1M) + upkeep ≈ 2× academy weekly (manual ratio); spec skill 10–20, other non-physicals capped at 8; promoted positions random.
- `ROLE_W` mirrors the game's Quality (6.2 + 1.41·Σprimaries + 0.52·Σsecondaries + 0.19·Σphysicals, r 0.999 on our squad's `data-q`) — refit from `data-q` before changing weights.
- Next match home/away comes from the fixture list — the next-match pundit line doesn't always name the home side first.
- MOTS/PIC = ±`MOTS_STARS` on every zone; `motsPlan` spends the season's 2 on the best remaining fixtures; own uses are tracked in `db.mots` (reports don't show attitude). `Team_attitude` options: Normal / Play it Cool / Match of the Season.
 — use a function replacement or split/join.
- Report commentary (`#comments li.rf-item`, kinds `--goal/--at/--sub/--ht/--final`) → `side.moves` {L,C,R, goals, by finisher} + `side.atMsgs`; `learnLanes` fits goalRate's lane split (`LANE_EXP`, `LANE_MID`, mirrored in `fit.js`); `attackLanes(team)` = their recent lane shares.
- Training: an assistant manager trains a skill only above quality 0 (set by the hire, not the page); any assistant enables the auto-fitness line (`minimum_fitness` in the `treinarglobal` form) → `AM_FITNESS` 80 (manual §8: under 80% at training time the session is penalised). With an assistant, individual orders stay on skills. `trainingDue` re-reads the page every autopilot run — new signings start on None.
- `slotImpact` averages over the season's league fixtures (`sideFromHistory` per opponent) — next-opponent-only weights made every buy a forward. Talent effects are the manual's ±2 global skill; GS is 0–100, so `GS` = 0.2 rating per point (`talentBonus`, `TALENT_AT`). Our players' talents come from `tr.vj-talent` on their page; `computePlan` applies them per style/passing via `withTalents`; event subs use the 'sub' role.
- Funds come from every page's sidebar (`readFunds` in `fetchDoc`/`ingest`: `td.team_players a[href*=financas.asp] b`) — the finance page alone went stale between full refreshes.
- Listings: the pool (`db.scan.rows`) is the only source for the board; unseen rows expire after `LISTING_TTL` (30 h). Everyone on the board is checked on his player page every 2 h (`verifyBoard` → `fetchValues` → `listingStatus`: "Currently in transfer list" / `assinar_livres` link / else gone and removed) — free agents have no deadline, so a signed one lingered for days.
- Match model pick = likelihood-weighted grid average (`calibrateModel`, `fit.js`): the old flattest-within-1-log-lik rule flattened K_BEAT and halved defence. Check elasticities against a log-linear Poisson fit when touching `goalRate`.
- MOTS: `motsPlan` → `seasonTable` Monte Carlo over all remaining league fixtures (`db.standings` from `parseStandingsPage`, zones `is-up`/`is-down`; `db.playoffs.active` from `playoffs.asp?action=3` season list). Bots: team page has "Manager Focus" and no manager link (`team.bot`, read weekly in `crawlDivision`).
- The game plays **Default Orders** (`titulares_v3.asp` without `jogo_id`) for any match with no saved orders — `applyOrders` writes the plan there too (MOTS off, `db.defaultOrdersSig`). Upgrades must beat the starter today (`MIN_UPGRADE_NOW`).
- No foreign-player limit in lineups (checked 2026-11-04); `parseAcademyPage().minNational` watches the federation's "Minimum Number of National Players" in case a referendum adds one.
- Best value ranks on net cost (fee − discounted `resaleShare` after `RESALE_YEARS` + a season of wages); Best buys respect `prefs.maxBuyAge` (default 29). Nobody over `MAX_BUY_AGE_ANY` (31: must play this season + next — the user never buys to flip) anywhere; `seasonGain` weights this season by `seasonLeft()` (unplayed league rounds) — otherwise near-free 36-year-olds top Best value.
- A listing's "Ask. Price" is the auction floor, not the cost — always budget on expected cost (`AUCTION_RATIO` × Value, never below the ask). Read real Values for affordable-ask upgrades too (`runScan`), or the price model learns only from expensive players and prices everything out; `bids` = ask fits, fee doesn't, with `winChance` (log-normal, `AUCTION_SPREAD`). Search `sort=1` with `field` = that skill = best first.

## Offline tools (optional, for Claude's deeper analysis)
`tools/harvest.js` (run in a signed-in browser tab; read-only; writes via `tools/server.py` into `data/`), `model/fit.js` (same fit + grades + weather/AT/growth tables → `model/report.md`), `tools/release.js` (writes `model/params.json` into the script's starting values). `data/` is git-ignored.
