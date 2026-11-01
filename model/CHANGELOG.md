# PM Copilot — learning log

Newest first. Written by the daily review (and by hand) whenever the data changes the engine.

## 2026-11-01 — v0.6.1
- **Data:** 99 division reports (+32 since 30/10), 9 opposing teams, 16 player histories (2 days).
- **Result:** Joburg Vikings 5–0 C.A. Nacional (31/10). Forecast 97% / 2% / 0% (xG ≈ 4–0); pundits 36% / 43% / 21%. Plan played: 10/11 of the planned XI, Defensive/Short. Nacional switched to 4-4-2 (usually 5-3-2).
- **Refit on 99 games:** BASE 6, K_BEAT 1.5, K_GK 1, K_MID 8 (log-lik −253.6 vs −455.2 constant-rate). Goalkeeper quality keeps mattering most; midfield control matters little once passing style is accounted for.
- **Growth table:** first observed sessions for Very Bad…Excellent; still mostly priors.
- **Changed:** forecast grading now compares the actual starting XI (the game's own shape labels differ from ours, e.g. "5-2-3").
- **Watch:** weather (6 conditions, ~15 games each) — not modelled yet; revisit at 30+ games per condition. Same for advanced tactics (most sides leave them off).
