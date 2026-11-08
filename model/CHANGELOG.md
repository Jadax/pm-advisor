# PM Copilot — learning log

Newest first. Written by the daily review (and by hand) whenever the data changes the engine.

## 2026-11-09 — v0.17.0 (defence valued properly; MOTS by the final table)
- **Data:** 99 harvested division reports (198 performances). A Poisson fit of goals on zone stars: +1 star of our attack +0.213 ±0.033, +1 star of their defence −0.186 ±0.088, midfield +0.048, keeper −0.094 — attack and defence about even. The engine had attack +0.60 vs defence −0.31: its "robust" pick took the flattest K_BEAT within 1 log-lik of the best, and a flat K_BEAT makes defence matter little. That is why the transfer board kept recommending forwards.
- **Changed:** calibrateModel / fit.js now use the likelihood-weighted average of the grid (K_BEAT 0.5 and 0.6 added). In-browser refit on 77 reports: K_BEAT 1.5 → 0.90, K_GK 1.30, BASE 5.07, K_MID 6.96; best fits put defence at −0.57…−0.82 per star vs attack +0.67…+0.84. Starting values updated.
- **Transfer weights:** slot impact is measured at +1, +3 and +6 rating (season-averaged) and each upgrade is weighed at its own size — attacks pile into a side's strongest lane, so a big upgrade in a weak lane is worth more than its +1 slope (CF 0.32 per point at +1, 0.98 at +6). Board now spans F/M/D; forwards still lead because each forward is alone in his lane's zone and attacks concentrate in strong lanes (472 commentary moves).
- **MOTS:** the rest of the league season is simulated (3000 runs, all 20 remaining fixtures, each team from its reports) for every way of spending what is left, scored on final position (promotion 10, 2nd 1, 3rd 0.5, relegation −10) + 0.05/point − morale cost of a MOTS defeat − fatigue 0.15 pts per use. Rival head-to-heads count double by construction; games that can't move the table keep it. Human opponents (team page links a manager; bots show a generated one with "Manager Focus" — 7 bots, 2 humans in B-4) answer with MOTS 30% of the time if they have any left. Playoffs (2nd vs 7th/8th above, only with >3 divisions; MOTS carries into them) reserve one when 2nd is likely — none in South Africa since season 96.
- **Today:** 2nd place 100%, promotion 0% (Newcastle 42 pts, 14/14) → keep both MOTS. With Newcastle only 2 ahead the plan spends them @ Pretoria and vs Qwa-Qwa.

## 2026-11-08 — v0.16.0 (talents in tactics, right scale)
- **Scale fix:** the player page defines GS (global skill) as 0–100; our ratings run 0–20, so a talent's ±2 GS is ±0.4 rating, not ±2 (v0.15.0 overstated it 5×). Skill bonuses of AT specialists (+2 tackling…) stay on the 0–20 skill scale.
- **Our squad:** talents are now read from each player's page (`tr.vj-talent`): dos Santos Zonal Marking Specialist, Kesici and Slater Motivated Starter, Mohd Direct Pass Specialist.
- **Tactics:** every formation × style × passing (and the ATs that style turns on) is scored with the XI's talents applied, so passing/style specialists and AT specialists tilt the choice. Scripted substitutions favour Substitute Heroes (+2 GS coming on) and avoid Motivated Starters (−2 GS).
- **Transfer list:** unchanged path (valuePath → talentBonus with the plan we play), now on the right scale.

## 2026-11-08 — v0.15.0 (auto-fitness, season-wide transfer weights, published talents)
- **Training (manual §8, §16):** a player under 80% fitness when training runs (straight after the match) gets a penalised session; fitness training adds +15% after league games, +5% after cup/friendly. An assistant manager trains a skill only above quality 0 (ours is 0/5), but any assistant can switch players under a fitness line to Fitness automatically — the game does it with no tab open. The autopilot keeps that line at 80% and leaves individual orders on skills. The line was found reset to 0 once; it is now re-checked every run. Players with no individual order (new signings) only get +1% fitness.
- **Transfers (data):** a 1007-listing scan covered every line and upgrades existed at every slot, but Best buys / value / stretch / bids were all forwards. Cause: each gain was weighted by the slot's effect against the next opponent only (LF ×2.58, CD ×0.16). Slot weights are now averaged over every league fixture of the season, each opponent as their reports show them. Ratings already use all 12 skills (secondaries 37%, physicals 13% of a primary, refit from our reports).
- **Talents (manual §7):** effects are published — ±2 global skill: passing specialists +2 in their passing / −2 in others (0 in Mixed), Attack/Defense-minded ±2 by style, Motivated Starter +2 and Substitute Hero −2 as starters, AT specialists −2 global skill with +2 on that AT's skills only while it is on. Replaces guessed ±0.3.
- **Checked against TrainingPredictor v5 (2010):** per-session gain by potential (Terrible 0.004–0.048 … World Class 0.436–0.48, steps of 0.048) and ×0.75 a year from 21 agree with our measured GROWTH once staff/fitness factors are applied, and with the manual's −25%/year. Its AT skill pairs match evalATs except Low Pressing, where the manual's specialist (+2 tackling, −2 speed) backs our slower-side rule. RankingPointsCalc is national-team ranking only.

## 2026-11-08 — no change (v0.14.0 stays)
- **Data:** no fresh harvest (browser pane closed); local data unchanged since 01/11 — 99 reports, 2 decisions, 1 graded match (model Brier 0.001 vs pundits 0.639).
- **Refit:** identical (robust BASE 6, K_BEAT 1.5, K_GK 1, K_MID 8; −253.6 vs −455.2 constant-rate).
- **Not changed:** v0.13/v0.14 shipped today from in-browser data (availability, condition, rating ratios, shape and lane learning); nothing new offline to test them against. Weather still <30 games per condition; advanced tactics still confounded by team strength.
- **Watch:** open the browser pane signed in to pmanager.org before the next run so the 07/11 Umtata game, the Cup QF and new rounds can be harvested and the v0.13/v0.14 changes graded.

## 2026-11-05 — no change (v0.12.0 stays)
- **Data:** no fresh harvest (browser pane closed); local data unchanged since 01/11 — 99 reports, 2 decisions, 1 graded match (model Brier 0.001 vs pundits 0.639).
- **Refit:** identical (robust BASE 6, K_BEAT 1.5, K_GK 1, K_MID 8; −253.6 vs −455.2 constant-rate).
- **Not changed:** no new evidence; weather still <30 games per condition, advanced tactics confounded by team strength, calibration can't be judged on 1 graded match. The in-browser learner keeps refitting on the user's side.
- **Watch:** open the browser pane signed in to pmanager.org before the next run so the Cup QF, the Greater Tzaneen MOTS game and the new rounds can be harvested and graded.

## 2026-11-08 — v0.14.0 (match commentary)
- **Data:** every report's commentary is now parsed — each attacking move credited to the side of its first-named player and the lane of that side's last-named outfielder (the finisher), goals per lane, finishers per player, and the advanced-tactic confirmations ("able to use their long shots ability", "keeper's style is confusing the forwards", "marking style working", "lacking strength", "winning one-on-ones"...). 86 division reports re-read: 472 moves, 217 of 363 goals (substitutes aren't on the report's pitch, so their moves are missed).
- **Found:** attacks pile into a side's strongest lane far more than assumed. Lane share ∝ (attack + 0.25·midfield)^4 fits 71 performances with log-lik −342.8 vs −389.7 for the old (attack + 0.5·midfield)^2 and −490 uniform; an extra right-side bias adds nothing once the exponent is 4 (right attack zones average 5.78 vs left 5.30, centre 3.14). Goal likelihood unchanged (−234.8 vs −234.4) — lanes decide where chances come from, not how many.
- **Changed:** goalRate's lane split uses learned LANE_EXP / LANE_MID (`learnLanes`, refit with the model; `model/fit.js` mirrors it). Opponent card shows where they attack (e.g. Pretoria: right 47% · centre 26% · left 26%, last 6 games).
- **Watch:** use the AT confirmations to grade our advanced-tactic calls; credit substitutes' moves.

## 2026-11-08 — v0.13.0 (availability, condition, own rating, formation learning)
- **Bug:** injured and suspended players were never excluded — Emerson (injured 3 days) was in the XI for 11/11. The squad page's status icons are now read; anyone still out on match day is left out. Unhappiness is read from the same icons.
- **Last match (07/11, 3–0 vs Umtata):** played 5-2-3 without Brekhun, Farag, Dziadzio, Šeremet (all 100% fit) — not the engine's XI. The autopilot only runs while a pmanager tab is open, so orders for that match were most likely never saved. Baez off at 59' was a plain substitution, not an injury and not one of the engine's events.
- **Condition (data):** the game's Affected Quality for all 17 players fits AQ = Q·exp(0.040·form step + 0.029·experience grade − 0.33·(1−happiness) − 0.47·(1−fitness)), rmse 1.5%. That replaces the hand-set form/fitness factors (form was read on the wrong scale: "Normal" was ignored). Happiness capped at −6% (one unhappy player in the fit; manual: minor, with a floor).
- **Team integration (manual §13–14):** worth 0.5–1 star on every zone, average of the XI; new signings start at zero (Brekhun: Terrible). Now added to our zones relative to a well-integrated XI.
- **Own rating (data):** our 17 reports regressed zone stars on the average primary / secondary / physical skill of our players in each zone (122 readings, R² 0.63): +0.35 star per primary point; secondaries −0.15 and physicals −0.02 of a primary (80% ranges −0.33…0.03 and −0.27…0.23) — the engine leans on primaries more than the game's Quality (0.37 / 0.13). Ratings now learn these ratios, shrunk toward Quality (300-reading prior): today 0.26 / 0.09. Used for our squad and the transfer list alike.
- **Formations (data):** goals for/against vs the model by shape across 77 division reports, shrunk toward 1 (8-goal prior): 3-4-3 att ×1.18 (n21), 5-2-3 def ×1.13 conceded (n18), 4-4-2 att ×1.06 (n38), 5-4-1 def ×0.88 (n7). Applied to both sides in every simulation.
- **Autopilot:** re-runs every 30 min while a pmanager tab is open, so orders don't go stale.
- **Watch:** the rating ratios as our reports grow; shape effects with small n; parse commentary (chances by player/lane, AT confirmations) next.

## 2026-11-04 — v0.12.0 (Match of the Season)
- **Rules (manual §13–14, §20):** MOTS adds "almost a whole star" to every zone, Play it Cool takes as much off; 2 MOTS per season, reset after the playoffs; league + cup, not friendlies; a MOTS defeat hurts morale badly; players tire ~1% more (league MOTS 3/4/5% by age vs 2/3/4%). Our own reports don't show attitude; `prox_adv.asp` shows the opponent's MOTS used.
- **Changed:** attitude is now ±0.9 stars on every zone (was ±8% goal rate). Season planner: every remaining league/cup fixture rated (opponent zones from their reports), gain = points with MOTS − without − 0.5 pt × P(loss with MOTS); MOTS goes to the top fixtures for the MOTS left, set on the orders page (`Team_attitude`) by the orders autopilot, and counted per season (user can correct 0/1/2).
- **Fixed:** win/draw/loss lost the probability beyond 10 goals (heavy favourites showed 97/1/0, and MOTS looked worse vs weak sides) — wins now take the tail. Next match home/away came from the pundits' line, which doesn't always list the home side first: today's away game at Greater Tzaneen was planned as a home game; fixtures now decide (odds swapped to match).
- **Today:** @ Greater Tzaneen (round 13) 84% → 96% with MOTS (+0.27 pts) and vs Qwa-Qwa Bears (round 18, +0.24) are the two picks; the rest are near-certain wins already.
- **Watch:** the morale cost of a MOTS defeat (prior 0.5 pt); whether opponents' MOTS use predicts their big games.

## 2026-11-04 — v0.11.4 (ratings matched to the game's Quality)
- **Data:** the game's Quality number for 17 players (our squad's `data-q` + Dobeš) fits Quality = 6.2 + 1.41·Σprimaries + 0.52·Σsecondaries + 0.19·Σphysicals with r = 0.999 (max error ~1 point). A secondary counts 37% of a primary, a physical 13%; our weights had 48% and 37% (physicals ~3× too heavy). Old ratings correlated 0.958 with Quality.
- **Changed:** position weights → primaries 0.333, secondaries 0.123, physicals 0.044 (GK: 0.365 / 0.135), still summing to 1. Wrong-side penalty 14% → 10% (manual §7: "small penalty"; magnitude unmeasured).
- **Checked (user question):** Dobeš (28, F RLC, 19/19, Hea 9, Pos 5) vs Zottelin (22, F L only, 20/20, Hea 1, Pos 3): same footing 14.95 vs 14.3 (game Quality 70 vs 67); at RF Zottelin is out of side → 12.9. We have no right-sided forward, so one of the left-footers always plays RF.
- **Watch:** wrong-side penalty size; professionalism's effect on 27–31 decline (Dobeš: Very Bad).

## 2026-11-04 — v0.11.3 (promotion push)
- **Goal (user):** upgrade a weak squad to win promotion; incremental upgrades welcome; every buy must stay at least this season + next (reselling quickly loses money in auctions).
- **Changed:** age limit 32 → 31 everywhere (at 32 a player has a 45% chance of retiring before next season in our prior); Best value now accepts smaller upgrades (5-season gain > 1, was 1.5). Short-term fixes = 30–31.

## 2026-11-04 — v0.11.2 (empty recruitment board)
- **Problem:** at 20% of funds every list was empty. (1) Each line read only the top 90 by main skill — elite players whose asks look cheap but whose fees (≈ half their Value) are far above a small cap. (2) The price model learned from 15 game Values, all of shortlisted (expensive) players, so it priced nearly every listing at ~$1M — even 32-year-olds asking $10k — and cheap listings never got their real Value fetched.
- **Changed:** per line, a second "band" search (main skill ≤ our weakest starter's +4), an age limit (≤32) on searches, 3 free-agent pages; the 15 biggest upgrades whose ask fits the cap get their real Value read every scan; the price model needs 25 Values and has a decline term from 27. New **Bid up to your cap** list: ask fits, expected fee doesn't — chance to win at the cap from the fee spread (log-normal around 0.5× Value, log-sd 1.15 from completed transfers: median 0.46, p90 ~2×).
- **Found:** 39 real Values — every player who improves our XI is valued ≥ ~$950k (10th pct), so ≈ $475k+ expected fee. At 20% (≈$321k) only free agents are sure buys; e.g. Gadocha (24, RF, +10.2 over 5 seasons) ~45% at $321k.
- **Watch:** record winning fees vs Value per bracket to replace the spread prior.

## 2026-11-04 — v0.11.1 (no retiring veterans)
- **Problem:** Best value was full of 36–37-year-old free agents. Their only gain is this season (they retire, and past 31 they lose skill after every training — manual §7–8), but this season counted in full against a ~$12k signing fee.
- **Changed:** this season counts only for our unplayed league rounds; chance of still playing 30–31 90%, 32 75%, 33 55%, 34 30%, 35+ 0; nobody over 32 on any list or market badge (must likely be here next season). Short-term fixes = 30–32.

## 2026-11-04 — v0.11.0 (academy speciality & youth team)
- **Rules (manual §8–10, academy page):** a speciality costs $1,000,000 once (page) + upkeep ≈ 2× the academy's weekly cost (manual: +€60k vs €30k for World Class → ≈ $30k/week here). Promoted youth get 10–20 in that skill; other non-physical skills cap at 8 (10 without); one change per season. Youth team = academy 17–18s, no matches, full training every league round; main-squad non-players get a penalty (nothing after cups/friendlies); B team max 16, reduced training, none from 22. No PM-specific community advice found (forums/Reddit/web).
- **Changed:** speciality value = Σ over random youth positions of the skill's weight (Positioning 4.6 main-skill pts/youth > Tackling = Passing 3.8 > Heading 3.1; GK skills lowest) × 10 promotions × 50% kept × $40k/pt ≈ $0.93M/season vs $0.59M cost (upkeep + fee over 5 seasons). Autopilot sets it once a season, before promotions, only with funds ≥ fee + a season of upkeep + buffer (now: need $1.87M, have $1.60M → saving). Youth-eligible players outside the XI go back to the youth team (keeps 14 players and a spare keeper — Osman stays for now as the only backup GK).
- **Watch:** the real speciality upkeep after it is set, and whether promoted positions follow the speciality (would change the pick).

## 2026-11-04 — v0.10.0 (age & resale)
- **Foreign players:** no starting-XI limit — the manual has none (the "Foreign Managers" rule is about which countries a manager may take a second team in), the Academy page shows "Minimum Number of National Players: No Limits", and the current XI is mostly non-national with no warning. Federations may add country rules by referendum later, so the script now reads that field and warns if it changes.
- **Changed:** recruitment ranks Best value on **net** cost = expected fee − discounted resale after 3 seasons (share by age at sale: ≤24 100%, 25–26 85%, 27–28 60%, 29–30 35%, 31–32 15%, 33+ 0) + a season of wages. Best buys capped at age 29 by default (switch ≤25 / ≤29 / any); older players appear only as labelled short-term fixes under Best value.
- **Watch:** replace the resale prior with real sale prices by age from transfer history.

## 2026-11-04 — v0.9.0 (training history)
- **Tracking:** every training session's exact gain per player (deduped by player + session date, with skill level, age, potential and the staff factor that applied) plus a daily skill snapshot — kept in the browser (`db.history`), up to 300 sessions / 180 days per player.
- **Changed:** projections use each player's own measured rate (blended with his grade's rate, prior = 5 sessions) and our real training conditions: share of a full session = staff level on the staff skill, 75% otherwise (84% today). Market players are projected with their grade's calibrated rate × the same factor, so buys and our squad are judged on the same training. SESSIONS = 20 full sessions/season (18 league + half-strength cups), multiplied by that factor.
- **Peak age:** kept at 26 — manual §8: progression −25%/yr from 21, losses possible from 27 (certain after 31). Revisit if tracked data shows growth stalling earlier.
- **Watch:** first per-player rates after a few league sessions; compare measured vs grade (Training → Progress).

## 2026-11-04 — v0.8.0 (recruitment)
- **Data:** live market scan — 748 listings (each line: ready upgrades filtered by our starters' main skills + under-22 prospects, plus the free-agent list), 22 game Values; 120 completed transfers from `ttransfer.asp`.
- **Found:** a listing's ask is only an auction floor (e.g. ask $75k, Value $774k). Completed transfers went for a median 0.46× the player's Value (0.66 under $250k, 0.50 at $250–750k; wide spread, p90 2×). Caveat: that page is our club's history and "Player Value" is today's value, so older deals skew low.
- **Changed:** expected cost = max(ask, 0.5 × Value) + a season of wages (free agents: 12-week signing fee); price model learns from game Values once 12+ are known. Retirement from 30 weights future seasons (0.85 → 0.6 → 0 from 35). Slot importance measured from the match model (+1 rating → expected points): LB ×2.2, LF ×2.0, GK ×1.9, RF ×1.6, CF ×1.3, midfield/CDs ×0.2–0.5 vs this opponent. Scout tab: Best buys (3) + Best value (3), one per position; Worth saving for (2); By position ordered by importance. Autopilot rescans every 12 h.
- **Watch:** learn the auction ratio from real outcomes (record Value at scan time, read the winning fee later).

## 2026-11-03 — no change (v0.7.0 stays)
- **Data:** no fresh harvest (browser pane closed); identical to 02/11 — 99 reports, 2 decisions, 1 graded match (model Brier 0.001 vs pundits 0.639).
- **Refit:** unchanged (robust BASE 6, K_BEAT 1.5, K_GK 1, K_MID 8; −253.6 vs −455.2 constant-rate).
- **Not changed:** nothing new to test; weather still <30 games per condition, advanced tactics still confounded by team strength. Most players show 0.00 skill points/week only because player histories span 2 days.
- **Watch:** the Cup QF at SAPredatorians (02/11) needs a harvest to be graded — open the browser pane signed in to pmanager.org before the next run.

## 2026-11-02 — no change (v0.7.0 stays)
- **Data:** no fresh harvest (browser pane closed); same 99 reports, 2 decisions, 1 graded match (5–0 vs Nacional, model Brier 0.001 vs pundits 0.639).
- **Checked:** residual home advantage on top of the zone ratings. Raw home/away goals 2.70/1.74, but the model already expects 258/186 vs 267/172 observed; a home multiplier H on the released set gives log-lik −253.58 (H=1) vs −253.44 (H=1.1) — no real gain, so zones already carry home/crowd. Refit unchanged (robust BASE 6, K_BEAT 1.5, K_GK 1, K_MID 8).
- **Not changed:** weather still 11–21 games per condition (<30); advanced-tactic usage is confounded by team strength; forecast calibration can't be judged on 1 graded match.
- **Watch:** grade the Cup QF at SAPredatorians (02/11) once harvested; revisit weather at 30+ games per condition.

## 2026-11-01 — v0.6.1
- **Data:** 99 division reports (+32 since 30/10), 9 opposing teams, 16 player histories (2 days).
- **Result:** Joburg Vikings 5–0 C.A. Nacional (31/10). Forecast 97% / 2% / 0% (xG ≈ 4–0); pundits 36% / 43% / 21%. Plan played: 10/11 of the planned XI, Defensive/Short. Nacional switched to 4-4-2 (usually 5-3-2).
- **Refit on 99 games:** BASE 6, K_BEAT 1.5, K_GK 1, K_MID 8 (log-lik −253.6 vs −455.2 constant-rate). Goalkeeper quality keeps mattering most; midfield control matters little once passing style is accounted for.
- **Growth table:** first observed sessions for Very Bad…Excellent; still mostly priors.
- **Changed:** forecast grading now compares the actual starting XI (the game's own shape labels differ from ours, e.g. "5-2-3").
- **Watch:** weather (6 conditions, ~15 games each) — not modelled yet; revisit at 30+ games per condition. Same for advanced tactics (most sides leave them off).
