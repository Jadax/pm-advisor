/* PM Copilot harvester — runs inside a signed-in pmanager.org tab (Claude's browser pane).
 *
 * Loads pm-copilot.user.js from the local data server with an isolated in-memory store and
 * every automation switched OFF (it only reads), crawls the game, and writes JSON into data/:
 *   data/reports/<gameId>.json   every report in the division (+ cups/friendlies of those teams)
 *   data/raw/<gameId>.html       trimmed report HTML, so new fields can be re-extracted later
 *   data/teams/<teamId>.json     roster grades, fixtures, last-20 formations, manager
 *   data/scouting/<playerId>.json  opponent skills our scout has observed
 *   data/players/<playerId>.jsonl  our players over time (one line per harvest day)
 *   data/club/<YYYY-MM-DD>.json  economy, club, staff, contracts, lecture, events, training
 *   data/decisions.jsonl         plan + forecast for the next match (graded later by model/fit.js)
 *
 * Progress: window.__harvest = { log: [...], done, error }
 */
(async () => {
  const BASE = 'http://localhost:8765';
  const H = (window.__harvest = { log: [], done: false, error: null, started: Date.now() });
  const say = m => { H.log.push(m); H.status = m; };
  const net = { targetAddressSpace: 'local' };
  const post = (path, content, append = false) =>
    fetch(BASE + '/save', { ...net, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content, append }) })
      .then(r => r.json()).then(r => { if (!r.ok) throw new Error(r.error); return r; });
  const listDir = dir => fetch(`${BASE}/list?dir=${encodeURIComponent(dir)}`, net).then(r => r.json());
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1) load the userscript read-only
    const store = { pmc_db_v2: JSON.stringify({ prefs: { autoRefresh: false, autoApply: false, autoSave: false, autoEvents: false, autoLecture: false, autoTraining: false, autoRenew: false, autoLearn: false, autoSaveDefaulted: true } }) };
    Object.assign(window, {
      GM_getValue: (k, d) => (k in store ? store[k] : d), GM_setValue: (k, v) => { store[k] = v; },
      GM_deleteValue: k => delete store[k], GM_setClipboard: () => {}, __PMC_TEST: {},
    });
    document.getElementById('pm-copilot')?.remove();
    (0, eval)(await fetch(BASE + '/pm-copilot.user.js', net).then(r => r.text()));
    const api = window.__PMC_TEST.api;
    document.getElementById('pm-copilot')?.remove(); // no UI needed
    const db = api.db;

    // 2) our club + next opponent
    say('own club…');
    await api.refreshAll(say);
    say('scouting next opponent…');
    try { await api.scoutOpponent(say); } catch (e) { say('scout: ' + e.message); }

    // 3) every team in the division
    say('division…');
    const { doc: st } = await api.fetchDoc('/classificacao.asp');
    const teams = [...new Map([...st.querySelectorAll('a[href*="ver_equipa.asp?equipa="]')]
      .map(a => [a.getAttribute('href').match(/equipa=(\d+)/)[1], a.textContent.trim()])).entries()];
    for (const [id, name] of teams) {
      say(`team ${name}…`);
      try { await api.grab(`/ver_equipa.asp?equipa=${id}`, { teamName: name }); } catch (e) { say(`${name} info: ${e.message}`); }
      try { await api.grab(`/ver_equipa.asp?equipa=${id}&vjog=1`, { teamName: name }); } catch (e) { say(`${name} players: ${e.message}`); }
      try { await api.grab(`/calendario.asp?action=equipa&equipa=${id}`, { teamName: name }); } catch (e) { say(`${name} fixtures: ${e.message}`); }
      await sleep(120);
    }

    // 4) every report not on disk yet
    const have = new Set((await listDir('data/reports')).map(f => f.replace(/\.json$/, '')));
    const ids = new Set();
    (db().fixtures?.list || []).forEach(f => f.reportId && ids.add(f.reportId));
    Object.values(db().teams).forEach(t => (t.fixtures || []).forEach(f => f.reportId && ids.add(f.reportId)));
    const todo = [...ids].filter(id => !have.has(id));
    let n = 0;
    for (const id of todo) {
      n++;
      say(`report ${n}/${todo.length}…`);
      try {
        const { doc, url } = await api.fetchDoc('/relatorio.asp?jogo_id=' + id);
        api.ingest(doc, url);
        const r = db().reports[id];
        if (r) await post(`data/reports/${id}.json`, r);
        const keep = ['.match-report-box', '#seleven', '#stats', '#ratings'].map(s => doc.querySelector(s)?.outerHTML || '').join('\n');
        await post(`data/raw/${id}.html`, `<!-- relatorio.asp?jogo_id=${id} -->\n${keep}`);
      } catch (e) { say(`report ${id}: ${e.message}`); }
      await sleep(120);
    }
    // our own reports already parsed during refresh also go to disk
    for (const [id, r] of Object.entries(db().reports)) if (!have.has(id) && !todo.includes(id)) await post(`data/reports/${id}.json`, r);

    // 5) teams
    for (const t of Object.values(db().teams)) if (t.id) await post(`data/teams/${t.id}.json`, { ...t, harvestedAt: today });

    // 6) scouting: opponent players' observed skills
    const opp = db().next && (db().next.weAreHome ? db().next.away : db().next.home);
    const oppTeam = Object.values(db().teams).find(t => t.name === opp);
    for (const p of oppTeam?.roster || []) {
      say(`scouting ${p.name}…`);
      try { await api.grab('/ver_jogador.asp?jog_id=' + p.id); } catch (e) { /* skip */ }
      const s = db().scouted?.[p.id];
      if (s) await post(`data/scouting/${p.id}.json`, { ...s, team: opp, name: p.name });
      await sleep(100);
    }

    // 7) our players as a time series, one line per harvest
    const tr = db().training?.rows || [];
    for (const p of db().squad?.players || []) {
      const t = tr.find(x => x.id === p.id) || {};
      const d = db().details?.[p.id] || {};
      await post(`data/players/${p.id}.jsonl`, { date: today, name: p.name, age: p.age, line: p.line, sides: p.sides, sk: p.sk, fit: t.fit, quality: t.quality, potential: t.potential, training: t.training, last: t.last, form: d.form, experience: d.experience, professionalism: d.professionalism, health: d.health, happiness: d.happiness }, true);
    }

    // 8) club snapshot
    const D = db();
    await post(`data/club/${today}.json`, { me: D.me, economy: D.economy, club: D.club, staff: D.staff, staffPrices: D.staffPrices, contracts: D.contracts, lecture: D.lecture, events: D.events, training: D.training && { current: D.training.current, staff: D.training.staff, lastDate: D.training.lastDate }, academy: D.academy, stadium: D.stadium, sponsors: D.sponsors, next: D.next, fixtures: D.fixtures });

    // 9) decision record: what the advisor recommends for the next match, and its forecast
    if (D.next) {
      const plan = api.computePlan();
      if (!plan.error) {
        const b = plan.best;
        await post('data/decisions.jsonl', {
          at: new Date().toISOString(), match: { date: D.next.date, home: D.next.home, away: D.next.away, comp: D.next.comp }, weAreHome: D.next.weAreHome,
          version: window.__PMC_TEST.version || null, pundits: D.next.odds,
          plan: { formation: `${b.f.D.n}-${b.f.M.n}-${b.f.F.n}`, slots: b.xi.map(x => ({ code: x.slot.code, id: x.p.id, name: x.p.name, score: +x.score.toFixed(2) })), style: b.style, passing: b.passing, ats: b.ats, pref: plan.pref, captain: plan.captain?.p.name, pens: plan.pens?.p.name },
          forecast: { w: b.r.w, d: b.r.d, l: b.r.l, xgFor: b.r.xgFor, xgAg: b.r.xgAg },
          opponent: { source: plan.opp?.source, form: plan.opp?.form, style: plan.opp?.style, passing: plan.opp?.passing, z: plan.opp?.z },
          ourZones: b.z, cal: plan.cal,
        }, true);
      }
    }
    say(`done: ${todo.length} new reports, ${teams.length} teams`);
    H.summary = { newReports: todo.length, teams: teams.length, reportsKnown: ids.size };
  } catch (e) {
    H.error = e.message;
    say('ERROR ' + e.message);
  } finally {
    H.done = true;
  }
})();
