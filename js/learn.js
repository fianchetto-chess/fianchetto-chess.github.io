import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { SECTIONS, OPENINGS } from './lessons-data.js';
import { esc, store, moveListHtml, checkSquare, playSound, moveSound } from './ui.js';
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
    <h2>♗ ${t('learn.openings')} <small>(${OPENINGS.length})</small></h2>
    ${['e4w', 'e4b', 'd4w', 'd4b', 'flank'].map((g) => `
      <h3>${t('learn.group.' + g)}</h3>
      <div class="cards">${OPENINGS.filter((o) => o.group === g).map((o) => `
        <a class="card lesson-card ${d['op-' + o.id] ? 'done' : ''}" href="#/learn/opening/${o.id}">
          <div class="card-title">${esc(tx(o.title))}</div>
          <div class="card-sub">${o.eco} · ${t(o.side === 'w' ? 'learn.forWhite' : 'learn.forBlack')} · ${t('learn.varsN', { n: o.vars.length + 1 })}${d['op-' + o.id] ? ` · ${t('learn.learned')} ✓` : ''}</div>
        </a>`).join('')}</div>`).join('')}`;
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
    moveSound(mv);

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
          moveSound(r);
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

// Номер хода для полухода: 4 → «3.», 5 → «3...»
const plyLabel = (ply) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}`;

function openingLines(op) {
  const main = { idx: 0, at: 0, rows: op.line, name: t('learn.mainLine') };
  const vars = op.vars.map((v, i) => ({
    idx: i + 1, at: v.at, rows: op.line.slice(0, v.at).concat(v.line),
    name: `${plyLabel(v.at)}${v.line[0][0]} — ${varName(v)}`,
  }));
  return [main, ...vars];
}
const lineKey = (op, L) => `op-${op.id}-L${L.idx}`;
// название без повтора хода в скобках: «Berlin Defence (3...Nf6)» → «Berlin Defence»
const varName = (v) => tx(v.name).replace(/\s*\([^)]*\)\s*$/, '');

export function renderOpening(root, id) {
  const op = OPENINGS.find((o) => o.id === id);
  if (!op) { root.innerHTML = `<p>${t('common.notFound')}</p>`; return; }
  const lines = openingLines(op);
  root.innerHTML = `
    <a href="#/learn" class="back">← ${t('learn.allLessons')}</a>
    <div class="game-layout">
      <div class="board-col">
        <div id="oboard"></div>
        <div class="btn-row nav-row">
          <button class="btn" id="first">⏮</button><button class="btn" id="back">◀</button>
          <button class="btn" id="fwd">▶</button><button class="btn" id="last">⏭</button>
        </div>
      </div>
      <div class="side-col panel">
        <h2>${esc(tx(op.title))} <small>${op.eco}</small></h2>
        <p>${esc(tx(op.intro))}</p>
        <div class="tabs"><button class="tab active" data-m="view">${t('learn.view')}</button><button class="tab" data-m="train">${t(op.side === 'w' ? 'learn.trainWhite' : 'learn.trainBlack')}</button></div>
        <div class="var-progress"></div>
        <div class="var-chips"></div>
        <div class="comment"></div>
        <div class="alts"></div>
        <div class="moves" id="omoves"></div>
        <div class="feedback"></div>
        <div class="btn-row train-row"></div>
      </div>
    </div>`;
  const board = new Board(root.querySelector('#oboard'), { orientation: op.side });
  const comment = root.querySelector('.comment');
  const altsEl = root.querySelector('.alts');
  const fb = root.querySelector('.feedback');
  const navRow = root.querySelector('.nav-row');
  const chipsEl = root.querySelector('.var-chips');
  const progEl = root.querySelector('.var-progress');
  const trainRow = root.querySelector('.train-row');
  let mode = 'view';
  let sel = 0;        // выбранный вариант
  let ply = 0;
  let chess = new Chess();
  let token = 0;

  const learned = () => lines.filter((L) => done()[lineKey(op, L)]).length;
  const cur = () => lines[sel];
  const sansOf = (L) => L.rows.map((r) => r[0]);

  function positionAt(L, n) {
    const c = new Chess();
    for (let i = 0; i < n; i++) c.move(L.rows[i][0]);
    return c;
  }

  // Какие ещё ответы возможны в этой позиции (другие варианты с тем же началом)
  function alternatives(L, n) {
    return lines.filter((M) => M !== L && M.rows.length > n
      && M.rows.slice(0, n).every((r, i) => r[0] === L.rows[i][0])
      && (L.rows.length <= n || M.rows[n][0] !== L.rows[n][0]))
      .filter((M, i, arr) => arr.findIndex((x) => x.rows[n][0] === M.rows[n][0]) === i);
  }

  function renderChips() {
    const d = done();
    progEl.innerHTML = `${t('learn.varsLearned', { k: learned(), n: lines.length })}`;
    chipsEl.innerHTML = mode === 'view' ? lines.map((L) => `
      <button class="chip ${L.idx === sel ? 'active' : ''}" data-i="${L.idx}">${d[lineKey(op, L)] ? '✓ ' : ''}${esc(L.name)}</button>`).join('') : '';
  }

  function show(animate = true) {
    const L = cur();
    chess = positionAt(L, ply);
    const hist = chess.history({ verbose: true });
    const lm = hist.length ? [hist.at(-1).from, hist.at(-1).to] : null;
    const movable = mode === 'train' && ply < L.rows.length && chess.turn() === op.side ? op.side : null;
    board.fromChess(chess, { movable, lastMove: lm, animate });
    board.setArrows([]);
    const sans = sansOf(L);
    root.querySelector('#omoves').innerHTML = moveListHtml(sans.slice(0, mode === 'train' ? ply : sans.length), ply - 1);
    if (ply === 0) comment.innerHTML = t('learn.startPos');
    else {
      const row = L.rows[ply - 1];
      const branch = L.idx && ply - 1 === L.at ? ` <span class="var-tag">${t('learn.branchHere')}</span>` : '';
      comment.innerHTML = `<b>${plyLabel(ply - 1)} ${esc(row[0])}</b> — ${esc(openingComment(row))}${branch}`;
    }
    // подсказка о развилке: соперник может ответить иначе
    altsEl.innerHTML = '';
    if (mode === 'view') {
      const alts = alternatives(L, ply);
      if (alts.length) {
        altsEl.innerHTML = `<div class="alts-title">${t(chess.turn() === op.side ? 'learn.altsMine' : 'learn.altsOpp')}</div>` +
          alts.map((M) => `<button class="chip small" data-i="${M.idx}">${plyLabel(ply)}${esc(M.rows[ply][0])} — ${esc(M.idx ? varName(op.vars[M.idx - 1]) : t('learn.mainLine'))}</button>`).join('');
      }
    }
  }

  // ---------- тренировка: соперник сам выбирает вариант ----------
  function pickTrainLine() {
    const d = done();
    const left = lines.filter((L) => !d[lineKey(op, L)]);
    const pool = left.length ? left : lines;
    return pool[Math.floor(Math.random() * pool.length)].idx;
  }

  function startTraining() {
    token++;
    sel = pickTrainLine();
    ply = 0;
    fb.className = 'feedback'; fb.textContent = t('learn.oppChooses');
    trainRow.innerHTML = '';
    renderChips();
    show(false);
    autoOpponent();
  }

  function finishLine() {
    const L = cur();
    const d = done(); d[lineKey(op, L)] = true; store.set('done', d);
    const k = learned();
    if (k >= lines.length) markDone('op-' + op.id);
    playSound('end');
    fb.className = 'feedback ok';
    fb.innerHTML = `🎉 ${t('learn.lineDone', { name: esc(L.name) })}<br>${k >= lines.length ? t('learn.allVarsDone') : t('learn.varsLearned', { k, n: lines.length })}`;
    trainRow.innerHTML = `<button class="btn primary" id="nextVar">${t(k >= lines.length ? 'learn.trainAgain' : 'learn.nextVar')} →</button>`;
    trainRow.querySelector('#nextVar').onclick = startTraining;
    renderChips();
  }

  function autoOpponent() {
    if (mode !== 'train') return;
    const L = cur();
    if (ply >= L.rows.length) { finishLine(); return; }
    if (chess.turn() !== op.side) {
      const my = token;
      setTimeout(() => {
        if (my !== token || mode !== 'train') return;
        const mv = new Chess(chess.fen()).move(L.rows[ply][0]);
        ply++;
        moveSound(mv);
        show();
        if (L.idx && ply - 1 === L.at) { fb.className = 'feedback'; fb.innerHTML = `↪ ${t('learn.oppDeviates', { m: `${plyLabel(ply - 1)}${esc(mv.san)}`, name: esc(varName(op.vars[L.idx - 1])) })}`; }
        autoOpponent();
      }, 550);
    }
  }

  board.onMove = (from, to, promotion) => {
    const L = cur();
    let mv;
    try { mv = new Chess(chess.fen()).move({ from, to, promotion }); } catch { show(false); return; }
    if (mv.san === L.rows[ply][0]) {
      fb.className = 'feedback ok'; fb.textContent = `✅ ${t('common.correct')}`;
      ply++; moveSound(mv); show(false); autoOpponent();
    } else {
      playSound('wrong');
      fb.className = 'feedback bad';
      fb.innerHTML = `❌ ${t('learn.openingWrong')}`;
      setTimeout(() => {
        show(false);
        const h = new Chess(chess.fen()).move(L.rows[ply][0]);
        board.setArrows([{ from: h.from, to: h.to, color: 'green' }]);
      }, 600);
    }
  };

  function setMode(m) {
    mode = m;
    root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.m === m));
    navRow.style.display = mode === 'view' ? '' : 'none';
    fb.textContent = ''; fb.className = 'feedback';
    trainRow.innerHTML = '';
    if (mode === 'train') { startTraining(); return; }
    token++;
    ply = 0;
    renderChips();
    show(false);
  }

  root.querySelectorAll('.tab').forEach((b) => b.onclick = () => setMode(b.dataset.m));
  const pick = (e) => {
    const c = e.target.closest('.chip[data-i]');
    if (!c) return;
    const prev = cur();
    const next = lines[Number(c.dataset.i)];
    sel = next.idx;
    // если текущая позиция есть и в новом варианте — остаёмся, иначе переходим к развилке
    const same = next.rows.length >= ply && next.rows.slice(0, ply).every((r, i) => prev.rows[i] && r[0] === prev.rows[i][0]);
    ply = same ? ply : next.at;
    renderChips();
    show(false);
  };
  chipsEl.onclick = pick;
  altsEl.onclick = (e) => {
    const c = e.target.closest('.chip[data-i]');
    if (!c) return;
    sel = Number(c.dataset.i);
    renderChips();
    ply++;
    const mv = positionAt(cur(), ply).history({ verbose: true }).at(-1);
    moveSound(mv);
    show(true);
  };
  const go = (n) => {
    const target = Math.max(0, Math.min(cur().rows.length, n));
    if (target === ply + 1) moveSound(positionAt(cur(), target).history({ verbose: true }).at(-1));
    ply = target;
    show(true);
  };
  root.querySelector('#first').onclick = () => go(0);
  root.querySelector('#back').onclick = () => go(ply - 1);
  root.querySelector('#fwd').onclick = () => go(ply + 1);
  root.querySelector('#last').onclick = () => go(cur().rows.length);
  root.querySelector('#omoves').onclick = (e) => { const m = e.target.closest('.mv[data-ply]'); if (m && mode === 'view') go(Number(m.dataset.ply) + 1); };
  const key = (e) => {
    if (!document.body.contains(root.querySelector('#oboard'))) { window.removeEventListener('keydown', key); return; }
    if (mode !== 'view') return;
    if (e.key === 'ArrowLeft') go(ply - 1);
    if (e.key === 'ArrowRight') go(ply + 1);
  };
  window.addEventListener('keydown', key);
  root._cleanup = () => { token++; };
  renderChips();
  show(false);
}
