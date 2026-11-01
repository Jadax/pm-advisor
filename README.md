# ⚽ PM Copilot

Made with ❤ by Tushant Sharma

A Tampermonkey userscript for [Planetarium Manager](https://www.pmanager.org) that prepares every match for you — lineup, tactics, match events, lecture — and gets better at it after every game. Plus training, transfers, contracts, staff and facilities advice backed by numbers, not guesses.

## 🚀 Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. 👉 **[Install PM Copilot](https://raw.githubusercontent.com/Jadax/pm-advisor/main/pm-copilot.user.js)** — Tampermonkey opens an install prompt.
3. Log in to pmanager.org. The **PM** pill (bottom right, or **Alt+P**) opens the panel. On first load it reads everything it needs (≈30 s).

Updates install themselves (Tampermonkey checks GitHub; *Utilities → Check for userscript updates* to force it).

## ✨ What it does

| Tab | |
|---|---|
| **Match** | Match-prep checklist; best formation, XI, style and passing across ~1000 combinations; opponent's real engine zone ratings, last-20 formations, tired players; every advanced tactic checked against the in-game rules; attitude, captain, penalty taker, alternatives. |
| **Squad** | Ratings, fitness, form, projected rating at 26, contract years; contracts needing attention. |
| **Training** | Best individual and staff training per player. |
| **Club** | Finances vs wage roof; staff Hire/Keep/Skip from live wages; stadium, academy, sponsor advice. |
| **Scout** | Any transfer search ranked for your team (Now · @26 · 5-season gap vs the starter he'd replace) with Buy/Develop/Skip badges in the game's table. |
| **Auto** | Autopilot switches, activity log, **What I've learned**. |

## 🤖 Autopilot (each switch on by default)

On any pmanager page it keeps the next match prepared: match orders (saved), match events (your own events are never touched), the best-expected-value lecture, training, and renewals of keepers at their minimum asked wage within the wage roof. Bids, purchases, staff hires and facility builds stay advice only.

## 🧠 How it learns

Everything happens in your browser:

1. **Match database** — once a day it reads every match report in your division: both teams' engine zone ratings, formations, styles, advanced tactics, weather, score.
2. **Self-calibration** — it refits its match model on that database (Poisson likelihood; the smoothest parameters that fit as well as the best) and its training-growth rates from your players' exact per-session gains.
3. **Graded forecasts** — before each match it records the plan and the forecast; after it, it grades the forecast against the result and against the pundits. See **Auto → What I've learned**.

Code improvements ship through this repo and reach you automatically.

## 📐 The model, briefly

- **Ratings**: weighted position skills (main ×2 secondary, small physical weight) × position/side fit × fitness × form × experience, converted to engine "stars".
- **Opponent**: their skills are hidden, so it uses the engine's own zone ratings from their recent matches, their usual shape, quality grades and anything your scout has observed.
- **Goals**: lane-by-lane attack vs defence, keeper, midfield and passing style → expected goals → win/draw/loss. Shown odds lean 25% on the pundits.
- **Player value**: growth by potential grade, −25%/year from 21, skill loss from 27; compared at 26 and over five seasons so a 17- and a 24-year-old are judged fairly.

## 🛠 For development

`CLAUDE.md` has the rules, file map and invariants. Optional offline tools: `tools/harvest.js` (read-only crawl into `data/`, via `tools/server.py`), `model/fit.js` (refit + report in `model/report.md`), `tools/release.js`. Check before shipping: `node --check pm-copilot.user.js`.

## 📄 License

MIT
