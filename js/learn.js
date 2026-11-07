import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { SECTIONS, OPENINGS } from './lessons-data.js';
import { esc, store, moveListHtml, checkSquare, playSound } from './ui.js';
import { t, tx, getLang } from './i18n.js';

const done = () => store.get('done', {});
const markDone = (id) => { const d = done(); d[id] = true; store.set('done', d); };
export const openingComment = (row) => (getLang() === 'ru' ? row[2] : row[1]);

export function renderLearn(root) {
  const d = done();
  root.innerHTML = `
    <h1>${t('learn.title')}</h1>
    <p class="lead">${t('learn.lead')}</p>
    ${SECTIONS.map((s) => `
      <h2>${s.icon} ${esc(tx(s.title))}</h2>
      <div class="cards">${s.lessons.map((l) => `
        <a class="card lesson-card ${d[l.id] ? 'done' : ''}" href="#/learn/lesson/${l.id}">
          <div class="card-title">${esc(tx(l.title))}</div>
          <div class="card-sub">${t('learn.steps', { n: l.steps.length })}${d[l.id] ? ` · ${t('learn.completed')} ✓` : ''}</div>
        </a>`).join('')}</div>`).join('')}
    <h2>♗ ${t('learn.openings')}</h2>
    <div class="cards">${OPENINGS.map((o) => `
      <a class="card lesson-card ${d['op-' + o.id] ? 'done' : ''}" href="#/learn/opening/${o.id}">
        <div class="card-title">${esc(tx(o.title))}</div>
        <div class="card-sub">${o.eco} · ${t(o.side === 'w' ? 'learn.forWhite' : 'learn.forBlack')}${d['op-' + o.id] ? ` · ${t('learn.learned')} ✓` : ''}</div>
      </a>`).join('')}</div>`;
}

export function renderLesson(root, id) {
  const lesson = SECTIONS.flatMap((s) => s.lessons).find((l) => l.id === id);
  if (!lesson) { root.innerHTML = `<p>${t('common.notFound')}</p>`; return; }
  root.innerHTML = `
    <a href="#/learn" class="back">← ${t('learn.allLessons')}</a>
    <div class="game-layout">
      <div class="board-col"><div id="lboard"></div></div>
      <div class="side-col panel">
        <h2>${esc(tx(lesson.title))}</h2>
        <div class="step-count"></div>
        <div class="lesson-text"></div>
        <div class="feedback"></div>
        <div class="btn-row">
          <button class="btn" id="prev">← ${t('common.back')}</button>
          <button class="btn" id="hint">${t('common.hint')}</button>
          <button class="btn" id="reset">${t('common.retry')}</button>
          <button class="btn primary" id="next">${t('common.next')} →</button>
        </div>
      </div>
    </div>`;
  const fb = root.querySelector('.feedback');
  const board = new Board(root.querySelector('#lboard'));
  let step = 0;
  let chess;
  let seqIdx = 0;
  let solved = false;

  const feedback = (html, cls = '') => { fb.className = `feedback ${cls}`; fb.innerHTML = html; };

  function update(lastMove) {
    const st = lesson.steps[step];
    const interactive = st.type !== 'show' && !solved;
    board.fromChess(chess, { movable: interactive ? chess.turn() : null, lastMove });
  }

  function setup() {
    const st = lesson.steps[step];
    solved = st.type === 'show' || st.type === 'explore';
    seqIdx = 0;
    chess = new Chess(st.fen || undefined);
    if (st.moves) for (const m of st.moves) chess.move(m);
    board.setOrientation(st.type === 'explore' ? 'w' : chess.turn());
    board.setArrows([]);
    root.querySelector('.step-count').textContent = t('learn.stepOf', { i: step + 1, n: lesson.steps.length });
    root.querySelector('.lesson-text').innerHTML = tx(st.text);
    feedback('');
    root.querySelector('#prev').disabled = step === 0;
    root.querySelector('#hint').style.display = ['task', 'sequence'].includes(st.type) ? '' : 'none';
    const hist = chess.history({ verbose: true });
    update(hist.length ? [hist.at(-1).from, hist.at(-1).to] : null);
    if (st.type === 'explore') board.fromChess(chess, { movable: 'w', lastMove: null });
    refreshNext();
  }

  function refreshNext() {
    const last = step === lesson.steps.length - 1;
    const nb = root.querySelector('#next');
    nb.textContent = last ? `${t('common.finish')} ✓` : `${t('common.next')} →`;
    nb.disabled = !solved;
  }

  function success(text) {
    solved = true;
    playSound('end');
    feedback(`✅ ${tx(text)}`, 'ok');
    board.setMovable(null);
    refreshNext();
  }

  board.onMove = (from, to, promotion) => {
    const st = lesson.steps[step];
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { update(); return; }
    playSound(mv.captured ? 'capture' : 'move');

    if (st.type === 'explore') {
      const parts = chess.fen().split(' ');
      parts[1] = 'w'; parts[3] = '-';
      try { chess.load(parts.join(' ')); } catch { chess = new Chess(st.fen); }
      board.fromChess(chess, { movable: 'w', lastMove: [from, to] });
      return;
    }

    if (st.type === 'task') {
      const ok = (st.solution && st.solution.includes(mv.lan)) || (st.check === 'mate' && chess.isCheckmate());
      if (ok) { update([from, to]); success(st.success); return; }
      feedback(chess.isStalemate() ? `😬 ${t('learn.stalemateRetry')}` : `❌ ${t('learn.notQuite')}`, 'bad');
      update([from, to]);
      setTimeout(() => { chess.undo(); update(); }, 900);
      return;
    }

    if (st.type === 'sequence') {
      if (mv.san === st.line[seqIdx]) {
        seqIdx++;
        update([from, to]);
        if (seqIdx >= st.line.length) { success(st.success); return; }
        feedback(`👍 ${t('learn.correctOpp')}`, 'ok');
        board.setMovable(null);
        setTimeout(() => {
          const r = chess.move(st.line[seqIdx]);
          seqIdx++;
          playSound(r.captured ? 'capture' : 'move');
          update([r.from, r.to]);
          if (seqIdx >= st.line.length) success(st.success);
          else feedback(t('common.yourMove'), '');
        }, 600);
      } else {
        feedback(`❌ ${t('learn.wrongMove')}`, 'bad');
        update([from, to]);
        setTimeout(() => { chess.undo(); update(); }, 900);
      }
    }
  };

  root.querySelector('#hint').onclick = () => {
    const st = lesson.steps[step];
    let uci = null;
    if (st.type === 'task') {
      if (st.solution) uci = st.solution[0];
      else if (st.check === 'mate') {
        const m = chess.moves({ verbose: true }).find((x) => { const tt = new Chess(chess.fen()); tt.move(x); return tt.isCheckmate(); });
        uci = m && m.lan;
      }
    } else if (st.type === 'sequence') {
      uci = new Chess(chess.fen()).move(st.line[seqIdx]).lan;
    }
    if (uci) board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: 'green' }]);
  };
  root.querySelector('#reset').onclick = setup;
  root.querySelector('#prev').onclick = () => { if (step > 0) { step--; setup(); } };
  root.querySelector('#next').onclick = () => {
    if (step < lesson.steps.length - 1) { step++; setup(); } else { markDone(lesson.id); location.hash = '#/learn'; }
  };
  setup();
}

export function renderOpening(root, id) {
  const op = OPENINGS.find((o) => o.id === id);
  if (!op) { root.innerHTML = `<p>${t('common.notFound')}</p>`; return; }
  const sans = op.line.map((x) => x[0]);
  root.innerHTML = `
    <a href="#/learn" class="back">← ${t('learn.allLessons')}</a>
    <div class="game-layout">
      <div class="board-col"><div id="oboard"></div></div>
      <div class="side-col panel">
        <h2>${esc(tx(op.title))} <small>${op.eco}</small></h2>
        <p>${esc(tx(op.intro))}</p>
        <div class="tabs"><button class="tab active" data-m="view">${t('learn.view')}</button><button class="tab" data-m="train">${t(op.side === 'w' ? 'learn.trainWhite' : 'learn.trainBlack')}</button></div>
        <div class="comment"></div>
        <div class="moves" id="omoves"></div>
        <div class="btn-row nav-row">
          <button class="btn" id="first">⏮</button><button class="btn" id="back">◀</button>
          <button class="btn" id="fwd">▶</button><button class="btn" id="last">⏭</button>
        </div>
        <div class="feedback"></div>
      </div>
    </div>`;
  const board = new Board(root.querySelector('#oboard'), { orientation: op.side });
  const comment = root.querySelector('.comment');
  const fb = root.querySelector('.feedback');
  const navRow = root.querySelector('.nav-row');
  let mode = 'view';
  let ply = 0;
  let chess = new Chess();

  function positionAt(n) {
    const c = new Chess();
    for (let i = 0; i < n; i++) c.move(sans[i]);
    return c;
  }

  function show() {
    chess = positionAt(ply);
    const hist = chess.history({ verbose: true });
    const lm = hist.length ? [hist.at(-1).from, hist.at(-1).to] : null;
    const movable = mode === 'train' && ply < sans.length && chess.turn() === op.side ? op.side : null;
    board.fromChess(chess, { movable, lastMove: lm });
    board.setArrows([]);
    root.querySelector('#omoves').innerHTML = moveListHtml(sans.slice(0, mode === 'train' ? ply : sans.length), ply - 1);
    comment.innerHTML = ply === 0 ? t('learn.startPos') : `<b>${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${esc(sans[ply - 1])}</b> — ${esc(openingComment(op.line[ply - 1]))}`;
  }

  function autoOpponent() {
    if (mode !== 'train') return;
    if (ply >= sans.length) {
      fb.className = 'feedback ok';
      fb.innerHTML = `🎉 ${t('learn.openingDone')}`;
      markDone('op-' + op.id);
      return;
    }
    if (chess.turn() !== op.side) setTimeout(() => { ply++; playSound('move'); show(); autoOpponent(); }, 500);
  }

  board.onMove = (from, to, promotion) => {
    let mv;
    try { mv = new Chess(chess.fen()).move({ from, to, promotion }); } catch { show(); return; }
    if (mv.san === sans[ply]) {
      fb.className = 'feedback ok'; fb.textContent = `✅ ${t('common.correct')}`;
      ply++; playSound('move'); show(); autoOpponent();
    } else {
      fb.className = 'feedback bad';
      fb.innerHTML = `❌ ${t('learn.openingWrong')}`;
      setTimeout(() => {
        show();
        const h = new Chess(chess.fen()).move(sans[ply]);
        board.setArrows([{ from: h.from, to: h.to, color: 'green' }]);
      }, 600);
    }
  };

  root.querySelectorAll('.tab').forEach((b) => b.onclick = () => {
    root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    mode = b.dataset.m;
    ply = 0; fb.textContent = ''; fb.className = 'feedback';
    navRow.style.display = mode === 'view' ? '' : 'none';
    show(); autoOpponent();
  });
  const go = (n) => { ply = Math.max(0, Math.min(sans.length, n)); show(); };
  root.querySelector('#first').onclick = () => go(0);
  root.querySelector('#back').onclick = () => go(ply - 1);
  root.querySelector('#fwd').onclick = () => go(ply + 1);
  root.querySelector('#last').onclick = () => go(sans.length);
  root.querySelector('#omoves').onclick = (e) => { const m = e.target.closest('.mv[data-ply]'); if (m && mode === 'view') go(Number(m.dataset.ply) + 1); };
  const key = (e) => {
    if (!document.body.contains(root.querySelector('#oboard'))) { window.removeEventListener('keydown', key); return; }
    if (mode !== 'view') return;
    if (e.key === 'ArrowLeft') go(ply - 1);
    if (e.key === 'ArrowRight') go(ply + 1);
  };
  window.addEventListener('keydown', key);
  show();
}
