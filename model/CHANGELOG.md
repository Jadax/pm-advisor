# PM Copilot — learning log

Newest first. Written by the daily review (and by hand) whenever the data changes the engine.

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
