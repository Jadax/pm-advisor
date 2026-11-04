// ==UserScript==
// @name         PM Copilot — Planetarium Manager assistant
// @namespace    pm-copilot
// @version      0.11.0
// @description  Opponent-aware tactics, match prep autopilot, training, transfers, finance and facilities for pmanager.org — learns from every match. Changelog: github.com/Jadax/pm-advisor
// @author       Tushant Sharma
// @license      MIT
// @match        https://www.pmanager.org/*
// @match        http://www.pmanager.org/*
// @match        https://pmanager.org/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/Jadax/pm-advisor/main/pm-copilot.user.js
// @downloadURL  https://raw.githubusercontent.com/Jadax/pm-advisor/main/pm-copilot.user.js
// @supportURL   https://github.com/Jadax/pm-advisor/issues
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const VERSION = '0.11.0';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  /* =========================================================================
   * Utilities
   * ======================================================================= */
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const avg = a => (a.length ? sum(a) / a.length : 0);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt$ = v => (isFinite(v) ? (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US') : '—');
  const pct = v => (isFinite(v) ? Math.round(v * 100) + '%' : '—');
  const f1 = v => (isFinite(v) ? v.toFixed(1) : '—');

  // PM uses European formatting: "1.504.160" thousands, "0,132" decimals.
  function num(s) {
    if (s == null) return NaN;
    let t = String(s).replace(/[^\d.,\-+]/g, '').replace(/[.,]+$/, '');
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const v = parseFloat(t);
    return isNaN(v) ? NaN : v;
  }

  function ago(ts) {
    if (!ts) return 'never';
    const m = Math.round((now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }

  // Visible text tokens in document order (selects contribute their selected option).
  function leafTexts(root) {
    const out = [];
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) {
          const t = clean(c.textContent);
          if (t) out.push(t);
        } else if (c.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(c.tagName)) {
          if (c.tagName === 'SELECT') {
            const o = c.options[c.selectedIndex];
            if (o && clean(o.textContent)) out.push(clean(o.textContent));
          } else walk(c);
        }
      }
    };
    if (root) walk(root);
    return out;
  }
  const docText = root => leafTexts(root).join('\n');
  const flatText = root => clean(root?.textContent);
  const cellText = c => {
    const sel = c.querySelector && c.querySelector('select');
    if (sel) return clean(sel.options[sel.selectedIndex]?.textContent);
    return clean(c.textContent);
  };
  const rowCells = row => (row.tagName === 'TR' ? Array.from(row.cells) : Array.from(row.children));
  const hrefOf = a => {
    try { return new URL(a.getAttribute('href'), location.origin + '/').href; } catch { return null; }
  };
  const param = (href, ...keys) => {
    try {
      const u = new URL(href, location.origin + '/');
      for (const k of keys) if (u.searchParams.get(k)) return u.searchParams.get(k);
    } catch { /* ignore */ }
    return null;
  };
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* =========================================================================
   * Storage
   * ======================================================================= */
  const KEY = 'pmc_db_v2';
  const blankDb = () => ({ me: {}, teams: {}, reports: {}, teamLinks: {}, details: {}, prefs: { excluded: [], objective: 'points', tab: 'match', autoRefresh: true, autoApply: true, autoSave: true, autoEvents: true, autoLecture: true, autoTraining: true, autoRenew: true, autoLearn: true, autoSpeciality: true, autoYouth: true } });
  let db;
  try { db = Object.assign(blankDb(), JSON.parse(GM_getValue(KEY, '{}'))); } catch { db = blankDb(); }
  db.prefs = Object.assign(blankDb().prefs, db.prefs);
  if (!db.prefs.autoSaveDefaulted) { db.prefs.autoSave = true; db.prefs.autoSaveDefaulted = true; } // auto-save became the default in 0.3.0
  let dataVersion = 0;
  const save = () => { dataVersion++; GM_setValue(KEY, JSON.stringify(db)); };

  /* =========================================================================
   * Game knowledge (manual + in-game tactic help)
   * ======================================================================= */
  const SKILLS = ['HAN', 'CRO', 'REF', 'AGI', 'TCK', 'HEA', 'PAS', 'POS', 'FIN', 'TEC', 'SPE', 'STR'];
  const SKILL_NAME = { HAN: 'Handling', CRO: 'Out of Area', REF: 'Reflexes', AGI: 'Agility', TCK: 'Tackling', HEA: 'Heading', PAS: 'Passing', POS: 'Positioning', FIN: 'Finishing', TEC: 'Technique', SPE: 'Speed', STR: 'Strength' };
  // Main attributes weigh double the secondary ones; physicals count a little for outfielders.
  const ROLE_W = {
    GK: { HAN: 0.3, CRO: 0.3, REF: 0.2, AGI: 0.2 },
    D: { TCK: 0.27, HEA: 0.27, PAS: 0.13, POS: 0.13, SPE: 0.1, STR: 0.1 },
    M: { PAS: 0.27, POS: 0.27, TCK: 0.13, TEC: 0.13, SPE: 0.1, STR: 0.1 },
    F: { FIN: 0.27, TEC: 0.27, HEA: 0.13, POS: 0.13, SPE: 0.1, STR: 0.1 },
  };
  const LINE_ORDER = { GK: 0, D: 1, M: 2, F: 3 };
  const LANES = ['L', 'C', 'R'];
  const MIRROR = { L: 'R', C: 'C', R: 'L' };
  const DENOMS = ['Terrible', 'Very Bad', 'Bad', 'Low', 'Passable', 'Good', 'Very Good', 'Excellent', 'Formidable', 'World Class'];
  const DENOM_RE = new RegExp('^(?:[↑↓–—\\-+]\\s*)?(' + DENOMS.slice().sort((a, b) => b.length - a.length).join('|') + ')$', 'i');
  const denomIdx = d => DENOMS.findIndex(x => norm(x) === norm(d));
  const SLOT_CODES = { D: { L: 'LB', C: 'CD', R: 'RB' }, M: { L: 'LM', C: 'CM', R: 'RM' }, F: { L: 'LF', C: 'CF', R: 'RF' } };
  const slotFromCode = code => {
    if (code === 'GK') return { line: 'GK', lane: 'C', code };
    for (const line of ['D', 'M', 'F']) for (const lane of LANES) if (SLOT_CODES[line][lane] === code) return { line, lane, code };
    return null;
  };
  const POS_RE = /^(GK|D|M|F)(?:\s*([RLC]{1,3}))?$/;
  const STYLES = ['Normal', 'Defensive', 'Attacking'];
  const PASSINGS = ['Short', 'Mixed', 'Long', 'Direct'];
  // How much possession (midfield) drives chance volume, and the extra risk of long balls.
  const PASS_FX = { Short: { w: 1, pen: 0 }, Mixed: { w: 0.6, pen: 0.02 }, Long: { w: 0.3, pen: 0.05 }, Direct: { w: 0.15, pen: 0.07 } };
  const STYLE_FX = { Normal: { d: 1, a: 1 }, Defensive: { d: 1.08, a: 0.93 }, Attacking: { d: 0.93, a: 1.08 } };
  // Rough main-skill level behind each quality grade (used for opponents, whose skills are hidden).
  const QUALITY_SKILL = { Terrible: 3, 'Very Bad': 5, Bad: 7, Low: 9, Passable: 12, Good: 14.5, 'Very Good': 17, Excellent: 19, Formidable: 20, 'World Class': 20 };

  /* =========================================================================
   * Generic grid detection (works for <table> and div-based grids)
   * ======================================================================= */
  function rowHits(row, want) {
    let n = 0;
    for (const c of rowCells(row)) if (want.has(clean(c.textContent).toUpperCase())) n++;
    return n;
  }
  function findHeaderRows(root, tokens, minHits) {
    const want = new Set(tokens.map(t => t.toUpperCase()));
    const found = [];
    for (const el of root.querySelectorAll('th,td,div,span,b,strong,a')) {
      if (el.children.length > 1) continue;
      if (!want.has(clean(el.textContent).toUpperCase())) continue;
      let row = el.closest('tr') || el.parentElement;
      for (let i = 0; i < 4 && row; i++) {
        if (rowHits(row, want) >= minHits) { if (!found.includes(row)) found.push(row); break; }
        row = row.parentElement;
      }
    }
    return found;
  }
  function gridRows(header) {
    if (header.tagName === 'TR') {
      const all = Array.from(header.closest('table').rows);
      return all.slice(all.indexOf(header) + 1);
    }
    const out = [];
    const n = rowCells(header).length;
    for (let s = header.nextElementSibling; s; s = s.nextElementSibling) {
      if (rowCells(s).length >= n * 0.6) out.push(s);
      else for (const c of s.children) out.push(c);
    }
    return out;
  }
  const headerTexts = h => rowCells(h).map(c => clean(c.textContent).toUpperCase());
  const playerLink = row => row.querySelector('a[href*="jog_id"],a[href*="ver_jogador"],a[href*="player"]');
  const playerId = a => (a ? (a.getAttribute('href').match(/(?:jog_id|jogador_id|id_jog|pid|player_id)=(\d+)/i) || [])[1] || null : null);

  function posFromTokens(toks) {
    for (let i = 0; i < toks.length; i++) {
      const m = toks[i].match(POS_RE);
      if (!m) continue;
      let sides = m[2] || '';
      if (!sides && /^[RLC]{1,3}$/.test(toks[i + 1] || '')) sides = toks[i + 1];
      return { line: m[1], sides: m[1] === 'GK' ? 'C' : sides, idx: i };
    }
    return null;
  }

  // Parses any skills table (own squad page, transfer list, scouted players...).
  function parseSkillPlayers(root) {
    const players = [];
    for (const hdr of findHeaderRows(root, SKILLS, 6)) {
      const ht = headerTexts(hdr);
      const order = [];
      let seen = false;
      ht.forEach(t => {
        if (!SKILLS.includes(t)) return;
        if (t === 'POS' && !seen) return; // first POS column = position, not positioning
        seen = true;
        order.push(t);
      });
      if (order.length < 6) continue;
      const nameIdx = ht.indexOf('NAME');
      const ageIdx = ht.indexOf('AGE');
      let group = null;
      for (const row of gridRows(hdr)) {
        const cells = rowCells(row);
        const texts = cells.map(cellText);
        if (cells.length < order.length) {
          const joined = texts.join(' ');
          if (/goalkeeper/i.test(joined)) group = 'GK';
          else if (/defender/i.test(joined)) group = 'D';
          else if (/midfielder/i.test(joined)) group = 'M';
          else if (/forward|attacker|striker/i.test(joined)) group = 'F';
          continue;
        }
        // longest run of 0..20 integers = the skill block
        let best = null;
        for (let i = 0; i < texts.length; i++) {
          let j = i;
          while (j < texts.length && /^\d{1,2}$/.test(texts[j]) && +texts[j] <= 20) j++;
          if (j - i >= order.length && (!best || j - i > best[1] - best[0])) best = [i, j];
          if (j > i) i = j;
        }
        if (!best) continue;
        const start = best[1] - order.length;
        const sk = {};
        order.forEach((k, i) => (sk[k] = +texts[start + i]));
        const link = playerLink(row);
        let name = link ? clean(link.textContent) : nameIdx >= 0 && cells.length === ht.length ? texts[nameIdx] : '';
        const toks = leafTexts(row);
        if (!name) name = toks.find(t => /[A-Za-zÀ-ž]{2,}/.test(t) && !POS_RE.test(t) && !/^[RLC]{1,3}$/.test(t)) || '?';
        const pos = posFromTokens(toks) || { line: group, sides: '' };
        let age = ageIdx >= 0 && cells.length === ht.length ? num(texts[ageIdx]) : NaN;
        if (!(age >= 15 && age <= 45)) age = num(texts.slice(0, start).find(t => /^\d{2}$/.test(t) && +t >= 15 && +t <= 45));
        players.push({ id: playerId(link), name, line: pos.line || group, sides: pos.sides || '', age: isFinite(age) ? age : null, sk });
      }
    }
    return players;
  }

  /* =========================================================================
   * Name matching (lineup shows "L d Santos", reports show "dos Santos")
   * ======================================================================= */
  const nameToks = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean);
  function nameScore(a, b) {
    const A = nameToks(a), B = nameToks(b);
    if (!A.length || !B.length) return 0;
    if (A.join(' ') === B.join(' ')) return 100;
    if (A[A.length - 1] !== B[B.length - 1]) return B.join(' ').startsWith(A.join(' ')) && A.join(' ').length > 5 ? 70 : 0;
    const ai = A.slice(0, -1), bi = B.slice(0, -1);
    if (!ai.length) return 50;
    let j = 0, ok = 0;
    for (const t of ai) {
      while (j < bi.length && !bi[j].startsWith(t)) j++;
      if (j < bi.length) { ok++; j++; }
    }
    return ok === ai.length ? 80 : 20;
  }
  function matchPlayer(name, list, id) {
    if (id) { const hit = list.find(p => p.id && String(p.id) === String(id)); if (hit) return hit; }
    if (!name) return null;
    let best = null, bs = 0, tie = false;
    for (const p of list) {
      const s = nameScore(name, p.name);
      if (s > bs) { best = p; bs = s; tie = false; } else if (s === bs && s > 0) tie = true;
    }
    return bs >= 50 && !(tie && bs < 80) ? best : null;
  }

  /* =========================================================================
   * Page parsers — each takes (doc, URL, ctx) and writes into db
   * ======================================================================= */
  function parseSquadPage(doc, u) {
    const players = parseSkillPlayers(doc.body);
    if (!players.length) return null;
    // tier from the row (0 main, 1 B team, 3 youth — the same codes as the page's equipa filter);
    // a "↓ Youth Team" link means he may still go back to the youth team (17–18, from our academy)
    for (const r of $$('tr.sq-row', doc)) {
      const p = players.find(x => x.id && x.id === playerId(playerLink(r)));
      if (!p) continue;
      p.tier = num(r.dataset.sq);
      p.toYouth = !!r.querySelector('a[href*="despromover"][href*="to=y"]');
    }
    const text = docText(doc.body);
    db.squad = { players, wagesSum: num((text.match(/Wages Sum\s*\$?\s*([\d.,]+)/i) || [])[1]), url: u.pathname + u.search, at: now() };
    save();
    return `Squad: ${players.length} players`;
  }

  function upsertTeam(id, name) {
    const key = id ? 't' + id : 'n' + norm(name);
    let t = db.teams[key] || Object.values(db.teams).find(x => (id && x.id === id) || (name && norm(x.name) === norm(name)));
    if (!t) t = db.teams[key] = { key, id, name };
    if (id) t.id = id;
    if (name && !/^Team \d/.test(name)) t.name = name;
    return t;
  }
  const teamByName = name => Object.values(db.teams).find(t => norm(t.name) === norm(name));
  const nameForTeamId = id => Object.entries(db.teamLinks).find(([, h]) => param(h, 'equipa') === id)?.[0];

  // ver_equipa.asp — team info (manager) or, with vjog=1, the player list (quality grades, no skills).
  function parseTeamPage(doc, u, ctx = {}) {
    const id = u.searchParams.get('equipa');
    if (!id) return null;
    const name = ctx.teamName || db.teams['t' + id]?.name || nameForTeamId(id) || 'Team ' + id;
    const team = upsertTeam(id, name);
    const mgr = (flatText(doc.body).match(/Place\s*Manager\s*(.+?)\s*(?:Vice-)?President/) || [])[1];
    if (mgr && !u.searchParams.get('vjog')) team.manager = clean(mgr);
    const rows = $$('tr.sq-row', doc).filter(r => playerLink(r));
    if (rows.length) {
      const hdr = rows[0].closest('table').rows[0];
      const ht = Array.from(hdr.cells).map(c => clean(c.textContent).toLowerCase());
      const at = k => ht.indexOf(k);
      const lastAt = k => ht.lastIndexOf(k);
      team.roster = rows.map(r => {
        const c = Array.from(r.cells).map(x => clean(x.textContent));
        const pos = posFromTokens(leafTexts(r.cells[0])) || {};
        const link = playerLink(r);
        return {
          id: playerId(link), name: clean(link.textContent), line: pos.line, sides: pos.sides || '',
          age: num(c[at('age')]), fitness: c[at('fitness')] || null, games: num(c[at('gam')]), avgRating: num(c[at('avg')]),
          goals: num(c[at('gls')]), quality: c[lastAt('quality')] || null, potential: c[lastAt('potential')] || null,
        };
      });
      team.rosterAt = now();
    }
    save();
    return rows.length ? `${team.name}: ${rows.length} players (quality only)` : `${team.name}: info`;
  }

  function parseTrainingPage(doc) {
    const trs = $$('tr', doc).filter(r => r.querySelector('select[name="atributos"]') && playerLink(r));
    if (!trs.length) return null;
    const options = new Set();
    const rows = trs.map(row => {
      const toks = leafTexts(row);
      const link = playerLink(row);
      const pos = posFromTokens(toks);
      const sel = row.querySelector('select[name="atributos"]');
      Array.from(sel.options).forEach(o => { if (o.value !== '-1') options.add(clean(o.textContent)); });
      const denoms = toks.filter(t => DENOM_RE.test(t)).map(t => t.match(DENOM_RE)[1]);
      const last = $$('.tr-last__row', row).map(x => ({ skill: clean(x.querySelector('span')?.textContent), delta: num(x.querySelector('b')?.textContent) }));
      return {
        id: row.dataset.jog || playerId(link), name: clean(link.textContent), line: pos?.line, sides: pos?.sides,
        age: num(toks.find(t => /^\d{2}$/.test(t) && +t >= 15 && +t <= 45)),
        fit: num(toks.find(t => /^\d{1,3}%$/.test(t))), quality: denoms[0] || null, potential: denoms[1] || null, evolution: denoms[2] || null,
        training: clean(sel.options[sel.selectedIndex]?.textContent), allowed: Array.from(sel.options).map(o => clean(o.textContent)), last,
      };
    });
    const text = docText(doc.body);
    // Staff box: manager, assistant and coaches, each with a quality (x/5) and a global training skill
    const staff = $$('.tr-staff .tr-card', doc).filter(c => !c.classList.contains('tr-card--empty') && c.querySelector('select[name="atributos"]')).map(c => {
      const s = c.querySelector('select[name="atributos"]');
      return { role: clean(c.querySelector('.tr-card__role')?.textContent), q: num((clean(c.querySelector('.tr-card__q b')?.textContent).match(/(\d)\s*\/\s*5/) || [])[1]), skill: clean(s.options[s.selectedIndex]?.textContent) };
    });
    db.training = {
      rows, options: [...options], staff,
      current: clean((text.match(/Current Training\s+([A-Za-z ]+?)\s*\n/i) || [])[1]),
      lastDate: (text.match(/Last Training\s+([\d/]+)/i) || [])[1] || null,
      at: now(),
    };
    recordGrowth(); // capture every session's gains as soon as the training page is read
    save();
    return `Training: ${rows.length} players`;
  }

  function parseEconomyPage(doc) {
    const text = docText(doc.body);
    const funds = num((text.match(/Available Funds\s*\$?\s*(-?[\d.,]+)/i) || [])[1]);
    if (!isFinite(funds)) return null;
    const items = {};
    const labels = ['Gate Receipts', 'Sponsors', 'Player Deals', 'Others', 'Wages and Bonus', 'Stadium Maintenance', 'Academy Maintenance', 'Total'];
    const counts = {};
    for (const el of doc.body.querySelectorAll('td,div,span,li')) {
      if (el.children.length > 2) continue;
      const lab = labels.find(l => clean(el.textContent) === l);
      if (!lab) continue;
      const row = el.closest('tr') || el.parentElement;
      const vals = leafTexts(row).filter(t => /\$/.test(t) || /^-?[\d.,]+$/.test(t)).map(num).filter(isFinite);
      if (vals.length < 2) continue;
      counts[lab] = (counts[lab] || 0) + 1;
      const side = ['Player Deals', 'Others', 'Total'].includes(lab) ? (counts[lab] === 1 ? 'in' : 'out') : ['Gate Receipts', 'Sponsors'].includes(lab) ? 'in' : 'out';
      items[side + ':' + lab] = { month: vals[0], year: vals[1] };
    }
    db.economy = { funds, month: num((text.match(/Current Month\s+(\d+)/i) || [])[1]), items, at: now() };
    db.me.funds = funds;
    save();
    return `Economy: funds ${fmt$(funds)}`;
  }

  function parseAcademyPage(doc) {
    const t = docText(doc.body);
    const q = (t.match(/Quality\s+(World Class|Excellent|Very Good|Good|Passable|Bad|None)/i) || [])[1];
    if (!q) return null;
    const m = re => num((t.match(re) || [])[1]);
    db.academy = {
      quality: q,
      speciality: clean((t.match(/Speciality\s+([A-Za-z ]+?)\s*\n/i) || [])[1]) || null,
      weekly: m(/Current weekly cost\s*\$?\s*([\d.,]+)/i),
      promoted: m(/Promoted Players\s+(\d+)/i),
      limit: m(/Promotions Limit\s+(\d+)\s*players/i) || m(/Promotions Limit\s+\d+\s*\/\s*(\d+)/i),
      // federations can add country rules by referendum (manual §25); "No Limits" today
      minNational: clean((t.match(/Minimum Number of National Players\s+([^\n]+)/i) || [])[1]) || null,
      branchCost: m(/Building Cost\s*\$?\s*([\d.,]+)/i),
      newSpeciality: m(/New Speciality\s*\$?\s*([\d.,]+)/i),
      improvements: m(/Academy Improvements\s+(\d+)/i),
      specChanges: m(/Speciality Changes\s+(\d+)/i),
      at: now(),
    };
    save();
    return `Academy: ${q}`;
  }

  function parseStadiumPage(doc) {
    const t = docText(doc.body);
    if (!/Terrace Price/i.test(t)) return null;
    const m = re => num((t.match(re) || [])[1]);
    db.stadium = {
      name: clean((t.match(/Name\s+([^\n]+)/) || [])[1]),
      capacity: m(/Capacity\s+([\d.,]+)/i),
      seatPrice: m(/Terrace Price\s*\$?\s*([\d.,]+)/i),
      demolishPrice: m(/Destroy Terrace\s*\$?\s*([\d.,]+)/i),
      covered: !/currently\s+not\s+covered/i.test(flatText(doc.body)),
      coverCost: num((flatText(doc.body).match(/building cost is\s*\$?\s*([\d.,]+)/i) || [])[1]),
      pitch: (flatText(doc.body).match(/pitch is currently\s+(\w+)/i) || [])[1] || null,
      at: now(),
    };
    save();
    return `Stadium: ${db.stadium.capacity} seats`;
  }

  function parseSponsorsPage(doc) {
    const t = docText(doc.body);
    const v = num((t.match(/Sponsorship Value\s*\$?\s*([\d.,]+)/i) || [])[1]);
    if (!isFinite(v)) return null;
    const ft = flatText(doc.body);
    db.sponsors = {
      type: clean((t.match(/Sponsor Type\s+([^\n]+)/i) || [])[1]),
      weekly: v,
      major: !/haven't made a deal with a major sponsor/i.test(ft),
      offersOpen: !/retracted their deal offers/i.test(ft),
      form: clean((t.match(/Team Form\s+([^\n]+)/i) || [])[1]),
      at: now(),
    };
    save();
    return `Sponsor: ${fmt$(v)}/week`;
  }

  function parseFixtureRows(doc) {
    const out = [];
    const seen = new Set();
    const RES = /^(\d{1,2}\s*-\s*\d{1,2}|vs)$/i;
    for (const leaf of doc.body.querySelectorAll('td,span,div,a,b,strong')) {
      if (leaf.children.length || !RES.test(clean(leaf.textContent))) continue;
      let row = leaf.closest('tr');
      if (!row) {
        row = leaf.parentElement;
        for (let i = 0; i < 5 && row && !/\d{1,2}\/\d{1,2}/.test(row.textContent); i++) row = row.parentElement;
      }
      if (!row || seen.has(row)) continue;
      seen.add(row);
      const toks = leafTexts(row);
      const ri = toks.findIndex(t => RES.test(t));
      const date = toks.find(t => /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(t));
      if (ri < 1 || ri >= toks.length - 1 || !date) continue;
      const home = toks[ri - 1], away = toks[ri + 1];
      for (const a of row.querySelectorAll('a[href]')) {
        const tx = clean(a.textContent);
        if ((tx === home || tx === away) && /equipa=\d+/.test(a.getAttribute('href'))) db.teamLinks[norm(tx)] = hrefOf(a);
      }
      const sc = toks[ri].match(/(\d+)\s*-\s*(\d+)/);
      const rep = row.querySelector('a[href*="relatorio"]');
      out.push({
        date, home, away,
        type: toks.find(t => /Lg\.|Cup|Friendl|Final/i.test(t)) || '',
        score: sc ? [+sc[1], +sc[2]] : null,
        reportId: rep ? param(rep.getAttribute('href'), 'jogo_id') : null,
      });
    }
    return out;
  }

  function parseFixturesPage(doc, u, ctx = {}) {
    const list = parseFixtureRows(doc);
    if (!list.length) return null;
    const t = docText(doc.body);
    let name = clean((t.match(/TEAM FIXTURES\s*\n([^\n]+)/i) || [])[1]);
    if (!name) {
      const c = {};
      list.forEach(f => { c[f.home] = (c[f.home] || 0) + 1; c[f.away] = (c[f.away] || 0) + 1; });
      name = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
    }
    const id = u.searchParams.get('equipa');
    if (!ctx.teamName && !id) {
      db.me.name = name;
      db.fixtures = { list, at: now() };
      save();
      return `Fixtures: ${list.length} matches (${name})`;
    }
    const team = upsertTeam(id, ctx.teamName || name);
    team.fixtures = list;
    team.fixturesAt = now();
    save();
    return `${team.name} fixtures: ${list.length}`;
  }

  function parseNextMatchPage(doc) {
    const ft = flatText(doc.body);
    const ex = ft.match(/distributed as follows:\s*(.+?) win:\s*(\d+)%;\s*draw:\s*(\d+)%;\s*(.+?) win:\s*(\d+)%/i);
    if (!ex) return null;
    const home = clean(ex[1]), away = clean(ex[4]);
    const t = docText(doc.body);
    const m = re => (t.match(re) || [])[1];
    for (const a of doc.querySelectorAll('a[href*="equipa="]')) {
      const tx = norm(a.textContent);
      if (tx === norm(home) || tx === norm(away)) db.teamLinks[tx] = hrefOf(a);
    }
    const date = m(/(\d{1,2}\/\d{1,2}\/\d{4})\s*\n/);
    const fx = (db.fixtures?.list || []).find(f => norm(f.home) === norm(home) && norm(f.away) === norm(away) && !f.score);
    db.next = {
      home, away, date,
      odds: { home: +ex[2] / 100, draw: +ex[3] / 100, away: +ex[5] / 100 },
      comp: fx?.type || clean(m(/(Rnd\.\s*\d+\s*Lg\.)/) || ''),
      weather: clean(m(/Weather Forecast\s*\n([^\n]+)/i)),
      points: { win: num(m(/Victory points\s*\n?\s*([+-]?\d+)/i)), draw: num(m(/Draw points\s*\n?\s*([+-]?\d+)/i)), loss: num(m(/Defeat points\s*\n?\s*([+-]?\d+)/i)) },
      at: now(),
    };
    resolveSides();
    save();
    return `Next match: ${home} vs ${away}`;
  }
  function resolveSides() {
    const n = db.next;
    if (!n) return;
    const me = norm(db.me.name || '');
    n.weAreHome = me ? (me === norm(n.home) ? true : me === norm(n.away) ? false : null) : null;
  }

  const ZONE_KEY = { Defender: 'def', Midfield: 'mid', Attack: 'att' };
  const LANE_KEY = { Left: 'L', Center: 'C', Centre: 'C', Right: 'R' };
  function parseReportPage(doc, u) {
    const ft = flatText(doc.body);
    const id = u.searchParams.get('jogo_id') || (ft.match(/Game ID\s*(\d+)/i) || [])[1];
    const names = $$('.mr-formations__form-name', doc).map(e => clean(e.textContent));
    const forms = $$('.mr-formations__form-formation', doc).map(e => (clean(e.textContent).match(/(\d(?:-\d){2,3})/) || [])[1]);
    const styles = $$('.mr-formations__form-style', doc).map(e => clean(e.textContent));
    if (!id || names.length < 2) return null;
    const sides = [0, 1].map(i => ({
      team: names[i], formation: forms[i] || '4-4-2',
      style: /defensive/i.test(styles[i]) ? 'Defensive' : /attacking/i.test(styles[i]) ? 'Attacking' : 'Normal',
      passing: (styles[i]?.match(/(Short|Mixed|Long|Direct)/i) || [])[1] || 'Short',
      players: [], stats: {}, zones: null, bot: false,
    }));
    for (const el of $$('.mr-pp[data-jog]', doc)) {
      const st = el.getAttribute('style') || '';
      const x = num((st.match(/left\s*:\s*([\d.]+)%/) || [])[1]);
      const y = num((st.match(/top\s*:\s*([\d.]+)%/) || [])[1]);
      const a = el.querySelector('.mr-pp__name');
      const p = { id: el.dataset.jog, name: clean(a?.getAttribute('title') || a?.textContent), rating: num(el.querySelector('.mr-pp__rating')?.textContent), x, y, gk: el.classList.contains('mr-pp--gk') };
      sides[isFinite(x) && x < 50 ? 0 : 1].players.push(p);
    }
    sides.forEach((s, i) => inferReportPositions(s, i === 0));
    for (const tr of $$('#stats tr', doc)) {
      const c = Array.from(tr.cells).map(x => clean(x.textContent));
      if (c.length >= 4 && c[0] && !/^formation$/i.test(c[0])) { sides[0].stats[c[0]] = c[1]; sides[1].stats[c[0]] = c[3]; }
    }
    const zh = { def: {}, mid: {}, att: {}, share: {} }, za = { def: {}, mid: {}, att: {}, share: {} };
    for (const cell of $$('#ratings .rz-cell', doc)) {
      const v = cell.querySelector('.rz-vs');
      const m = (v?.getAttribute('title') || '').match(/(Left|Center|Centre|Right)-(Defender|Midfield|Attack)\s+([\d,]+)\s*\|\s*(Left|Center|Centre|Right)-(Defender|Midfield|Attack)\s+([\d,]+)/);
      if (!m) continue;
      const share = num(cell.querySelector('.rz-cell__pct')?.textContent) / 100;
      zh[ZONE_KEY[m[2]]][LANE_KEY[m[1]]] = num(m[3]);
      za[ZONE_KEY[m[5]]][LANE_KEY[m[4]]] = num(m[6]);
      zh.share[ZONE_KEY[m[2]] + LANE_KEY[m[1]]] = share;
    }
    if (Object.keys(zh.def).length) {
      const avgs = $$('#ratings .rz-avg', doc).map(e => num(e.textContent));
      const gks = $$('#ratings .rz-gk__val', doc).map(e => num(e.textContent));
      zh.avg = avgs[0]; za.avg = avgs[1]; zh.gk = gks[0]; za.gk = gks[1];
      sides[0].zones = zh; sides[1].zones = za;
    }
    for (const m of ft.matchAll(/AI \(bot\) manager\s*Manager\s*·\s*(.+?)(?=\s*Substitutions|\s*AI \(bot\)|$)/g)) {
      const s = sides.find(x => norm(m[1]).startsWith(norm(x.team)));
      if (s) s.bot = true;
    }
    const sc = ft.match(new RegExp(reEsc(names[0]) + '\\s*(\\d{1,2})\\s*:\\s*(\\d{1,2})\\s*' + reEsc(names[1])));
    const dm = [...ft.matchAll(/((?:League|Cup|Friendly|Playoff)[^/']{0,70}?)\s(\d{1,2}\/\d{1,2}\/\d{4})/gi)].pop();
    db.reports[id] = {
      id, sides, score: sc ? [+sc[1], +sc[2]] : null,
      date: dm?.[2] || null, comp: clean(dm?.[1] || ''),
      attendance: num((ft.match(/Attendance\s*([\d.,]+)/i) || [])[1]),
      weather: clean((ft.match(/Attendance\s*[\d.,]+\s*Weather\s*(.+?)\s*Referee/i) || [])[1]) || null,
      referee: clean((ft.match(/Referee\s*(.+?)\s*Game ID/i) || [])[1]) || null,
      at: now(),
    };
    save();
    return `Report ${names[0]} ${sc ? sc[1] + '-' + sc[2] : ''} ${names[1]}`;
  }

  // Turn pitch coordinates into line/lane using the published formation counts.
  function inferReportPositions(side, home) {
    const counts = side.formation.split('-').map(Number);
    const nD = counts[0], nF = counts[counts.length - 1], nM = 10 - nD - nF;
    const ps = side.players.filter(p => isFinite(p.x));
    if (ps.length < 11) return;
    const depth = p => (home ? p.x : 100 - p.x);
    const sorted = ps.slice().sort((a, b) => (b.gk - a.gk) || depth(a) - depth(b));
    sorted.forEach((p, i) => {
      p.line = i === 0 ? 'GK' : i <= nD ? 'D' : i <= nD + nM ? 'M' : 'F';
      if (p.line === 'GK') { p.lane = 'C'; return; }
      // home attacks right, so their left flank is the top of the pitch; mirrored for away
      p.lane = p.y < 30 ? (home ? 'L' : 'R') : p.y > 70 ? (home ? 'R' : 'L') : 'C';
    });
  }

  // Starting Eleven page is built client-side, so only the live document works.
  const POS_KEY = { gr: 'GK', de: 'LB', dd: 'RB', me: 'LM', md: 'RM', ae: 'LF', ad: 'RF' };
  function parseLineupPage(doc) {
    const ps = $$('.football-table .player[data-player]', doc);
    if (!ps.length) return null;
    const starters = ps.map(p => ({ slot: p.dataset.lang, key: p.dataset.pos, id: p.dataset.player, name: clean(p.querySelector('.player-name')?.getAttribute('title') || p.textContent) }));
    const adv = {};
    for (const s of $$('select.adv-option-select', doc)) adv[s.id] = clean(s.options[s.selectedIndex]?.textContent);
    db.lineup = { starters, adv, at: now() };
    save();
    return `Lineup: ${starters.length} starters`;
  }

  // Our own player pages: form, experience, professionalism (feed the model + captain choice).
  function parsePlayerPage(doc, u) {
    const id = u.searchParams.get('jog_id');
    if (!id) return null;
    const ft = flatText(doc.body);
    if (!(db.squad?.players || []).some(p => p.id === id)) {
      // someone else's player: keep whatever skills our scout has observed ("Handling 14" vs "Handling ? Unknown")
      const sk = {};
      for (const k of SKILLS) {
        const v = (ft.match(new RegExp(SKILL_NAME[k] + '\\s+(\\d{1,2})(?![\\d,.])')) || [])[1];
        if (v != null && +v <= 20) sk[k] = +v;
      }
      if (Object.keys(sk).length < 4) return null;
      db.scouted = db.scouted || {};
      db.scouted[id] = { sk, observed: clean((ft.match(/Last Observation:?\s*(.+?)\s*Primaries/i) || [])[1]), at: now() };
      save();
      return `Scouted skills for ${Object.keys(sk).length} attributes`;
    }
    const g = k => (ft.match(new RegExp(k + '\\s+(' + DENOMS.slice().sort((a, b) => b.length - a.length).join('|') + ')', 'i')) || [])[1] || null;
    db.details[id] = {
      form: g('Form'), experience: g('Experience'), professionalism: g('Professionalism'), penalties: g('Penalties'),
      happiness: num((ft.match(/Happiness\s+(\d+)%/i) || [])[1]), health: num((ft.match(/Health\s+(\d+)%/i) || [])[1]),
      at: now(),
    };
    save();
    return 'Player details saved';
  }

  // info.asp without the stadium form — Team Details: reputation, wage roof, attendance.
  function parseClubPage(doc) {
    const ft = flatText(doc.body);
    if (!/Wage Roof of Club/i.test(ft)) return null;
    const g = re => clean((ft.match(re) || [])[1]);
    db.club = {
      reputation: g(/Team Reputation\s*(.+?)\s*Current Division/i),
      division: g(/Current Division\s*(.+?)\s*\(/i), place: num(g(/Current Division\s*.+?\((\d+)\s*Place/i)),
      cup: g(/Cup Status\s*(.+?)\s*Rival Teams/i), rivals: g(/Rival Teams\s*(.+?)\s*Games Without/i).split(/\s*,\s*/).filter(Boolean),
      financial: g(/Financial Situation\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)(?=[A-Z]|\s|$)/),
      wageRoof: num(g(/Wage Roof of Club\s*\$?([\d.,]+)/i)), wages: num(g(/Wages Sum\s*\$?([\d.,]+)/i)), pendingWages: num(g(/Wages Sum\s*\$?[\d.,]+\s*\(\+\s*\$?([\d.,]+)\)/i)) || 0,
      avgAttendance: num(g(/Average Attendance\s*([\d.,]+)/i)), fanClub: g(/Fan Club Size\s*(.+?)\s*Trophy/i),
      at: now(),
    };
    save();
    return `Club: wage roof ${fmt$(db.club.wageRoof)}, avg crowd ${db.club.avgAttendance}`;
  }
  const parseInfoPage = (doc, u) => parseStadiumPage(doc, u) || parseClubPage(doc);

  // contratos.asp — years left, wage, minutes, renewable or not.
  function parseContractsPage(doc) {
    const rows = $$('tr.sq-row', doc).filter(r => playerLink(r)).map(r => {
      const c = Array.from(r.cells);
      const link = playerLink(r);
      return {
        id: playerId(link), name: clean(link.textContent), age: num(c[2]?.textContent),
        quality: clean(c[3]?.textContent), potential: clean(c[4]?.textContent),
        years: num((clean(c[5]?.textContent).match(/(\d+)\s*year/i) || [])[1]), value: num(c[6]?.textContent), wage: num(c[7]?.textContent),
        minutes: num(c[8]?.textContent) || 0, renewable: !!r.querySelector('a[href*="renovar"]'), wontRenew: /won.?t renew/i.test(r.textContent),
      };
    });
    if (!rows.length) return null;
    db.contracts = { rows, at: now() };
    save();
    return `Contracts: ${rows.filter(x => x.years <= 1).length} expiring`;
  }

  // prox_adv.asp — the next opponent's last 20 formations and Match-of-the-Season use.
  function parseOpponentPage(doc) {
    const ft = flatText(doc.body);
    const freq = {};
    // "5-3-2_v11 ×194-4-2_v19 ×1": the count runs straight into the next formation
    for (const m of ft.matchAll(/(\d(?:-\d){2,3})_v\d+\s*×\s*(\d+?)(?=\d-\d-\d|\D|$)/g)) freq[m[1]] = (freq[m[1]] || 0) + +m[2];
    if (!Object.keys(freq).length) return null;
    const opp = opponentName();
    const team = opp && (teamByName(opp) || upsertTeam(param(db.teamLinks[norm(opp)] || '', 'equipa'), opp));
    if (team) {
      team.freq = freq;
      team.motsUsed = num((ft.match(/Used Match of the Season\s*(\d+)/i) || [])[1]);
      team.lastStyle = clean((ft.match(/Last Used Style\s*(.+?)\s*Used Match/i) || [])[1]);
    }
    const sc = ft.match(/Scout\s*([^()]{2,40}?)\s*\((\d)\/5\)/);
    if (sc) db.me.scout = { name: clean(sc[1]), q: +sc[2] };
    save();
    return `Opponent: ${Object.entries(freq).map(([f, n]) => `${f}×${n}`).join(', ')}`;
  }

  // palestras.asp — morale and the five lecture intensities.
  const LECTURES = ['Super Light', 'Light', 'Medium', 'Heavy', 'Intense'];
  function parseLecturePage(doc) {
    const ft = flatText(doc.body);
    const cards = [...ft.matchAll(/(SUPER LIGHT|LIGHT|MEDIUM|HEAVY|INTENSE)\s*(\d+)%\s*Success Rate\s*Morale Change\s*\+\/-\s*(\d+)/gi)]
      .map(m => ({ name: LECTURES.find(l => norm(l) === norm(m[1])), rate: +m[2] / 100, change: +m[3] }))
      .map(c => ({ ...c, tipo: LECTURES.indexOf(c.name) + 1 }));
    if (!cards.length && !/Team Morale/i.test(ft)) return null;
    db.lecture = {
      morale: clean((ft.match(/Team Morale\s*(.+?\(\d+\))/i) || [])[1]),
      integration: clean((ft.match(/Team Integration\s*(.+?)\s*Bonus/i) || [])[1]),
      professionalism: clean((ft.match(/Team Professionalism\s*(.+?)\s*Bonus/i) || [])[1]),
      cards, available: !!doc.querySelector('[onclick*="give_lecture"]'), at: now(),
    };
    save();
    return `Lecture: morale ${db.lecture.morale}`;
  }

  // eventos.asp — the current match-day events.
  function parseEventsPage(doc) {
    const list = $$('.ev-ev', doc).map(e => {
      const del = e.querySelector('a[href*="action=apagar"]');
      return {
        id: (del?.getAttribute('href').match(/eID=(\d+)/i) || [])[1],
        type: (e.className.match(/ev-ev--(\w+)/) || [])[1] || 'other',
        text: clean(e.textContent.replace(/Active|Inactive/g, '')),
        players: $$('a[href*="jog_id"]', e).map(a => playerId(a)).filter(Boolean),
        active: !!e.querySelector('.ev-st.is-on'),
      };
    }).filter(e => e.id);
    if (!doc.querySelector('form[action*="guardar"]')) return null;
    db.events = { list, at: now() };
    save();
    return `Events: ${list.length}`;
  }

  // eqtecnica.asp — staff summary, or (fase=1) the hiring form showing one role/level wage.
  const STAFF_F = { 1: 'AM', 2: 'Physio', 3: 'Scout', 4: 'Coach' };
  const STAFF_LEVEL = ['Terrible', 'Very Bad', 'Bad', 'Passable', 'Good', 'Very Good'];
  function parseStaffPage(doc, u) {
    if (u.searchParams.get('fase') === '1') {
      const form = doc.querySelector('form[action*="fase=2"]');
      const act = form && new URL(form.getAttribute('action'), location.origin + '/');
      const role = STAFF_F[act?.searchParams.get('f')], q = num(act?.searchParams.get('q'));
      const wage = num(form?.querySelector('.et-wage')?.textContent);
      if (!role || !isFinite(wage)) return null;
      db.staffPrices = db.staffPrices || {};
      (db.staffPrices[role] = db.staffPrices[role] || [])[q] = wage;
      db.staffPricesAt = now();
      save();
      return `${role} ${STAFF_LEVEL[q]}: ${fmt$(wage)}/week`;
    }
    const ft = flatText(doc.body);
    const m = ft.match(/Staff\s*Coach\s*(\d+)\s*Scout\s*(\d+)\s*Assistant Manager\s*(\d+)\s*Physio\s*(\d+)\s*Wage\s*\$?([\d.,]+)/i);
    if (!m) return null;
    db.staff = { Coach: +m[1], Scout: +m[2], AM: +m[3], Physio: +m[4], wage: num(m[5]), at: now() };
    save();
    return `Staff: ${m[1]} coach, ${m[2]} scout, ${m[3]} AM, ${m[4]} physio`;
  }

  const ROUTES = [
    [/plantel\.asp/i, parseSquadPage],
    [/treinos\.asp/i, parseTrainingPage],
    [/financas\.asp/i, parseEconomyPage],
    [/academia\.asp/i, parseAcademyPage],
    [/^\/info\.asp/i, parseInfoPage],
    [/contratos\.asp/i, parseContractsPage],
    [/prox_adv\.asp/i, parseOpponentPage],
    [/palestras\.asp/i, parseLecturePage],
    [/eventos\.asp/i, parseEventsPage],
    [/patrocinios\.asp/i, parseSponsorsPage],
    [/calendario\.asp/i, parseFixturesPage],
    [/proximo_jogo\.asp/i, parseNextMatchPage],
    [/relatorio\.asp/i, parseReportPage],
    [/titulares/i, parseLineupPage],
    [/ver_equipa\.asp/i, parseTeamPage],
    [/ver_jogador\.asp/i, parsePlayerPage],
    [/eqtecnica\.asp/i, parseStaffPage],
    [/procurar\.asp/i, parseMarketPage],
    [/lista_livres\.asp/i, parseMarketPage],
  ];
  function ingest(doc, url, ctx) {
    const u = new URL(url, location.origin);
    for (const [re, fn] of ROUTES) {
      if (!re.test(u.pathname)) continue;
      try { return fn(doc, u, ctx); } catch (e) { console.warn('[PM Copilot]', fn.name, e); return null; }
    }
    return null;
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status + ' ' + url);
    const buf = await res.arrayBuffer();
    const cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
    let html = new TextDecoder(cs || 'utf-8').decode(buf);
    if (!cs) {
      const meta = (html.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
      if (meta && !/utf-?8/i.test(meta)) html = new TextDecoder(meta).decode(buf);
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!/logout/i.test(html) && /type=["']?password/i.test(html)) throw new Error('Not logged in');
    return { doc, url: res.url || url };
  }
  async function grab(url, ctx) {
    const { doc, url: final } = await fetchDoc(url);
    return ingest(doc, final, ctx);
  }

  const PAGES = {
    squad: () => db.squad?.url || '/plantel.asp?equipa=2&pos=',
    training: () => '/treinos.asp?equipa=A',
    economy: () => '/financas.asp',
    academy: () => '/academia.asp',
    stadium: () => '/info.asp?action=2',
    sponsors: () => '/patrocinios.asp',
    fixtures: () => '/calendario.asp?action=equipa',
    next: () => '/proximo_jogo.asp',
    staff: () => '/eqtecnica.asp',
    club: () => '/info.asp',
    contracts: () => '/contratos.asp',
    opponent: () => '/prox_adv.asp',
    lecture: () => '/palestras.asp',
    events: () => '/eventos.asp',
  };

  async function refreshAll(progress) {
    const log = [];
    for (const [k, f] of Object.entries(PAGES)) {
      progress(`Reading ${k}…`);
      try { log.push(await grab(f()) || `${k}: nothing recognised`); } catch (e) { log.push(`${k}: ${e.message}`); }
      await sleep(150);
    }
    const reps = (db.fixtures?.list || []).filter(f => f.reportId && !db.reports[f.reportId]);
    for (const f of reps) {
      progress(`Report ${f.home} – ${f.away}…`);
      try { await grab('/relatorio.asp?jogo_id=' + f.reportId); } catch (e) { log.push('report: ' + e.message); }
      await sleep(150);
    }
    // hiring prices change rarely (division-dependent) — re-read every few days
    const P = db.staffPrices || {};
    const pricesComplete = ['AM', 'Coach', 'Scout', 'Physio'].every(r => [1, 2, 3, 4, 5].every(q => isFinite(P[r]?.[q]))) && isFinite(P.AM?.[0]);
    if (!pricesComplete || !db.staffPricesAt || now() - db.staffPricesAt > 3 * 86400e3) {
      progress('Reading staff wages…');
      for (const f of [1, 2, 3, 4]) for (let q = f === 1 ? 0 : 1; q <= 5; q++) {
        try { await grab(`/eqtecnica.asp?fase=1&hf=0&q=${q}&f=${f}`); } catch (e) { /* non-critical */ }
        await sleep(80);
      }
    }
    for (const p of db.squad?.players || []) {
      if (!p.id || (db.details[p.id] && now() - db.details[p.id].at < 6 * 3600e3)) continue;
      progress(`Player ${p.name}…`);
      try { await grab('/ver_jogador.asp?jog_id=' + p.id); } catch (e) { /* non-critical */ }
      await sleep(120);
    }
    db.lastRefresh = now();
    save();
    return log;
  }

  /* =========================================================================
   * Opponent scouting
   * ======================================================================= */
  function opponentName() {
    const n = db.next;
    if (!n) return null;
    if (n.weAreHome === true) return n.away;
    if (n.weAreHome === false) return n.home;
    return null;
  }

  async function scoutOpponent(progress) {
    const log = [];
    if (!db.fixtures) { progress('Reading fixtures…'); await grab(PAGES.fixtures()); }
    progress('Reading next match…');
    await grab(PAGES.next());
    const opp = opponentName();
    if (!opp) throw new Error('Tell me which team is yours (Data tab).');
    const id = param(db.teamLinks[norm(opp)] || '', 'equipa');
    if (!id) throw new Error(`No link to ${opp} found — open their team page once.`);
    const team = upsertTeam(id, opp);
    save();
    progress(`${opp}: team page…`);
    try { await grab(`/ver_equipa.asp?equipa=${id}`, { teamName: opp }); } catch (e) { log.push('team: ' + e.message); }
    progress(`${opp}: players…`);
    try { log.push(await grab(`/ver_equipa.asp?equipa=${id}&vjog=1`, { teamName: opp })); } catch (e) { log.push('players: ' + e.message); }
    progress(`${opp}: fixtures…`);
    try { log.push(await grab(`/calendario.asp?action=equipa&equipa=${id}`, { teamName: opp })); } catch (e) { log.push('fixtures: ' + e.message); }
    const ids = new Set();
    (db.fixtures?.list || []).filter(f => f.reportId && [norm(f.home), norm(f.away)].includes(norm(opp))).forEach(f => ids.add(f.reportId));
    (team.fixtures || []).filter(f => f.reportId).slice(-5).forEach(f => ids.add(f.reportId));
    let n = 0;
    for (const rid of ids) {
      n++;
      if (db.reports[rid]) continue;
      progress(`${opp}: report ${n}/${ids.size}…`);
      try { await grab('/relatorio.asp?jogo_id=' + rid); } catch (e) { log.push('report: ' + e.message); }
      await sleep(150);
    }
    // observed skills from our scout, if he has looked at them
    let seen = 0;
    for (const p of team.roster || []) {
      progress(`${opp}: player ${p.name}…`);
      try { if (await grab('/ver_jogador.asp?jog_id=' + p.id)) seen++; } catch (e) { /* non-critical */ }
      await sleep(100);
    }
    if (seen) log.push(`${seen} players with scouted skills`);
    team.scoutedAt = now();
    save();
    log.push(`${opp} scouted: ${ids.size} reports`);
    return log;
  }

  /* =========================================================================
   * Tactical model
   * ======================================================================= */
  const roleSkill = (p, line) => sum(Object.entries(ROLE_W[line]).map(([k, w]) => (p.sk?.[k] ?? 0) * w));
  function posFactor(p, slot) {
    let f = 1;
    if (p.line && p.line !== slot.line) {
      if (p.line === 'GK' || slot.line === 'GK') f = 0.25;
      else f = Math.abs(LINE_ORDER[p.line] - LINE_ORDER[slot.line]) === 1 ? 0.78 : 0.55;
    }
    if (slot.line !== 'GK' && p.sides && !p.sides.includes(slot.lane)) f *= 0.86;
    return f;
  }
  const fitFactor = fit => (!isFinite(fit) ? 1 : fit >= 90 ? 1 : fit >= 80 ? 0.97 : fit >= 50 ? 0.88 : 0.75);
  // Form and experience feed the "global skill" — small, symmetric nudges around Good / Passable.
  const formFactor = p => {
    const f = denomIdx(p.form || ''), e = denomIdx(p.experience || '');
    return (f >= 0 ? 1 + 0.02 * (f - 5) : 1) * (e >= 0 ? 1 + 0.012 * (e - 4) : 1);
  };
  const slotScore = (p, slot) => roleSkill(p, slot.line) * posFactor(p, slot) * fitFactor(p.fit) * formFactor(p);

  function hungarian(cost) {
    const n = cost.length, m = cost[0].length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
    return res;
  }

  // Legal shapes: ≥3 D, ≥2 M, ≥1 F, max one per wing and three in the middle of each line.
  const FORMATIONS = (() => {
    const opts = (min, max) => {
      const o = [];
      for (const L of [0, 1]) for (const R of [0, 1]) for (let C = 1; C <= 3; C++) {
        const n = L + C + R;
        if (n >= min && n <= max) o.push({ L, C, R, n });
      }
      return o;
    };
    const out = [];
    for (const d of opts(3, 5)) for (const m of opts(2, 5)) for (const f of opts(1, 3)) {
      if (d.n + m.n + f.n !== 10 || d.L !== d.R) continue; // lopsided back lines are rarely useful
      out.push({ D: d, M: m, F: f });
    }
    return out;
  })();
  const formLabel = f => `${f.D.n}-${f.M.n}-${f.F.n}`;
  const formDetail = f => ['D', 'M', 'F'].map(l => [f[l].L ? SLOT_CODES[l].L : '', f[l].C ? (f[l].C > 1 ? f[l].C : '') + SLOT_CODES[l].C : '', f[l].R ? SLOT_CODES[l].R : ''].filter(Boolean).join(' ')).join(' · ');
  function slotsFor(f) {
    const s = [{ line: 'GK', lane: 'C', code: 'GK' }];
    for (const line of ['D', 'M', 'F']) for (const lane of LANES) for (let i = 0; i < f[line][lane]; i++) s.push({ line, lane, code: SLOT_CODES[line][lane] });
    return s;
  }
  function formFromString(str) {
    const c = (str || '4-4-2').split('-').map(Number);
    const nD = c[0], nF = c[c.length - 1], nM = 10 - nD - nF;
    const lay = (n, line) => {
      const t = { 1: [0, 1, 0], 2: [0, 2, 0], 3: line === 'F' ? [1, 1, 1] : [0, 3, 0], 4: [1, 2, 1], 5: [1, 3, 1] }[n] || [0, n, 0];
      return { L: t[0], C: t[1], R: t[2], n };
    };
    return { D: lay(nD, 'D'), M: lay(nM, 'M'), F: lay(nF, 'F') };
  }
  function formFromSlots(slots) {
    const f = { D: { L: 0, C: 0, R: 0, n: 0 }, M: { L: 0, C: 0, R: 0, n: 0 }, F: { L: 0, C: 0, R: 0, n: 0 } };
    for (const s of slots) if (s.line && s.line !== 'GK') { f[s.line][s.lane]++; f[s.line].n++; }
    return f;
  }

  function bestXI(players, form) {
    const slots = slotsFor(form);
    if (players.length < 11) return null;
    const S = slots.map(s => players.map(p => slotScore(p, s)));
    const asg = hungarian(S.map(r => r.map(x => 40 - x)));
    return slots.map((s, i) => ({ slot: s, p: players[asg[i]], score: S[i][asg[i]] }));
  }

  function zonesFor(xi) {
    const out = xi.filter(x => x.slot.line !== 'GK');
    const teamAvg = avg(out.map(x => x.score));
    const by = (line, lane) => out.filter(x => x.slot.line === line && x.slot.lane === lane).map(x => x.score);
    const z = { def: {}, mid: {}, att: {}, n: { D: {}, M: {}, F: {} }, gk: xi.find(x => x.slot.line === 'GK')?.score ?? teamAvg * 0.4 };
    for (const l of LANES) {
      const D = by('D', l), M = by('M', l), F = by('F', l);
      z.n.D[l] = D.length; z.n.M[l] = M.length; z.n.F[l] = F.length;
      const pick = (main, alt) => (main.length ? avg(main) : alt.length ? 0.5 * avg(alt) : 0.3 * teamAvg);
      z.def[l] = 0.85 * pick(D, M) + 0.15 * teamAvg;
      z.mid[l] = 0.85 * pick(M, [...D, ...F]) + 0.15 * teamAvg;
      z.att[l] = 0.85 * pick(F, M) + 0.15 * teamAvg;
    }
    return z;
  }

  // How many match-engine "stars" one model point is worth, fitted on our own match reports.
  function calibration() {
    const squad = db.squad?.players || [];
    const pairs = [], gk = [];
    for (const r of Object.values(db.reports)) {
      const side = r.sides.find(s => norm(s.team) === norm(db.me.name || ''));
      if (!side?.zones || !side.players.some(p => p.line)) continue;
      const xi = side.players.filter(p => p.line).map(rp => {
        const p = squad.find(q => q.id === rp.id);
        const slot = { line: rp.line, lane: rp.lane, code: rp.line === 'GK' ? 'GK' : SLOT_CODES[rp.line][rp.lane] };
        return p ? { slot, p, score: slotScore(p, slot) } : null;
      }).filter(Boolean);
      if (xi.length < 10) continue;
      const z = zonesFor(xi), fx = STYLE_FX[side.style] || STYLE_FX.Normal;
      for (const l of LANES) {
        if (z.n.D[l]) pairs.push([z.def[l], side.zones.def[l] / fx.d]);
        if (z.n.M[l]) pairs.push([z.mid[l], side.zones.mid[l]]);
        if (z.n.F[l]) pairs.push([z.att[l], side.zones.att[l] / fx.a]);
      }
      if (isFinite(side.zones.gk)) gk.push([z.gk, side.zones.gk / fx.d]);
    }
    const fit = ps => { const ok = ps.filter(([m, s]) => isFinite(m) && isFinite(s) && m > 0); return ok.length >= 6 ? sum(ok.map(([m, s]) => m * s)) / sum(ok.map(([m]) => m * m)) : null; };
    return { a: fit(pairs) || 0.47, gk: fit(gk) || 0.34, n: pairs.length };
  }
  function toStars(z, cal) {
    const o = { def: {}, mid: {}, att: {}, n: z.n, gk: z.gk * cal.gk };
    for (const k of ['def', 'mid', 'att']) for (const l of LANES) o[k][l] = z[k][l] * cal.a;
    return o;
  }

  // Advanced tactic conditions, as written in the in-game help.
  function evalATs(us, them) {
    if (!them) return null;
    const S = (xi, k, lines) => sum(xi.filter(x => !lines || lines.includes(x.slot.line)).map(x => x.p.sk?.[k] ?? 0));
    const A = (xi, ks, lines) => avg(xi.filter(x => lines.includes(x.slot.line)).map(x => sum(ks.map(k => x.p.sk?.[k] ?? 0))));
    const cmp = (a, b) => ({ a, b, win: a > b, margin: b ? (a - b) / b : 0 });
    const gkU = us.find(x => x.slot.line === 'GK')?.p.sk || {}, gkT = them.find(x => x.slot.line === 'GK')?.p.sk || {};
    return {
      pressHigh: [cmp(S(us, 'SPE'), S(them, 'SPE')), cmp(S(us, 'PAS'), S(them, 'PAS'))],
      pressLow: [cmp(S(them, 'SPE'), S(us, 'SPE')), cmp(S(us, 'TCK'), S(them, 'TCK'))],
      offside: [cmp(A(us, ['POS'], ['D']), A(them, ['POS'], ['F'])), cmp(A(us, ['SPE'], ['D']), A(them, ['SPE'], ['F']))],
      counter: { speed: cmp(S(us, 'SPE'), S(them, 'SPE')), pass: cmp(S(us, 'PAS'), S(them, 'PAS')) },
      highBalls: [cmp(S(us, 'HEA'), S(them, 'HEA')), cmp(S(us, 'STR'), S(them, 'STR'))],
      oneOnOne: [cmp(A(us, ['TEC', 'STR'], ['M', 'F']), A(them, ['TCK', 'STR'], ['D', 'M']))],
      standIn: [cmp((gkU.REF || 0) + (gkU.HAN || 0), A(them, ['HEA', 'FIN'], ['F']))],
      rushOut: [cmp((gkU.AGI || 0) + (gkU.CRO || 0), A(them, ['HEA', 'TEC'], ['F']))],
      zonal: [cmp(A(us, ['SPE', 'TCK'], ['D', 'M']), A(them, ['POS', 'SPE'], ['M', 'F']))],
      manMark: [cmp(A(us, ['STR', 'TCK'], ['D', 'M']), A(them, ['POS', 'STR'], ['M', 'F']))],
      longShots: [cmp(A(us, ['FIN', 'TEC'], ['M', 'F']) / 2, ((gkT.AGI || 0) + A(them, ['POS'], ['D'])) / 2)],
      firstTime: [cmp(A(us, ['FIN', 'HEA'], ['F']) / 2, ((gkT.REF || 0) + A(them, ['HEA'], ['D'])) / 2)],
    };
  }

  function decideATs(at, style, ourForm, theirForm, safe) {
    if (!at) return null;
    const allWin = cs => cs.every(c => c.win && c.margin > safe);
    const d = {};
    d.pressing = allWin(at.pressHigh) ? 'High' : allWin(at.pressLow) ? 'Low' : 'Normal';
    d.offside = allWin(at.offside);
    const defensive = style === 'Defensive' || (ourForm && theirForm && ourForm.D.n > theirForm.F.n + 1);
    const cw = (at.counter.speed.win && at.counter.speed.margin > safe ? 0.45 : 0) + (at.counter.pass.win && at.counter.pass.margin > safe ? 0.25 : 0) + (defensive ? 0.3 : 0);
    d.counter = cw >= 0.7;
    d.highBalls = allWin(at.highBalls);
    d.oneOnOne = allWin(at.oneOnOne);
    const si = at.standIn[0], ro = at.rushOut[0];
    d.keeping = si.win && si.margin > safe && si.margin >= ro.margin ? 'Stand In' : ro.win && ro.margin > safe ? 'Rushing out' : 'Not Defined';
    d.marking = allWin(at.zonal) && at.zonal[0].margin >= at.manMark[0].margin ? 'Zonal' : allWin(at.manMark) ? 'Man to Man' : 'Not Defined';
    d.longShots = allWin(at.longShots);
    d.firstTime = ourForm && ourForm.F.n >= 3 && allWin(at.firstTime);
    d.won = [d.pressing !== 'Normal', d.offside, d.counter, d.highBalls, d.oneOnOne, d.keeping !== 'Not Defined', d.marking !== 'Not Defined', d.longShots, d.firstTime].filter(Boolean).length;
    return d;
  }

  function poisson(l, k) { let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.exp(-l) * l ** k / f; }
  function wdl(a, b) {
    let w = 0, d = 0, l = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const p = poisson(a, i) * poisson(b, j);
      if (i > j) w += p; else if (i === j) d += p; else l += p;
    }
    return { w, d, l };
  }

  function sideMult(z, s) {
    const fx = STYLE_FX[s.style] || STYLE_FX.Normal;
    const g = (1 + 0.02 * (s.atWon || 0)) * (s.attitude === 'MOTS' ? 1.08 : s.attitude === 'PIC' ? 0.92 : 1) * (s.home ? 1.03 : 1);
    const o = { def: {}, mid: {}, att: {}, n: z.n, gk: z.gk * fx.d * g };
    for (const l of LANES) { o.def[l] = z.def[l] * fx.d * g; o.att[l] = z.att[l] * fx.a * g; o.mid[l] = z.mid[l] * g; }
    return o;
  }

  const PREF_W = { Normal: {}, Left: { L: 1.35 }, Right: { R: 1.35 }, Center: { C: 1.35 }, 'Attack on wings': { L: 1.2, R: 1.2 }, 'Center/Left': { C: 1.15, L: 1.15 }, 'Center/Right': { C: 1.15, R: 1.15 } };
  // Works in match-engine star units. BASE/K_* are fitted (Poisson likelihood) on real reports:
  // zone ratings from the Action Zones tab against final scores. These are the starting values;
  // calibrateModel() refits them in the browser from the report database as it grows.
  const ME = { BASE: 6, K_BEAT: 1.5, K_GK: 1, K_MID: 8 };
  const midOf = z => (z.mid.L + 2 * z.mid.C + z.mid.R) / 4;
  // Expected goals for `att` against `def` (zones already adjusted for style, home and numbers).
  function goalRate(att, def, passing, P = ME, pref = null) {
    const fx = PASS_FX[passing] || PASS_FX.Short;
    const poss = sigmoid((midOf(att) - midOf(def)) / P.K_MID);
    const attacks = P.BASE * (fx.w * poss + (1 - fx.w) * 0.5);
    const pw = PREF_W[pref] || {};
    // where we attack depends on our strength in that lane (midfield + attack) and the chosen side
    const wts = LANES.map(l => Math.max(0.5, att.att[l] + 0.5 * att.mid[l]) ** 2 * (pw[l] || 1));
    const tw = sum(wts);
    let g = 0;
    LANES.forEach((l, i) => {
      const pBeat = sigmoid((att.att[l] * (1 - fx.pen) - def.def[MIRROR[l]]) / P.K_BEAT);
      const pConv = 2 * sigmoid((att.att[l] - def.gk) / P.K_GK);
      g += attacks * (wts[i] / tw) * pBeat * pConv;
    });
    return Math.max(g, 1e-6);
  }
  function simulate(us, them) {
    const a = sideMult(us.z, us), b = sideMult(them.z, them);
    for (const l of LANES) {
      const m = MIRROR[l];
      const d1 = clamp(a.n.D[l] - b.n.F[m], -3, 3);
      a.def[l] *= 1 + 0.04 * d1; b.att[m] *= 1 - 0.04 * d1;
      const d2 = clamp(b.n.D[m] - a.n.F[l], -3, 3);
      b.def[m] *= 1 + 0.04 * d2; a.att[l] *= 1 - 0.04 * d2;
      const d3 = clamp(a.n.M[l] - b.n.M[m], -3, 3);
      a.mid[l] *= 1 + 0.03 * d3; b.mid[m] *= 1 - 0.03 * d3;
    }
    const xgFor = goalRate(a, b, us.passing, ME, us.pref), xgAg = goalRate(b, a, them.passing, ME, them.pref);
    return { xgFor, xgAg, poss: sigmoid((midOf(a) - midOf(b)) / ME.K_MID), ...wdl(xgFor, xgAg) };
  }

  // Goal difference breaks ties once win chances saturate against weak sides.
  function objectiveValue(r, obj, pts) {
    const gd = 0.01 * (r.xgFor - r.xgAg);
    if (obj === 'avoid') return r.w + r.d + 0.1 * r.w + gd;
    if (obj === 'win') return r.w + gd;
    if (obj === 'ranking' && pts && isFinite(pts.win)) return pts.win * r.w + pts.draw * r.d + pts.loss * r.l + gd;
    return 3 * r.w + r.d + gd;
  }
  // Shown numbers lean 25% on the pundits: the model is fitted on few games and can't see form swings.
  function shown(r) {
    const o = db.next?.odds;
    if (!o || db.next.weAreHome == null) return r;
    const [w, l] = db.next.weAreHome ? [o.home, o.away] : [o.away, o.home];
    return { ...r, w: 0.75 * r.w + 0.25 * w, d: 0.75 * r.d + 0.25 * o.draw, l: 0.75 * r.l + 0.25 * l };
  }

  function squadPool() {
    const tr = db.training?.rows || [];
    const ex = new Set(db.prefs.excluded || []);
    return (db.squad?.players || []).filter(p => !ex.has(p.name) && p.tier !== 3).map(p => { // youth team can't play
      const t = matchPlayer(p.name, tr, p.id);
      const d = db.details[p.id] || {};
      return { ...p, fit: t?.fit, potential: t?.potential, quality: t?.quality, form: d.form, experience: d.experience, professionalism: d.professionalism, penalties: d.penalties, rate: playerRate(p.id, t?.potential).rate };
    });
  }

  const dateKey = d => { if (!d) return 0; const [dd, mm, yy] = d.split('/').map(Number); return (yy || 0) * 10000 + (mm || 0) * 100 + (dd || 0); };

  // Everything we know about the opponent: real ME zone ratings from their reports, quality grades, ATs used.
  function opponentModel(cal, ourRefZ) {
    const name = opponentName();
    if (!name) return null;
    const team = teamByName(name);
    const reps = Object.values(db.reports)
      .filter(r => r.sides.some(s => norm(s.team) === norm(name)))
      .sort((a, b) => dateKey(b.date) - dateKey(a.date) || b.id - a.id);
    const sideOf = r => r.sides.find(s => norm(s.team) === norm(name));
    const history = reps.slice(0, 6).map(r => {
      const s = sideOf(r), idx = r.sides.indexOf(s);
      return { id: r.id, date: r.date, vs: r.sides[1 - idx].team, home: idx === 0, gf: r.score?.[idx], ga: r.score?.[1 - idx], formation: s.formation, style: s.style, passing: s.passing, stats: s.stats, zones: s.zones, bot: s.bot };
    });
    // If one shape dominates their last 20 games (Opponent page), expect it even if the latest report differs.
    const freq = team?.freq || {};
    const total = sum(Object.values(freq));
    const usual = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const usualShape = usual && usual[1] / total >= 0.6 ? usual[0] : null;
    const shapeRep = usualShape ? reps.find(r => sideOf(r).formation === usualShape) : null;
    const last = (shapeRep || reps[0]) && sideOf(shapeRep || reps[0]);
    const positioned = last?.players.filter(p => p.line) || [];
    const form = positioned.length >= 11 ? formFromSlots(positioned) : formFromString(usualShape || last?.formation);
    const mode = arr => Object.entries(arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
    const style = mode(history.slice(0, 3).map(h => h.style)) || 'Normal';
    const passing = mode(history.slice(0, 3).map(h => h.passing)) || 'Short';

    // Zones: recency-weighted ME stars (undoing that match's style and home bonus).
    let z = null, source = 'estimate';
    const zr = history.filter(h => h.zones);
    if (zr.length) {
      source = 'match-engine';
      z = { def: {}, mid: {}, att: {}, n: { D: {}, M: {}, F: {} }, gk: 0 };
      let wsum = 0;
      zr.slice(0, 5).forEach((h, i) => {
        const w = 0.75 ** i, fx = STYLE_FX[h.style] || STYLE_FX.Normal, hm = h.home ? 1.03 : 1;
        wsum += w;
        for (const l of LANES) {
          z.def[l] = (z.def[l] || 0) + w * (h.zones.def[l] ?? 0) / fx.d / hm;
          z.mid[l] = (z.mid[l] || 0) + w * (h.zones.mid[l] ?? 0) / hm;
          z.att[l] = (z.att[l] || 0) + w * (h.zones.att[l] ?? 0) / fx.a / hm;
        }
        z.gk += w * (h.zones.gk ?? 0) / fx.d / hm;
      });
      for (const k of ['def', 'mid', 'att']) for (const l of LANES) z[k][l] /= wsum;
      z.gk /= wsum;
    } else {
      const o = db.next?.odds;
      let factor = 1;
      if (o) {
        const ours = db.next.weAreHome ? o.home : o.away, theirs = db.next.weAreHome ? o.away : o.home;
        factor = clamp(1 + (theirs - ours) * 0.6, 0.7, 1.35);
      }
      z = JSON.parse(JSON.stringify(toStars(ourRefZ, cal)));
      for (const k of ['def', 'mid', 'att']) for (const l of LANES) z[k][l] *= factor;
      z.gk *= factor;
    }
    for (const line of ['D', 'M', 'F']) for (const l of LANES) z.n[line][l] = form[line][l];

    // Estimated players (quality grade → skills) for advanced-tactic comparisons.
    let xi = null;
    const roster = team?.roster || [];
    if (roster.length && positioned.length >= 11) {
      xi = positioned.map(rp => {
        const r = roster.find(x => x.id === rp.id) || { quality: 'Passable', line: rp.line };
        const q = QUALITY_SKILL[r.quality] ?? 12;
        const sk = {};
        for (const k of SKILLS) sk[k] = 3;
        for (const [k, w] of Object.entries(ROLE_W[rp.line])) sk[k] = w >= 0.25 || rp.line === 'GK' ? q : k === 'SPE' || k === 'STR' ? 7 : q * 0.55;
        Object.assign(sk, db.scouted?.[rp.id]?.sk || {}); // real observed skills beat grade estimates
        const slot = { line: rp.line, lane: rp.lane, code: rp.line === 'GK' ? 'GK' : SLOT_CODES[rp.line][rp.lane] };
        return { slot, p: { name: rp.name, sk, fitness: r.fitness, quality: r.quality }, score: 0 };
      });
    }
    const scoutedN = xi ? xi.filter(x => Object.keys(db.scouted?.[positioned.find(p => p.name === x.p.name)?.id]?.sk || {}).length >= 6).length : 0;
    const tired = roster.filter(r => /tired|drained/i.test(r.fitness || ''));
    const dangers = last ? last.players.filter(p => isFinite(p.rating)).sort((a, b) => b.rating - a.rating).slice(0, 3) : [];
    const isBot = history.length ? history.filter(h => h.bot).length > history.length / 2 : null;
    return { name, team, form, style, passing, z, source, xi, history, dangers, tired, isBot, roster, scoutedN };
  }

  let planCache = { v: -1, plan: null };
  function computePlan() {
    const key = dataVersion + ':' + db.prefs.objective;
    if (planCache.v === key) return planCache.plan;
    const pool = squadPool();
    if (pool.length < 11) return (planCache = { v: key, plan: { error: 'I need your squad first — press “Refresh all” in the Data tab.' } }).plan;
    const cal = calibration();
    const refXI = bestXI(pool, formFromString('4-4-2'));
    const opp = opponentModel(cal, zonesFor(refXI));
    const home = db.next ? db.next.weAreHome !== false : true;
    const oppSide = { z: opp?.z || toStars(zonesFor(refXI), cal), style: opp?.style || 'Normal', passing: opp?.passing || 'Short', home: !home, attitude: 'Normal', atWon: 0 };
    const pts = db.next?.points;
    // grade-based estimates need a clear margin; observed (scouted) skills only a small one for hidden decimals
    const safe = opp?.scoutedN >= 8 ? 0.05 : 0.15;
    const results = [];
    for (const f of FORMATIONS) {
      const xi = bestXI(pool, f);
      if (!xi) continue;
      const z = toStars(zonesFor(xi), cal);
      const at = opp?.xi ? evalATs(xi, opp.xi) : null;
      for (const style of STYLES) {
        const ats = decideATs(at, style, f, opp?.form, safe);
        for (const passing of PASSINGS) {
          const r = simulate({ z, style, passing, home, attitude: 'Normal', atWon: ats?.won || 0 }, oppSide);
          results.push({ f, xi, z, style, passing, ats, at, r, val: objectiveValue(r, db.prefs.objective, pts) });
        }
      }
    }
    results.sort((a, b) => b.val - a.val);
    const best = results[0];
    // Preferred side: compare every option on the chosen setup.
    const base = { z: best.z, style: best.style, passing: best.passing, home, atWon: best.ats?.won || 0, attitude: 'Normal' };
    const prefs = Object.keys(PREF_W).filter(k => k === 'Normal' || Object.keys(PREF_W[k]).every(l => best.f.M[l] + best.f.F[l] > 0))
      .map(k => ({ k, r: simulate({ ...base, pref: k }, oppSide) }))
      .sort((a, b) => objectiveValue(b.r, db.prefs.objective, pts) - objectiveValue(a.r, db.prefs.objective, pts));
    const pref = prefs[0].k;
    base.pref = pref;
    best.r = prefs[0].r;
    const attitudes = Object.fromEntries(['Normal', 'MOTS', 'PIC'].map(a => [a, simulate({ ...base, attitude: a }, oppSide)]));
    const seen = new Set(), alts = [];
    for (const r of results) {
      const k = formDetail(r.f);
      if (seen.has(k)) continue;
      seen.add(k);
      alts.push(r);
      if (alts.length >= 6) break;
    }
    const current = currentLineupEval(pool, oppSide, home, cal);
    const starters = best.xi;
    const profScore = x => denomIdx(x.p.professionalism || '') * 10 + (x.p.age || 0) / 10;
    const captain = starters.slice().sort((a, b) => profScore(b) - profScore(a) || b.score - a.score)[0];
    const penScore = p => (p.penalties ? denomIdx(p.penalties) * 5 : 0) + 0.5 * ((p.sk?.FIN || 0) + (p.sk?.TEC || 0));
    const pens = starters.filter(x => x.slot.line !== 'GK').sort((a, b) => penScore(b.p) - penScore(a.p))[0];
    const plan = { best, alts, opp, oppSide, attitudes, pref, prefs, current, captain, pens, home, pool, cal, total: results.length };
    planCache = { v: key, plan };
    return plan;
  }

  function currentLineupEval(pool, oppSide, home, cal) {
    const lu = db.lineup;
    if (!lu?.starters?.length) return null;
    const xi = [], issues = [];
    for (const s of lu.starters) {
      const slot = slotFromCode(s.slot);
      const p = matchPlayer(s.name, pool, s.id) || matchPlayer(s.name, db.squad?.players || [], s.id);
      if (!slot || !p) { issues.push(`Couldn’t match ${s.name} (${s.slot})`); continue; }
      const f = posFactor(p, slot);
      if (f < 0.99) issues.push(`${p.name} is ${p.line}${p.sides ? ' ' + p.sides : ''} but plays ${slot.code} (−${Math.round((1 - f) * 100)}%)`);
      if (isFinite(p.fit) && p.fit < 80) issues.push(`${p.name} fitness ${p.fit}%`);
      xi.push({ slot, p, score: slotScore(p, slot) });
    }
    if (xi.length < 11) return { issues, partial: true };
    const adv = lu.adv || {};
    const style = /defensive/i.test(adv.estilo_jogo_1) ? 'Defensive' : /attacking/i.test(adv.estilo_jogo_1) ? 'Attacking' : 'Normal';
    const passing = (adv.estilo_jogo_2 || '').split(' ')[0] || 'Short';
    const form = formFromSlots(xi.map(x => x.slot));
    const r = simulate({ z: toStars(zonesFor(xi), cal), style, passing, home, attitude: 'Normal', pref: adv.Preferred_Side }, oppSide);
    return { xi, form, r, issues, style, passing };
  }

  /* =========================================================================
   * Advisors: training, club, scouting
   * ======================================================================= */
  function trainingAdvice() {
    const rows = (db.squad?.players || []).map(p => {
      const t = matchPlayer(p.name, db.training?.rows || [], p.id);
      const allowed = t?.allowed?.length ? new Set(t.allowed.map(norm)) : null;
      const line = p.line || 'M';
      const fit = t?.fit;
      let rec, why;
      if (isFinite(fit) && fit < 75) { rec = 'Fitness'; why = `fitness ${fit}% — league training adds +15%`; }
      else {
        const cands = Object.entries(ROLE_W[line])
          .filter(([k]) => (p.sk?.[k] ?? 0) < 20 && (!allowed || allowed.has(norm(SKILL_NAME[k]))))
          .map(([k, w]) => ({ k, w, v: p.sk?.[k] ?? 0 }))
          .sort((a, b) => b.w - a.w || a.v - b.v);
        const c = cands[0];
        if (c) { rec = SKILL_NAME[c.k]; why = `${SKILL_NAME[c.k]} ${c.v} — ${c.w >= 0.25 ? 'main' : c.k === 'SPE' || c.k === 'STR' ? 'physical' : 'secondary'} skill for a ${line}`; }
        else { rec = 'Physicals'; why = 'position skills maxed'; }
      }
      const warn = [];
      if (p.age >= 31) warn.push('31+: loses 0.4 per skill every league training');
      else if (p.age >= 27) warn.push('27–31: may lose 0.2/skill (professionalism protects)');
      if (t && ['Terrible', 'Very Bad', 'Bad'].includes(t.potential) && p.age >= 22) warn.push(`potential ${t.potential} — little growth left; sell once you have a better replacement`);
      return { p, t, cur: t?.training || '—', rec, why, warn, mismatch: !!t && norm(t.training) !== norm(rec) };
    });
    const counts = {};
    rows.forEach(o => (counts[o.rec] = (counts[o.rec] || 0) + 1));
    return { rows, teamRec: Object.entries(counts).sort((a, b) => b[1] - a[1]), current: db.training?.current };
  }

  function clubAdvice() {
    const tips = [];
    const e = db.economy, sp = db.sponsors, ac = db.academy, st = db.stadium;
    const funds = e?.funds ?? db.me.funds;
    const it = e?.items || {};
    const wages = it['out:Wages and Bonus']?.month || db.squad?.wagesSum || 0;
    const gate = it['in:Gate Receipts']?.month || 0;
    const maint = it['out:Stadium Maintenance']?.month || 0;
    const income = (sp?.weekly || 0) + gate;
    const outflow = wages + (ac?.weekly || it['out:Academy Maintenance']?.month || 0) + maint;
    const net = income - outflow;
    const fin = { funds, wages, income, outflow, net, gateKnown: !!gate, maintKnown: !!maint };
    if (isFinite(funds)) {
      fin.buffer = Math.max(300000, 8 * wages);
      fin.spendable = funds - fin.buffer;
      if (funds < 0) tips.push({ lvl: 'bad', t: 'Funds are negative. Below −100k at Friday’s economy update the board loses confidence; below −200k with <10% confidence you get sacked.' });
    }
    if (!gate) tips.push({ lvl: 'info', t: 'No economy figures yet this month — gate receipts and stadium maintenance show up after the Friday 08:00 update.' });
    if (net < 0 && gate) tips.push({ lvl: 'warn', t: `Weekly cash flow is negative (${fmt$(net)}). Hold off on wage-heavy signings.` });
    if (sp && !sp.major) tips.push({ lvl: 'warn', t: sp.offersOpen ? 'Major sponsor offers are open — pick one whose goal you will realistically reach.' : 'No major sponsor this season (offers withdrawn). Sign one in the pre-season window; until then you get the small weekly contribution.' });
    const homeReps = Object.values(db.reports).filter(r => norm(r.sides[0]?.team) === norm(db.me.name || '') && isFinite(r.attendance));
    if (st?.capacity) {
      const fill = homeReps.length ? avg(homeReps.map(r => r.attendance)) / st.capacity : null;
      fin.fill = fill;
      fin.homeGames = homeReps.length;
      if (fill == null) tips.push({ lvl: 'info', t: 'Home attendance unknown — Refresh all reads your home match reports.' });
      else if (fill > 0.95) {
        const add = Math.round(st.capacity * 0.1 / 500) * 500;
        tips.push({ lvl: 'good', t: `Home games are ~${pct(fill)} full. Adding ${add.toLocaleString()} seats costs ${fmt$(add * (st.seatPrice || 20))} (+ maintenance). Construction takes game-months.` });
      } else if (fill < 0.75) tips.push({ lvl: 'info', t: `Home games only ~${pct(fill)} full — don’t add seats. Supporters (and attendance) grow with wins.` });
      else tips.push({ lvl: 'info', t: `Home games ~${pct(fill)} full (${fin.homeGames} games) — capacity is fine for now.` });
      if (!st.covered) tips.push({ lvl: 'info', t: `Roof: ${fmt$(st.coverCost || 400000)} + ~$10k/week, 2 game-months to build. Low priority while funds are needed for the squad.` });
    }
    if (ac) {
      if (isFinite(ac.promoted) && isFinite(ac.limit)) {
        tips.push(ac.promoted >= ac.limit
          ? { lvl: 'info', t: `All ${ac.limit} academy promotions used. Next season promote all 10 in the first pre-season days — youth train every league game.` }
          : { lvl: 'good', t: `${ac.limit - ac.promoted} academy promotions left — use them now.` });
      }
      if (ac.quality && !/world/i.test(ac.quality)) tips.push({ lvl: 'warn', t: `Academy is ${ac.quality}. Upgrade one level at a time (max 3/season); better academies produce higher-potential youth.` });
      const sp2 = specialityPlan(fin);
      if (sp2) {
        const p = sp2.pick, auto = db.prefs.autoSpeciality ? ' The autopilot sets it' : ' Set it';
        const lines = min => Object.keys(YOUTH_LINES).filter(l => (ROLE_W[l][p.k] || 0) >= min && (min > 0.2 || (ROLE_W[l][p.k] || 0) < 0.2)).join('/');
        const why = `${p.name} (main skill for ${lines(0.25) || '—'}, secondary for ${lines(0.11) || '—'}): each promoted youth starts ~${f1(p.pts)} main-skill points ahead ≈ ${fmt$(sp2.perSeason)}/season of player value vs ${fmt$(sp2.costSeason)} (≈${fmt$(sp2.weekly)}/week + ${fmt$(sp2.oneOff)} spread over ${HORIZON} seasons).`;
        tips.push({
          keep: { lvl: 'good', t: `Speciality ${sp2.has} — the best pick. Keep it.` },
          'keep-other': { lvl: 'info', t: `Speciality ${sp2.has}; ${p.name} would add a little more, but a change costs ${fmt$(sp2.oneOff)} again — keep it.` },
          skip: { lvl: 'info', t: `Speciality not worth it yet: ${why}` },
          save: { lvl: 'info', t: `Speciality — ${why} Needs ${fmt$(sp2.need)} in funds (fee + a season of upkeep + safety buffer); you have ${fmt$(sp2.funds)}.` },
          'next-season': { lvl: 'info', t: `Speciality already changed this season. ${p.name} next season. ${why}` },
          wait: { lvl: 'info', t: `Speciality ${p.name} pays — ${why}${auto} at the start of next season, before promotions (this season's 10 are used).` },
          set: { lvl: 'warn', t: `Speciality ${p.name} pays — ${why}${auto} now; promote this season's youth after it.` },
        }[sp2.verdict]);
      }
      tips.push({ lvl: 'info', t: `Academy branches (${fmt$(ac.branchCost || 200000)} + weekly) only add youth of another nationality — skip unless you need that.` });
    }
    const tr = trainingAdvice();
    const top = tr.teamRec[0];
    if (top) tips.push({ lvl: norm(top[0]) === norm(tr.current || '') ? 'good' : 'warn', t: `Staff training: “${top[0]}” fits ${top[1]} players${tr.current ? ` (now: ${tr.current})` : ''}. Anyone training something else individually only gets 75%.` });
    return { fin, tips };
  }

  /* Staff hiring. Training rule (manual §8/§16): a staff member of level L trains his skill at 75% + 5%·L;
   * players whose individual training matches no staff skill train at 75%. Coaches and Assistant
   * Managers cost the same per level, and an AM also unlocks fitness automation + the squad report. */
  const STAFF_F_ID = { AM: 1, Physio: 2, Scout: 3, Coach: 4 };
  const TRAININGS_PER_WEEK = 2.25; // two league rounds + cup/friendly sessions at half strength
  const POINT_VALUE = 40000; // rule of thumb: what one extra skill point on a squad player is worth
  function staffAdvice(fin) {
    const prices = db.staffPrices || {};
    const have = db.staff || { Coach: 0, Scout: 0, AM: 0, Physio: 0 };
    const known = !!db.staff;
    const wageOf = (role, q) => prices[role]?.[q];
    const out = [];
    const spare = isFinite(fin.funds) && isFinite(fin.buffer) ? Math.max(0, fin.funds - fin.buffer) : 0;
    let allowance = Math.max(0, isFinite(fin.net) ? fin.net : 0) + spare / 22; // spread spare cash over ~two seasons
    const take = w => { allowance -= w; return w; };

    // Training value of putting one more staff member on a skill nobody on the staff trains yet.
    const staffCards = db.training?.staff || [];
    const covered = new Set(staffCards.map(s => norm(s.skill)));
    const staffFactor = q => Math.min(1, 0.75 + 0.05 * (q || 0));
    const tr = trainingAdvice();
    const groups = {};
    for (const r of tr.rows) {
      const t = r.t;
      if (!t) continue;
      const lastSkill = t.last?.[0]?.skill;
      const card = staffCards.find(s => norm(s.skill) === norm(lastSkill || ''));
      const rate = sum((t.last || []).map(l => l.delta || 0)) / (card ? staffFactor(card.q) : 0.75); // per session at 100%
      (groups[r.rec] = groups[r.rec] || []).push({ name: r.p.name, rate });
    }
    const options = [];
    for (const [skill, ps] of Object.entries(groups)) {
      if (covered.has(norm(skill)) || skill === 'Fitness') continue;
      const base = sum(ps.map(p => p.rate));
      for (let q = 1; q <= 5; q++) {
        const w = wageOf('Coach', q) ?? wageOf('AM', q);
        if (!w) continue;
        const pts = base * 0.05 * q * TRAININGS_PER_WEEK; // extra skill points per week
        options.push({ skill, q, w, pts, perPt: pts > 0 ? w / pts : Infinity, players: ps });
      }
    }
    options.sort((a, b) => (b.pts * POINT_VALUE - b.w) - (a.pts * POINT_VALUE - a.w));
    const bestTrain = options.find(o => o.perPt <= POINT_VALUE && o.w <= allowance);
    const bestAny = options.slice().sort((a, b) => a.perPt - b.perPt)[0];
    const trainWhy = o => `${o.players.length} player${o.players.length > 1 ? 's' : ''} on ${o.skill} would gain ~${(o.pts * 11).toFixed(2)} skill points per season (${fmt$(o.perPt)} per point)`;

    // Assistant Manager: same price as a coach, so he takes the first coaching slot.
    if (have.AM) out.push({ role: 'AM', verdict: 'keep', why: 'Already hired. Make sure his training skill is one your manager doesn’t cover.' });
    else if (bestTrain) out.push({ role: 'AM', verdict: 'hire', q: bestTrain.q, w: take(bestTrain.w), why: `Acts as a coach at the same price as one, and adds auto fitness training + the squad report. Train him on ${bestTrain.skill}: ${trainWhy(bestTrain)}.` });
    else if (wageOf('AM', 0) && wageOf('AM', 0) <= allowance) out.push({ role: 'AM', verdict: 'hire', q: 0, w: take(wageOf('AM', 0)), why: 'Cheapest level only: unlocks the Assistant Manager report (shows hidden progression — who is worth keeping) and automatic fitness training. Higher levels don’t pay off yet.' });
    else out.push({ role: 'AM', verdict: 'skip', why: 'No room in the budget right now.' });

    // Coach: only when a second training slot clearly pays for itself.
    const second = bestTrain && !have.AM ? options.find(o => o !== bestTrain && o.skill !== bestTrain.skill && o.perPt <= POINT_VALUE && o.w <= allowance) : bestTrain;
    if (have.Coach) out.push({ role: 'Coach', verdict: 'keep', why: `${have.Coach} hired. Point each at a skill nobody else trains${bestAny ? ` (best now: ${bestAny.skill})` : ''}.` });
    else if (second) out.push({ role: 'Coach', verdict: 'hire', q: second.q, w: take(second.w), why: `Train on ${second.skill}: ${trainWhy(second)}.` });
    else out.push({ role: 'Coach', verdict: 'skip', why: bestAny ? `Best option would be ${bestAny.skill}: ${trainWhy(bestAny)} — above the ~${fmt$(POINT_VALUE)}/point that’s worth paying. Worth it once several young, high-potential players share a skill.` : 'Not enough training data yet — open the Training page.' });

    // Scout: the tactics engine is blind to opponent skills without one.
    const opp = opponentName() && teamByName(opponentName());
    if (have.Scout) out.push({ role: 'Scout', verdict: 'keep', why: 'Use “Scout this Player” on the next opponent’s key players before matchday.' });
    else {
      const q = [4, 3, 2, 1].find(l => wageOf('Scout', l) && wageOf('Scout', l) <= allowance);
      if (q) out.push({ role: 'Scout', verdict: 'hire', q, w: take(wageOf('Scout', q)), why: `Opponent skills are hidden${opp?.manager ? ` (${opp.name} is managed by ${opp.manager})` : ''}, so advanced tactics are judged on estimates and most stay switched off. A scout reveals real skills, writes a report on your next opponent and estimates transfer bids.${q < 4 ? ' Good level would be more accurate when funds allow.' : ''}` });
      else out.push({ role: 'Scout', verdict: 'skip', why: 'Can’t afford one without eating into the safety buffer.' });
    }

    // Physio: only earns his wage when players are actually injured.
    const injured = (db.squad?.players || []).filter(p => isFinite(db.details[p.id]?.health) && db.details[p.id].health < 100);
    if (have.Physio) out.push({ role: 'Physio', verdict: injured.length ? 'keep' : 'review', why: injured.length ? `${injured.length} injured — he is shortening their recovery.` : 'Nobody is injured; fine to keep if injuries are frequent, otherwise his wage can go elsewhere.' });
    else if (injured.length >= 2 || injured.some(p => plannedStarters().has(p.name))) {
      const q = [3, 2, 1].find(l => wageOf('Physio', l) && wageOf('Physio', l) <= allowance);
      out.push(q ? { role: 'Physio', verdict: 'hire', q, w: take(wageOf('Physio', q)), why: `Injured: ${injured.map(p => p.name).join(', ')}. A physio shortens recovery time.` } : { role: 'Physio', verdict: 'skip', why: 'Injuries, but no budget left.' });
    } else out.push({ role: 'Physio', verdict: 'skip', why: injured.length ? `Only ${injured[0].name} is injured and he isn’t in the best XI.` : 'Nobody is injured.' });

    const added = sum(out.filter(o => o.verdict === 'hire').map(o => o.w || 0));
    return { list: out, added, known, pricesKnown: Object.keys(prices).length > 0, netAfter: (fin.net || 0) - added, allowance: Math.max(0, fin.net || 0) + spare / 22 };
  }
  function plannedStarters() {
    try { return new Set((computePlan().best?.xi || []).map(x => x.p.name)); } catch { return new Set(); }
  }

  function scoutingAdvice(plan) {
    if (!plan?.best) return null;
    const pool = plan.pool;
    const xi = plan.best.xi;
    const teamAvg = avg(xi.map(x => x.score));
    const slots = xi.map(x => {
      const depth = pool.filter(p => p !== x.p && posFactor(p, x.slot) >= 0.99).length;
      const main = Object.entries(ROLE_W[x.slot.line]).filter(([, w]) => w >= 0.25).map(([k]) => k);
      return { ...x, depth, gap: teamAvg - x.score, main };
    }).sort((a, b) => b.gap - a.gap || a.depth - b.depth);
    const targets = slots.filter(s => s.gap > 0.6 || s.depth === 0).slice(0, 4).map(s => ({
      slot: s.slot, cur: s.p, curScore: s.score, depth: s.depth,
      profile: s.main.map(k => `${SKILL_NAME[k]} ≥ ${Math.min(20, Math.max(14, Math.ceil((s.p.sk?.[k] || 0) + 3)))}`).join(', '),
    }));
    return { slots, targets };
  }

  function evaluatePagePlayers(plan) {
    const mine = new Set((db.squad?.players || []).map(p => norm(p.name)));
    const others = parseSkillPlayers(document.body).filter(p => !mine.has(norm(p.name)));
    if (!others.length || !plan?.best) return [];
    return others.map(p => {
      let best = null;
      for (const x of plan.best.xi) {
        const d = slotScore(p, x.slot) - x.score;
        if (!best || d > best.d) best = { d, slot: x.slot, replaces: x.p };
      }
      return { p, ...best };
    }).sort((a, b) => b.d - a.d);
  }

  /* =========================================================================
   * Player value: project everyone to the same future so a 17-year-old and a
   * 24-year-old are compared fairly (manual §8: progression −25%/year from 21,
   * skill losses from 27, bigger after 31).
   * ======================================================================= */
  // Skill points per league-training session at 100%, by potential grade (index into DENOMS).
  // Priors from our own players' training gains; model/fit.js refits them from harvested history.
  const GROWTH = [0.05, 0.082, 0.128, 0.135, 0.167, 0.207, 0.25, 0.319, 0.34, 0.38];
  const SESSIONS = 20; // full-strength trainings per season: 18 league rounds + cup/friendly sessions at half strength
  // Manual §8: progression −25%/year from 21, skill losses possible from 27 (certain after 31) — so 26 is the
  // last season of real growth, and the age every player is compared at.
  const PEAK_AGE = 26;
  const HORIZON = 5, DISCOUNT = 0.85;

  // Rating bonus for a talent, given the plan we actually play (effects aren't published — kept small).
  function talentBonus(talent, plan, line) {
    const t = norm(talent || '');
    if (!t || t === 'none' || t === '–') return 0;
    const a = plan?.best?.ats || {}, pass = plan?.best?.passing;
    if (/fast|strong/.test(t)) return 0.3;
    if (/coward|sore loser/.test(t)) return -0.3;
    if (/aggressive/.test(t)) return -0.1;
    if (/motivated starter/.test(t)) return 0.15;
    if (/attack-minded/.test(t)) return line === 'F' || line === 'M' ? 0.15 : -0.1;
    if (/defense-minded/.test(t)) return line === 'D' ? 0.15 : -0.1;
    const uses = { 'short pass': pass === 'Short', 'long pass': pass === 'Long', 'direct pass': pass === 'Direct', 'low pressing': a.pressing === 'Low', 'high pressing': a.pressing === 'High', 'offside trap': a.offside, 'counter attack': a.counter, 'high balls': a.highBalls, 'one on one': a.oneOnOne, 'zonal marking': a.marking === 'Zonal', 'man-to-man': a.marking === 'Man to Man', 'long-shots': a.longShots, 'first-time': a.firstTime };
    const hit = Object.entries(uses).find(([k]) => t.includes(k));
    return hit ? (hit[1] ? 0.25 : 0.05) : 0;
  }

  // Season-by-season skills for one player, training spent where his position gains most. Uses his own
  // measured rate when we have one (our players), else his grade's rate — and, either way, the share of a
  // full session our training actually delivers (staff level, individual vs staff skill).
  function projectSkills(p, line, seasons = HORIZON) {
    const g = denomIdx(p.potential || '');
    const base = (p.rate ?? GROWTH[g >= 0 ? g : 4]) * (p.trainFactor ?? trainingFactor());
    const sk = { ...p.sk };
    const out = [{ age: p.age, sk: { ...sk } }];
    const w = ROLE_W[line];
    for (let s = 1; s <= seasons; s++) {
      const age = (p.age || 22) + s;
      const prevAge = age - 1;
      // progression is fixed until 21, then loses 25% a year; the shown grade already includes past cuts
      const rate = base * 0.75 ** Math.max(0, prevAge - Math.max(p.age || 22, 20));
      let pts = rate * SESSIONS;
      // spend points: highest-weight skill below 20 first (physicals train at half efficiency)
      while (pts > 0.01) {
        const k = Object.keys(w).filter(x => (sk[x] ?? 0) < 20).sort((a, b) => w[b] * (b === 'SPE' || b === 'STR' ? 0.5 : 1) - w[a] * (a === 'SPE' || a === 'STR' ? 0.5 : 1) || (sk[a] ?? 0) - (sk[b] ?? 0))[0];
        if (!k) break;
        const room = 20 - (sk[k] ?? 0);
        const eff = (sk[k] ?? 0) >= 18 ? 0.5 : 1; // gains slow down near the cap
        const use = Math.min(pts, room / eff);
        sk[k] = Math.min(20, (sk[k] ?? 0) + use * eff);
        pts -= use;
      }
      // decline: 27–31 a chance of −0.2 per training, over 31 −0.4 every training, on random skills
      if (prevAge >= 27) {
        const perSession = prevAge > 31 ? 0.4 : 0.2 * Math.min(0.55, 0.15 + 0.1 * (prevAge - 27));
        for (const k of SKILLS) sk[k] = Math.max(0, (sk[k] ?? 0) - perSession * SESSIONS / 12);
      }
      out.push({ age, sk: { ...sk } });
    }
    return out;
  }

  // Rating path at a slot over the horizon, plus the projected rating at 26.
  function valuePath(p, slot, plan) {
    const path = projectSkills(p, slot.line, Math.max(HORIZON, PEAK_AGE - (p.age || 22)));
    const bonus = talentBonus(p.talent, plan, slot.line);
    const rate = s => roleSkill({ sk: s.sk }, slot.line) * posFactor(p, slot) + bonus;
    const ratings = path.map(rate);
    const at26 = p.age >= PEAK_AGE ? ratings[0] : ratings[Math.min(ratings.length - 1, PEAK_AGE - p.age)];
    return { now: ratings[0], at26, ratings: ratings.slice(0, HORIZON + 1) };
  }
  const discounted = rs => sum(rs.map((r, i) => r * DISCOUNT ** i));
  // Players decide to retire from 30 (manual §7) — a future season only counts if he's still likely playing.
  const careerWeight = age => (age < 30 ? 1 : age < 32 ? 0.85 : age < 35 ? 0.6 : 0);
  // 5-season gain of a candidate over the starter he'd replace; this season always counts.
  const seasonGain = (cand, starter, age) => sum(cand.ratings.map((r, i) => (r - starter.ratings[i]) * DISCOUNT ** i * (i ? careerWeight((age || 22) + i) : 1)));

  // Rank candidates (transfer list, search results) against the starter each would replace.
  function rankCandidates(cands, plan) {
    if (!plan?.best) return [];
    const ours = plan.best.xi.map(x => {
      const pl = plan.pool.find(q => q.id === x.p.id) || x.p;
      return { x, v: valuePath({ ...pl, potential: pl.potential }, x.slot, plan) };
    });
    const fin = clubAdvice().fin;
    const roof = db.club?.wageRoof, bill = (db.club?.wages || 0) + (db.club?.pendingWages || 0);
    return cands.map(c => {
      let best = null;
      for (const o of ours) {
        if (o.x.slot.line === 'GK' && c.line !== 'GK') continue;
        const v = valuePath(c, o.x.slot, plan);
        const d5 = seasonGain(v, o.v, c.age);
        if (!best || d5 > best.d5) best = { slot: o.x.slot, vs: o.x.p, v, ov: o.v, d5, dNow: v.now - o.v.now, d26: v.at26 - o.v.at26 };
      }
      const price = c.price || 0;
      const verdict = best.dNow > 0.3 && best.d5 > 0.5 ? 'buy' : best.d26 > 0.5 && best.d5 > -1 ? 'develop' : 'skip';
      const afford = !isFinite(fin.spendable) || price <= fin.spendable;
      const wageOk = !roof || !c.wage || bill + c.wage <= roof;
      return { c, ...best, verdict, afford, wageOk, perMillion: price > 0 ? best.d5 / (price / 1e6) : null };
    }).sort((a, b) => (b.verdict === 'skip' ? -1 : 0) - (a.verdict === 'skip' ? -1 : 0) || b.d5 - a.d5);
  }

  // procurar.asp results (transfer list / free players): skills, grades, talent, wage, price, deadline.
  function parseMarketPage(doc, u) {
    const rows = $$('tr.sq-row', doc).filter(r => playerLink(r) && $$('td.sq-c-sk', r).length >= 12);
    if (!rows.length) return null;
    const list = rows.map(r => {
      const link = playerLink(r);
      const sk = {};
      $$('td.sq-c-sk', r).slice(0, 12).forEach((td, i) => (sk[SKILLS[i]] = num(td.textContent)));
      const pos = posFromTokens(leafTexts(r.querySelector('.sq-c-pos') || r.cells[0])) || {};
      const grades = $$('.sq-qp .inf-grade', r).map(g => g.getAttribute('title'));
      const tal = r.querySelector('.tlf-talc');
      const cells = Array.from(r.cells).map(c => clean(c.textContent));
      const money = cells.filter(t => /^\$[\d.]+/.test(t)).map(t => num(t.match(/^\$[\d.]+/)[0]));
      const ask = r.querySelector('.tlf-pd__p');
      return {
        id: playerId(link), name: clean(link.getAttribute('title') || link.textContent), line: pos.line, sides: pos.sides || '',
        age: num(r.querySelector('.tlf-c-age')?.textContent), sk, quality: grades[0] || null, potential: grades[1] || null,
        talent: tal ? tal.getAttribute('title') : null, wage: money[0] ?? null, free: /lista_livres/i.test(u.pathname),
        price: /lista_livres/i.test(u.pathname) ? 0 : ask ? num(ask.textContent) || 0 : money[1] || 0,
        deadline: clean(r.querySelector('.tlf-pd__d')?.textContent) || null,
      };
    });
    db.market = { rows: list, url: u.pathname + u.search, at: now() };
    mergeListings(list, 'page');
    save();
    return `Market: ${list.length} players`;
  }

  // Small verdict badge next to each name in the game's own results table.
  function badgeMarketRows() {
    if (!/procurar/i.test(location.pathname) || !db.market?.rows?.length) return;
    let ranked;
    try { ranked = rankCandidates(db.market.rows, computePlan()); } catch { return; }
    const byId = new Map(ranked.map(r => [r.c.id, r]));
    for (const row of $$('tr.sq-row')) {
      const r = byId.get(playerId(playerLink(row)));
      const cell = row.querySelector('.sq-c-name');
      if (!r || !cell) continue;
      cell.querySelector('.pmc-badge')?.remove();
      const col = r.verdict === 'buy' ? '#1e7b34' : r.verdict === 'develop' ? '#2f6fde' : '#8a9096';
      const b = document.createElement('span');
      b.className = 'pmc-badge';
      b.title = `PM Copilot: ${r.verdict.toUpperCase()} as ${r.slot.code} vs ${r.vs.name}\nNow ${f1(r.v.now)} (${r.dNow >= 0 ? '+' : ''}${f1(r.dNow)}) · at 26 ${f1(r.v.at26)} (${r.d26 >= 0 ? '+' : ''}${f1(r.d26)}) · 5-season ${r.d5 >= 0 ? '+' : ''}${f1(r.d5)}`;
      b.textContent = `${r.verdict === 'buy' ? 'BUY' : r.verdict === 'develop' ? 'DEV' : '—'} ${r.slot.code} ${r.d5 >= 0 ? '+' : ''}${f1(r.d5)}`;
      b.style.cssText = `display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;font:700 10px/16px system-ui,sans-serif;color:#fff;background:${col};vertical-align:middle;cursor:help`;
      cell.querySelector('a')?.after(b);
    }
  }

  /* ---------- Recruitment: scan the whole market, price it, pick best / budget / steal per slot ---------- */
  // Same parameter set the game's own search form sends (procurar.asp?action=proc_jog, GET-able).
  const SEARCH_BASE = { nome: '', pos: '0', lado: '-1', idd_op: '<', idd: 'Any', temp_op: '<', temp: 'Any', expe_op: '>=', expe: 'Any', con_op: '<', con: 'Any', pro_op: '>', pro: 'Any', vel_op: '>', vel: 'Any', forma_op: '>', forma: 'Any', cab_op: '>', cab: 'Any', ord_op: '<=', ord: 'Any', cul_op: '>', cul: 'Any', pre_op: '<=', pre: 'Any', forca_op: '>', forca: 'Any', lesionado: 'No', prog_op: '>', prog: 'Any', tack_op: '>', tack: 'Any', internacional: 'Any', passe_op: '>', passe: 'Any', pais: '-1', rem_op: '>', rem: 'Any', tec_op: '>', tec: 'Any', jmaos_op: '>', jmaos: 'Any', saidas_op: '>', saidas: 'Any', reflexos_op: '>', reflexos: 'Any', agilidade_op: '>', agilidade: 'Any', qual_op: '>', qual: 'Any', talento: '', nacional: '-1', B1: 'Pesquisar', field: '17', pid: '1', sort: '0', pv: '1' };
  const searchUrl = o => '/procurar.asp?action=proc_jog&' + new URLSearchParams({ ...SEARCH_BASE, ...o }).toString();
  const AUCTION_RATIO = 0.5; // sale fee / player Value, from completed transfers (ttransfer.asp)
  // Share of today's price a player still fetches when sold at a given age (growth to 26, decline from 27,
  // retirement from 30). A prior until the market history says otherwise.
  const RESALE_YEARS = 3;
  const resaleShare = age => (age <= 24 ? 1 : age <= 26 ? 0.85 : age <= 28 ? 0.6 : age <= 30 ? 0.35 : age <= 32 ? 0.15 : 0);
  const SCAN_POS = { GK: 'GR', D: 'D', M: 'M', F: 'A' };
  const SCAN_PAGES = 3; // 30 per page
  // Search-form skill filters and sort fields for each line's two main skills; free-list sort actions.
  const MAIN_FILTER = { GK: [['jmaos', 'HAN', 3], ['saidas', 'CRO', 4]], D: [['tack', 'TCK', 7], ['cab', 'HEA', 8]], M: [['passe', 'PAS', 9], ['cul', 'POS', 10]], F: [['rem', 'FIN', 11], ['tec', 'TEC', 12]] };
  const FREE_SORT = { GK: 'maos', D: 'tackling', M: 'passe', F: 'remate' };
  const PRICE_STEPS = [0, 10e3, 20e3, 30e3, 40e3, 50e3, 60e3, 70e3, 80e3, 90e3, 100e3, 125e3, 150e3, 175e3, 200e3, 250e3, 300e3, 350e3, 400e3, 450e3, 500e3, 600e3, 700e3, 800e3, 900e3, 1e6, 1.25e6, 1.5e6, 1.75e6, 2e6, 2.25e6, 2.5e6, 2.75e6, 3e6, 3.5e6, 4e6, 4.5e6, 5e6, 6e6, 7e6, 8e6, 9e6, 10e6, 20e6];
  // Per line: ready upgrades (main skills near our starters', within the price cap, best first) and
  // prospects (under 22, Very Good+ potential). Thresholds come from our weakest starter in that line.
  function scanQueries(plan) {
    const cap = buyCaps().max;
    const pre = String(PRICE_STEPS.find(p => p >= cap) ?? 'Any');
    return Object.entries(SCAN_POS).flatMap(([line, pos]) => {
      const starters = (plan?.best?.xi || []).filter(x => x.slot.line === line).map(x => x.p);
      const filt = {};
      for (const [param, k] of MAIN_FILTER[line]) {
        const low = starters.length ? Math.min(...starters.map(p => p.sk?.[k] ?? 0)) : 14;
        filt[param + '_op'] = '>';
        filt[param] = String(clamp(Math.floor(low) - 3, 10, 19));
      }
      return [
        { line, kind: 'ready', q: { pos, pre_op: '<=', pre, field: String(MAIN_FILTER[line][0][2]), sort: '1', ...filt } },
        { line, kind: 'prospect', q: { pos, pre_op: '<=', pre, idd_op: '<', idd: '22', prog_op: '>', prog: '6' } },
      ];
    });
  }

  // "31/10/26 06:04" → ms; listings past their deadline are gone.
  const deadlineMs = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/); return m ? new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], m[2] - 1, +m[1], +m[4], +m[5]).getTime() : null; };
  function mergeListings(rows, source) {
    const pool = (db.scan = db.scan || { rows: {}, at: null }).rows;
    for (const r of rows) pool[r.id] = { ...pool[r.id], ...r, source, seenAt: now() };
    for (const [id, r] of Object.entries(pool)) {
      const dl = deadlineMs(r.deadline);
      if ((dl && dl < now()) || now() - r.seenAt > 4 * 86400e3) delete pool[id];
    }
  }

  async function scanMarket(progress = () => {}) {
    const keepPage = db.market; // the scan reuses the page parser; restore what the user is looking at
    let n = 0;
    const take = async (url, label) => {
      const { doc } = await fetchDoc(url);
      const msg = parseMarketPage(doc, new URL(url, location.origin));
      if (!msg) return 0;
      mergeListings(db.market.rows, label);
      return db.market.rows.length;
    };
    for (const s of scanQueries(computePlan())) {
      for (let page = 1; page <= SCAN_PAGES; page++) {
        progress(`Market: ${s.line} ${s.kind} p${page}…`);
        const got = await take(searchUrl({ ...s.q, pid: String(page) }), 'scan');
        n += got;
        if (got < 30) break; // last page
        await sleep(150);
      }
      await sleep(120);
    }
    for (const [line, act] of Object.entries(FREE_SORT)) {
      progress(`Free players: ${line}…`);
      n += await take(`/lista_livres.asp?action=${act}&gid=1&sort=0&pv=1`, 'free');
      await sleep(150);
    }
    db.market = keepPage;
    db.scan.at = now();
    save();
    return n;
  }

  // How much to put into one player: a share of the money in the bank, not of the "spendable" estimate.
  function buyCaps() {
    const funds = db.economy?.funds ?? db.me.funds ?? 0;
    const pct = db.prefs.buyPct || 0.35;
    return { funds, max: Math.max(0, funds * pct), budget: Math.max(0, funds * pct * 0.4), pct };
  }

  // What a player of this level costs: log(price) ~ rating now + growth to 26 + youth (ridge least squares).
  // Learns from the game's Value once we know 12+ (asks are only auction floors), else from asks.
  function fairPriceModel(rows) {
    const vals = db.playerValues || {};
    const byValue = rows.filter(r => vals[r.id]?.value > 0).length >= 12;
    const target = r => (byValue ? vals[r.id]?.value : r.price);
    const data = rows.filter(r => target(r) > 0 && r.age && r.line).map(r => {
      const v = valuePath(r, { line: r.line, lane: (r.sides || 'C')[0], code: '' }, null);
      return { x: [1, v.now, v.at26 - v.now, Math.max(0, 24 - r.age)], y: Math.log(target(r)) };
    });
    if (data.length < 12) return null;
    const k = 4, A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j && i ? 1 : 0))), b = new Array(k).fill(0);
    for (const d of data) for (let i = 0; i < k; i++) { b[i] += d.x[i] * d.y; for (let j = 0; j < k; j++) A[i][j] += d.x[i] * d.x[j]; }
    // Gaussian elimination on the 4×4 normal equations
    for (let i = 0; i < k; i++) {
      let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < k; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const w = new Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) w[i] = (b[i] - sum(A[i].slice(i + 1).map((a, j) => a * w[i + 1 + j]))) / A[i][i];
    return { n: data.length, byValue, price: r => { const v = valuePath(r, { line: r.line, lane: (r.sides || 'C')[0], code: '' }, null); return Math.exp(w[0] + w[1] * v.now + w[2] * (v.at26 - v.now) + w[3] * Math.max(0, 24 - r.age)); } };
  }

  // How much each XI slot matters in this match model: expected points gained from +1 rating there.
  function slotImpact(plan) {
    const b = plan.best;
    const base = { style: b.style, passing: b.passing, home: plan.home, attitude: 'Normal', atWon: b.ats?.won || 0, pref: plan.pref };
    const pts = r => 3 * r.w + r.d;
    const ref = pts(simulate({ ...base, z: toStars(zonesFor(b.xi), plan.cal) }, plan.oppSide));
    const raw = b.xi.map((x, i) => {
      const xi = b.xi.map((y, j) => (j === i ? { ...y, score: y.score + 1 } : y));
      return Math.max(1e-4, pts(simulate({ ...base, z: toStars(zonesFor(xi), plan.cal) }, plan.oppSide)) - ref);
    });
    const mean = avg(raw);
    return new Map(b.xi.map((x, i) => [x.slot, raw[i] / mean])); // 1 = average slot
  }

  // Every listing evaluated at every XI slot of its own line, then the shortlists and a per-slot board.
  function recruitBoard(plan) {
    if (!plan?.best) return null;
    const listings = Object.values(db.scan?.rows || {});
    for (const r of db.market?.rows || []) if (!listings.some(x => x.id === r.id)) listings.push(r);
    const mine = new Set((db.squad?.players || []).map(p => p.id));
    const cands = listings.filter(r => !mine.has(r.id) && r.line);
    const caps = buyCaps();
    const fair = fairPriceModel(cands);
    const roof = db.club?.wageRoof, bill = (db.club?.wages || 0) + (db.club?.pendingWages || 0);
    const ours = plan.best.xi.map(x => { const pl = plan.pool.find(q => q.id === x.p.id) || x.p; return { x, v: valuePath(pl, x.slot, plan) }; });
    const evals = [];
    for (const c of cands) {
      const fairP = fair?.price(c), gameValue = db.playerValues?.[c.id]?.value;
      // the ask is only an auction floor; completed transfers went for ~half the player's Value
      // (median 0.46, ~0.5–0.66 under $750k). Free agents cost a 12-week signing fee instead.
      const worth = gameValue || (fair?.byValue ? fairP : 0) || 0;
      const expPrice = c.free ? 12 * (c.wage || 0) : Math.max(c.price || 0, AUCTION_RATIO * worth);
      // what he still sells for after 3 seasons: young players keep their value, 30+ drain to nothing
      const resale = c.free ? 0 : expPrice * resaleShare((c.age || 22) + RESALE_YEARS);
      const cost = expPrice - DISCOUNT ** RESALE_YEARS * resale + (c.wage || 0) * 11; // net of resale, + a season of wages
      for (const o of ours) {
        if (o.x.slot.line !== c.line) continue;
        const v = valuePath(c, o.x.slot, plan);
        const d5 = seasonGain(v, o.v, c.age);
        evals.push({ c, slot: o.x.slot, vs: o.x.p, v, ov: o.v, d5, dNow: v.now - o.v.now, d26: v.at26 - o.v.at26, cost, perM: cost > 0 ? d5 / (cost / 1e6) : d5 * 10, fair: fairP, value: gameValue, expPrice, cheap: fair?.byValue && fairP && gameValue ? fairP / gameValue : null, wageOk: !roof || !c.wage || bill + c.wage <= roof });
      }
    }
    // weight every gain by how much that slot moves results in this model, so priority positions lead
    const impact = slotImpact(plan);
    for (const e of evals) { e.imp = impact.get(e.slot) || 1; e.w = e.d5 * e.imp; e.roi = e.cost > 0 ? e.w / (e.cost / 1e6) : e.w * 10; }
    const bestPer = new Map();
    for (const e of evals) if (!bestPer.has(e.c.id) || e.w > bestPer.get(e.c.id).w) bestPer.set(e.c.id, e);
    const uniq = [...bestPer.values()].filter(e => e.d5 > 0.5 && e.wageOk);
    const within = cap => uniq.filter(e => e.expPrice <= cap);
    // the cream only: highest first, one per position, nobody twice
    const taken = new Set();
    const pick = (arr, key, n) => {
      const out = [], slotsUsed = new Set();
      for (const e of arr.slice().sort((a, b) => key(b) - key(a))) {
        if (out.length >= n) break;
        if (slotsUsed.has(e.slot) || taken.has(e.c.id)) continue;
        out.push(e); slotsUsed.add(e.slot); taken.add(e.c.id);
      }
      return out;
    };
    // long-term upgrades only: an old player is a stopgap, and shows up under Best value if he's cheap enough
    const maxAge = db.prefs.maxBuyAge ?? 29;
    const best = pick(within(caps.max).filter(e => e.c.age <= maxAge), e => e.w, 3);
    // value: most priority-weighted gain per $1M of expected cost (fee + a season of wages); a real upgrade only
    const value = pick(within(caps.max).filter(e => e.d5 > 1.5), e => e.roi * (e.cheap ? Math.min(1.5, e.cheap) : 1), 3);
    // what more money would buy: biggest upgrades above the cap, under 30, within 80% of funds
    const stretch = pick(uniq.filter(e => e.expPrice > caps.max && e.expPrice <= caps.funds * 0.8 && e.c.age <= maxAge), e => e.w, 2);
    const slots = ours.map(o => {
      const forSlot = evals.filter(e => e.slot === o.x.slot && e.d5 > 0.5 && e.wageOk && e.expPrice <= caps.max);
      const one = (key, ok = () => true) => forSlot.filter(ok).sort((a, b) => key(b) - key(a))[0] || null;
      return { slot: o.x.slot, starter: o.x.p, ov: o.v, imp: impact.get(o.x.slot) || 1, best: one(e => e.w, e => e.c.age <= maxAge), value: one(e => e.roi) };
    }).sort((a, b) => b.imp - a.imp);
    return { caps, fair, best, value, stretch, slots, maxAge, minNational: db.academy?.minNational, n: cands.length, scannedAt: db.scan?.at };
  }

  // The game's own Value for the shortlist (player page), to show how far under value a price is.
  async function fetchValues(entries, progress = () => {}) {
    db.playerValues = db.playerValues || {};
    for (const e of entries) {
      if (db.playerValues[e.c.id] && now() - db.playerValues[e.c.id].at < 86400e3) continue;
      progress(`Value: ${e.c.name}…`);
      try {
        const { doc } = await fetchDoc('/ver_jogador.asp?jog_id=' + e.c.id);
        const v = num((flatText(doc.body).match(/Contract Length\s*\d+\s*years?\s*Wage\s*\$?[\d.,]+\s*Value\s*\$?([\d.,]+)/i) || flatText(doc.body).match(/\bValue\s*\$([\d.,]+)/) || [])[1]);
        if (isFinite(v)) db.playerValues[e.c.id] = { value: v, at: now() };
      } catch { /* skip */ }
      await sleep(120);
    }
    save();
  }
  async function runScan(progress = () => {}) {
    const n = await scanMarket(progress);
    // a fetched Value can push a player over budget, so refill the shortlist once and value the newcomers
    for (let pass = 0; pass < 2; pass++) {
      const board = recruitBoard(computePlan());
      if (!board) break;
      const short = [...new Map([...board.best, ...board.value, ...board.stretch, ...board.slots.flatMap(s => [s.best, s.value])].filter(Boolean).map(e => [e.c.id, e])).values()].filter(e => !e.c.free);
      await fetchValues(short, progress);
    }
    logAction('market', `Scanned ${n} listings · ${Object.keys(db.scan?.rows || {}).length} live`);
    return [`${Object.keys(db.scan?.rows || {}).length} live listings scanned`];
  }

  /* =========================================================================
   * Apply to the game's own pages. Every function takes a page context
   * { doc, win } so it works on the live tab or inside a hidden frame.
   * ======================================================================= */
  const LIVE = () => ({ doc: document, win: PAGE });
  function setSelect(sel, wants, win = PAGE) {
    if (!sel) return null;
    for (const w of [].concat(wants).filter(Boolean)) {
      const nw = norm(w).replace(/\s+/g, '');
      const opts = Array.from(sel.options);
      const opt = opts.find(o => norm(o.textContent).replace(/\s+/g, '') === nw) || opts.find(o => nameScore(o.textContent, w) >= 80);
      if (!opt) continue;
      // a native event reaches both plain listeners and jQuery handlers
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      try { win.jQuery?.(sel).selectmenu('refresh'); } catch { /* not a selectmenu widget */ }
      return clean(opt.textContent);
    }
    return null;
  }

  // Rebuilds the pitch the same way the page's own loader does (removePlayer → holders → setPlayer).
  function applyXI(xi, { doc, win } = LIVE()) {
    const $ = win.jQuery;
    if (!$ || typeof win.setPlayer !== 'function' || !win.$positionsDropdown) throw new Error('Lineup editor not ready');
    const target = {};
    const centre = {};
    for (const line of ['D', 'M', 'F']) centre[line] = xi.filter(x => x.slot.line === line && x.slot.lane === 'C');
    for (const x of xi) {
      const { line, lane } = x.slot;
      if (line === 'GK') { target.gr = x.p.id; continue; }
      const pre = { D: 'd', M: 'm', F: 'a' }[line];
      if (lane === 'L') target[pre + 'e'] = x.p.id;
      else if (lane === 'R') target[pre + 'd'] = x.p.id;
    }
    for (const line of ['D', 'M', 'F']) {
      const pre = { D: 'd', M: 'm', F: 'a' }[line];
      const keys = { 1: ['c2'], 2: ['c1', 'c3'], 3: ['c1', 'c2', 'c3'] }[centre[line].length] || [];
      centre[line].forEach((x, i) => (target[pre + keys[i]] = x.p.id));
    }
    const ids = Object.values(target);
    if (ids.length !== 11 || ids.some(id => !id || !doc.getElementById(id))) throw new Error('Some players are missing from the lineup list');
    $('#starting_eleven .player-row .player-info').each((_, el) => win.removePlayer(el.id));
    $('#starting_eleven .player-row').remove();
    win.selectedpositions.length = 0;
    for (const pos of Object.keys(target)) {
      win.selectedpositions.push(pos);
      const holder = $('<div class="player-holder player-row" data-pos="' + pos + '" data-posgroup="' + pos.charAt(0) + '"></div>');
      holder.append(win.$positionsDropdown.clone());
      $('#starting_eleven').append(holder);
      holder.find('.pos-dropdown').customselectmenu({ change() { $(this).change(); } });
    }
    for (const [pos, id] of Object.entries(target)) win.setPlayer(id, pos);
    $('.football-table .player[data-pos]').each((_, p) => {
      if (target[p.dataset.pos]) return;
      p.removeAttribute('data-player');
      $(p).find('.player-pos').addClass('reset').removeAttr('style');
      $(p).find('.player-name').html('');
    });
    return Object.keys(target).length;
  }

  // Without opponent estimates every AT stays off: a lost AT is a penalty, an unused one costs nothing.
  const SAFE_ATS = { pressing: 'Normal', offside: false, counter: false, highBalls: false, oneOnOne: false, keeping: 'Not Defined', marking: 'Not Defined', longShots: false, firstTime: false };
  function applyPlan(plan, ctx = LIVE()) {
    const { doc, win } = ctx;
    const b = plan.best, a = b.ats || SAFE_ATS;
    const yn = v => (v ? 'Yes' : 'No');
    const done = [], failed = [];
    // open every advanced-option group so the values are visible (the page saves this open state too)
    $$('.adv-option-item .ui-icon-circle-plus', doc).forEach(i => i.click());
    const set = (id, v) => { const r = setSelect(doc.getElementById(id), v, win); (r ? done : failed).push(id.replace(/_/g, ' ') + (r ? ' → ' + r : '')); };
    try { done.push(`XI (${applyXI(b.xi, ctx)} players)`); } catch (e) { failed.push('XI: ' + e.message); }
    set('estilo_jogo_1', b.style === 'Normal' ? 'Neutral' : b.style);
    set('estilo_jogo_2', b.passing + ' Passing');
    set('Pressing', a.pressing); set('Offside_Trap', yn(a.offside)); set('Counter_Attack', yn(a.counter));
    set('High_Balls', yn(a.highBalls)); set('One_on_Ones', yn(a.oneOnOne)); set('Keeping_Style', a.keeping);
    set('Marking', a.marking); set('RematesLonge', yn(a.longShots)); set('RematesPrimeira', yn(a.firstTime));
    set('Tackling', 'Normal');
    set('Preferred_Side', plan.pref);
    if (plan.captain) set('Team_Captain', plan.captain.p.name);
    if (plan.pens) set('pk1', plan.pens.p.name);
    if (typeof win.changed === 'function') win.changed();
    return { done, failed, xiOk: !failed.some(f => f.startsWith('XI')) };
  }

  const scoutStale = () => {
    const o = opponentName(), t = o && teamByName(o);
    return !!o && (!t?.scoutedAt || now() - t.scoutedAt > 12 * 3600e3);
  };
  // Which match a Starting Eleven page is editing ("Default Orders" or "vs X @ date").
  function ordersContext(doc = document) {
    const sel = doc.querySelector('select[name="lista_j"]');
    const label = clean(sel?.options[sel.selectedIndex]?.textContent);
    const opp = opponentName();
    const nextOpt = sel && opp ? Array.from(sel.options).find(o => norm(o.textContent).includes(norm(opp))) : null;
    if (nextOpt && db.next) db.next.ordersUrl = '/' + nextOpt.value.replace(/^\//, '');
    return { label, isDefault: /default/i.test(label), forNext: !!opp && norm(label).includes(norm(opp)) };
  }
  const planSignature = plan => JSON.stringify([formDetail(plan.best.f), plan.best.xi.map(x => x.p.id), plan.best.style, plan.best.passing, plan.best.ats, plan.pref]);
  const matchKey = () => (db.next ? `${db.next.date}|${db.next.home}|${db.next.away}` : null);
  const prep = () => { const k = matchKey(); db.prep = db.prep || {}; return k ? (db.prep[k] = db.prep[k] || {}) : {}; };
  function logAction(kind, text, ok = true) {
    db.actions = [{ at: now(), kind, text, ok }, ...(db.actions || [])].slice(0, 40);
    save();
  }

  // Loads a game page in a hidden same-origin frame so its own scripts run, then hands over { doc, win }.
  function withFrame(url, ready, fn, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;width:1200px;height:900px;left:-3000px;top:0;opacity:0;pointer-events:none';
      f.src = url;
      const t0 = now();
      const done = (err, v) => { f.remove(); err ? reject(err) : resolve(v); };
      f.onload = () => {
        f.onload = null; // later loads (form submits inside the frame) are handled by fn itself
        const tick = async () => {
          try {
            const win = f.contentWindow, doc = f.contentDocument;
            if (doc && ready({ doc, win })) return done(null, await fn({ doc, win, frame: f }));
            if (now() - t0 > timeout) return done(new Error('Page took too long: ' + url));
            setTimeout(tick, 250);
          } catch (e) { done(e); }
        };
        tick();
      };
      document.body.appendChild(f);
    });
  }
  const waitFor = async (test, ms = 8000) => { const t0 = now(); while (!test()) { if (now() - t0 > ms) return false; await sleep(150); } return true; };
  const lineupReady = ({ doc, win }) => !!(win.setPlayer && win.$positionsDropdown && doc.querySelector('#starting_eleven .player-row'));

  async function saveOrders(ctx) {
    const btn = ctx.doc.getElementById('savebutton');
    if (!btn) return false;
    btn.click();
    return waitFor(() => /\bsaved\b/.test(btn.className) || /error/.test(btn.className));
  }

  // Match orders: live page if we're on it, otherwise a hidden frame.
  async function applyOrders({ force = false } = {}) {
    if (scoutStale()) await scoutOpponent(() => {});
    const plan = computePlan();
    if (plan.error) throw new Error(plan.error);
    const sig = planSignature(plan);
    const p = prep();
    if (!force && p.orders?.sig === sig) return null; // already applied — keep manual tweaks
    const run = async ctx => {
      const res = applyPlan(plan, ctx);
      const saved = res.xiOk && db.prefs.autoSave ? await saveOrders(ctx) : false;
      return { ...res, saved };
    };
    let res;
    const here = /titulares/i.test(location.pathname) && ordersContext().forNext && PAGE.setPlayer;
    if (here) res = await run(LIVE());
    else {
      if (!db.next?.ordersUrl) {
        const { doc } = await fetchDoc('/titulares_v3.asp');
        ordersContext(doc);
      }
      if (!db.next?.ordersUrl) throw new Error('Could not find this match in Starting Eleven');
      res = await withFrame(db.next.ordersUrl, lineupReady, async ctx => { ordersContext(ctx.doc); return run(ctx); });
    }
    p.orders = { sig, at: now(), saved: res.saved, failed: res.failed };
    logAction('orders', `${formLabel(plan.best.f)} ${plan.best.style}/${plan.best.passing}${plan.best.ats ? '' : ' (ATs off)'} vs ${plan.opp?.name}${res.saved ? ' · saved' : ' · not saved'}`, res.xiOk);
    return res;
  }

  /* ---------- Training: individual + staff, through the training page itself ---------- */
  function applyTraining(doc = document, win = PAGE) {
    const adv = trainingAdvice();
    let n = 0;
    for (const row of $$('tr.sq-row', doc)) {
      const sel = row.querySelector('select[name="atributos"]');
      const r = sel && adv.rows.find(x => x.p.id === row.dataset.jog);
      if (!r || !r.mismatch) continue;
      if (setSelect(sel, r.rec, win)) n++;
    }
    return n;
  }
  function staffTrainingTarget(doc) {
    const adv = trainingAdvice();
    const staff = $$('form', doc).find(f => /treinarglobal/i.test(f.getAttribute('action') || ''))?.querySelector('select[name="atributos"]');
    const top = adv.teamRec.find(([skill]) => staff && Array.from(staff.options).some(o => norm(o.textContent) === norm(skill)));
    return staff && top && norm(staff.options[staff.selectedIndex]?.textContent) !== norm(top[0]) ? { staff, skill: top[0] } : null;
  }
  async function autoTraining() {
    const ready = ({ doc }) => !!doc.querySelector('select[name="atributos"]');
    const changed = await withFrame('/treinos.asp?equipa=A', ready, async ({ doc, win, frame }) => {
      const n = applyTraining(doc, win);
      if (n) {
        doc.querySelector('select[name="atributos"]').form.querySelector('input[type=submit][name=trein]').click();
        await new Promise(r => frame.addEventListener('load', r, { once: true }));
        await waitFor(() => !!frame.contentDocument?.querySelector('select[name="atributos"]'));
      }
      const d2 = frame.contentDocument, st = staffTrainingTarget(d2);
      if (st) {
        setSelect(st.staff, st.skill, frame.contentWindow);
        st.staff.form.querySelector('input[type=submit][name=trein]').click();
        await new Promise(r => frame.addEventListener('load', r, { once: true }));
      }
      return { n, staff: st?.skill };
    });
    await grab('/treinos.asp?equipa=A');
    if (changed.n || changed.staff) logAction('training', `${changed.n} individual order${changed.n === 1 ? '' : 's'} changed${changed.staff ? ` · staff → ${changed.staff}` : ''}`);
    return changed;
  }

  /* ---------- Contracts: renew keepers at 1 year left, at their minimum asked wage ---------- */
  function contractVerdict(c, starters) {
    const pot = denomIdx(c.potential || ''), q = denomIdx(c.quality || '');
    const keep = starters.has(c.name) || (c.age <= 23 && pot >= denomIdx('Good')) || (q >= denomIdx('Very Good') && c.age <= 28);
    const declining = pot <= denomIdx('Bad') && c.age >= 28;
    return keep && !declining;
  }
  async function autoRenew() {
    const { doc } = await fetchDoc('/contratos.asp');
    parseContractsPage(doc);
    const starters = plannedStarters();
    const due = (db.contracts?.rows || []).filter(c => c.years <= 1 && c.renewable && contractVerdict(c, starters));
    const out = [];
    for (const c of due) {
      const { doc: rd } = await fetchDoc('/renovar.asp?jg_id=' + c.id);
      const form = rd.querySelector('form[action*="aceitar"]');
      if (!form) { out.push(`${c.name}: no renewal form`); continue; }
      const offer = num(form.querySelector('[name="o_ofer"]')?.value);
      const roof = num(form.dataset.roof), wages = num(form.dataset.wages), cur = num(form.dataset.current);
      if (isFinite(roof) && wages - cur + offer > roof) { logAction('contract', `${c.name}: asks ${fmt$(offer)} — over the wage roof`, false); continue; }
      const opts = Array.from(form.querySelectorAll('[name="dur_p"] option')).map(o => +o.value);
      const years = c.age <= 24 ? Math.max(...opts) : c.age <= 28 ? Math.min(2, Math.max(...opts)) : Math.min(...opts);
      const body = new URLSearchParams({ o_ofer: String(offer), dur_p: String(years), jg_id: c.id, Submit: 'Offer' });
      const res = await fetch(form.getAttribute('action'), { method: 'POST', body, credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const ok = res.ok;
      logAction('contract', `${c.name}: offered ${fmt$(offer)}/wk for +${years} year${years > 1 ? 's' : ''}`, ok);
      out.push(c.name);
      await sleep(300);
    }
    if (due.length) { const { doc: d2 } = await fetchDoc('/contratos.asp'); parseContractsPage(d2); }
    db.contractsCheckedAt = now();
    save();
    return out;
  }

  /* ---------- Academy speciality (manual §10) ----------
   * A speciality makes every promoted youth start at 10–20 in that skill (instead of ≤10, ≤12 for
   * Speed/Strength) but caps his other non-physical skills at 8. One change per season. Promoted
   * positions are random, so a skill is worth what it adds across the lines youth land in. */
  const SPEC_ID = { POS: 7, STR: 4, HAN: 8, HEA: 2, PAS: 1, FIN: 5, CRO: 9, TCK: 3, TEC: 6, SPE: 10, REF: 11, AGI: 12 };
  const YOUTH_LINES = { GK: 0.1, D: 0.35, M: 0.35, F: 0.2 };
  const WEEKS_PER_SEASON = 13;
  const YOUTH_KEPT = 0.5; // share of promoted youth good enough to play or sell
  function specialityPlan(fin) {
    const ac = db.academy;
    if (!ac?.quality || /none/i.test(ac.quality)) return null;
    const MAIN = 0.27;
    const use = k => sum(Object.entries(YOUTH_LINES).map(([l, s]) => s * (ROLE_W[l][k] || 0))) / MAIN;
    // main-skill points gained per youth: spec skill averages 15 (vs ~6, physicals ~8), minus the 9–10s lost elsewhere
    const opts = SKILLS.map(k => ({ k, name: SKILL_NAME[k], id: SPEC_ID[k], use: use(k), pts: (15 - (k === 'SPE' || k === 'STR' ? 8 : 6)) * use(k) - 0.9 }))
      .sort((a, b) => b.pts - a.pts);
    const pick = opts[0];
    const oneOff = ac.newSpeciality || 1000000;
    // the manual prices a speciality at 2× a World Class academy's upkeep; the page shows our real academy cost
    const weekly = 2 * (ac.weekly || 15000);
    const perSeason = (ac.limit || 10) * YOUTH_KEPT * pick.pts * POINT_VALUE;
    const costSeason = weekly * WEEKS_PER_SEASON + oneOff / HORIZON;
    const has = ac.speciality && !/none/i.test(ac.speciality) ? ac.speciality : null;
    const funds = fin?.funds ?? db.me.funds;
    const need = oneOff + weekly * WEEKS_PER_SEASON + (fin?.buffer ?? 300000);
    const r = { opts, pick, oneOff, weekly, perSeason, costSeason, net: perSeason - costSeason, has, funds, need, changes: ac.specChanges };
    if (has) r.verdict = norm(has) === norm(pick.name) ? 'keep' : 'keep-other';
    else if (r.net <= 0) r.verdict = 'skip';
    else if (!(funds >= need)) r.verdict = 'save';
    else if (ac.specChanges > 0) r.verdict = 'next-season';
    // only when this season's promotions are still to come, so the upkeep buys youth straight away
    else if (isFinite(ac.promoted) && isFinite(ac.limit) && ac.promoted >= ac.limit) r.verdict = 'wait';
    else r.verdict = 'set';
    return r;
  }
  async function autoSpeciality() {
    const { doc } = await fetchDoc('/academia.asp');
    parseAcademyPage(doc);
    const r = specialityPlan(clubAdvice().fin);
    if (r?.verdict !== 'set') return;
    const post = (url, body) => fetch(url, { method: 'POST', body: new URLSearchParams(body), credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const res = await post('/academia.asp?action=nova_especialidade', { especialidade: String(r.pick.id) });
    // "Next >>" leads to a confirmation form; submit it as-is
    const d = new DOMParser().parseFromString(await res.text(), 'text/html');
    const conf = Array.from(d.forms).find(f => /academia/i.test(f.getAttribute('action') || '') && !f.querySelector('select[name="academia"],select[name="especialidade"],select[name="country"]'));
    if (conf) {
      const body = {};
      conf.querySelectorAll('input[name],select[name]').forEach(i => { if (!/checkbox|radio/.test(i.type) || i.checked) body[i.name] = i.value; });
      await post(new URL(conf.getAttribute('action'), location.origin + '/').href, body);
    }
    await sleep(150);
    const { doc: d2 } = await fetchDoc('/academia.asp');
    parseAcademyPage(d2);
    const ok = norm(db.academy?.speciality || '') === norm(r.pick.name);
    logAction('academy', ok ? `Speciality set to ${r.pick.name} (${fmt$(r.oneOff)} + ~${fmt$(r.weekly)}/week)` : `Speciality ${r.pick.name}: not confirmed by the page`, ok);
  }

  /* ---------- Youth team (manual §9) ----------
   * Youth-team players train at full league strength every league round without playing; a 17–18-year-old
   * sitting out in the main squad gets the non-player penalty instead (nothing at all after cups/friendlies).
   * They can't play while there, but can be promoted back any time. */
  function youthMoves(plan) {
    const players = db.squad?.players || [];
    const xi = new Set((plan?.best?.xi || []).map(x => x.p.id));
    const cover = line => players.filter(p => p.tier !== 3 && !p.toYouth && p.line === line && !xi.has(p.id)).length;
    // keep 11 + 3 subs available, and a spare keeper
    let avail = players.filter(p => p.tier !== 3).length;
    const back = players.filter(p => p.toYouth && !xi.has(p.id)).map(p => {
      const ok = (p.line !== 'GK' || cover('GK') > 0) && avail > 14;
      if (ok) avail--;
      return { p, ok, why: ok ? '' : avail <= 14 ? 'squad too thin' : 'only spare keeper' };
    });
    const bOld = players.filter(p => p.tier === 1 && p.age >= 22);
    const youth = players.filter(p => p.tier === 3);
    return { back, bOld, youth };
  }
  async function autoYouth() {
    let plan;
    try { plan = computePlan(); } catch { return; }
    if (!plan?.best) return;
    const moves = youthMoves(plan).back.filter(m => m.ok);
    for (const { p } of moves) {
      const res = await fetch(`/plantel.asp?action=despromover&to=y&jog_id=${p.id}&filtro=1&equipa=2`, { credentials: 'include' });
      logAction('youth', `${p.name} (${p.age}) back to the youth team — full training every league round`, res.ok);
      await sleep(150);
    }
    if (moves.length) {
      const u = new URL('/plantel.asp?equipa=2&pos=', location.origin);
      parseSquadPage((await fetchDoc(u.href)).doc, u);
    }
    db.youthCheckedAt = now();
  }

  /* ---------- Match-day events, rebuilt for each match ---------- */
  const SCRIPT_EVENT_RE = /^(Style|Substitution)\s*(60'Losing, by 1\+|70'Losing, by 1\+|75'Drawing(?!\s*\/)|80'Winning, by 1(?!\+)|65'Winning, by 2\+|75'Winning, by 2\+)/;
  function planEvents(plan, reserved, maxSubs) {
    const xi = plan.best.xi, pass = plan.best.passing, style = plan.best.style;
    const inXI = new Set(xi.map(x => x.p.id));
    const bench = plan.pool.filter(p => !inXI.has(p.id) && !reserved.has(p.id));
    const used = new Set();
    const st = s => ({ tipo: 1, novo_estilo: `${s === 'Normal' ? 'Neutral' : s} / ${pass} Passing` });
    const ev = [];
    // style swings around the match state
    if (style !== 'Attacking') ev.push({ desc: `Losing at 60′ → Attacking / ${pass}`, minuto: 60, resultado: -1, golos: 1, oumais: 1, ...st('Attacking') });
    if (style === 'Defensive') ev.push({ desc: `Drawing at 75′ → Neutral / ${pass}`, minuto: 75, resultado: 0, ...st('Normal') });
    else ev.push({ desc: `Winning by 1 at 80′ → Defensive / ${pass}`, minuto: 80, resultado: 1, golos: 1, ...st('Defensive') });
    if (style !== 'Defensive') ev.push({ desc: `Player sent off → Defensive / ${pass}`, trigger: 1, pos_expulsao: -1, ...st('Defensive') });
    // substitutions (leave room for injuries)
    let subs = Math.min(3, maxSubs);
    const outOk = x => x.slot.line !== 'GK' && !reserved.has(x.p.id) && !used.has(x.p.id);
    const likeForLike = x => bench.filter(b => !used.has(b.id) && posFactor(b, x.slot) >= 0.86).map(b => ({ b, s: slotScore(b, x.slot) })).sort((a, c) => c.s - a.s)[0];
    // chasing the game: an extra forward for the weakest midfielder (or spare defender)
    const fwd = bench.filter(b => !used.has(b.id)).map(b => ({ b, s: slotScore(b, { line: 'F', lane: 'C' }) })).sort((a, c) => c.s - a.s)[0];
    const nM = xi.filter(x => x.slot.line === 'M').length, nD = xi.filter(x => x.slot.line === 'D').length;
    const sacrifice = xi.filter(x => outOk(x) && ((x.slot.line === 'M' && nM > 2) || (x.slot.line === 'D' && nD > 3))).sort((a, c) => a.score - c.score)[0];
    if (subs && fwd && fwd.s > 6 && sacrifice) {
      ev.push({ desc: `Losing at 70′ → ${surname(fwd.b.name)} on for ${surname(sacrifice.p.name)} as CF`, minuto: 70, resultado: -1, golos: 1, oumais: 1, tipo: 0, jog_sai: sacrifice.p.id, jog_entra: fwd.b.id, new_pos_sub: 8 });
      used.add(sacrifice.p.id); used.add(fwd.b.id); subs--;
    }
    // game won: rest the most tired starters, give minutes to the bench
    const tiredFirst = xi.filter(outOk).sort((a, c) => (a.p.fit ?? 100) - (c.p.fit ?? 100) || (c.p.age || 0) - (a.p.age || 0));
    for (const minute of [65, 75]) {
      if (!subs) break;
      for (const x of tiredFirst) {
        if (used.has(x.p.id)) continue;
        const r = likeForLike(x);
        if (!r || r.s < 0.75 * x.score) continue;
        ev.push({ desc: `Winning by 2+ at ${minute}′ → ${surname(r.b.name)} for ${surname(x.p.name)}`, minuto: minute, resultado: 1, golos: 2, oumais: 1, tipo: 0, jog_sai: x.p.id, jog_entra: r.b.id, new_pos_sub: -1 });
        used.add(x.p.id); used.add(r.b.id); subs--;
        break;
      }
    }
    return ev;
  }
  function eventParams(form, spec) {
    const p = new URLSearchParams();
    for (const el of form.elements) {
      if (!el.name || el.type === 'button' || el.type === 'submit') continue;
      if (el.type === 'checkbox') continue;
      p.set(el.name, el.value);
    }
    const base = { eid: 0, estado: 0, trigger: 0, pos_expulsao: -1, apos_golo: -1, tipo_evento: 0, minuto: 0, resultado: 10, golos: 0, prioridade: 0, new_pos_sub: -1 };
    for (const [k, v] of Object.entries(base)) p.set(k, String(v));
    for (const [k, v] of Object.entries(spec)) {
      if (k === 'desc') continue;
      if (k === 'tipo') { p.set('tipo_evento', String(v)); continue; }
      if (k === 'oumais') { if (v) p.set('oumais', '1'); continue; }
      if (k === 'novo_estilo') {
        const want = norm(v).replace(/\s+/g, '');
        const o = Array.from(form.querySelector('[name="novo_estilo"]').options).find(x => norm(x.textContent).replace(/\s+/g, '') === want);
        if (o) p.set('novo_estilo', o.value);
        continue;
      }
      p.set(k, String(v));
    }
    return p;
  }
  async function autoEvents() {
    const plan = computePlan();
    if (plan.error) throw new Error(plan.error);
    const sig = planSignature(plan);
    const pr = prep();
    if (pr.events?.sig === sig) return null;
    let { doc } = await fetchDoc('/eventos.asp');
    parseEventsPage(doc);
    // fresh install (or cleared data): recognise events this script creates by their trigger pattern
    if (!db.myEvents?.length) db.myEvents = db.events.list.filter(e => SCRIPT_EVENT_RE.test(e.text)).map(e => e.id);
    const mine = new Set(db.myEvents || []);
    for (const e of db.events.list.filter(e => mine.has(e.id))) { await fetch(`/eventos.asp?action=apagar&eID=${e.id}&te=0`, { credentials: 'include' }); await sleep(120); }
    const others = db.events.list.filter(e => !mine.has(e.id));
    const reserved = new Set(others.flatMap(e => e.players));
    const specs = planEvents(plan, reserved, 5 - others.filter(e => e.type === 'sub').length);
    const form = doc.querySelector('form[action*="guardar"]');
    if (!form) throw new Error('Events form not found');
    for (const s of specs) {
      await fetch(form.getAttribute('action'), { method: 'POST', body: eventParams(form, s), credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      await sleep(150);
    }
    ({ doc } = await fetchDoc('/eventos.asp'));
    parseEventsPage(doc);
    const otherIds = new Set(others.map(e => e.id));
    db.myEvents = db.events.list.filter(e => !otherIds.has(e.id)).map(e => e.id);
    pr.events = { sig, at: now(), n: db.myEvents.length, list: specs.map(s => s.desc) };
    logAction('events', `${db.myEvents.length} match events set (kept ${others.length} of yours)`);
    save();
    return specs;
  }

  /* ---------- Lectures: best expected morale change, once per match ---------- */
  function lectureChoice(L) {
    if (!L?.cards?.length) return null;
    // expected morale change = change × (P(success) − P(failure))
    const scored = L.cards.map(c => ({ ...c, ev: c.change * (2 * c.rate - 1) })).sort((a, b) => b.ev - a.ev);
    return scored[0].ev > 0.05 ? scored[0] : { none: true, best: scored[0] };
  }
  async function autoLecture() {
    const pr = prep();
    if (pr.lecture) return null;
    const { doc } = await fetchDoc('/palestras.asp');
    parseLecturePage(doc);
    const L = db.lecture;
    if (!L.available) { pr.lecture = { at: now(), skipped: 'not available right now' }; save(); return null; }
    const c = lectureChoice(L);
    if (!c || c.none) { pr.lecture = { at: now(), skipped: `no lecture has a positive expected effect (best ${c?.best?.name} ${c?.best?.ev?.toFixed(2)})` }; logAction('lecture', 'Skipped: every lecture is more likely to hurt than help'); save(); return null; }
    await fetch(`/palestras.asp?action=dar&tipo=${c.tipo}`, { credentials: 'include' });
    const before = L.morale;
    const { doc: d2 } = await fetchDoc('/palestras.asp');
    parseLecturePage(d2);
    pr.lecture = { at: now(), given: c.name, rate: c.rate, before, after: db.lecture.morale };
    logAction('lecture', `${c.name} lecture (${pct(c.rate)} success) · morale ${before || '?'} → ${db.lecture.morale || '?'}`);
    save();
    return c;
  }

  /* ---------- Autopilot: keeps the next match prepared, from any page ---------- */
  /* ---------- Learning: match database, self-calibration, forecast grades — all in the browser ---------- */
  const GROWTH_PRIOR = GROWTH.slice();
  const MIN_CAL_GAMES = 30, MAX_REPORTS = 600, GROWTH_PRIOR_WEIGHT = 5;
  function applyModel(p) {
    for (const k of ['BASE', 'K_BEAT', 'K_GK', 'K_MID']) if (isFinite(p[k])) ME[k] = p[k];
    if (Array.isArray(p.growth) && p.growth.length === GROWTH.length) GROWTH.splice(0, GROWTH.length, ...p.growth);
  }

  // Every match report in the division (plus their cups/friendlies), at most once a day.
  async function crawlDivision(progress = () => {}) {
    const { doc } = await fetchDoc('/classificacao.asp');
    const teams = [...new Map($$('a[href*="ver_equipa.asp?equipa="]', doc).map(a => [param(a.getAttribute('href'), 'equipa'), clean(a.textContent)])).entries()];
    for (const [id, name] of teams) {
      progress(`Division: ${name}…`);
      try { await grab(`/calendario.asp?action=equipa&equipa=${id}`, { teamName: name }); } catch { /* next team */ }
      const t = db.teams['t' + id];
      if (t && (!t.rosterAt || now() - t.rosterAt > 3 * 86400e3)) { try { await grab(`/ver_equipa.asp?equipa=${id}&vjog=1`, { teamName: name }); } catch { /* optional */ } }
      await sleep(120);
    }
    const ids = new Set();
    Object.values(db.teams).forEach(t => (t.fixtures || []).forEach(f => f.reportId && ids.add(f.reportId)));
    (db.fixtures?.list || []).forEach(f => f.reportId && ids.add(f.reportId));
    const todo = [...ids].filter(id => !db.reports[id]).slice(0, 60);
    let n = 0;
    for (const id of todo) {
      progress(`Division: report ${++n}/${todo.length}…`);
      try { await grab('/relatorio.asp?jogo_id=' + id); } catch { /* skip */ }
      await sleep(120);
    }
    pruneReports();
    db.divisionCrawledAt = now();
    save();
    return todo.length;
  }
  // GM storage stays small: keep our own and the next opponent's reports, then the newest others.
  function pruneReports() {
    const all = Object.values(db.reports);
    if (all.length <= MAX_REPORTS) return;
    const keep = new Set([norm(db.me.name || ''), norm(opponentName() || '')]);
    const others = all.filter(r => !r.sides.some(s => keep.has(norm(s.team)))).sort((a, b) => dateKey(a.date) - dateKey(b.date));
    for (const r of others.slice(0, all.length - MAX_REPORTS)) delete db.reports[r.id];
  }

  // Refit the match model on every report with full zone ratings (same likelihood as model/fit.js).
  const fullZones = s => s?.zones && ['def', 'mid', 'att'].every(k => LANES.every(l => isFinite(s.zones[k]?.[l]))) && isFinite(s.zones.gk);
  const logPois = (l, k) => { let f = 0; for (let i = 2; i <= k; i++) f += Math.log(i); return -l + k * Math.log(l) - f; };
  function calibrateModel() {
    const games = Object.values(db.reports).filter(r => r.score && r.sides?.length === 2 && r.sides.every(fullZones));
    if (games.length < MIN_CAL_GAMES) return null;
    const ll = P => games.reduce((s, r) => s + logPois(goalRate(r.sides[0].zones, r.sides[1].zones, r.sides[0].passing, P), r.score[0]) + logPois(goalRate(r.sides[1].zones, r.sides[0].zones, r.sides[1].passing, P), r.score[1]), 0);
    const grid = [];
    for (const BASE of [4, 5, 6, 7, 8, 10]) for (const K_BEAT of [0.75, 1, 1.5, 2, 3]) for (const K_GK of [0.75, 1, 1.5, 2, 3]) for (const K_MID of [1, 2, 4, 8]) {
      const P = { BASE, K_BEAT, K_GK, K_MID };
      grid.push({ P, ll: ll(P) });
    }
    grid.sort((a, b) => b.ll - a.ll);
    // the smoothest curves within 1 log-lik point of the best: as good, and far less overconfident
    const pick = grid.filter(g => g.ll >= grid[0].ll - 1).sort((a, b) => b.P.K_BEAT - a.P.K_BEAT || b.P.K_GK - a.P.K_GK || b.P.K_MID - a.P.K_MID)[0];
    const mean = sum(games.map(r => r.score[0] + r.score[1])) / (2 * games.length);
    const llNull = sum(games.map(r => logPois(mean, r.score[0]) + logPois(mean, r.score[1])));
    const changed = ['BASE', 'K_BEAT', 'K_GK', 'K_MID'].some(k => pick.P[k] !== ME[k]);
    db.model = { ...db.model, ...pick.P, fittedOn: games.length, fittedAt: now(), logLik: +pick.ll.toFixed(1), nullLogLik: +llNull.toFixed(1) };
    applyModel(db.model);
    save();
    if (changed) logAction('learn', `Match model refitted on ${games.length} matches (BASE ${pick.P.BASE}, K_BEAT ${pick.P.K_BEAT}, K_GK ${pick.P.K_GK}, K_MID ${pick.P.K_MID})`);
    return pick.P;
  }

  // Growth per potential grade from our players' exact per-session training gains.
  // Every training session's exact gain per player (deduped by player|session date) feeds three things:
  // the squad's training history, each player's own growth rate, and the growth table per potential grade.
  function recordGrowth() {
    const t = db.training;
    // needs the squad for skill levels and ages; the session stays unseen and is recorded on the next read
    if (!t?.rows?.length || !t.lastDate || !db.squad?.players?.length) return;
    const g = (db.growth = db.growth || { samples: {}, seen: {} });
    const hist = (db.history = db.history || {});
    const staff = (t.staff || []).map(s => ({ skill: norm(s.skill), f: Math.min(1, 0.75 + 0.05 * (s.q || 0)) }));
    const day = new Date().toISOString().slice(0, 10);
    for (const r of t.rows) {
      const sq = (db.squad?.players || []).find(p => p.id === r.id);
      const h = (hist[r.id] = hist[r.id] || { name: r.name, sessions: [], snaps: [] });
      // one snapshot a day: skills, age and grades, so improvement can be shown over time
      if (sq && h.snaps[h.snaps.length - 1]?.date !== day) {
        h.snaps.push({ date: day, age: sq.age, sk: { ...sq.sk }, potential: r.potential, quality: r.quality, fit: r.fit });
        if (h.snaps.length > 180) h.snaps.shift();
      }
      const key = `${r.id}|${t.lastDate}`, gi = denomIdx(r.potential || '');
      const gain = sum((r.last || []).map(l => l.delta || 0));
      if (g.seen[key] || !gain) continue;
      g.seen[key] = 1;
      const trained = norm(r.last[0].skill);
      const code = Object.keys(SKILL_NAME).find(k => norm(SKILL_NAME[k]) === trained);
      const level = code ? (sq?.sk?.[code] ?? 0) : 0;
      const factor = staff.find(s => s.skill === trained)?.f || 0.75;
      h.sessions.push({ d: t.lastDate, skill: r.last.map(l => l.skill).join('+'), gain: +gain.toFixed(4), full: +(gain / factor).toFixed(4), factor, level, age: sq?.age, potential: r.potential });
      if (h.sessions.length > 300) h.sessions.shift();
      if (gi < 0 || level >= 18) continue; // near the cap gains slow — says little about the rate
      (g.samples[gi] = g.samples[gi] || []).push(+(gain / factor).toFixed(4));
      if (g.samples[gi].length > 200) g.samples[gi].shift();
    }
    const fitted = GROWTH_PRIOR.map((p, i) => { const s = g.samples[i] || []; return +((p * GROWTH_PRIOR_WEIGHT + sum(s)) / (GROWTH_PRIOR_WEIGHT + s.length)).toFixed(3); });
    db.model = { ...db.model, growth: fitted };
    applyModel(db.model);
    save();
  }
  // A player's own growth per full-strength session: his measured sessions (below 18) blended with his grade's rate.
  function playerRate(id, potential) {
    const gi = denomIdx(potential || '');
    const prior = GROWTH[gi >= 0 ? gi : 4];
    const s = (db.history?.[id]?.sessions || []).filter(x => x.level < 18);
    return { rate: (prior * GROWTH_PRIOR_WEIGHT + sum(s.map(x => x.full))) / (GROWTH_PRIOR_WEIGHT + s.length), n: s.length, prior };
  }
  // How much of a full session our players actually get: staff level on the staff skill, 75% otherwise.
  function trainingFactor() {
    const t = db.training;
    if (!t?.rows?.length) return 0.9;
    const staff = (t.staff || []).map(s => ({ skill: norm(s.skill), f: Math.min(1, 0.75 + 0.05 * (s.q || 0)) }));
    return avg(t.rows.map(r => staff.find(s => s.skill === norm(r.training))?.f || 0.75));
  }

  // Match database: the plan + forecast before each match, the result after — graded against the pundits.
  function decisionRecord() {
    const plan = computePlan();
    if (plan.error || !db.next) return null;
    const b = plan.best;
    return {
      at: now(), version: VERSION, date: db.next.date, home: db.next.home, away: db.next.away, comp: db.next.comp, weather: db.next.weather,
      weAreHome: db.next.weAreHome, pundits: db.next.odds,
      plan: { formation: formLabel(b.f), ids: b.xi.map(x => x.p.id), style: b.style, passing: b.passing, ats: b.ats, pref: plan.pref },
      forecast: { w: b.r.w, d: b.r.d, l: b.r.l, xgFor: b.r.xgFor, xgAg: b.r.xgAg },
      opponent: { source: plan.opp?.source, style: plan.opp?.style, passing: plan.opp?.passing, scouted: plan.opp?.scoutedN },
      model: { ...ME },
    };
  }
  function recordDecision() {
    const k = matchKey(), rec = k && decisionRecord();
    if (!rec) return;
    db.matchDb = db.matchDb || {};
    db.matchDb[k] = { ...(db.matchDb[k] || {}), decision: rec };
    save();
  }
  // Attach results to recorded decisions as soon as their report is in.
  function gradeMatches() {
    let n = 0;
    for (const [k, m] of Object.entries(db.matchDb || {})) {
      if (m.result || !m.decision) continue;
      const d = m.decision;
      const r = Object.values(db.reports).find(x => x.date === d.date && norm(x.sides[0]?.team) === norm(d.home) && norm(x.sides[1]?.team) === norm(d.away) && x.score);
      if (!r) continue;
      const us = d.weAreHome ? 0 : 1, gf = r.score[us], ga = r.score[1 - us];
      const res = gf > ga ? 'w' : gf === ga ? 'd' : 'l';
      const brier = f => (f ? ['w', 'd', 'l'].reduce((s, x) => s + ((f[x] || 0) - (x === res ? 1 : 0)) ** 2, 0) : null);
      const pund = d.pundits && (d.weAreHome ? { w: d.pundits.home, d: d.pundits.draw, l: d.pundits.away } : { w: d.pundits.away, d: d.pundits.draw, l: d.pundits.home });
      const started = new Set(r.sides[us].players.map(p => String(p.id)));
      m.result = { gf, ga, res, brier: brier(d.forecast), brierPundits: brier(pund), followed: d.plan.ids.filter(id => started.has(String(id))).length >= 10 && r.sides[us].style === d.plan.style, ourAvg: r.sides[us].zones?.avg, theirAvg: r.sides[1 - us].zones?.avg };
      logAction('learn', `${d.home} ${r.score.join('-')} ${d.away}: forecast ${pct(d.forecast.w)} win → ${res.toUpperCase()} (Brier ${m.result.brier.toFixed(2)}${m.result.brierPundits != null ? ` vs pundits ${m.result.brierPundits.toFixed(2)}` : ''})`);
      n++;
    }
    if (n) save();
    return n;
  }
  function learnSummary() {
    const graded = Object.values(db.matchDb || {}).filter(m => m.result).sort((a, b) => dateKey(b.decision.date) - dateKey(a.decision.date));
    const avg = a => (a.length ? sum(a) / a.length : null);
    const samples = db.growth?.samples || {};
    return {
      graded, model: avg(graded.map(m => m.result.brier)), pundits: avg(graded.map(m => m.result.brierPundits).filter(x => x != null)),
      record: ['w', 'd', 'l'].map(x => graded.filter(m => m.result.res === x).length),
      growthN: sum(Object.values(samples).map(s => s.length)),
    };
  }
  async function learn(progress = () => {}) {
    if (!db.divisionCrawledAt || now() - db.divisionCrawledAt > 20 * 3600e3) await crawlDivision(progress);
    recordGrowth();
    gradeMatches();
    progress('Calibrating…');
    if (!db.model?.fittedAt || now() - db.model.fittedAt > 20 * 3600e3 || (db.model.fittedOn || 0) + 20 <= Object.keys(db.reports).length) calibrateModel();
  }
  const today = () => new Date().toISOString().slice(0, 10);

  let piloting = false;
  async function autoPilot({ forceOrders = false } = {}) {
    if (piloting) return;
    piloting = true;
    const step = async (name, fn) => { try { setStatus(name + '…'); await fn(); } catch (e) { logAction(name, e.message, false); } };
    try {
      if (db.prefs.autoRefresh && (!db.lastRefresh || now() - db.lastRefresh > 6 * 3600e3)) await step('Refreshing data', () => refreshAll(setStatus));
      if (db.prefs.autoRefresh && scoutStale()) await step('Scouting', () => scoutOpponent(setStatus));
      if (db.prefs.autoLearn) await step('Learning', () => learn(setStatus)); // recalibrate before any decision
      if (db.prefs.autoLearn && (!db.scan?.at || now() - db.scan.at > 12 * 3600e3)) await step('Market scan', () => runScan(setStatus));
      if (db.prefs.autoYouth && (!db.youthCheckedAt || now() - db.youthCheckedAt > 12 * 3600e3)) await step('Youth team', autoYouth); // before orders: it changes who is available
      if (db.next && db.prefs.autoApply) await step('Match orders', () => applyOrders({ force: forceOrders }));
      if (db.next) recordDecision();
      if (db.next && db.prefs.autoEvents) await step('Match events', autoEvents);
      if (db.next && db.prefs.autoLecture) await step('Lecture', autoLecture);
      if (db.prefs.autoTraining && (!db.trainingAppliedAt || now() - db.trainingAppliedAt > 12 * 3600e3)) await step('Training', async () => { await autoTraining(); db.trainingAppliedAt = now(); save(); });
      if (db.prefs.autoRenew && (!db.contractsCheckedAt || now() - db.contractsCheckedAt > 12 * 3600e3)) await step('Contracts', autoRenew);
      if (db.prefs.autoSpeciality && specialityPlan(clubAdvice().fin)?.verdict === 'set') await step('Academy', autoSpeciality); // re-checks on a fresh page first
    } finally {
      piloting = false;
      setStatus(null);
      save();
      badgeMarketRows();
      if (panel.classList.contains('open')) render();
    }
  }

  /* =========================================================================
   * Debug snapshot — lets parsers be tuned to the real DOM
   * ======================================================================= */
  function snapshot() {
    const grids = $$('table').slice(0, 25).map(t => ({ cls: t.className, rows: t.rows.length, sample: Array.from(t.rows).slice(0, 3).map(r => Array.from(r.cells).map(c => cellText(c).slice(0, 30))) }));
    const selects = $$('select').slice(0, 40).map(s => ({ id: s.id, name: s.name, cls: s.className, opts: Array.from(s.options).map(o => clean(o.textContent)).slice(0, 12) }));
    const links = [...new Set($$('a[href]').map(a => a.getAttribute('href')).filter(h => /\.asp/i.test(h)))].slice(0, 120);
    return JSON.stringify({ v: VERSION, url: location.href, grids, selects, links, text: docText(document.body).slice(0, 5000) }, null, 1);
  }

  /* =========================================================================
   * UI — a slim dock that opens on the tab that fits the page you're on
   * ======================================================================= */
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.root{--bg:#fff;--bg2:#f4f5f2;--bg3:#eceee9;--fg:#16191c;--mut:#70767d;--line:#e8eae5;--acc:#2e7d32;--accs:#e8f2e8;--warn:#a15c07;--warns:#fdf3e2;--bad:#c0392b;--bads:#fbeceb;--good:#1e7b34;--info:#2f6fde;
--r:10px;--sh:0 16px 48px rgba(20,28,20,.18),0 1px 3px rgba(20,28,20,.08);font:12px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){.root{--bg:#141719;--bg2:#1b1f22;--bg3:#23282c;--fg:#e9ebe7;--mut:#959c96;--line:#262b2f;--acc:#5bbd60;--accs:#1c2b1d;--warn:#e8a94e;--warns:#2a2215;--bad:#f07a6e;--bads:#2e1a18;--good:#6fd174;--info:#7ea8ff}}
button{font:inherit;color:inherit}
.fab{position:fixed;right:16px;bottom:16px;z-index:2147483646;height:36px;padding:0 12px 0 10px;border-radius:18px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-weight:700;font-size:12px;display:flex;align-items:center;gap:7px;cursor:pointer;box-shadow:var(--sh);transition:transform .12s}
.fab:hover{transform:translateY(-1px)}
.fab i{width:8px;height:8px;border-radius:50%;background:var(--acc)}
.fab.busy i{animation:pulse 1s infinite}
@keyframes pulse{50%{opacity:.25}}
.panel{position:fixed;top:10px;right:10px;bottom:10px;width:min(380px,calc(100vw - 20px));z-index:2147483647;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateX(16px) scale(.985);pointer-events:none;transition:opacity .14s,transform .14s}
.panel.open{opacity:1;transform:none;pointer-events:auto}
.hd{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px}
.hd b{font-size:13px;letter-spacing:-.1px}
.hd .v{color:var(--mut);font-size:10.5px}
.st{flex:1;min-width:0;color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.ib{width:26px;height:26px;border-radius:7px;border:0;background:transparent;color:var(--mut);cursor:pointer;display:grid;place-items:center;font-size:14px;flex:none}
.ib:hover{background:var(--bg2);color:var(--fg)}
.tabs{display:flex;gap:1px;padding:0 10px 8px;border-bottom:1px solid var(--line)}
.tab{flex:1;border:0;background:transparent;color:var(--mut);padding:5px 0;border-radius:7px;font-weight:600;font-size:11.5px;cursor:pointer}
.tab:hover{color:var(--fg)}
.tab.on{background:var(--bg2);color:var(--fg)}
.body{flex:1;overflow:auto;scrollbar-width:thin}
.sec{border-bottom:1px solid var(--line);padding:10px 14px}
.sec>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--mut);user-select:none}
.sec>summary::-webkit-details-marker{display:none}
.sec>summary::before{content:"";width:0;height:0;border-left:4px solid currentColor;border-top:3.5px solid transparent;border-bottom:3.5px solid transparent;transition:transform .12s}
.sec[open]>summary::before{transform:rotate(90deg)}
.sec>summary .r{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500}
.sec>summary+*{margin-top:8px}
.hero{padding:12px 14px;border-bottom:1px solid var(--line)}
.teams{font-size:15px;font-weight:700;letter-spacing:-.2px}
.teams .vs{color:var(--mut);font-weight:500;margin:0 4px}
.row{display:flex;align-items:center;gap:6px}.sp{justify-content:space-between}.wr{flex-wrap:wrap}
.mut{color:var(--mut)}.sm{font-size:11px}.xs{font-size:10.5px}.b{font-weight:600}
.big{font-size:17px;font-weight:750;letter-spacing:-.3px}
.chip{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:999px;background:var(--bg2);font-size:10.5px;font-weight:600;white-space:nowrap;line-height:17px}
.chip.g{background:var(--accs);color:var(--good)}.chip.w{background:var(--warns);color:var(--warn)}.chip.x{background:var(--bads);color:var(--bad)}
.btn{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--line);background:var(--bg);font-weight:600;font-size:11.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;text-decoration:none;color:var(--fg);white-space:nowrap}
.btn:hover{background:var(--bg2)}
.btn.p{background:var(--acc);border-color:var(--acc);color:#fff}
.btn.p:hover{filter:brightness(1.07)}
.btn:disabled{opacity:.45;cursor:default}
.seg{display:inline-flex;background:var(--bg2);border-radius:7px;padding:2px}
.seg{flex:none}
.seg button{border:0;background:transparent;color:var(--mut);font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;cursor:pointer;white-space:nowrap}
.seg button.on{background:var(--bg);color:var(--fg);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--bg3);margin:6px 0 3px}
.bw{background:var(--acc)}.bd{background:#a3a9a3}.bl{background:#5b6168}
.wdl{display:flex;justify-content:space-between;font-size:10.5px;color:var(--mut)}
.wdl b{color:var(--fg);font-weight:650}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{color:var(--mut);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.3px;text-align:left;padding:3px 4px}
td{padding:4px;border-top:1px solid var(--line);vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr.click{cursor:pointer}tr.click:hover td{background:var(--bg2)}
tr.off td{opacity:.38;text-decoration:line-through}
.kv{display:grid;grid-template-columns:1fr auto;gap:3px 10px}
.kv>:nth-child(odd){color:var(--mut)}
.kv>:nth-child(even){text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.list{list-style:none;padding:0}
.list li{display:flex;gap:7px;padding:5px 0;border-top:1px solid var(--line)}
.list li:first-child{border-top:0}
.dot{width:6px;height:6px;border-radius:50%;margin-top:5px;flex:none;background:var(--mut)}
.dot.good{background:var(--good)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}.dot.info{background:var(--info)}
.chk{display:grid;grid-template-columns:16px 1fr auto;gap:2px 6px;align-items:center}
.chk .ic{width:14px;height:14px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:800;color:#fff;background:var(--bg3)}
.chk .ic.ok{background:var(--acc)}.chk .ic.no{background:var(--warn)}
.chk .t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pitch{background:linear-gradient(#2e6b33,#275e2c);border-radius:9px;padding:8px 4px;display:grid;gap:5px}
.pl{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;min-height:34px}
.pp{display:flex;flex-direction:column;align-items:center;color:#fff;text-align:center;min-width:0}
.pp b{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:8.5px;font-weight:700;border:1.5px solid rgba(255,255,255,.75)}
.pp.GK b{background:#15803d}.pp.D b{background:#9b1c1c}.pp.M b{background:#3b3aa3}.pp.F b{background:#d27b06}
.pp span{font-size:9.5px;line-height:1.15;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.5);margin-top:1px}
.zg{display:grid;grid-template-columns:52px repeat(3,1fr);gap:2px;font-size:10.5px;text-align:center}
.zg>div{padding:3px 1px;border-radius:5px;background:var(--bg2);font-variant-numeric:tabular-nums}
.zg .h{background:transparent;color:var(--mut);font-weight:600;text-align:left}
.zg .up{background:var(--accs);color:var(--good);font-weight:700}.zg .dn{background:var(--bads);color:var(--bad);font-weight:700}
.at{display:grid;grid-template-columns:1fr auto;gap:0 8px}
.at>div{padding:4px 0;border-top:1px solid var(--line)}
.at>div:nth-child(-n+2){border-top:0}
.at .why{color:var(--mut);font-size:10.5px}
.sw{position:relative;width:30px;height:17px;border-radius:9px;border:0;background:var(--bg3);cursor:pointer;flex:none;transition:background .12s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .12s}
.sw.on{background:var(--acc)}.sw.on::after{transform:translateX(13px)}
.opt{display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-top:1px solid var(--line)}
.opt:first-child{border-top:0}
.opt>div{flex:1}
.empty{padding:22px 14px;text-align:center;color:var(--mut)}
input.txt{flex:1;height:26px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:7px;padding:0 8px;font:inherit}
.toast{position:fixed;left:50%;bottom:18px;transform:translate(-50%,8px);background:#16191c;color:#fff;padding:7px 12px;border-radius:9px;font-size:11.5px;z-index:2147483647;opacity:0;transition:opacity .15s,transform .15s;pointer-events:none;max-width:min(520px,86vw);box-shadow:var(--sh)}
.toast.on{opacity:.95;transform:translate(-50%,0)}
`;

  const host = document.createElement('div');
  host.id = 'pm-copilot';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style><div class="root"><button class="fab" title="PM Copilot (Alt+P)"><i></i>PM</button><div class="panel"><div class="hd"><b>PM Copilot</b><span class="v">v${VERSION}</span><span class="st" id="st"></span><button class="ib" data-act="pilot" title="Run autopilot now">⟳</button><button class="ib" data-act="close" title="Close (Alt+P)">✕</button></div><div class="tabs"></div><div class="body"></div></div><div class="toast"></div></div>`;
  const panel = shadow.querySelector('.panel');
  const body = shadow.querySelector('.body');
  const tabsEl = shadow.querySelector('.tabs');
  const toastEl = shadow.querySelector('.toast');
  const fab = shadow.querySelector('.fab');
  const TABS = [['match', 'Match'], ['squad', 'Squad'], ['train', 'Training'], ['club', 'Club'], ['scout', 'Scout'], ['auto', 'Auto']];
  // open on the tab that belongs to the page you're on
  const PAGE_TAB = [[/titulares|proximo_jogo|relatorio|eventos|palestras|prox_adv|calendario/i, 'match'], [/plantel|contratos|ver_jogador/i, 'squad'], [/treinos/i, 'train'], [/financas|academia|^\/info\.asp|patrocinios|eqtecnica/i, 'club'], [/ver_equipa|transfer|procurar|leilo|mercado/i, 'scout']];
  let tab = (PAGE_TAB.find(([re]) => re.test(location.pathname)) || [])[1] || db.prefs.tab || 'match';
  let busy = false;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove('on'), 3400);
  }
  function setStatus(msg) {
    const el = shadow.getElementById('st');
    if (el) el.textContent = msg || '';
    fab.classList.toggle('busy', !!msg);
    fab.title = msg || 'PM Copilot (Alt+P)';
  }
  function setOpen(open) {
    panel.classList.toggle('open', open);
    GM_setValue('pmc_open', open);
    if (open) render();
  }
  function render() {
    tabsEl.innerHTML = TABS.map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
    const fn = { match: viewMatch, squad: viewSquad, train: viewTrain, club: viewClub, scout: viewScout, auto: viewAuto }[tab] || viewMatch;
    const top = body.scrollTop;
    const openState = new Map($$('details[data-k]', body).map(d => [d.dataset.k, d.open]));
    try { body.innerHTML = fn(); } catch (e) { console.error(e); body.innerHTML = `<div class="empty"><b>Something broke</b><div class="sm">${esc(e.message)}</div></div>`; }
    $$('details[data-k]', body).forEach(d => { if (openState.has(d.dataset.k)) d.open = openState.get(d.dataset.k); });
    body.scrollTop = top;
  }

  const chip = (t, k = '') => `<span class="chip ${k}">${esc(t)}</span>`;
  const surname = n => { const t = clean(n).split(' '); return t.length > 1 ? t[t.length - 1] : n; };
  const isLive = re => re.test(location.pathname);
  const sec = (k, title, inner, { open = true, right = '' } = {}) => `<details class="sec" data-k="${k}" ${open ? 'open' : ''}><summary>${title}${right ? `<span class="r">${right}</span>` : ''}</summary><div>${inner}</div></details>`;
  const list = items => `<ul class="list">${items.map(t => `<li><span class="dot ${t.lvl || 'info'}"></span><span>${t.html ?? esc(t.t)}</span></li>`).join('')}</ul>`;
  function wdlBar(r, label = 'W / D / L') {
    const w = Math.round(r.w * 100), d = Math.round(r.d * 100), l = Math.max(0, 100 - w - d);
    return `<div class="bar"><div class="bw" style="width:${w}%"></div><div class="bd" style="width:${d}%"></div><div class="bl" style="width:${l}%"></div></div><div class="wdl"><span>Win <b>${w}%</b></span><span>Draw <b>${d}%</b></span><span>Loss <b>${l}%</b></span></div>`;
  }
  function pitch(xi) {
    return `<div class="pitch">${['F', 'M', 'D', 'GK'].map(line => {
      const ps = xi.filter(x => x.slot.line === line);
      const cols = new Array(5).fill(null);
      const C = ps.filter(x => x.slot.lane === 'C');
      ps.filter(x => x.slot.lane === 'L').forEach(x => (cols[0] = x));
      ps.filter(x => x.slot.lane === 'R').forEach(x => (cols[4] = x));
      ({ 1: [2], 2: [1, 3], 3: [1, 2, 3] }[C.length] || []).forEach((c, i) => (cols[c] = C[i]));
      return `<div class="pl">${cols.map(x => (x ? `<div class="pp ${line}" title="${esc(x.p.name)} · ${f1(x.score)}"><b>${x.slot.code}</b><span>${esc(surname(x.p.name))}</span></div>` : '<div></div>')).join('')}</div>`;
    }).join('')}</div>`;
  }
  // Our zones vs theirs, lane by lane (their left faces our right).
  function zoneGrid(plan) {
    const a = sideMult(plan.best.z, { style: plan.best.style, home: plan.home }), b = sideMult(plan.opp.z, { style: plan.opp.style, home: !plan.home });
    const cell = (x, y) => `<div class="${x > y * 1.08 ? 'up' : x < y * 0.92 ? 'dn' : ''}">${f1(x)}<span class="mut"> / ${f1(y)}</span></div>`;
    return `<div class="zg"><div class="h"></div><div class="h" style="text-align:center">Left</div><div class="h" style="text-align:center">Centre</div><div class="h" style="text-align:center">Right</div>
      <div class="h">Attack</div>${LANES.map(l => cell(a.att[l], b.def[MIRROR[l]])).join('')}
      <div class="h">Midfield</div>${LANES.map(l => cell(a.mid[l], b.mid[MIRROR[l]])).join('')}
      <div class="h">Defence</div>${LANES.map(l => cell(a.def[l], b.att[MIRROR[l]])).join('')}</div>
      <div class="xs mut" style="margin-top:4px">Ours / theirs facing us, match-engine stars.</div>`;
  }
  const mode = arr => Object.entries(arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  function attitudeTip(plan) {
    const n = plan.attitudes.Normal, comp = db.next?.comp || '';
    const gain = plan.attitudes.MOTS.w - n.w;
    if (/cup/i.test(comp)) return `Cup tie: MOTS adds ~${Math.round(gain * 100)} pts of win chance. Only 2 per season, and losing with MOTS hurts morale.`;
    if (n.w > 0.72) return 'Clear favourite: Play it Cool keeps players fresher (and lifts morale if you win) at a small cost.';
    if (n.w < 0.4) return 'Underdog: use MOTS only if this game decides something.';
    return 'Normal. Save your two MOTS for title or promotion deciders.';
  }

  /* ---------- Match ---------- */
  function prepChecklist() {
    const p = prep();
    const row = (ok, label, detail) => `<span class="ic ${ok === true ? 'ok' : ok === false ? 'no' : ''}">${ok === true ? '✓' : ok === false ? '!' : '·'}</span><span class="t">${label}${detail ? ` <span class="mut">· ${esc(detail)}</span>` : ''}</span><span class="xs mut">${''}</span>`;
    const o = p.orders, e = p.events, l = p.lecture;
    const c = (db.contracts?.rows || []).filter(x => x.years <= 1);
    return `<div class="chk">
      ${row(o ? (o.saved ? true : false) : null, 'Orders', o ? `${o.saved ? 'saved' : 'filled, not saved'} ${ago(o.at)}` : db.prefs.autoApply ? 'pending' : 'auto off')}
      ${row(e ? true : null, 'Events', e ? `${e.n} set ${ago(e.at)}` : db.prefs.autoEvents ? 'pending' : 'auto off')}
      ${row(l ? (l.given ? true : false) : null, 'Lecture', l ? (l.given ? `${l.given} · ${l.before || ''} → ${l.after || ''}` : l.skipped) : db.prefs.autoLecture ? 'pending' : 'auto off')}
      ${row(db.trainingAppliedAt ? true : null, 'Training', db.trainingAppliedAt ? `checked ${ago(db.trainingAppliedAt)}` : db.prefs.autoTraining ? 'pending' : 'auto off')}
      ${row(db.contractsCheckedAt ? (c.some(x => x.wontRenew) ? false : true) : null, 'Contracts', db.contractsCheckedAt ? (c.length ? `${c.length} expiring` : 'none expiring') : db.prefs.autoRenew ? 'pending' : 'auto off')}
    </div>`;
  }
  function viewMatch() {
    const nx = db.next;
    if (!nx) return `<div class="empty">No match data yet.<div style="margin-top:8px"><button class="btn p" data-act="pilot">Fetch everything</button></div></div>`;
    const plan = computePlan();
    const opp = opponentName();
    let h = `<div class="hero"><div class="row sp"><span class="xs mut">${esc(nx.comp || '')} · ${esc(nx.date || '')}${nx.weAreHome != null ? ` · ${nx.weAreHome ? 'Home' : 'Away'}` : ''}</span>${isFinite(nx.points?.win) ? `<span class="xs mut">rank +${nx.points.win} / ${nx.points.draw} / ${nx.points.loss}</span>` : ''}</div>
      <div class="teams" style="margin-top:3px">${esc(nx.home)}<span class="vs">vs</span>${esc(nx.away)}</div>
      ${plan.error ? '' : wdlBar(shown(plan.best.r))}
      <div class="row sp xs mut" style="margin-top:2px">${plan.error ? '' : `<span>xG ${f1(plan.best.r.xgFor)} – ${f1(plan.best.r.xgAg)}</span>`}${nx.odds ? `<span>pundits ${pct(nx.odds.home)} / ${pct(nx.odds.draw)} / ${pct(nx.odds.away)}</span>` : ''}</div>
      ${nx.weAreHome == null ? `<div style="margin-top:6px">${chip('Which team is yours? → Auto tab', 'w')}</div>` : ''}</div>`;
    if (plan.error) return h + `<div class="empty">${esc(plan.error)}</div>`;
    const { best, opp: o } = plan;
    h += sec('prep', 'Match prep', prepChecklist(), { right: `<button class="btn" data-act="pilot" ${piloting ? 'disabled' : ''}>Run now</button>` });
    h += sec('plan', 'Plan', `
      <div class="row sp"><div><span class="big">${formLabel(best.f)}</span> <span class="xs mut">${esc(formDetail(best.f))}</span></div><span class="seg">${[['points', 'Pts'], ['avoid', 'No loss'], ['win', 'Win'], ['ranking', 'Rank']].map(([k, l]) => `<button data-obj="${k}" class="${db.prefs.objective === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>
      <div class="row wr" style="margin:6px 0 8px">${chip(best.style)}${chip(best.passing + ' passing')}${chip('Attack ' + plan.pref)}${plan.captain ? chip('C ' + surname(plan.captain.p.name)) : ''}${plan.pens ? chip('Pen ' + surname(plan.pens.p.name)) : ''}</div>
      ${pitch(best.xi)}
      ${plan.current?.r ? `<div class="xs mut" style="margin-top:6px">Saved lineup ${formLabel(plan.current.form)} ${plan.current.style}/${plan.current.passing}: win ${pct(shown(plan.current.r).w)}</div>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn p" data-act="apply">${db.prefs.autoSave ? 'Apply & save now' : 'Fill orders now'}</button><button class="btn" data-act="copy">Copy</button>${db.next?.ordersUrl ? `<a class="btn" href="${esc(db.next.ordersUrl)}">Open orders</a>` : ''}</div>`);
    if (o) {
      const used = k => { const v = o.history.map(x => x.stats?.[k]).filter(Boolean); return v.length ? mode(v) : null; };
      const ats = ['Pressing', 'Counter Attack', 'Marking', 'Offside Trap', 'High Balls', 'One-on-Ones', 'Keeping Style'].map(k => [k, used(k)]).filter(([, v]) => v && !/^(no|normal|not defined)$/i.test(v));
      const freq = o.team?.freq ? Object.entries(o.team.freq).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ×${n}`).join(', ') : '';
      h += sec('opp', esc(o.name), `
        <div class="sm">Expect <b>${esc(formDetail(o.form))}</b> · ${esc(o.style)} / ${esc(o.passing)}${ats.length ? ` · plays ${ats.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}</div>
        ${freq ? `<div class="xs mut" style="margin-top:2px">Last 20: ${esc(freq)}${isFinite(o.team?.motsUsed) ? ` · MOTS used ${o.team.motsUsed}` : ''}</div>` : ''}
        ${o.tired.length ? `<div class="xs" style="margin-top:2px;color:var(--warn)">Tired: ${o.tired.map(t => esc(surname(t.name))).join(', ')}</div>` : ''}
        <div style="margin-top:8px">${zoneGrid(plan)}</div>
        ${o.history.length ? `<table style="margin-top:8px"><tr><th>Date</th><th>Vs</th><th class="n">Score</th><th>Shape</th></tr>${o.history.map(m => `<tr><td>${esc((m.date || '').slice(0, 5))}</td><td>${m.home ? '' : '@ '}${esc(m.vs || '')}</td><td class="n">${m.gf ?? ''}–${m.ga ?? ''}</td><td>${esc(m.formation)}</td></tr>`).join('')}</table>` : '<div class="xs mut" style="margin-top:6px">No reports yet.</div>'}`,
        { right: o.source === 'match-engine' ? chip('engine data', 'g') : chip('estimated', 'w'), open: false });
    }
    const a = best.ats, at = best.at;
    const c = x => `${f1(x.a)} vs ${f1(x.b)}`;
    const atr = (k, v, why, on) => `<div><div class="b">${k}</div><div class="why">${why}</div></div><div>${chip(v, on ? 'g' : '')}</div>`;
    h += sec('ats', 'Advanced tactics', a ? `<div class="at">
        ${atr('Pressing', a.pressing, `speed ${c(at.pressHigh[0])} · passing ${c(at.pressHigh[1])} · tackling ${c(at.pressLow[1])}`, a.pressing !== 'Normal')}
        ${atr('Offside trap', a.offside ? 'Yes' : 'No', `D positioning ${c(at.offside[0])} · speed ${c(at.offside[1])}`, a.offside)}
        ${atr('Counter attack', a.counter ? 'Yes' : 'No', `speed ${c(at.counter.speed)} · passing ${c(at.counter.pass)}`, a.counter)}
        ${atr('High balls', a.highBalls ? 'Yes' : 'No', `heading ${c(at.highBalls[0])} · strength ${c(at.highBalls[1])}`, a.highBalls)}
        ${atr('One-on-ones', a.oneOnOne ? 'Yes' : 'No', `tech+str ${c(at.oneOnOne[0])}`, a.oneOnOne)}
        ${atr('Keeping style', a.keeping, `stand in ${c(at.standIn[0])} · rush out ${c(at.rushOut[0])}`, a.keeping !== 'Not Defined')}
        ${atr('Marking', a.marking, `zonal ${c(at.zonal[0])} · man ${c(at.manMark[0])}`, a.marking !== 'Not Defined')}
        ${atr('Long shots', a.longShots ? 'Yes' : 'No', c(at.longShots[0]), a.longShots)}
        ${atr('First-time shots', a.firstTime ? 'Yes' : 'No', `needs 3 forwards · ${c(at.firstTime[0])}`, a.firstTime)}
      </div><div class="xs mut" style="margin-top:6px">On only when won by &gt;15% — opponent skills are estimated, and a lost tactic costs rating.</div>` : '<div class="sm mut">All off until the opponent is scouted — a lost tactic costs rating.</div>',
      { right: a ? `${a.won} on` : 'off', open: false });
    const ev = prep().events;
    h += sec('events', 'Match events', ev?.list?.length ? list(ev.list.map(t => ({ t, lvl: 'good' }))) : `<div class="sm mut">${db.prefs.autoEvents ? 'Set automatically when the match is prepared.' : 'Auto events are off.'}</div>`, { right: ev ? `${ev.n} active` : '', open: false });
    const A = Object.fromEntries(Object.entries(plan.attitudes).map(([k, v]) => [k, shown(v)]));
    h += sec('att', 'Attitude', `<table><tr><th></th><th class="n">W</th><th class="n">D</th><th class="n">L</th></tr>${[['Normal', 'Normal'], ['MOTS', 'Match of the Season'], ['PIC', 'Play it Cool']].map(([k, l]) => `<tr><td>${l}</td><td class="n">${pct(A[k].w)}</td><td class="n">${pct(A[k].d)}</td><td class="n">${pct(A[k].l)}</td></tr>`).join('')}</table><div class="xs mut" style="margin-top:6px">${attitudeTip(plan)}</div>`, { open: false });
    h += sec('alts', 'Alternatives', `<table><tr><th>Shape</th><th>Style</th><th class="n">W</th><th class="n">xG</th></tr>${plan.alts.map(x => `<tr><td><b>${formLabel(x.f)}</b> <span class="xs mut">${esc(formDetail(x.f))}</span></td><td class="xs">${x.style}/${x.passing}</td><td class="n">${pct(shown(x.r).w)}</td><td class="n">${f1(x.r.xgFor)}–${f1(x.r.xgAg)}</td></tr>`).join('')}</table>`, { right: `${plan.total} tested`, open: false });
    if (plan.current?.issues?.length) h += sec('issues', 'Saved lineup issues', list(plan.current.issues.map(t => ({ t, lvl: 'warn' }))), { open: false });
    return h;
  }

  /* ---------- Squad (incl. contracts) ---------- */
  function viewSquad() {
    if (!db.squad) return `<div class="empty">No squad yet.<div style="margin-top:8px"><button class="btn p" data-act="pilot">Fetch everything</button></div></div>`;
    const plan = computePlan();
    const inXI = new Map((plan.best?.xi || []).map(x => [x.p.name, x.slot.code]));
    const ex = new Set(db.prefs.excluded);
    const pool = squadPool();
    const con = new Map((db.contracts?.rows || []).map(c => [c.id, c]));
    const all = (db.squad.players || []).map(p => ({ ...p, ...(pool.find(q => q.name === p.name) || {}), t: matchPlayer(p.name, db.training?.rows || [], p.id), c: con.get(p.id) }));
    all.sort((a, b) => (LINE_ORDER[a.line] ?? 9) - (LINE_ORDER[b.line] ?? 9) || roleSkill(b, b.line || 'M') - roleSkill(a, a.line || 'M'));
    let h = sec('squad', 'Squad', `<table><tr><th>Player</th><th>Pos</th><th class="n">Age</th><th class="n">Fit</th><th class="n">Rtg</th><th class="n" title="Projected rating at 26">@26</th><th class="n">Yrs</th><th></th></tr>${all.map(p => {
      const f = p.t?.fit;
      return `<tr class="click ${ex.has(p.name) ? 'off' : ''}" data-ex="${esc(p.name)}"><td>${esc(p.name)}<div class="xs mut">${[p.t?.quality, p.t?.potential && 'pot ' + p.t.potential, p.form && 'form ' + p.form].filter(Boolean).map(esc).join(' · ')}</div></td><td class="xs" style="white-space:nowrap">${esc(p.line || '?')} ${esc(p.sides || '')}</td><td class="n">${p.age ?? ''}</td><td class="n">${isFinite(f) ? `<span style="color:${f < 80 ? 'var(--bad)' : f < 90 ? 'var(--warn)' : 'inherit'}">${f}</span>` : ''}</td><td class="n">${f1(roleSkill(p, p.line || 'M'))}</td><td class="n">${(() => { const v = valuePath({ ...p, potential: p.t?.potential }, { line: p.line || 'M', lane: (p.sides || 'C')[0], code: '' }, plan); const d = v.at26 - v.now; return `${f1(v.at26)}${d > 0.4 ? `<div class="xs" style="color:var(--good)">+${f1(d)}</div>` : ''}`; })()}</td><td class="n">${p.c ? `<span style="color:${p.c.years <= 1 ? 'var(--bad)' : 'inherit'}">${p.c.years}</span>` : ''}</td><td>${inXI.has(p.name) ? chip(inXI.get(p.name), 'g') : ''}</td></tr>`;
    }).join('')}</table><div class="xs mut" style="margin-top:6px">Tap a player to mark him unavailable. Rtg = weighted position skills (0–20).</div>`, { right: `${pool.length} available` });
    const Y = youthMoves(plan);
    const yt = [
      ...Y.back.map(({ p, ok, why }) => ({ lvl: ok ? 'warn' : 'info', t: ok ? `${p.name} (${p.age}) isn't in the XI — back to the youth team for full training every league round${db.prefs.autoYouth ? ' (autopilot does it)' : ''}. He can be promoted again any time.` : `${p.name} (${p.age}) could go back to the youth team for full training, but stays: ${why}.` })),
      ...Y.bOld.map(p => ({ lvl: 'warn', t: `${p.name} is ${p.age} and in the B team — no positive training there from 22. Move him to the main squad.` })),
      ...(Y.youth.length ? [{ lvl: 'info', t: `Youth team: ${Y.youth.map(p => `${surname(p.name)} (${p.age})`).join(', ')} — training at full league strength; they can't play until promoted (automatic at 19).` }] : []),
    ];
    h += sec('tiers', 'Main · B · Youth', list(yt.length ? yt : [{ lvl: 'good', t: 'Everyone is in the right team.' }]) + '<div class="xs mut" style="margin-top:6px">Only the main squad plays matches (B-team players can be picked too). Youth team: academy players aged 17–18, no matches, full training every league round. B team: max 16, no matches of its own, reduced training, none from 22.</div>', { open: !!Y.back.some(m => m.ok) || !!Y.bOld.length });
    const rows = db.contracts?.rows || [];
    const starters = plannedStarters();
    const items = rows.filter(c => c.years <= 1 || c.wontRenew).map(c => {
      const keep = contractVerdict(c, starters);
      if (c.wontRenew) return { lvl: 'bad', t: `${c.name} (${c.years} yr) won’t renew — ${c.years <= 1 ? 'sell before he leaves for free' : 'try again later; consider selling'}.` };
      return { lvl: keep ? 'good' : 'warn', t: `${c.name}: ${c.years} year left — ${keep ? (db.prefs.autoRenew ? 'auto-renewing at his minimum asked wage' : 'renew at his minimum asked wage') : 'not worth renewing (low potential / not a starter)'}.` };
    });
    const noMins = rows.filter(c => c.years <= 2 && c.minutes < 300 && !c.wontRenew).map(c => ({ lvl: 'info', t: `${c.name} has only ${c.minutes} minutes — players want up to 630 league+cup minutes before renewing.` }));
    h += sec('contracts', 'Contracts', rows.length ? list([...items, ...noMins].length ? [...items, ...noMins] : [{ lvl: 'good', t: 'Nobody is close to the end of his contract.' }]) : '<div class="sm mut">Not read yet.</div>', { right: db.contracts ? `wage bill ${fmt$(sum(rows.map(r => r.wage)))}` : '' });
    const depth = ['GK', 'D', 'M', 'F'].map(l => [l, pool.filter(p => p.line === l).length]);
    h += sec('depth', 'Depth', `<div class="row">${depth.map(([l, n]) => chip(`${l} ${n}`, n < (l === 'GK' ? 2 : 5) ? 'w' : '')).join('')}</div>`, { open: false });
    return h;
  }

  /* ---------- Training ---------- */
  function viewTrain() {
    if (!db.squad) return `<div class="empty">No data yet.<div style="margin-top:8px"><button class="btn p" data-act="pilot">Fetch everything</button></div></div>`;
    const t = trainingAdvice();
    const n = t.rows.filter(r => r.mismatch).length;
    let h = sec('team', 'Staff training', `<div class="kv"><div>Current</div><div>${esc(t.current || '—')}</div><div>Best for the squad</div><div>${esc(t.teamRec[0]?.[0] || '—')} · ${t.teamRec[0]?.[1] || 0} players</div></div>
      <div class="xs mut" style="margin-top:6px">No individual order = no training; individual ≠ staff → 75%. Cup/friendly sessions are half strength. B-team players over 22 don’t improve.</div>`);
    h += sec('ind', 'Individual', `<table><tr><th>Player</th><th>Now</th><th>Best</th></tr>${t.rows.map(r => `<tr><td>${esc(r.p.name)}<div class="xs mut">${esc(r.why)}</div>${r.warn.map(w => `<div class="xs" style="color:var(--warn)">${esc(w)}</div>`).join('')}</td><td class="xs">${esc(r.cur)}${r.t?.last?.length ? `<div class="mut">${r.t.last.map(l => `+${l.delta}`).join(' ')}</div>` : ''}</td><td>${chip(r.rec, r.mismatch ? 'w' : 'g')}</td></tr>`).join('')}</table>`,
      { right: n ? `<button class="btn p" data-act="train">Apply ${n}</button>` : chip('all set', 'g') });
    // tracked history: measured growth vs what the grade predicts, and the projection it implies at 26
    const plan = computePlan();
    const pool = plan.pool || squadPool();
    const tf = trainingFactor();
    const prog = pool.map(p => {
      const hst = db.history?.[p.id] || { sessions: [], snaps: [] };
      const r = playerRate(p.id, p.potential);
      const v = valuePath(p, { line: p.line || 'M', lane: (p.sides || 'C')[0], code: '' }, plan);
      return { p, hst, r, v, gained: sum(hst.sessions.map(s => s.gain)), since: hst.snaps[0]?.date };
    }).sort((a, b) => (b.v.at26 - b.v.now) - (a.v.at26 - a.v.now));
    const vs = x => (x.r.n >= 3 ? (x.r.rate > x.r.prior * 1.15 ? 'var(--good)' : x.r.rate < x.r.prior * 0.85 ? 'var(--bad)' : 'inherit') : 'var(--mut)');
    h += sec('progress', 'Progress', `<div class="xs mut" style="margin-bottom:6px">Your training delivers <b>${pct(tf)}</b> of a full session on average (staff level on the staff skill, 75% for anything else). Projections use each player’s own measured rate (blended with his grade’s until he has a few sessions), so buys and your squad are judged on the same training.</div>
      <table><tr><th>Player</th><th class="n" title="Sessions measured">Ses.</th><th class="n" title="Measured gain per full session (grade average)">/ses.</th><th class="n" title="Skill points gained since tracking started">Gained</th><th class="n">Now→26</th></tr>${prog.map(x => `<tr><td>${esc(x.p.name)}<div class="xs mut">${x.p.age} · ${esc(x.p.potential || '?')}${x.p.age >= PEAK_AGE ? ' · past growth age' : ` · ${PEAK_AGE - x.p.age} season${PEAK_AGE - x.p.age === 1 ? '' : 's'} to 26`}</div></td><td class="n">${x.r.n}</td><td class="n"><span style="color:${vs(x)}">${x.r.rate.toFixed(3)}</span><div class="xs mut">${x.r.prior.toFixed(3)}</div></td><td class="n">${x.gained ? '+' + x.gained.toFixed(2) : '—'}</td><td class="n">${f1(x.v.now)}<div class="xs" style="color:${x.v.at26 - x.v.now > 0.4 ? 'var(--good)' : 'var(--mut)'}">→ ${f1(x.v.at26)}</div></td></tr>`).join('')}</table>
      <div class="xs mut" style="margin-top:6px">Tracking since ${esc(prog.find(x => x.since)?.since || 'today')}. Green/red = clearly ahead/behind his grade (3+ sessions). Growth peaks at 26 (−25%/yr from 21, losses from 27).</div>`, { open: true });
    return h;
  }

  /* ---------- Club ---------- */
  function viewClub() {
    const { fin, tips } = clubAdvice();
    const st = db.stadium, ac = db.academy, sp = db.sponsors, cl = db.club;
    let h = sec('fin', 'Finances', `<div class="kv">
      <div>Funds</div><div>${fmt$(fin.funds)}</div>
      <div>Income / week</div><div>${fmt$(fin.income)}</div>
      <div>Costs / week</div><div>${fmt$(fin.outflow)}</div>
      <div>Net / week</div><div style="color:${fin.net < 0 ? 'var(--bad)' : 'var(--good)'}">${fmt$(fin.net)}</div>
      <div>Spendable (after buffer)</div><div>${fmt$(fin.spendable)}</div>
      ${cl ? `<div>Wage bill / roof</div><div>${fmt$((cl.wages || 0) + (cl.pendingWages || 0))} / ${fmt$(cl.wageRoof)}</div>` : ''}</div>`, { right: ago(db.economy?.at) });
    const P = db.staffPrices || {};
    const missing = [!isFinite(db.economy?.funds) && 'economy', !db.training?.rows?.length && 'training', !db.squad && 'squad', !['AM', 'Coach', 'Scout', 'Physio'].every(r => isFinite(P[r]?.[1])) && 'staff wages'].filter(Boolean);
    if (missing.length) h += sec('staff', 'Staff', `<div class="sm">Waiting for ${missing.join(', ')} data.</div><div style="margin-top:6px"><button class="btn p" data-act="pilot">Fetch now</button></div>`);
    else {
      const s = staffAdvice(fin);
      const ROLE = { AM: 'Assistant Manager', Coach: 'Coach', Scout: 'Scout', Physio: 'Physio' };
      const v = o => (o.verdict === 'hire' ? chip(`Hire ${STAFF_LEVEL[o.q]}`, 'g') : o.verdict === 'keep' ? chip('Keep', 'g') : o.verdict === 'review' ? chip('Review', 'w') : chip('Skip'));
      h += sec('staff', 'Staff', list(s.list.map(o => ({ lvl: o.verdict === 'hire' ? 'good' : o.verdict === 'review' ? 'warn' : 'info', html: `<div class="row sp"><b>${ROLE[o.role]}</b><span>${v(o)}${o.w ? ` <span class="xs mut">${fmt$(o.w)}/wk</span>` : ''}</span></div><div class="xs mut">${esc(o.why)}</div>${o.verdict === 'hire' ? `<a class="xs" style="color:var(--acc)" href="/eqtecnica.asp?fase=1&hf=0&q=${o.q}&f=${STAFF_F_ID[o.role]}">Hire page →</a>` : ''}` }))) + (s.added ? `<div class="xs mut" style="margin-top:4px">Adds ${fmt$(s.added)}/wk → net ${fmt$(s.netAfter)}/wk before gate receipts.</div>` : ''), { right: db.staff ? `${db.staff.AM} AM · ${db.staff.Coach} coach · ${db.staff.Scout} scout · ${db.staff.Physio} physio` : '' });
    }
    h += sec('fac', 'Facilities', `<div class="kv">
      <div>Stadium</div><div>${st?.capacity ? st.capacity.toLocaleString() + ' seats' : '—'}</div>
      <div>Average crowd</div><div>${cl?.avgAttendance ? cl.avgAttendance.toLocaleString() + (st?.capacity ? ` (${pct(cl.avgAttendance / st.capacity)})` : '') : fin.fill != null ? pct(fin.fill) : '—'}</div>
      <div>Roof</div><div>${st ? (st.covered ? 'Yes' : 'No') : '—'}</div>
      <div>Academy</div><div>${esc(ac?.quality || '—')}${ac?.speciality && !/none/i.test(ac.speciality) ? ' · ' + esc(ac.speciality) : ''}</div>
      <div>Promotions</div><div>${ac ? `${ac.promoted ?? '?'} / ${ac.limit ?? '?'}` : '—'}</div>
      <div>Sponsor</div><div>${sp ? esc(sp.type) + ' · ' + fmt$(sp.weekly) : '—'}</div>
      ${cl ? `<div>Reputation · fans</div><div>${esc(cl.reputation)} · ${esc(cl.fanClub)}</div>` : ''}</div>`, { open: false });
    h += sec('adv', 'Advice', list(tips));
    return h;
  }

  /* ---------- Scout ---------- */
  let pageEval = null;
  function viewScout() {
    const plan = computePlan();
    if (plan.error) return `<div class="empty">${esc(plan.error)}</div>`;
    const s = scoutingAdvice(plan);
    const fin = clubAdvice().fin;
    let h = '';
    const B = recruitBoard(plan);
    if (B) {
      const sg = v => `${v >= 0 ? '+' : ''}${f1(v)}`;
      const money = v => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}k`);
      const tag = e => [e.c.free ? chip('free agent', 'g') : '', e.c.age >= 30 ? chip('short-term', 'w') : '', e.cheap && e.cheap >= 1.4 ? chip('game undervalues him', 'g') : '', !e.c.free && !e.value ? chip('value unknown', 'w') : ''].join('');
      const row = e => `<tr title="${esc(`vs ${e.vs.name}: now ${f1(e.ov.now)}, at 26 ${f1(e.ov.at26)}`)}"><td><a href="/ver_jogador.asp?jog_id=${esc(e.c.id)}" style="color:inherit;font-weight:600">${esc(e.c.name)}</a><div class="xs mut">${e.c.age} · ${esc(e.c.line)}${esc(e.c.sides || '')} · ${esc(e.c.quality || '?')}/${esc(e.c.potential || '?')}${e.c.talent ? ' · ' + esc(e.c.talent) : ''}${e.c.deadline ? ' · ends ' + esc(e.c.deadline.slice(0, 8)) : ''}</div>${tag(e) ? `<div style="margin-top:2px">${tag(e)}</div>` : ''}</td><td>${chip(e.slot.code)}<div class="xs mut">${esc(surname(e.vs.name))}</div></td><td class="n"><b style="color:var(--good)">${sg(e.d5)}</b><div class="xs mut">now ${sg(e.dNow)}</div></td><td class="n" title="Expected winning bid: the ask (an auction floor) or about half his Value — what completed transfers typically went for. Free agents: 12-week signing fee.">≈${money(e.expPrice)}<div class="xs mut">${e.c.free ? 'signing fee' : `ask ${money(e.c.price || 0)}${e.value ? ` · value ${money(e.value)}` : ''}`}${e.c.wage ? ` · ${money(e.c.wage)}/wk` : ''}</div></td></tr>`;
      const tbl = arr => (arr.length ? `<table><tr><th>Player</th><th>As</th><th class="n">5 seasons</th><th class="n">Expect</th></tr>${arr.map(row).join('')}</table>` : '<div class="sm mut">Nothing that improves your XI at this price yet.</div>');
      h += sec('recruit', 'Recruitment', `<div class="row sp wr"><span class="sm">Funds <b>${money(B.caps.funds)}</b> · up to <b>${money(B.caps.max)}</b> per player</span><span class="seg">${[0.2, 0.35, 0.5].map(p => `<button data-buypct="${p}" class="${Math.abs(B.caps.pct - p) < 0.01 ? 'on' : ''}">${Math.round(p * 100)}%</button>`).join('')}</span></div>
        <div class="row" style="margin-top:6px"><button class="btn p" data-act="scan" ${busy ? 'disabled' : ''}>${B.scannedAt ? 'Rescan market' : 'Scan market'}</button><span class="xs mut">${B.n} live listings${B.scannedAt ? ' · ' + ago(B.scannedAt) : ''}</span></div>
        <div class="xs mut" style="margin-top:6px">Every position and the free-agent list, each player rated in every slot of his line against your starter over 5 seasons, weighted by how much that slot decides matches. Cost = expected winning bid (≈ half his Value, never below the ask) + a season of wages.</div>`);
      h += sec('rbest', 'Best buys', `<div class="row sp" style="margin-bottom:6px"><span class="xs mut">Long-term upgrades, priority positions first, one per position.</span><span class="seg">${[[25, '≤25'], [29, '≤29'], [99, 'Any age']].map(([a, l]) => `<button data-maxage="${a}" class="${B.maxAge === a ? 'on' : ''}">${l}</button>`).join('')}</span></div>` + tbl(B.best), { right: `≤ ${money(B.caps.max)}` });
      if (B.minNational && !/no limit/i.test(B.minNational)) h += `<div class="sec"><div class="sm" style="color:var(--warn)">Your federation now requires national players: ${esc(B.minNational)}. Check nationalities before buying.</div></div>`;
      h += sec('rvalue', 'Best value', tbl(B.value) + '<div class="xs mut" style="margin-top:6px">Most upgrade per $1M of <b>net</b> cost — the fee minus what he still sells for in 3 seasons (young players keep their value, 30+ lose it), plus a season of wages. Free agents and short-term fixes included.</div>', { right: 'return per $' });
      if (B.stretch.length) h += sec('rstretch', 'Worth saving for', tbl(B.stretch) + '<div class="xs mut" style="margin-top:6px">Bigger long-term upgrades above your cap (under 30).</div>', { right: `> ${money(B.caps.max)}`, open: false });
      h += sec('rslots', 'By position', `<table><tr><th>Slot</th><th>Starter</th><th>Best</th><th>Value</th></tr>${B.slots.map(s => `<tr><td>${chip(s.slot.code)}<div class="xs mut" title="How much this slot decides matches (1 = average)">×${s.imp.toFixed(1)}</div></td><td class="xs">${esc(surname(s.starter.name))}<div class="mut">${f1(s.ov.now)} → ${f1(s.ov.at26)}</div></td>${[s.best, s.value].map(e => `<td class="xs">${e ? `<a href="/ver_jogador.asp?jog_id=${esc(e.c.id)}" style="color:inherit;font-weight:600">${esc(surname(e.c.name))}</a> <span style="color:var(--good)">${sg(e.d5)}</span><div class="mut">${e.c.age}y · ≈${money(e.expPrice)}</div>` : '<span class="mut">—</span>'}</td>`).join('')}</tr>`).join('')}</table><div class="xs mut" style="margin-top:6px">Ordered by how much each position decides matches in the current model (×1 = average).</div>`, { open: false });
    }
    if (db.market?.rows?.length) {
      const ranked = rankCandidates(db.market.rows, plan);
      const vchip = r => (r.verdict === 'buy' ? chip('Buy', 'g') : r.verdict === 'develop' ? chip('Develop', 'w') : chip('Skip'));
      const sg = v => `${v >= 0 ? '+' : ''}${f1(v)}`;
      h += sec('market', 'This search page', `<table><tr><th>Player</th><th>As</th><th class="n">Now</th><th class="n">@26</th><th class="n">5 seasons</th><th class="n">Price</th></tr>${ranked.map(r => `<tr title="${esc(`vs ${r.vs.name}: now ${f1(r.ov.now)}, at 26 ${f1(r.ov.at26)}`)}"><td><a href="/ver_jogador.asp?jog_id=${esc(r.c.id)}" style="color:inherit;font-weight:600">${esc(r.c.name)}</a><div class="xs mut">${r.c.age} · ${esc(r.c.line || '')}${esc(r.c.sides || '')} · ${esc(r.c.quality || '?')}/${esc(r.c.potential || '?')}${r.c.talent ? ' · ' + esc(r.c.talent) : ''}</div><div style="margin-top:2px">${vchip(r)}${!r.afford ? chip('over budget', 'x') : ''}${!r.wageOk ? chip('wage roof', 'x') : ''}</div></td><td>${chip(r.slot.code)}<div class="xs mut">${esc(surname(r.vs.name))}</div></td><td class="n">${f1(r.v.now)}<div class="xs" style="color:${r.dNow >= 0 ? 'var(--good)' : 'var(--bad)'}">${sg(r.dNow)}</div></td><td class="n">${f1(r.v.at26)}<div class="xs" style="color:${r.d26 >= 0 ? 'var(--good)' : 'var(--bad)'}">${sg(r.d26)}</div></td><td class="n"><b style="color:${r.d5 >= 0 ? 'var(--good)' : 'var(--bad)'}">${sg(r.d5)}</b></td><td class="n">${r.c.price ? fmt$(r.c.price) : '<span class="mut">no ask</span>'}<div class="xs mut">${r.c.wage ? fmt$(r.c.wage) + '/wk' : ''}</div></td></tr>`).join('')}</table>
        <div class="xs mut" style="margin-top:6px">Each player is rated in the slot where he helps most and compared with the starter there. <b>Now</b> = today; <b>@26</b> = projected at 26 (last age before decline); <b>5 seasons</b> = summed gap over the next five seasons, discounted 15%/yr — the main ranking. Growth uses his potential grade, −25%/yr from 21, skill losses from 27.</div>`,
        { right: `${ranked.filter(r => r.verdict === 'buy').length} buy · ${ranked.filter(r => r.verdict === 'develop').length} develop · ${ago(db.market.at)}`, open: false });
    }
    if (!B?.scannedAt) {
      h += sec('weak', 'Weakest spots', `<table><tr><th>Slot</th><th>Starter</th><th class="n">Rtg</th><th class="n">Backup</th></tr>${s.slots.slice(0, 6).map(x => `<tr><td>${chip(x.slot.code)}</td><td>${esc(x.p.name)}</td><td class="n">${f1(x.score)}</td><td class="n">${x.depth || '<span style="color:var(--bad)">0</span>'}</td></tr>`).join('')}</table>`);
      h += sec('buy', 'Who to buy', (s.targets.length ? list(s.targets.map(t => ({ lvl: 'info', html: `<b>${t.slot.code}</b> — ${esc(t.profile)}; ≤ 23, potential ≥ Good. Replaces ${esc(t.cur.name)} (${f1(t.curScore)})${t.depth === 0 ? '; no backup today' : ''}.` }))) : '<div class="sm mut">No clear holes — buy young for potential.</div>') + `<div class="xs mut" style="margin-top:6px">Closed-bid 3-day auctions. Bosman/free signings: 30% selling tax first season; free agents cost 12× weekly wage up front.</div>`, { right: `budget ≈ ${fmt$(fin.spendable)}` });
    }
    h += sec('page', 'Players on this page', `<button class="btn" data-act="evalpage">Compare with my XI</button>${pageEval ? (pageEval.length ? `<table style="margin-top:8px"><tr><th>Player</th><th>Slot</th><th class="n">Δ</th></tr>${pageEval.slice(0, 25).map(e => `<tr><td>${esc(e.p.name)} <span class="xs mut">${esc(e.p.line || '')}${esc(e.p.sides || '')} ${e.p.age || ''}</span></td><td>${chip(e.slot.code)}</td><td class="n" style="color:${e.d > 0 ? 'var(--good)' : 'var(--mut)'}">${e.d > 0 ? '+' : ''}${f1(e.d)}</td></tr>`).join('')}</table>` : '<div class="xs mut" style="margin-top:6px">No players with visible skills here.</div>') : ''}`, { open: !!pageEval });
    return h;
  }

  /* ---------- Auto (automation, activity, data) ---------- */
  function viewAuto() {
    const sw = (k, label, sub) => `<div class="opt"><div><div class="b">${label}</div><div class="xs mut">${sub}</div></div><button class="sw ${db.prefs[k] ? 'on' : ''}" data-act="pref" data-pref="${k}" aria-pressed="${!!db.prefs[k]}" title="${db.prefs[k] ? 'On' : 'Off'}"></button></div>`;
    let h = sec('auto', 'Autopilot', `
      ${sw('autoRefresh', 'Keep data fresh', 'Every 6 h; re-scouts the opponent every 12 h.')}
      ${sw('autoApply', 'Match orders', 'XI, style, passing, every advanced option, side, captain, penalties.')}
      ${sw('autoSave', '…and save them', 'Off = filled in, you press Save.')}
      ${sw('autoEvents', 'Match events', 'Rebuilt per match: chase/protect/sent-off style changes and up to 3 subs. Your own events are kept.')}
      ${sw('autoLecture', 'Lecture', 'Once per match, the intensity with the best expected morale gain — none if all are negative.')}
      ${sw('autoTraining', 'Training', 'Individual orders and staff training, every 12 h.')}
      ${sw('autoRenew', 'Contract renewals', 'Keepers with 1 year left, at their minimum asked wage, within the wage roof.')}
      ${sw('autoYouth', 'Youth team', '17–18-year-olds outside the XI go back to the youth team (full training every league round); keeps 14 players and a spare keeper.')}
      ${sw('autoSpeciality', 'Academy speciality', 'Once a season, before promotions, when the model says it pays and funds stay above the safety buffer after the fee + a season of upkeep.')}
      ${sw('autoLearn', 'Learn & improve', 'Daily crawl of every division report; refits the match model and growth rates from them and grades its own forecasts.')}`, { right: `<button class="btn p" data-act="pilot" ${piloting ? 'disabled' : ''}>Run now</button>` });
    const m = db.model, L = learnSummary();
    const nReports = Object.keys(db.reports).length;
    h += sec('learn', 'What I’ve learned', `<div class="kv">
      <div>Match reports in memory</div><div>${nReports}</div>
      <div>Match model</div><div>${m?.fittedOn ? `fitted on ${m.fittedOn} · ${ago(m.fittedAt)}` : `starting values (needs ${MIN_CAL_GAMES} reports)`}</div>
      ${m?.fittedOn ? `<div>Fit vs guessing</div><div>log-lik ${m.logLik} vs ${m.nullLogLik}</div>` : ''}
      <div>Training sessions measured</div><div>${L.growthN}</div>
      <div>Forecasts graded</div><div>${L.graded.length}${L.graded.length ? ` · W${L.record[0]} D${L.record[1]} L${L.record[2]}` : ''}</div>
      ${L.model != null ? `<div>Accuracy (Brier, lower = better)</div><div>me ${L.model.toFixed(2)}${L.pundits != null ? ` · pundits ${L.pundits.toFixed(2)}` : ''}</div>` : ''}</div>
      ${L.graded.length ? `<table style="margin-top:8px"><tr><th>Match</th><th class="n">Score</th><th class="n">Said</th><th></th></tr>${L.graded.slice(0, 6).map(g => { const d = g.decision, r = g.result; return `<tr><td class="xs">${esc(d.date.slice(0, 5))} ${esc(d.weAreHome ? 'vs ' + d.away : '@ ' + d.home)}</td><td class="n">${r.gf}–${r.ga}</td><td class="n xs">${pct(d.forecast.w)} W</td><td>${chip(r.res.toUpperCase(), r.res === 'w' ? 'g' : r.res === 'l' ? 'x' : '')}${r.followed ? '' : chip('plan not used', 'w')}</td></tr>`; }).join('')}</table>` : '<div class="xs mut" style="margin-top:6px">Each match gets graded once its report is in.</div>'}`, { open: true });
    const acts = db.actions || [];
    h += sec('log', 'Activity', acts.length ? list(acts.slice(0, 15).map(a => ({ lvl: a.ok ? 'good' : 'bad', html: `${esc(a.text)} <span class="xs mut">· ${a.kind} · ${ago(a.at)}</span>` }))) : '<div class="sm mut">Nothing yet.</div>');
    const src = [['Squad', db.squad?.at], ['Training', db.training?.at], ['Economy', db.economy?.at], ['Club', db.club?.at], ['Contracts', db.contracts?.at], ['Fixtures', db.fixtures?.at], ['Next match', db.next?.at], ['Events', db.events?.at], ['Lecture', db.lecture?.at]];
    const cal = calibration();
    h += sec('data', 'Data', `<div class="kv">${src.map(([n, at]) => `<div>${n}</div><div class="${at ? '' : 'mut'}">${ago(at)}</div>`).join('')}<div>Match reports</div><div>${Object.keys(db.reports).length}</div><div>Calibration</div><div>${cal.n ? `${cal.a.toFixed(2)} ★/pt · ${cal.n} zones` : 'default'}</div></div>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="refresh" ${busy ? 'disabled' : ''}>Refresh all</button><button class="btn" data-act="scout" ${busy ? 'disabled' : ''}>Scout opponent</button></div>`, { open: false });
    const names = db.next ? [db.next.home, db.next.away] : [];
    h += sec('team', 'Your team', `<div class="row"><input class="txt" id="myname" value="${esc(db.me.name || '')}" placeholder="Team name"><button class="btn" data-act="setname">Save</button></div>${names.length ? `<div class="row" style="margin-top:6px">${names.map(n => `<button class="btn" data-me="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}`, { open: !db.me.name });
    h += sec('trouble', 'Troubleshooting', `<div class="row"><button class="btn" data-act="export">Export data</button><button class="btn" data-act="snapshot">Copy page snapshot</button><button class="btn" data-act="reset">Reset data</button></div><div class="xs mut" style="margin-top:6px">Export saves everything the copilot has collected as one JSON file — drop it into the project’s data/ folder.</div><div class="xs mut" style="margin-top:6px">v${VERSION} · Alt+P toggles the panel</div>`, { open: false });
    return h;
  }

  function planText(plan) {
    const b = plan.best, a = b.ats;
    return [
      `PM Copilot — vs ${plan.opp?.name || '?'}`,
      `${formLabel(b.f)} (${formDetail(b.f)}) · ${b.style} / ${b.passing} passing · attack ${plan.pref}`,
      ...b.xi.map(x => `  ${x.slot.code.padEnd(3)} ${x.p.name}`),
      a ? `Pressing ${a.pressing} · Offside ${a.offside ? 'Yes' : 'No'} · Counter ${a.counter ? 'Yes' : 'No'} · High balls ${a.highBalls ? 'Yes' : 'No'} · 1v1 ${a.oneOnOne ? 'Yes' : 'No'} · Keeper ${a.keeping} · Marking ${a.marking} · Long shots ${a.longShots ? 'Yes' : 'No'}` : 'ATs: off (opponent not scouted)',
      `Captain ${plan.captain?.p.name} · Penalties ${plan.pens?.p.name}`,
      `Estimate W/D/L ${pct(shown(b.r).w)} / ${pct(shown(b.r).d)} / ${pct(shown(b.r).l)} · xG ${f1(b.r.xgFor)}–${f1(b.r.xgAg)}`,
    ].join('\n');
  }

  async function runBusy(fn, label = 'Working') {
    if (busy) return;
    busy = true;
    setStatus(label + '…');
    render();
    try {
      const log = await fn(setStatus);
      toast((Array.isArray(log) ? log : []).filter(Boolean).slice(-2).join(' · ') || 'Done');
    } catch (e) { toast('⚠ ' + e.message); }
    busy = false;
    setStatus(null);
    render();
  }

  shadow.addEventListener('click', e => {
    const t = e.target.closest('button,tr,[data-act]');
    if (!t) return;
    if (t === fab) return setOpen(!panel.classList.contains('open'));
    if (t.dataset.tab) { tab = t.dataset.tab; db.prefs.tab = tab; GM_setValue(KEY, JSON.stringify(db)); body.scrollTop = 0; return render(); }
    if (t.dataset.obj) { db.prefs.objective = t.dataset.obj; save(); return render(); }
    if (t.dataset.buypct) { db.prefs.buyPct = +t.dataset.buypct; save(); return render(); }
    if (t.dataset.maxage) { db.prefs.maxBuyAge = +t.dataset.maxage; save(); return render(); }
    if (t.dataset.ex) {
      const ex = new Set(db.prefs.excluded);
      if (ex.has(t.dataset.ex)) ex.delete(t.dataset.ex); else ex.add(t.dataset.ex);
      db.prefs.excluded = [...ex];
      save();
      return render();
    }
    if (t.dataset.me) { setMe(t.dataset.me); return render(); }
    switch (t.dataset.act) {
      case 'close': return setOpen(false);
      case 'refresh': return runBusy(refreshAll, 'Refreshing');
      case 'scout': return runBusy(scoutOpponent, 'Scouting');
      case 'scan': return runBusy(runScan, 'Scanning market');
      case 'pilot': return autoPilot({ forceOrders: false });
      case 'copy': GM_setClipboard(planText(computePlan())); return toast('Plan copied');
      case 'snapshot': GM_setClipboard(snapshot()); return toast('Snapshot copied');
      case 'export': {
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: VERSION, db }, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pm-copilot-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        return toast('Export downloaded');
      }
      case 'setname': setMe(shadow.getElementById('myname').value); return render();
      case 'evalpage': pageEval = evaluatePagePlayers(computePlan()); return render();
      case 'reset':
        if (confirm('Clear all PM Copilot data?')) { db = blankDb(); save(); render(); }
        return;
      case 'apply': return runBusy(async () => { const r = await applyOrders({ force: true }); return [r ? `Orders ${r.saved ? 'saved' : 'filled'}${r.failed.length ? ' · skipped ' + r.failed.join(', ') : ''}` : 'Already up to date']; }, 'Applying orders');
      case 'train': return runBusy(async () => { const r = await autoTraining(); db.trainingAppliedAt = now(); save(); return [`${r.n} training orders changed${r.staff ? ', staff → ' + r.staff : ''}`]; }, 'Training');
      case 'pref': {
        db.prefs[t.dataset.pref] = !db.prefs[t.dataset.pref];
        save();
        return render();
      }
    }
  });
  function setMe(name) {
    db.me.name = clean(name);
    resolveSides();
    save();
    toast('Your team: ' + db.me.name);
  }
  document.addEventListener('keydown', e => {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); setOpen(!panel.classList.contains('open')); }
  });

  /* =========================================================================
   * Boot: read the page we're on (the lineup editor renders late), then autopilot
   * ======================================================================= */
  if (db.model) applyModel(db.model); // the model this browser has calibrated so far
  function boot(attempt = 0) {
    const msg = ingest(document, location.href);
    if (!msg && /titulares/i.test(location.pathname) && attempt < 20) return setTimeout(() => boot(attempt + 1), 500);
    if (/titulares/i.test(location.pathname)) ordersContext();
    if (/procurar/i.test(location.pathname) && msg) { badgeMarketRows(); setOpen(true); }
    if (msg && panel.classList.contains('open')) render();
    autoPilot().catch(e => console.warn('[PM Copilot] autopilot', e));
  }
  boot();
  if (GM_getValue('pmc_open', false)) setOpen(true);
  if (window.__PMC_TEST) window.__PMC_TEST.version = VERSION;
  if (window.__PMC_TEST) window.__PMC_TEST.api = { db: () => db, ingest, fetchDoc, grab, parseSkillPlayers, computePlan, trainingAdvice, clubAdvice, staffAdvice, scoutOpponent, refreshAll, calibration, snapshot, render, setOpen, planEvents, lectureChoice, autoPilot, applyOrders, autoEvents, autoLecture, autoRenew, autoTraining, prep, rankCandidates, badgeMarketRows, valuePath, learn, calibrateModel, gradeMatches, learnSummary, recordGrowth, recordDecision, scanMarket, runScan, recruitBoard, fairPriceModel, searchUrl, specialityPlan, youthMoves, autoYouth, autoSpeciality };
})();
