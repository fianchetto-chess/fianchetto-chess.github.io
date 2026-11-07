import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { getEngine } from './engine.js';
import { analyzeGame, MARKS, winPercent, evalText } from './analysis.js';
import { esc, moveListHtml, store, toast, moveSound } from './ui.js';
import { t } from './i18n.js';

let pending = null;

export function openAnalysis(data) {
  pending = data;
  if (location.hash === '#/analysis') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/analysis';
}

export function renderAnalysis(root) {
  const data = pending;
  pending = null;
  if (!data) return renderBoard(root, store.get('anBoard', {}));
  run(root, data);
}

// ---------- Доска для анализа: ходы за обе стороны + движок в реальном времени ----------
const uciMv = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

function renderBoard(root, init = {}) {
  root.innerHTML = `
    <div class="analysis-head"><h1>${t('an.boardTitle')}</h1></div>
    <p class="lead">${t('an.boardLead')}</p>
    <div class="game-layout">
      <div class="board-col">
        <div class="board-with-bar">
          <div class="evalbar"><div class="evalbar-white" style="height:50%"></div><span class="evalbar-text"></span></div>
          <div id="fboard"></div>
        </div>
        <div class="btn-row nav-row">
          <button class="btn" id="first">⏮</button><button class="btn" id="back">◀</button>
          <button class="btn" id="fwd">▶</button><button class="btn" id="last">⏭</button>
          <button class="btn" id="flip">⇅</button>
        </div>
      </div>
      <div class="side-col panel">
        <div class="engine-head">
          <label class="toggle"><input type="checkbox" id="engOn" ${store.get('engOn', true) ? 'checked' : ''}> ${t('an.engine')}</label>
          <label class="toggle"><input type="checkbox" id="arrowOn" ${store.get('arrowOn', true) ? 'checked' : ''}> ${t('an.showArrow')}</label>
          <span class="eng-depth muted"></span>
        </div>
        <div class="eng-lines"></div>
        <div class="moves" id="fmoves"></div>
        <div class="btn-row">
          <button class="btn primary" id="full">🔍 ${t('an.analyseFull')}</button>
          <button class="btn" id="undo">↶ ${t('common.takeback')}</button>
          <button class="btn" id="reset">⟲ ${t('an.reset')}</button>
        </div>
        <details class="load-box">
          <summary>${t('an.loadPgn')}</summary>
          <textarea id="pgn" rows="5" placeholder="1. e4 e5 2. Nf3 Nc6 …  /  FEN"></textarea>
          <button class="btn" id="load">${t('an.load')}</button>
        </details>
      </div>
    </div>`;
  const board = new Board(root.querySelector('#fboard'), { orientation: init.orientation || 'w' });
  const engine = getEngine();
  const linesEl = root.querySelector('.eng-lines');
  const depthEl = root.querySelector('.eng-depth');
  const barWhite = root.querySelector('.evalbar-white');
  const barText = root.querySelector('.evalbar-text');
  let startFen = init.startFen || new Chess().fen();
  let moves = [];   // SAN
  let cur = 0;      // сколько ходов показано
  let tok = 0;
  let lines = [];

  // восстановить прошлую доску
  try {
    const c = new Chess(startFen);
    for (const m of init.moves || []) { c.move(m); moves.push(m); }
    cur = Math.min(init.cur ?? moves.length, moves.length);
  } catch { startFen = new Chess().fen(); moves = []; cur = 0; }

  const save = () => store.set('anBoard', { startFen, moves, cur, orientation: board.orientation });
  const position = (n = cur) => { const c = new Chess(startFen); for (let i = 0; i < n; i++) c.move(moves[i]); return c; };

  function evalOf(line, turn) {
    const sign = turn === 'w' ? 1 : -1;
    return line.score.mate !== undefined ? { mate: sign * line.score.mate, cp: null } : { cp: sign * line.score.cp, mate: null };
  }

  function drawLines(chess) {
    const turn = chess.turn();
    if (chess.isGameOver()) {
      linesEl.innerHTML = `<div class="eng-line over">${chess.isCheckmate() ? t('an.mateOnBoard') : t('result.draw')}</div>`;
      return;
    }
    if (!root.querySelector('#engOn').checked) { linesEl.innerHTML = `<div class="muted">${t('an.engineOff')}</div>`; return; }
    if (!lines.length) { linesEl.innerHTML = `<div class="muted">${t('an.thinking')}</div>`; return; }
    linesEl.innerHTML = lines.map((l, i) => {
      if (!l) return '';
      const ev = evalOf(l, turn);
      const c = new Chess(chess.fen());
      const sans = [];
      for (const u of l.pv.slice(0, 10)) { try { sans.push(c.move(uciMv(u)).san); } catch { break; } }
      let num = Number(chess.fen().split(' ')[5]);
      let w = turn === 'w';
      const txt = sans.map((s, j) => { const p = w ? `${num}.${s}` : (j === 0 ? `${num}...${s}` : s); if (!w) num++; w = !w; return p; }).join(' ');
      return `<div class="eng-line" data-i="${i}"><span class="eng-eval ${(ev.mate ?? ev.cp) >= 0 ? 'pos' : 'neg'}">${evalText(ev)}</span><span class="eng-pv">${esc(txt)}</span></div>`;
    }).join('');
    const ev = evalOf(lines[0], turn);
    const wp = winPercent(ev);
    barWhite.style.height = `${wp}%`;
    barText.textContent = evalText(ev);
    barText.className = `evalbar-text ${wp >= 50 ? 'on-white' : 'on-black'}`;
    board.setArrows(root.querySelector('#arrowOn').checked && lines[0].pv[0] ? [{ from: lines[0].pv[0].slice(0, 2), to: lines[0].pv[0].slice(2, 4), color: 'blue' }] : []);
  }

  function think(chess) {
    const my = ++tok;
    lines = [];
    depthEl.textContent = '';
    engine.stop();
    board.setArrows([]);
    drawLines(chess);
    if (chess.isGameOver() || !root.querySelector('#engOn').checked) {
      if (chess.isCheckmate()) { const wp = chess.turn() === 'w' ? 0 : 100; barWhite.style.height = `${wp}%`; barText.textContent = '#'; }
      return;
    }
    setTimeout(() => {
      if (my !== tok) return;
      let last = 0;
      engine.analyse(chess.fen(), {
        depth: 20, multipv: 3,
        onInfo: (info) => {
          if (my !== tok) return;
          lines[info.multipv - 1] = info;
          depthEl.textContent = t('an.depthN', { d: info.depth });
          const now = performance.now();
          if (now - last > 120) { last = now; drawLines(chess); }
        },
      }).then(() => { if (my === tok) drawLines(chess); });
    }, 120);
  }

  function show(animate = true) {
    const chess = position();
    board.fromChess(chess, { movable: chess.isGameOver() ? null : 'both', animate });
    const box = root.querySelector('#fmoves');
    box.innerHTML = moveListHtml(moves, cur - 1) || `<div class="muted">${t('an.boardEmpty')}</div>`;
    box.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
    save();
    think(chess);
  }

  board.onMove = (from, to, promotion, animate = false) => {
    const chess = position();
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { show(false); return; }
    moveSound(mv);
    if (moves[cur] !== mv.san) { moves = moves.slice(0, cur); moves.push(mv.san); } // новый вариант заменяет продолжение
    cur++;
    show(animate);
  };

  const go = (n) => {
    const target = Math.max(0, Math.min(moves.length, n));
    if (target === cur) return;
    if (target === cur + 1) { const c = position(); moveSound(c.move(moves[cur])); }
    cur = target;
    show(true);
  };
  root.querySelector('#first').onclick = () => go(0);
  root.querySelector('#back').onclick = () => go(cur - 1);
  root.querySelector('#fwd').onclick = () => go(cur + 1);
  root.querySelector('#last').onclick = () => go(moves.length);
  root.querySelector('#flip').onclick = () => { board.flip(); save(); };
  root.querySelector('#fmoves').onclick = (e) => { const m = e.target.closest('.mv[data-ply]'); if (m) go(Number(m.dataset.ply) + 1); };
  linesEl.onclick = (e) => {
    const l = e.target.closest('.eng-line[data-i]');
    if (!l || !lines[l.dataset.i]) return;
    const u = lines[l.dataset.i].pv[0];
    board.onMove(u.slice(0, 2), u.slice(2, 4), u[4], true);
  };
  root.querySelector('#engOn').onchange = (e) => { store.set('engOn', e.target.checked); show(false); };
  root.querySelector('#arrowOn').onchange = (e) => { store.set('arrowOn', e.target.checked); drawLines(position()); if (!e.target.checked) board.setArrows([]); };
  root.querySelector('#undo').onclick = () => { if (!cur) return; moves = moves.slice(0, cur - 1); cur--; show(true); };
  root.querySelector('#reset').onclick = () => { startFen = new Chess().fen(); moves = []; cur = 0; show(false); };
  root.querySelector('#full').onclick = () => {
    if (!moves.length) { toast(t('an.noMoves'), 'bad'); return; }
    tok++; engine.stop();
    run(root, { moves: moves.slice(), startFen, orientation: board.orientation });
  };
  root.querySelector('#load').onclick = () => {
    const text = root.querySelector('#pgn').value.trim();
    if (!text) return;
    const c = new Chess();
    try {
      c.loadPgn(text);
      const hdr = c.getHeaders ? c.getHeaders() : c.header();
      startFen = hdr.FEN || new Chess().fen();
      moves = c.history(); cur = moves.length;
    } catch {
      try { new Chess(text); startFen = text; moves = []; cur = 0; } catch { toast(t('an.badPgn'), 'bad'); return; }
    }
    root.querySelector('.load-box').open = false;
    show(false);
  };
  const key = (e) => {
    if (!document.body.contains(board.el)) { window.removeEventListener('keydown', key); return; }
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') go(cur - 1);
    if (e.key === 'ArrowRight') go(cur + 1);
  };
  window.addEventListener('keydown', key);
  root._cleanup = () => { tok++; engine.stop(); };
  show(false);
}

async function run(root, data) {
  const depthSaved = store.get('depth', 12);
  root.innerHTML = `
    <div class="analysis-head">
      <h1>${t('an.titleShort')}: ${esc(data.white || t('common.white'))} — ${esc(data.black || t('common.black'))} ${data.result ? `<small>${esc(data.result)}</small>` : ''}</h1>
      <label class="depth">${t('an.depth')}:
        <select id="depth">
          <option value="10" ${depthSaved === 10 ? 'selected' : ''}>${t('an.fast')}</option>
          <option value="12" ${depthSaved === 12 ? 'selected' : ''}>${t('an.normal')}</option>
          <option value="16" ${depthSaved === 16 ? 'selected' : ''}>${t('an.deep')}</option>
        </select>
      </label>
    </div>
    <div class="game-layout">
      <div class="board-col">
        <div class="board-with-bar">
          <div class="evalbar"><div class="evalbar-white"></div><span class="evalbar-text"></span></div>
          <div id="aboard"></div>
        </div>
        <div class="btn-row nav-row">
          <button class="btn" id="first">⏮</button><button class="btn" id="back">◀</button>
          <button class="btn" id="fwd">▶</button><button class="btn" id="last">⏭</button>
          <button class="btn" id="flip">⇅</button>
          <button class="btn" id="toBoard">♟ ${t('an.toBoard')}</button>
        </div>
      </div>
      <div class="side-col panel">
        <div class="progress"><div class="progress-bar"></div><span class="progress-text">${t('an.loadingEngine')}</span></div>
        <div class="summary"></div>
        <div class="move-comment"></div>
        <div class="moves" id="amoves"></div>
        <div class="graph"></div>
      </div>
    </div>`;
  const board = new Board(root.querySelector('#aboard'), { orientation: data.orientation || 'w' });
  const chess = new Chess(data.startFen || undefined);
  for (const m of data.moves) chess.move(typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m) ? { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] } : m);
  const sans = chess.history();
  board.setPosition(new Chess(data.startFen || undefined).fen());
  root.querySelector('#amoves').innerHTML = moveListHtml(sans, -1);

  root.querySelector('#toBoard').onclick = () => {
    run.id = (run.id || 0) + 1;
    renderBoard(root, { startFen: data.startFen, moves: sans, cur: sans.length, orientation: board.orientation });
  };
  root.querySelector('#depth').onchange = (e) => {
    store.set('depth', Number(e.target.value));
    run(root, data);
  };

  const engine = getEngine();
  const bar = root.querySelector('.progress-bar');
  const ptext = root.querySelector('.progress-text');
  await engine.ready;
  if (!document.body.contains(board.el)) return;
  ptext.textContent = t('an.progress', { p: 0 });
  const myRun = (run.id = (run.id || 0) + 1);
  let res;
  try {
    res = await analyzeGame({ moves: sans, startFen: data.startFen }, engine, {
      depth: store.get('depth', 12),
      onProgress: (p) => {
        if (run.id !== myRun) throw new Error('cancelled');
        bar.style.width = `${Math.round(p * 100)}%`;
        ptext.textContent = t('an.progress', { p: Math.round(p * 100) });
      },
    });
  } catch (e) {
    if (e.message !== 'cancelled') toast(t('err.analysis', { msg: e.message }), 'bad');
    return;
  }
  if (run.id !== myRun || !document.body.contains(board.el)) return;
  root.querySelector('.progress').remove();
  show(root, board, res, data);
}

function show(root, board, res, data) {
  let cur = res.results.length - 1;
  const box = root.querySelector('#amoves');
  const commentEl = root.querySelector('.move-comment');
  const barWhite = root.querySelector('.evalbar-white');
  const barText = root.querySelector('.evalbar-text');

  const counts = (c) => ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'interesting', 'inaccuracy', 'mistake', 'blunder']
    .map((k) => `<td class="${MARKS[k].cls}">${res.summary[c].counts[k]}</td>`).join('');
  root.querySelector('.summary').innerHTML = `
    ${res.opening ? `<div class="opening-name">📖 ${esc(res.opening)}</div>` : ''}
    <table class="sum-table">
      <tr><th></th><th>${t('an.accuracy')}</th>${['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'interesting', 'inaccuracy', 'mistake', 'blunder'].map((k) => `<th title="${MARKS[k].name}">${MARKS[k].icon(20)}</th>`).join('')}</tr>
      <tr><td>⚪ ${esc(data.white || t('common.white'))}</td><td class="acc">${res.summary.w.accuracy}%</td>${counts('w')}</tr>
      <tr><td>⚫ ${esc(data.black || t('common.black'))}</td><td class="acc">${res.summary.b.accuracy}%</td>${counts('b')}</tr>
    </table>`;

  drawGraph(root.querySelector('.graph'), res, (ply) => go(ply));

  function go(n) {
    cur = Math.max(-1, Math.min(res.results.length - 1, n));
    const fen = res.fens[cur + 1];
    const r = res.results[cur];
    const c = new Chess(fen);
    board.fromChess(c, { lastMove: r ? [r.from, r.to] : null });
    board.setBadges(r ? [{ sq: r.to, html: r.mark.icon(40) }] : []);
    const arrows = [];
    if (r && r.bestUci && r.bestUci !== r.uci && !['best', 'book', 'brilliant', 'great'].includes(r.kind)) {
      arrows.push({ from: r.bestUci.slice(0, 2), to: r.bestUci.slice(2, 4), color: 'green' });
    }
    board.setArrows(arrows);
    const ev = res.evals[cur + 1];
    const wp = winPercent(ev);
    barWhite.style.height = `${wp}%`;
    barText.textContent = evalText(ev);
    barText.className = `evalbar-text ${wp >= 50 ? 'on-white' : 'on-black'}`;
    box.innerHTML = moveListHtml(res.results.map((x) => x.san), cur, res.results);
    box.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
    if (!r) {
      commentEl.className = 'move-comment';
      commentEl.innerHTML = `<div class="mc-title">${t('an.startPos')}</div><div>${t('an.startHint')}</div>`;
    } else {
      const who = r.color === 'w' ? data.white || t('common.white') : data.black || t('common.black');
      commentEl.className = `move-comment ${r.mark.cls}`;
      commentEl.innerHTML = `
        <div class="mc-title">${r.mark.icon(28)}
          ${Math.floor(r.ply / 2) + 1}${r.color === 'w' ? '.' : '...'} ${esc(r.san)}${r.mark.sym} — ${r.mark.name}</div>
        <div class="mc-who">${esc(who)} · ${t('an.evalAfter')}: <b>${evalText(r.evalAfter)}</b></div>
        <div class="mc-text">${esc(r.text)}</div>`;
    }
    const cx = gx(cur + 1, res);
    root.querySelectorAll('.graph .cursor').forEach((el) => { el.setAttribute('x1', cx); el.setAttribute('x2', cx); });
  }

  box.onclick = (e) => { const m = e.target.closest('.mv[data-ply]'); if (m) go(Number(m.dataset.ply)); };
  root.querySelector('#first').onclick = () => go(-1);
  root.querySelector('#back').onclick = () => go(cur - 1);
  root.querySelector('#fwd').onclick = () => go(cur + 1);
  root.querySelector('#last').onclick = () => go(res.results.length - 1);
  root.querySelector('#flip').onclick = () => { board.flip(); go(cur); };
  const key = (e) => {
    if (!document.body.contains(board.el)) { window.removeEventListener('keydown', key); return; }
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') go(cur - 1);
    if (e.key === 'ArrowRight') go(cur + 1);
  };
  window.addEventListener('keydown', key);
  go(-1);
}

const GW = 600, GH = 120;
function gx(i, res) { return (i / Math.max(1, res.fens.length - 1)) * GW; }

function drawGraph(el, res, onPick) {
  const pts = res.evals.map((ev, i) => [gx(i, res), GH - (winPercent(ev) / 100) * GH]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const dots = res.results.map((r, i) => {
    if (!['blunder', 'mistake', 'inaccuracy', 'brilliant', 'great'].includes(r.kind)) return '';
    const [x, y] = pts[i + 1];
    return `<circle cx="${x}" cy="${y}" r="4" class="gdot ${r.mark.cls}" data-ply="${i}"><title>${r.san}${r.mark.sym}</title></circle>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="none">
      <rect x="0" y="0" width="${GW}" height="${GH}" class="gbg"/>
      <polygon points="0,${GH} ${line} ${GW},${GH}" class="garea"/>
      <line x1="0" y1="${GH / 2}" x2="${GW}" y2="${GH / 2}" class="gmid"/>
      <line class="cursor" x1="0" y1="0" x2="0" y2="${GH}"/>
      ${dots}
    </svg>`;
  const svg = el.querySelector('svg');
  svg.onclick = (e) => {
    const d = e.target.closest('[data-ply]');
    if (d) return onPick(Number(d.dataset.ply));
    const rect = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (res.fens.length - 1));
    onPick(i - 1);
  };
}
