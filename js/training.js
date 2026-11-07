import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { getEngine } from './engine.js';
import { ENDGAMES } from './train-gen.js';
import { store, moveListHtml, playSound, moveSound, toast } from './ui.js';
import { t, tx } from './i18n.js';

// ---------- данные задач (сгенерированы заранее и отсортированы от простых к сложным) ----------
let dataPromise = null;
function loadData() {
  if (!dataPromise) dataPromise = fetch(new URL('../data/puzzles.json', import.meta.url)).then((r) => r.json());
  return dataPromise;
}

// ---------- генерация вопросов в отдельном потоке ----------
let worker = null;
let seq = 0;
const waiting = new Map();
function gen(kind, arg) {
  if (!worker) {
    worker = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, kind, arg });
  });
}

// ---------- прогресс ----------
const getProg = (k) => store.get('prog', {})[k] || 0;
function setProg(k, v) { const all = store.get('prog', {}); all[k] = v; store.set('prog', all); }
const stats = (k) => store.get('train2', {})[k] || { solved: 0, streak: 0, best: 0 };
function saveStats(k, s) { const all = store.get('train2', {}); all[k] = s; store.set('train2', all); }
function result(k, ok) {
  const s = stats(k);
  if (ok) { s.solved++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
  saveStats(k, s);
}

const QUIZ_LEVELS = 15; // уровни у викторин «на проходе» и «рокировка»

const THEORY = {
  kq: { en: 'Put the queen a <b>knight\'s move</b> away from the enemy king and shrink its "box". Once the king is pushed to the edge, bring your own king and mate. <b>Beware of stalemate:</b> always leave the enemy king at least one square until your king arrives.',
    ru: 'Ферзь становится <b>ходом коня</b> от чёрного короля и сжимает «коробку», в которой тот заперт. Когда король прижат к краю, подведите свой король и поставьте мат. <b>Осторожно с патом:</b> всегда оставляйте королю соперника хотя бы одно поле, пока ваш король не подошёл.' },
  kr: { en: 'The rook cuts the king off along a line; your king stands opposite the enemy king (<b>opposition</b>) — then a rook check from the side drives it back one more line. Without opposition, make a <b>waiting move</b> with the rook along the line. Repeat until the edge.',
    ru: 'Ладья отрезает короля по линии, свой король встаёт напротив короля соперника (<b>оппозиция</b>) — тогда шах ладьёй сбоку оттесняет его на линию дальше. Если оппозиции нет — сделайте <b>выжидательный ход</b> ладьёй вдоль линии. Повторяйте до края доски.' },
  krr: { en: '<b>The "ladder"</b>: the rooks take turns giving checks on neighbouring lines and push the king to the edge. You don\'t even need your king! If the enemy king approaches a rook, swing it to the far side of the board.',
    ru: '<b>«Лесенка»</b>: ладьи по очереди дают шахи на соседних линиях и оттесняют короля к краю. Король вам не нужен! Если чёрный король подходит к ладье — уведите её на другой край доски.' },
  kbb: { en: 'Bishops standing side by side form a "wall" of two diagonals. Together with your king, drive the enemy king into <b>any</b> corner and mate. Watch out for stalemate.',
    ru: 'Слоны, стоящие рядом, создают «стену» из двух диагоналей. Вместе с королём оттесните короля соперника в <b>любой</b> угол и поставьте мат. Берегитесь пата.' },
  kbn: { en: 'The hardest basic mate — up to 33 moves. Mate is only possible in a corner of <b>your bishop\'s colour</b>. First push the king to the edge, then herd it to the right corner with the knight\'s "W-manoeuvre". The engine hint is always there.',
    ru: 'Самый сложный базовый мат — до 33 ходов. Мат возможен только в углу <b>цвета вашего слона</b>. Сначала прижмите короля к краю, затем перегоняйте его в нужный угол с помощью «W-манёвра» коня. Подсказка движка всегда рядом.' },
  kpk: { en: 'Your king must walk <b>in front of</b> the pawn and occupy the key squares. Use the <b>opposition</b>: kings facing each other with one square between, with the opponent to move. Promote the pawn and deliver mate.',
    ru: 'Король должен идти <b>впереди</b> пешки и занимать ключевые поля. Используйте <b>оппозицию</b>: короли друг напротив друга через одну клетку, и ходит соперник. Проведите пешку в ферзи и поставьте мат.' },
};

const PUZZLE_TRACKS = [
  { id: 'mate1', icon: '#', title: 'tr.mate1', sub: 'tr.mate1Sub' },
  { id: 'mate2', icon: '#²', title: 'tr.mate2', sub: 'tr.mate2Sub' },
  { id: 'mate3', icon: '#³', title: 'tr.mate3', sub: 'tr.mate3Sub' },
  { id: 'tactic', icon: '⚔', title: 'tr.tactic', sub: 'tr.tacticSub' },
  { id: 'promo', icon: '♛', title: 'tr.promo', sub: 'tr.promoSub' },
];

function progressHtml(i, n, done = i) {
  const pct = n ? Math.round((Math.min(done, n) / n) * 100) : 0;
  return `<div class="lvl-bar"><div style="width:${pct}%"></div></div><div class="lvl-text">${t('tr.levelOf', { i: Math.min(i + 1, n), n })}</div>`;
}

export async function renderTraining(root) {
  root.innerHTML = `<h1>${t('nav.train')}</h1><p class="lead">${t('tr.lead')}</p><p>${t('common.loading')}</p>`;
  let data;
  try { data = await loadData(); } catch { root.innerHTML += `<p class="bad">${t('err.http', { code: 'data' })}</p>`; return; }
  const card = (href, title, sub, key, total) => {
    const i = getProg(key);
    return `<a class="card train-card" href="${href}"><div class="card-title">${title}</div><div class="card-sub">${sub}</div>
      ${total ? progressHtml(i, total) : ''}${i >= total && total ? `<div class="card-stat">✓ ${t('tr.trackDone')}</div>` : ''}</a>`;
  };
  root.innerHTML = `
    <h1>${t('nav.train')}</h1>
    <p class="lead">${t('tr.lead')}</p>
    <h2>⚔ ${t('tr.tactics')}</h2>
    <div class="cards">${PUZZLE_TRACKS.map((tr) => card(`#/train/p/${tr.id}`, `${tr.icon} ${t(tr.title)}`, t(tr.sub), tr.id, data[tr.id].length)).join('')}</div>
    <h2>♔ ${t('tr.mates')}</h2>
    <p class="muted">${t('tr.matesNote')}</p>
    <div class="cards">${Object.entries(ENDGAMES).map(([k, e]) => card(`#/train/end/${k}`, `${e.icon} ${t('end.title.' + k)}`, t('end.sub.' + k), 'end-' + k, (data.end[k] || []).length)).join('')}</div>
    <h2>♙ ${t('tr.special')}</h2>
    <div class="cards">
      ${card('#/train/ep', `⇗ ${t('tr.ep')}`, t('tr.epSub'), 'ep', QUIZ_LEVELS)}
      ${card('#/train/castle', `♜ ${t('tr.castle')}`, t('tr.castleSub'), 'castle', QUIZ_LEVELS)}
    </div>`;
}

function shell(root, title, extra = '') {
  root.innerHTML = `
    <a href="#/train" class="back">← ${t('tr.all')}</a>
    <div class="game-layout">
      <div class="board-col"><div id="tboard"></div></div>
      <div class="side-col panel">
        <h2>${title}</h2>
        <div class="lvl"></div>
        ${extra}
        <div class="task"></div>
        <div class="feedback"></div>
        <div class="answers btn-row"></div>
        <div class="btn-row controls"></div>
        <div class="train-stats muted"></div>
      </div>
    </div>`;
  return new Board(root.querySelector('#tboard'));
}

const fb = (root, html, cls = '') => { const el = root.querySelector('.feedback'); el.className = `feedback ${cls}`; el.innerHTML = html; };
const alive = (board) => document.body.contains(board.el);
const uciMv = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setLevel(root, key, i, n) {
  root.querySelector('.lvl').innerHTML = progressHtml(i, n, getProg(key));
  const s = stats(key);
  root.querySelector('.train-stats').innerHTML = t('tr.statsLine', { solved: s.solved, streak: s.streak, best: s.best });
}

// ---------- Задачи: мат в 1/2/3, найди выигрывающий ход, превращение ----------
export async function renderPuzzleTrack(root, track) {
  const tr = PUZZLE_TRACKS.find((x) => x.id === track);
  if (!tr) { location.hash = '#/train'; return; }
  const board = shell(root, `${tr.icon} ${t(tr.title)}`);
  const data = await loadData();
  const list = data[track];
  const engine = getEngine();
  root.querySelector('.controls').innerHTML = `
    <button class="btn" id="hint">💡 ${t('common.hint')}</button>
    <button class="btn" id="show">${t('tr.showSolution')}</button>
    <button class="btn" id="retry">↻ ${t('tr.retry')}</button>
    <button class="btn primary" id="next">${t('common.next')} →</button>`;
  const btn = (id) => root.querySelector('#' + id);
  let i = Math.min(getProg(track), list.length - 1);
  let pz, chess, color, need, failed, solved, busy, hintStep, token = 0;

  function load(idx) {
    i = Math.max(0, Math.min(idx, list.length - 1));
    pz = list[i];
    chess = new Chess(pz.f);
    color = chess.turn();
    need = pz.n || 1;       // сколько ходов осталось до мата
    failed = false; solved = false; busy = false; hintStep = 0; token++;
    board.setArrows([]);
    board.setOrientation(color);
    board.fromChess(chess, { movable: color, lastMove: null, animate: false });
    setLevel(root, track, i, list.length);
    const side = t(color === 'w' ? 'tr.whiteToMove' : 'tr.blackToMove');
    const task = track === 'tactic' ? t('tr.tacticTask') : track === 'promo' ? t('tr.promoTask2') : t('tr.mateTask', { n: pz.n });
    root.querySelector('.task').innerHTML = `${side} <b>${task}</b>`;
    fb(root, '');
    btn('next').disabled = true;
  }

  function win() {
    solved = true;
    board.setMovable(null);
    if (!failed) result(track, true);
    if (!failed || i + 1 > getProg(track)) setProg(track, Math.max(getProg(track), i + 1));
    playSound('end');
    fb(root, `✅ ${failed ? t('tr.solvedAfterTry') : t('tr.solvedOk')}${i + 1 >= list.length ? ` ${t('tr.trackDone')}` : ''}`, 'ok');
    btn('next').disabled = i + 1 >= list.length;
    setLevel(root, track, i, list.length);
  }

  function lose(msg) {
    if (!failed) result(track, false);
    failed = true;
    playSound('wrong');
    fb(root, `❌ ${msg}`, 'bad');
  }

  async function opponentReply(fen) {
    const r = await engine.analyse(fen, { depth: 12 });
    return r.bestmove;
  }

  board.onMove = async (from, to, promotion) => {
    if (busy || solved) return;
    const my = token;
    const before = chess.fen();
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { board.fromChess(chess, { movable: color }); return; }
    moveSound(mv);
    board.setArrows([]);
    busy = true;
    board.fromChess(chess, { movable: null, lastMove: [from, to], animate: false });
    let ok = false;
    if (chess.isCheckmate()) { ok = true; }
    else if (track === 'tactic') {
      if (mv.lan === pz.s) ok = true;
      else {
        // другой ход тоже засчитывается, если он выигрывает не хуже
        const r = await engine.analyse(chess.fen(), { depth: 12 });
        const l = r.lines[0];
        const ev = l ? (l.score.mate !== undefined ? (l.score.mate < 0 ? 99999 : -99999) : -l.score.cp) : -9999;
        ok = ev >= Math.max(200, (pz.e || 300) - 120);
      }
      if (my !== token) return;
      if (ok) {
        // показываем идею: ещё пару ходов основного варианта
        board.setMovable(null);
        if (mv.lan === pz.s) {
          for (const u of (pz.p || []).slice(1, 4)) {
            await sleep(650);
            if (my !== token || !alive(board)) return;
            let r;
            try { r = chess.move(uciMv(u)); } catch { break; }
            moveSound(r);
            board.fromChess(chess, { movable: null });
          }
        }
        busy = false;
        win();
        return;
      }
    } else if (!chess.isGameOver() && need > 1) {
      // мат в N: после хода должен оставаться мат не дольше, чем нужно
      const r = await engine.analyse(chess.fen(), { depth: Math.min(20, 6 + need * 4) });
      if (my !== token) return;
      const l = r.lines[0];
      if (l && l.score.mate !== undefined && l.score.mate < 0 && -l.score.mate <= need - 1) {
        need = -l.score.mate;
        await sleep(350);
        if (my !== token || !alive(board)) return;
        const rep = chess.move(uciMv(r.bestmove));
        moveSound(rep);
        busy = false;
        board.fromChess(chess, { movable: color });
        fb(root, `👍 ${t('tr.goodContinue', { n: need })}`, 'ok');
        return;
      }
    }
    if (my !== token) return;
    if (ok) { busy = false; win(); return; }
    lose(chess.isStalemate() ? t('tr.stalemate') : t('tr.notBest'));
    await sleep(900);
    if (my !== token || !alive(board)) return;
    chess.load(before);
    busy = false;
    board.fromChess(chess, { movable: color, lastMove: null });
  };

  btn('hint').onclick = () => {
    if (solved || busy) return;
    hintStep++;
    if (!failed) { result(track, false); failed = true; }
    const go = async () => {
      let u = pz.s;
      if (chess.fen() !== pz.f) { const r = await engine.analyse(chess.fen(), { depth: 14 }); u = r.bestmove; }
      if (hintStep === 1) board.setHints([{ sq: u.slice(0, 2), cls: 'hint-from' }]);
      else board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'green' }]);
    };
    go();
  };
  btn('show').onclick = async () => {
    if (solved || busy) return;
    if (!failed) { result(track, false); failed = true; }
    busy = true;
    const my = token;
    // проигрываем решение на доске
    let line = pz.p && pz.p.length ? pz.p : [pz.s];
    chess.load(pz.f);
    board.fromChess(chess, { movable: null, lastMove: null, animate: false });
    if (track !== 'tactic' && pz.n) line = line.slice(0, pz.n * 2 - 1);
    for (const u of line.slice(0, 7)) {
      await sleep(600);
      if (my !== token || !alive(board)) return;
      let r;
      try { r = chess.move(uciMv(u)); } catch { break; }
      moveSound(r);
      board.fromChess(chess, { movable: null });
    }
    busy = false;
    fb(root, t('tr.solutionShown'));
    setProg(track, Math.max(getProg(track), i + 1));
    btn('next').disabled = i + 1 >= list.length;
  };
  btn('retry').onclick = () => load(i);
  btn('next').onclick = () => load(i + 1);
  root.querySelector('.lvl').onclick = (e) => {
    if (!e.target.closest('.lvl-bar')) return;
    const r = e.target.closest('.lvl-bar').getBoundingClientRect();
    const target = Math.floor(((e.clientX - r.left) / r.width) * list.length);
    if (target <= getProg(track)) load(target); // можно вернуться к пройденным уровням
  };
  root._cleanup = () => { token++; engine.stop(); };
  load(i);
}

// ---------- Взятие на проходе: «можно или нельзя?» (уровни) ----------
export function renderEnPassant(root) {
  const key = 'ep';
  const board = shell(root, `⇗ ${t('tr.ep')}`);
  root.querySelector('.controls').innerHTML = `<button class="btn primary" id="nexte">${t('tr.nextPos')} →</button>`;
  let task, chess, stage, level;

  async function next() {
    level = Math.min(getProg(key), QUIZ_LEVELS - 1);
    setLevel(root, key, level, QUIZ_LEVELS);
    task = await gen('genEnPassant', level);
    if (!alive(board)) return;
    chess = new Chess(task.fen);
    stage = 'ask';
    board.setOrientation(task.color);
    board.fromChess(chess, { movable: null, lastMove: task.lastMove, animate: false });
    board.setArrows([{ from: task.lastMove[0], to: task.lastMove[1], color: 'blue' }]);
    root.querySelector('.task').innerHTML = `${t(task.color === 'w' ? 'tr.whiteToMove' : 'tr.blackToMove')} ${t('tr.epLast')}<br><b>${t('tr.epQ')}</b>`;
    root.querySelector('.answers').innerHTML = `<button class="btn" data-a="1">${t('tr.yes')}</button><button class="btn" data-a="0">${t('tr.no')}</button>`;
    fb(root, '');
  }
  function done(ok) {
    result(key, ok);
    if (ok) setProg(key, Math.min(QUIZ_LEVELS, getProg(key) + 1));
    setLevel(root, key, Math.min(getProg(key), QUIZ_LEVELS - 1), QUIZ_LEVELS);
    playSound(ok ? 'end' : 'wrong');
  }

  root.querySelector('.answers').onclick = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b || stage !== 'ask') return;
    const said = b.dataset.a === '1';
    root.querySelector('.answers').innerHTML = '';
    if (said !== task.can) {
      done(false);
      fb(root, `❌ ${t('tr.ep.' + task.reason)}`, 'bad');
      if (task.can) board.setArrows([{ from: task.answer.slice(0, 2), to: task.answer.slice(2, 4), color: 'green' }]);
      stage = 'done';
      return;
    }
    if (!task.can) { done(true); fb(root, `✅ ${t('common.correct')} ${t('tr.ep.' + task.reason)}`, 'ok'); stage = 'done'; return; }
    stage = 'move';
    fb(root, `👍 ${t('tr.epNowCapture')}`, 'ok');
    board.fromChess(chess, { movable: task.color, lastMove: task.lastMove, animate: false });
  };

  board.onMove = (from, to, promotion) => {
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { return; }
    moveSound(mv);
    board.fromChess(chess, { movable: null, lastMove: [from, to] });
    board.setArrows([]);
    if (mv.flags.includes('e')) {
      done(true);
      fb(root, `✅ ${t('tr.epDone', { m: mv.san })}`, 'ok');
      stage = 'done';
    } else {
      fb(root, `❌ ${t('tr.epOther')}`, 'bad');
      setTimeout(() => { if (!alive(board)) return; chess.undo(); board.fromChess(chess, { movable: task.color, lastMove: task.lastMove }); }, 900);
    }
  };
  root.querySelector('#nexte').onclick = next;
  next();
}

// ---------- Рокировка (уровни) ----------
export function renderCastling(root) {
  const key = 'castle';
  const board = shell(root, `♜ ${t('tr.castle')}`, `<p class="muted">${t('tr.castleRules')}</p>`);
  root.querySelector('.controls').innerHTML = `<button class="btn primary" id="nextc">${t('tr.nextPos')} →</button>`;
  let task, stage;

  async function next() {
    const level = Math.min(getProg(key), QUIZ_LEVELS - 1);
    setLevel(root, key, level, QUIZ_LEVELS);
    task = await gen('genCastling', level);
    if (!alive(board)) return;
    stage = 'ask';
    const chess = new Chess(task.fen);
    board.setOrientation('w');
    board.setArrows([]);
    board.setHints([]);
    board.fromChess(chess, { movable: null, lastMove: null, animate: false });
    root.querySelector('.task').innerHTML = `${t('tr.whiteToMove')}${task.notes.length ? `<br><i>${t('tr.known')}: ${task.notes.map((n) => t('tr.note.' + n)).join(' ')}</i>` : ''}<br><b>${t('tr.castleQ')}</b>`;
    root.querySelector('.answers').innerHTML = ['short', 'long', 'both', 'none']
      .map((v) => `<button class="btn" data-a="${v}">${t('tr.c.' + v)}</button>`).join('');
    fb(root, '');
  }

  root.querySelector('.answers').onclick = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b || stage !== 'ask') return;
    stage = 'done';
    const ok = b.dataset.a === task.answer;
    result(key, ok);
    if (ok) setProg(key, Math.min(QUIZ_LEVELS, getProg(key) + 1));
    setLevel(root, key, Math.min(getProg(key), QUIZ_LEVELS - 1), QUIZ_LEVELS);
    playSound(ok ? 'end' : 'wrong');
    root.querySelectorAll('.answers button').forEach((x) => {
      x.disabled = true;
      if (x.dataset.a === task.answer) x.classList.add('primary');
    });
    const c = new Chess(task.fen);
    board.setHints(['b1', 'c1', 'd1', 'e1', 'f1', 'g1'].filter((sq) => c.isAttacked(sq, 'b')).map((sq) => ({ sq, cls: 'hint-attacked' })));
    const ex = task.explain;
    const side = (k) => `${t('tr.c.' + k + 'Name')}: ${ex[k] ? t('tr.no.' + ex[k].code, { sq: ex[k].squares || '' }) : t('tr.allowed')}.`;
    fb(root, `${ok ? `✅ ${t('common.correct')}` : `❌ ${t('tr.wrong')}`} ${side('short')} ${side('long')}${ex.b1tip ? ` ${t('tr.b1tip')}` : ''}`, ok ? 'ok' : 'bad');
  };
  root.querySelector('#nextc').onclick = next;
  next();
}

// ---------- Техника мата против движка (уровни: от короткого мата к длинному) ----------
export async function renderEndgame(root, type) {
  const cfg = ENDGAMES[type];
  if (!cfg) { location.hash = '#/train'; return; }
  const key = 'end-' + type;
  const board = shell(root, `${cfg.icon} ${t('end.title.' + type)}`, `<details class="theory" ${getProg(key) < 2 ? 'open' : ''}><summary>${t('tr.howToMate')}</summary><p>${tx(THEORY[type])}</p></details>`);
  root.querySelector('.controls').innerHTML = `
    <button class="btn" id="hintE">💡 ${t('common.hint')}</button>
    <button class="btn" id="undoE">↶ ${t('common.takeback')}</button>
    <button class="btn" id="resetE">↻ ${t('common.retry')}</button>
    <button class="btn primary" id="nextE">${t('common.next')} →</button>`;
  root.querySelector('.task').innerHTML = '<div class="par"></div><div class="moves" id="emoves"></div>';
  const list = (await loadData()).end[type];
  const engine = getEngine();
  let i, startFen, chess, over, busy, token = 0, par = null, hinted = false;

  function redraw(lastMove, animate = true) {
    board.fromChess(chess, { movable: !over && !busy && chess.turn() === 'w' ? 'w' : null, lastMove, animate });
    const sans = chess.history();
    const box = root.querySelector('#emoves');
    box.innerHTML = moveListHtml(sans, sans.length - 1);
    box.scrollTop = box.scrollHeight;
  }

  function load(idx) {
    token++;
    i = Math.max(0, Math.min(idx, list.length - 1));
    startFen = list[i].f;
    par = list[i].n;
    chess = new Chess(startFen);
    over = false; busy = false; hinted = false;
    board.setArrows([]);
    board.setOrientation('w');
    redraw(null, false);
    setLevel(root, key, i, list.length);
    fb(root, t('tr.yourMoveWhite'));
    root.querySelector('.par').innerHTML = `🎯 ${par ? t('tr.par', { n: par }) : type === 'kbn' ? t('tr.parKbn') : t('tr.parWin')}`;
    root.querySelector('#nextE').disabled = i >= getProg(key);
  }

  function finish(ok, text) {
    over = true;
    if (ok) {
      if (!hinted) result(key, true);
      setProg(key, Math.max(getProg(key), i + 1));
      root.querySelector('#nextE').disabled = i + 1 >= list.length;
      setLevel(root, key, i, list.length);
    } else result(key, false);
    playSound(ok ? 'end' : 'wrong');
    fb(root, text, ok ? 'ok' : 'bad');
    redraw(undefined, false);
  }

  function checkOver() {
    const myMoves = Math.ceil(chess.history().length / 2);
    if (chess.isCheckmate()) {
      const verdict = par && myMoves <= par ? t('tr.perfect') : par ? t('tr.engineWould', { n: par }) : '';
      finish(true, `✅ ${t('tr.matedIn', { n: myMoves })} ${verdict}${hinted ? ` ${t('tr.hintNoStreak')}` : ''}`);
      return true;
    }
    if (chess.isStalemate()) { finish(false, `❌ ${t('tr.failStalemate')}`); return true; }
    if (chess.isInsufficientMaterial()) { finish(false, `❌ ${t('tr.failPiece')}`); return true; }
    if (chess.isThreefoldRepetition()) { finish(false, `❌ ${t('tr.failRep')}`); return true; }
    if (myMoves >= 50) { finish(false, `❌ ${t('tr.fail50')}`); return true; }
    return false;
  }

  board.onMove = async (from, to, promotion) => {
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { redraw(); return; }
    moveSound(mv);
    board.setArrows([]);
    if (checkOver()) return;
    busy = true;
    redraw([from, to], false);
    fb(root, t('tr.engineThinking'));
    const my = token;
    const started = Date.now();
    const res = await engine.analyse(chess.fen(), { depth: 12 });
    const wait = 350 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (my !== token || !alive(board)) return;
    busy = false;
    if (res.bestmove) {
      const r = chess.move(uciMv(res.bestmove));
      moveSound(r);
      if (checkOver()) return;
      redraw([r.from, r.to]);
    }
    fb(root, t('common.yourMove'));
  };

  root.querySelector('#hintE').onclick = async () => {
    if (over || busy || chess.turn() !== 'w') return;
    hinted = true;
    fb(root, t('tr.searching'));
    const my = token;
    const res = await engine.analyse(chess.fen(), { depth: 16 });
    if (my !== token || !alive(board) || !res.bestmove) return;
    board.setArrows([{ from: res.bestmove.slice(0, 2), to: res.bestmove.slice(2, 4), color: 'green' }]);
    const m = res.lines[0] && res.lines[0].score.mate;
    fb(root, `💡 ${t('tr.hintShown')}${m && m > 0 ? ` — ${t('ev.youMate', { n: m })}` : ''}`);
  };
  root.querySelector('#undoE').onclick = () => {
    if (busy || chess.history().length < 2) return;
    token++;
    chess.undo(); if (chess.turn() !== 'w') chess.undo();
    over = false;
    board.setArrows([]);
    redraw();
    fb(root, t('common.yourMove'));
  };
  root.querySelector('#resetE').onclick = () => load(i);
  root.querySelector('#nextE').onclick = () => load(i + 1);
  root._cleanup = () => { token++; engine.stop(); };
  load(Math.min(getProg(key), list.length - 1));
}
