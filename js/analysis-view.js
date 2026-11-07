import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { getEngine } from './engine.js';
import { analyzeGame, MARKS, winPercent, evalText } from './analysis.js';
import { esc, moveListHtml, store, toast } from './ui.js';
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
  if (!data) return renderInput(root);
  run(root, data);
}

function renderInput(root) {
  const last = store.get('lastPgn', '');
  root.innerHTML = `
    <h1>${t('an.title')}</h1>
    <p class="lead">${t('an.lead')}</p>
    <div class="panel">
      <textarea id="pgn" rows="8" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 ...">${esc(last)}</textarea>
      <div class="btn-row">
        <button class="btn primary" id="go">🔍 ${t('an.go')}</button>
      </div>
      <p class="muted">${t('an.note')}</p>
    </div>`;
  root.querySelector('#go').onclick = () => {
    const text = root.querySelector('#pgn').value.trim();
    const c = new Chess();
    try { c.loadPgn(text); } catch {
      toast(t('an.badPgn'), 'bad');
      return;
    }
    if (!c.history().length) { toast(t('an.noMoves'), 'bad'); return; }
    store.set('lastPgn', text);
    const h = c.getHeaders ? c.getHeaders() : c.header();
    const val = (v) => (v && v !== '?' ? v : null);
    run(root, { moves: c.history(), white: val(h.White) || t('common.white'), black: val(h.Black) || t('common.black'), result: val(h.Result) !== '*' ? val(h.Result) : null });
  };
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
  const chess = new Chess();
  for (const m of data.moves) chess.move(typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m) ? { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] } : m);
  const sans = chess.history();
  board.setPosition(new Chess().fen());
  root.querySelector('#amoves').innerHTML = moveListHtml(sans, -1);

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
    res = await analyzeGame({ moves: sans }, engine, {
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
