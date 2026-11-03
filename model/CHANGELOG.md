# PM Copilot — learning log

Newest first. Written by the daily review (and by hand) whenever the data changes the engine.

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
