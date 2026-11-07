import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { getEngine } from './engine.js';
import { ENDGAMES } from './train-gen.js';
import { esc, store, moveListHtml, playSound, toast } from './ui.js';
import { t, tx } from './i18n.js';

// ---------- генерация задач в отдельном потоке ----------
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

const stats = (key) => store.get('train', {})[key] || { solved: 0, streak: 0, best: 0 };
function saveStats(key, s) { const all = store.get('train', {}); all[key] = s; store.set('train', all); }

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

export function renderTraining(root) {
  const s = (k) => stats(k);
  const card = (href, title, sub, key) => `
    <a class="card" href="${href}"><div class="card-title">${title}</div><div class="card-sub">${sub}</div>
    ${key && s(key).solved ? `<div class="card-stat">${t('tr.solved', { n: s(key).solved })}${s(key).best ? ` · ${t('tr.bestStreak', { n: s(key).best })}` : ''}</div>` : ''}</a>`;
  root.innerHTML = `
    <h1>${t('nav.train')}</h1>
    <p class="lead">${t('tr.lead')}</p>
    <h2>♔ ${t('tr.mates')}</h2>
    <p class="muted">${t('tr.matesNote')}</p>
    <div class="cards">${Object.entries(ENDGAMES).map(([k, e]) => card(`#/train/end/${k}`, `${e.icon} ${t('end.title.' + k)}`, t('end.sub.' + k), 'end-' + k)).join('')}</div>
    <h2>♙ ${t('tr.special')}</h2>
    <div class="cards">
      ${card('#/train/ep', `⇗ ${t('tr.ep')}`, t('tr.epSub'), 'ep')}
      ${card('#/train/castle', `♜ ${t('tr.castle')}`, t('tr.castleSub'), 'castle')}
      ${card('#/train/promo', `♛ ${t('tr.promo')}`, t('tr.promoSub'), 'promo')}
    </div>
    <h2>⚔ ${t('tr.tactics')}</h2>
    <div class="cards">${card('#/train/mate1', `# ${t('tr.mate1')}`, t('tr.mate1Sub'), 'mate1')}</div>`;
}

function shell(root, title, extra = '') {
  root.innerHTML = `
    <a href="#/train" class="back">← ${t('tr.all')}</a>
    <div class="game-layout">
      <div class="board-col"><div id="tboard"></div></div>
      <div class="side-col panel">
        <h2>${title}</h2>
        ${extra}
        <div class="train-stats"></div>
        <div class="task"></div>
        <div class="feedback"></div>
        <div class="answers btn-row"></div>
        <div class="btn-row controls"></div>
      </div>
    </div>`;
  return new Board(root.querySelector('#tboard'));
}

function setStats(root, key) {
  const s = stats(key);
  root.querySelector('.train-stats').innerHTML = t('tr.statsLine', { solved: s.solved, streak: s.streak, best: s.best });
}

function result(root, key, ok) {
  const s = stats(key);
  if (ok) { s.solved++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
  saveStats(key, s);
  setStats(root, key);
}

const fb = (root, html, cls = '') => { const el = root.querySelector('.feedback'); el.className = `feedback ${cls}`; el.innerHTML = html; };
const alive = (board) => document.body.contains(board.el);

// ---------- Мат в 1 и мат превращением ----------
export function renderPuzzle(root, kind) {
  const key = kind === 'promo' ? 'promo' : 'mate1';
  const board = shell(root, kind === 'promo' ? `♛ ${t('tr.promo')}` : `# ${t('tr.mate1')}`);
  let task = null;
  let chess = null;
  let answered = false;
  root.querySelector('.controls').innerHTML = `<button class="btn" id="show">${t('tr.showSolution')}</button><button class="btn primary" id="nextp">${t('common.next')} →</button>`;
  setStats(root, key);

  async function next() {
    fb(root, t('tr.generating'));
    board.setArrows([]); board.setMovable(null);
    try { task = await gen(kind === 'promo' ? 'genPromotionMate' : 'genMateIn1'); } catch (e) { fb(root, e.message, 'bad'); return; }
    if (!alive(board)) return;
    chess = new Chess(task.fen);
    answered = false;
    board.setOrientation('w');
    board.fromChess(chess, { movable: 'w', lastMove: null });
    root.querySelector('.task').innerHTML = kind === 'promo'
      ? t('tr.promoTask')
      : t('tr.mate1Task');
    fb(root, '');
  }

  board.onMove = (from, to, promotion) => {
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { board.fromChess(chess, { movable: 'w' }); return; }
    playSound(mv.captured ? 'capture' : 'move');
    board.fromChess(chess, { movable: null, lastMove: [from, to] });
    const ok = chess.isCheckmate();
    if (!answered) result(root, key, ok);
    answered = true;
    if (ok) {
      playSound('end');
      fb(root, `✅ ${t('tr.mateOk', { m: mv.san })}${kind === 'promo' && mv.promotion === 'n' ? ` ${t('tr.underpromo')}` : ''}`, 'ok');
    } else {
      const why = t(chess.isStalemate() ? 'tr.stalemate' : chess.inCheck() ? 'tr.checkNotMate' : 'tr.notMate');
      fb(root, `❌ ${why} ${t('tr.tryAgain')}`, 'bad');
      setTimeout(() => { if (!alive(board)) return; chess.undo(); board.fromChess(chess, { movable: 'w' }); }, 1100);
    }
  };
  root.querySelector('#show').onclick = () => {
    if (!task) return;
    if (!answered) result(root, key, false);
    answered = true;
    const u = task.mates[0];
    board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'green' }]);
    const san = new Chess(task.fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san;
    fb(root, t('tr.solution', { m: `<b>${san}</b>` }));
  };
  root.querySelector('#nextp').onclick = next;
  next();
}

// ---------- Взятие на проходе ----------
export function renderEnPassant(root) {
  const board = shell(root, `⇗ ${t('tr.ep')}`);
  root.querySelector('.controls').innerHTML = `<button class="btn primary" id="nexte">${t('tr.nextPos')} →</button>`;
  setStats(root, 'ep');
  let task, chess, stage;

  async function next() {
    task = await gen('genEnPassant');
    if (!alive(board)) return;
    chess = new Chess(task.fen);
    stage = 'ask';
    board.setOrientation(task.color);
    board.fromChess(chess, { movable: null, lastMove: task.lastMove });
    board.setArrows([{ from: task.lastMove[0], to: task.lastMove[1], color: 'blue' }]);
    root.querySelector('.task').innerHTML = `${t(task.color === 'w' ? 'tr.whiteToMove' : 'tr.blackToMove')} ${t('tr.epLast')}<br><b>${t('tr.epQ')}</b>`;
    root.querySelector('.answers').innerHTML = `<button class="btn" data-a="1">${t('tr.yes')}</button><button class="btn" data-a="0">${t('tr.no')}</button>`;
    fb(root, '');
  }

  root.querySelector('.answers').onclick = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b || stage !== 'ask') return;
    const said = b.dataset.a === '1';
    root.querySelector('.answers').innerHTML = '';
    if (said !== task.can) {
      result(root, 'ep', false);
      fb(root, `❌ ${t('tr.ep.' + task.reason)}`, 'bad');
      if (task.can) board.setArrows([{ from: task.answer.slice(0, 2), to: task.answer.slice(2, 4), color: 'green' }]);
      stage = 'done';
      return;
    }
    if (!task.can) {
      result(root, 'ep', true);
      fb(root, `✅ ${t('common.correct')} ${t('tr.ep.' + task.reason)}`, 'ok');
      stage = 'done';
      return;
    }
    stage = 'move';
    fb(root, `👍 ${t('tr.epNowCapture')}`, 'ok');
    board.fromChess(chess, { movable: task.color, lastMove: task.lastMove });
  };

  board.onMove = (from, to, promotion) => {
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { return; }
    playSound('capture');
    board.fromChess(chess, { movable: null, lastMove: [from, to] });
    board.setArrows([]);
    if (mv.flags.includes('e')) {
      result(root, 'ep', true);
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

// ---------- Рокировка ----------
export function renderCastling(root) {
  const board = shell(root, `♜ ${t('tr.castle')}`, `<p class="muted">${t('tr.castleRules')}</p>`);
  root.querySelector('.controls').innerHTML = `<button class="btn primary" id="nextc">${t('tr.nextPos')} →</button>`;
  setStats(root, 'castle');
  let task, stage;

  async function next() {
    task = await gen('genCastling');
    if (!alive(board)) return;
    stage = 'ask';
    const chess = new Chess(task.fen);
    board.setOrientation('w');
    board.setArrows([]);
    board.setHints([]);
    board.fromChess(chess, { movable: null, lastMove: null });
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
    result(root, 'castle', ok);
    root.querySelectorAll('.answers button').forEach((x) => {
      x.disabled = true;
      if (x.dataset.a === task.answer) x.classList.add('primary');
    });
    // Подсветим поля, которые бьёт соперник на пути короля
    const c = new Chess(task.fen);
    board.setHints(['b1', 'c1', 'd1', 'e1', 'f1', 'g1'].filter((s) => c.isAttacked(s, 'b')).map((sq) => ({ sq, cls: 'hint-attacked' })));
    const ex = task.explain;
    const side = (k) => `${t('tr.c.' + k + 'Name')}: ${ex[k] ? t('tr.no.' + ex[k].code, { sq: ex[k].squares || '' }) : t('tr.allowed')}.`;
    fb(root, `${ok ? `✅ ${t('common.correct')}` : `❌ ${t('tr.wrong')}`} ${side('short')} ${side('long')}${ex.b1tip ? ` ${t('tr.b1tip')}` : ''}`, ok ? 'ok' : 'bad');
  };
  root.querySelector('#nextc').onclick = next;
  next();
}

// ---------- Техника мата против движка ----------
export function renderEndgame(root, type) {
  const cfg = ENDGAMES[type];
  if (!cfg) { location.hash = '#/train'; return; }
  const key = 'end-' + type;
  const board = shell(root, `${cfg.icon} ${t('end.title.' + type)}`, `<details class="theory" open><summary>${t('tr.howToMate')}</summary><p>${tx(THEORY[type])}</p></details>`);
  root.querySelector('.controls').innerHTML = `
    <button class="btn" id="hintE">💡 ${t('common.hint')}</button>
    <button class="btn" id="undoE">↶ ${t('common.takeback')}</button>
    <button class="btn" id="resetE">↻ ${t('common.retry')}</button>
    <button class="btn primary" id="newE">${t('tr.newPos')} →</button>`;
  root.querySelector('.task').innerHTML = '<div class="moves" id="emoves"></div><div class="par"></div>';
  setStats(root, key);
  const engine = getEngine();
  let startFen, chess, over, busy, token = 0, par = null, hinted = false;

  function redraw(lastMove) {
    board.fromChess(chess, { movable: !over && !busy && chess.turn() === 'w' ? 'w' : null, lastMove });
    const sans = chess.history();
    const box = root.querySelector('#emoves');
    box.innerHTML = moveListHtml(sans, sans.length - 1);
    box.scrollTop = box.scrollHeight;
  }

  async function start(fen) {
    token++;
    startFen = fen;
    chess = new Chess(fen);
    over = false; busy = false; hinted = false;
    board.setArrows([]);
    board.setOrientation('w');
    redraw(null);
    fb(root, t('tr.yourMoveWhite'));
    root.querySelector('.par').textContent = t('tr.parCalc');
    const my = token;
    const res = await engine.analyse(fen, { movetime: type === 'kbn' ? 4000 : 2500 });
    if (my !== token || !alive(board)) return;
    const m = res.lines[0] && res.lines[0].score.mate;
    par = m && m > 0 ? m : null;
    root.querySelector('.par').innerHTML = `🎯 ${par ? t('tr.par', { n: par }) : type === 'kbn' ? t('tr.parKbn') : t('tr.parWin')}`;
  }

  async function newPosition() {
    fb(root, t('tr.generating'));
    const fen = await gen('genEndgame', type);
    if (alive(board)) start(fen);
  }

  function finish(ok, text) {
    over = true;
    if (!hinted || !ok) result(root, key, ok);
    playSound('end');
    fb(root, text, ok ? 'ok' : 'bad');
    redraw();
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
    playSound(mv.captured ? 'capture' : 'move');
    board.setArrows([]);
    if (checkOver()) return;
    busy = true;
    redraw([from, to]);
    fb(root, t('tr.engineThinking'));
    const my = token;
    const started = Date.now();
    const res = await engine.analyse(chess.fen(), { depth: 12 });
    const wait = 350 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (my !== token || !alive(board)) return;
    busy = false;
    if (res.bestmove) {
      const r = chess.move({ from: res.bestmove.slice(0, 2), to: res.bestmove.slice(2, 4), promotion: res.bestmove[4] });
      playSound(r.captured ? 'capture' : 'move');
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
  root.querySelector('#resetE').onclick = () => start(startFen);
  root.querySelector('#newE').onclick = newPosition;
  newPosition().catch((e) => toast(e.message, 'bad'));
}
