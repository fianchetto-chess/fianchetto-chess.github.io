import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { getEngine } from './engine.js';
import { ENDGAMES } from './train-gen.js';
import { store, moveListHtml, playSound, moveSound, toast } from './ui.js';
import { t, tx } from './i18n.js';

// ---------- данные задач (сгенерированы заранее и отсортированы от простых к сложным) ----------
let dataPromise = null;
export function loadData() {
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

const QUIZ_LEVELS = 15;

// сложность задачи по её месту в отсортированном списке (для подбора задач дня)
const RANGES = { mate1: [400, 1400], mate2: [900, 1900], mate3: [1300, 2400], tactic: [600, 2200], promo: [500, 1700], daily: [1000, 1900] };
function puzzleElo(track, i, n) {
  const [lo, hi] = RANGES[track] || [800, 1600];
  return Math.round(lo + (hi - lo) * (n > 1 ? i / (n - 1) : 0.5));
}

// ---------- задачи дня: 30 сложных задач, каждая сложнее предыдущей ----------
export const DAILY_N = 30;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function dailyPuzzles(data) {
  // только самая трудная часть тренировок: тактика, мат в 2 и мат в 3+
  const items = [];
  for (const tr of ['tactic', 'mate2', 'mate3']) {
    const list = data[tr];
    const from = Math.floor(list.length * 0.6);
    for (let i = from; i < list.length; i++) items.push({ pz: list[i], elo: puzzleElo(tr, i, list.length) });
  }
  items.sort((a, b) => a.elo - b.elo);
  const d = new Date();
  const dayNum = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const band = items.length / DAILY_N;
  const out = [];
  for (let k = 0; k < DAILY_N; k++) {
    const lo = Math.floor(k * band), size = Math.max(1, Math.floor(band));
    out.push(items[lo + ((dayNum * 7919 + k * 104729) % size)].pz);
  }
  return out;
}
// прогресс задач дня обнуляется каждый новый день
export function dailyProgress() {
  if (store.get('dailyDay', null) !== dayKey()) { store.set('dailyDay', dayKey()); setProg('daily', 0); }
  return getProg('daily');
}
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
  if (n && i >= n) return `<div class="lvl-bar"><div style="width:100%"></div></div><div class="lvl-text">${t('tr.levelFree', { i: i + 1 })}</div>`;
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
  const dp = dailyProgress();
  root.innerHTML = `
    <h1>${t('nav.train')}</h1>
    <p class="lead">${t('tr.lead')}</p>
    <div class="train-top">
      <a class="card daily-card" href="#/train/p/daily"><div class="card-title">📅 ${t('daily.title')}</div>
        <div class="card-sub">${dp >= DAILY_N ? `✓ ${t('daily.doneToday')}` : t('daily.cta')}</div>
        <div class="card-stat">${t('daily.progress', { n: dp, total: DAILY_N })}</div></a>
    </div>
    <h2>⚔ ${t('tr.tactics')}</h2>
    <div class="cards">${PUZZLE_TRACKS.map((tr) => levelCard(`#/train/p/${tr.id}`, `${tr.icon} ${t(tr.title)}`, t(tr.sub), tr.id)).join('')}</div>
    <h2>♔ ${t('tr.mates')}</h2>
    <p class="muted">${t('tr.matesNote')}</p>
    <div class="cards">${Object.entries(ENDGAMES).map(([k, e]) => levelCard(`#/train/end/${k}`, `${e.icon} ${t('end.title.' + k)}`, t('end.sub.' + k), 'end-' + k)).join('')}</div>
    <h2>♙ ${t('tr.special')}</h2>
    <div class="cards">
      ${levelCard('#/train/ep', `⇗ ${t('tr.ep')}`, t('tr.epSub'), 'ep')}
      ${levelCard('#/train/castle', `♜ ${t('tr.castle')}`, t('tr.castleSub'), 'castle')}
    </div>`;
}

function shell(root, title, extra = '', back = '#/train') {
  root.innerHTML = `
    <a href="${back}" class="back">← ${back === '#/train' ? t('tr.all') : t('lv.toLevels')}</a>
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
// ---------- уровни: в каждой тренировке 10 уровней по 20 задач ----------
export const LEVELS = 10, PER = 20;
const lvState = (key) => store.get('lv-' + key, { done: {} });
const solvedSet = (key, L) => new Set(lvState(key).done[L] || []);
const solvedIn = (key, L) => solvedSet(key, L).size;
function markSolved(key, L, k) {
  const s = lvState(key);
  const set = new Set(s.done[L] || []);
  set.add(k);
  s.done[L] = [...set];
  store.set('lv-' + key, s);
  return set.size;
}
const levelDone = (key, L) => solvedIn(key, L) >= PER;
const levelOpen = () => true; // все уровни доступны сразу
const levelsDone = (key) => { let n = 0; for (let L = 0; L < LEVELS; L++) if (levelDone(key, L)) n++; return n; };
// 200 задач из отсортированного по сложности списка — равномерно от лёгких к трудным
const levelSet = (list) => Array.from({ length: LEVELS * PER }, (_, i) => list[Math.floor((i * (list.length - 1)) / (LEVELS * PER - 1))]);
const clampLevel = (arg) => Math.max(0, Math.min(LEVELS - 1, (Number(arg) || 1) - 1));
function firstUnsolved(key, L) { const s = solvedSet(key, L); for (let k = 0; k < PER; k++) if (!s.has(k)) return k; return 0; }
function nextUnsolved(key, L, i) { const s = solvedSet(key, L); for (let j = 1; j <= PER; j++) { const k = (i + j) % PER; if (!s.has(k)) return k; } return (i + 1) % PER; }

// экран выбора уровня
function renderLevels(root, { key, title, base, extra = '' }) {
  root.innerHTML = `
    <a href="#/train" class="back">← ${t('tr.all')}</a>
    <h1>${title}</h1>
    ${extra}
    <p class="lead">${t('lv.lead', { n: LEVELS, per: PER })}</p>
    <div class="levels">${Array.from({ length: LEVELS }, (_, L) => {
      const n = solvedIn(key, L);
      return `<a class="lv-tile ${n >= PER ? 'done' : ''}" href="${base}/${L + 1}"><div class="lv-num">${L + 1}</div>
        <div class="lv-sub">${n >= PER ? `✓ ${t('lv.passed')}` : t('lv.solvedN', { n, per: PER })}</div>
        <div class="lvl-bar"><div style="width:${Math.round((n / PER) * 100)}%"></div></div></a>`;
    }).join('')}</div>`;
}

// полоска из 20 задач текущего уровня
function stripHtml(key, L, cur, quiz = false) {
  const s = solvedSet(key, L);
  const n = s.size;
  const cells = Array.from({ length: PER }, (_, k) => {
    const done = quiz ? k < n : s.has(k);
    return `<button class="ts ${done ? 'done' : ''} ${k === cur ? 'cur' : ''}" data-k="${k}" ${quiz ? 'disabled' : ''}>${k + 1}</button>`;
  }).join('');
  return `<div class="lvl-text">${t('lv.levelN', { l: L + 1, n: LEVELS })} · ${t('lv.solvedN', { n: Math.min(n, PER), per: PER })}</div><div class="task-strip">${cells}</div>`;
}
function levelCompleteHtml(base, L) {
  return L + 1 < LEVELS
    ? `🎉 <b>${t('lv.complete', { l: L + 1 })}</b> <a class="btn primary" href="${base}/${L + 2}">${t('lv.nextLevel', { l: L + 2 })} →</a>`
    : `🏆 <b>${t('lv.allDone')}</b>`;
}
function levelCard(href, title, sub, key) {
  const d = levelsDone(key);
  return `<a class="card train-card" href="${href}"><div class="card-title">${title}</div><div class="card-sub">${sub}</div>
    <div class="lvl-bar"><div style="width:${d * 10}%"></div></div><div class="lvl-text">${t('lv.cardDone', { n: d, total: LEVELS })}</div>
    ${d >= LEVELS ? `<div class="card-stat">✓ ${t('tr.trackDone')}</div>` : ''}</a>`;
}

export async function renderPuzzleTrack(root, track, lvArg) {
  const isDaily = track === 'daily';
  const tr = isDaily ? { id: 'daily', icon: '📅', title: 'daily.title' } : PUZZLE_TRACKS.find((x) => x.id === track);
  if (!tr) { location.hash = '#/train'; return; }
  const base = `#/train/p/${track}`;
  const title = `${tr.icon} ${t(tr.title)}`;
  if (!isDaily && !lvArg) { renderLevels(root, { key: track, title, base }); return; }
  const L = isDaily ? 0 : clampLevel(lvArg);
  if (!isDaily && !levelOpen(track, L)) { location.hash = base; return; }
  if (isDaily) dailyProgress();
  const board = shell(root, isDaily ? title : `${title} · ${t('lv.level', { l: L + 1 })}`, '', isDaily ? '#/train' : base);
  const data = await loadData();
  if (!alive(board)) return;
  const list = isDaily ? dailyPuzzles(data) : levelSet(data[track]).slice(L * PER, L * PER + PER);
  const tacticLike = (z) => track === 'tactic' || (isDaily && !z.n);
  const engine = getEngine();
  root.querySelector('.controls').innerHTML = `
    <button class="btn" id="hint">💡 ${t('common.hint')}</button>
    <button class="btn" id="show">${t('tr.showSolution')}</button>
    <button class="btn" id="retry">↻ ${t('tr.retry')}</button>
    <button class="btn primary" id="next">${t('common.next')} →</button>`;
  const btn = (id) => root.querySelector('#' + id);
  let i = 0, pz, chess, color, need, failed, solved, busy, hintStep, token = 0;

  function showInfo() {
    if (isDaily) { setLevel(root, track, i, list.length); return; }
    root.querySelector('.lvl').innerHTML = stripHtml(track, L, i);
    const s = stats(track);
    root.querySelector('.train-stats').innerHTML = t('tr.statsLine', { solved: s.solved, streak: s.streak, best: s.best });
  }

  function setup(z) {
    pz = z;
    chess = new Chess(pz.f);
    color = chess.turn();
    need = pz.n || 1;       // сколько ходов осталось до мата
    failed = false; solved = false; busy = false; hintStep = 0; token++;
    board.setArrows([]);
    board.setHints([]);
    board.setOrientation(color);
    board.fromChess(chess, { movable: color, lastMove: null, animate: false });
    showInfo();
    const side = t(color === 'w' ? 'tr.whiteToMove' : 'tr.blackToMove');
    const task = pz.n ? t('tr.mateTask', { n: pz.n }) : track === 'promo' ? t('tr.promoTask2') : t('tr.tacticTask');
    root.querySelector('.task').innerHTML = `${side} <b>${task}</b>`;
    fb(root, '');
    btn('next').disabled = isDaily;
  }

  function load(idx) {
    i = Math.max(0, Math.min(idx, list.length - 1));
    setup(list[i]);
  }

  function markFail() {
    if (failed) return null;
    failed = true;
    result(track, false);
  }

  function win() {
    solved = true;
    board.setMovable(null);
    if (!failed) result(track, true);
    playSound('end');
    if (isDaily) {
      setProg(track, Math.max(getProg(track), i + 1));
      fb(root, `✅ ${failed ? t('tr.solvedAfterTry') : t('tr.solvedOk')}${i + 1 >= list.length ? ` ${t('daily.doneToday')}` : ''}`, 'ok');
      btn('next').disabled = i + 1 >= list.length;
      showInfo();
      return;
    }
    const before = solvedIn(track, L);
    const n = markSolved(track, L, i);
    showInfo();
    btn('next').disabled = false;
    if (n >= PER && before < PER) { fb(root, levelCompleteHtml(base, L), 'ok'); return; }
    fb(root, `✅ ${failed ? t('tr.solvedAfterTry') : t('lv.taskSolved')}`, 'ok');
  }

  function lose(msg) {
    markFail();
    playSound('wrong');
    fb(root, `❌ ${msg}`, 'bad');
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
    board.fromChess(chess, { movable: null, lastMove: [from, to], animate: false, premove: color });
    let ok = false;
    if (chess.isCheckmate()) { ok = true; }
    else if (tacticLike(pz)) {
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
    board.cancelPremove();
    chess.load(before);
    busy = false;
    board.fromChess(chess, { movable: color, lastMove: null });
  };

  btn('hint').onclick = () => {
    if (solved || busy) return;
    hintStep++;
    markFail();
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
    markFail();
    busy = true;
    const my = token;
    let line = pz.p && pz.p.length ? pz.p : [pz.s];
    chess.load(pz.f);
    board.fromChess(chess, { movable: null, lastMove: null, animate: false });
    if (pz.n) line = line.slice(0, pz.n * 2 - 1);
    for (const u of line.slice(0, 7)) {
      await sleep(600);
      if (my !== token || !alive(board)) return;
      let r;
      try { r = chess.move(uciMv(u)); } catch { break; }
      moveSound(r);
      board.fromChess(chess, { movable: null });
    }
    busy = false;
    solved = true;
    fb(root, t(isDaily ? 'tr.solutionShown' : 'lv.solutionShown'));
    if (isDaily) setProg(track, Math.max(getProg(track), i + 1));
    btn('next').disabled = isDaily && i + 1 >= list.length;
  };
  btn('retry').onclick = () => setup(pz);
  btn('next').onclick = () => load(isDaily ? i + 1 : nextUnsolved(track, L, i));
  root.querySelector('.lvl').onclick = (e) => {
    if (isDaily) {
      if (!e.target.closest('.lvl-bar')) return;
      const r = e.target.closest('.lvl-bar').getBoundingClientRect();
      const target = Math.floor(((e.clientX - r.left) / r.width) * list.length);
      if (target <= getProg(track)) load(target);
      return;
    }
    const b = e.target.closest('.ts');
    if (b) load(Number(b.dataset.k));
  };
  root._cleanup = () => { token++; engine.stop(); };
  load(isDaily ? Math.min(getProg(track), list.length - 1) : firstUnsolved(track, L));
}

// ---------- Взятие на проходе: «можно или нельзя?» (уровни) ----------
// сложность генератора (0…14) для уровня 1…10
const quizDiff = (L) => Math.round((L * (QUIZ_LEVELS - 1)) / (LEVELS - 1));
function quizDone(root, key, L, base, ok) {
  result(key, ok);
  playSound(ok ? 'end' : 'wrong');
  let complete = false;
  if (ok) {
    const before = solvedIn(key, L);
    if (before < PER) complete = markSolved(key, L, before) >= PER;
  }
  root.querySelector('.lvl').innerHTML = stripHtml(key, L, Math.min(solvedIn(key, L), PER - 1), true);
  return complete ? levelCompleteHtml(base, L) : '';
}

export function renderEnPassant(root, lvArg) {
  const key = 'ep';
  const base = '#/train/ep';
  if (!lvArg) { renderLevels(root, { key, title: `⇗ ${t('tr.ep')}`, base }); return; }
  const L = clampLevel(lvArg);
  if (!levelOpen(key, L)) { location.hash = base; return; }
  const board = shell(root, `⇗ ${t('tr.ep')} · ${t('lv.level', { l: L + 1 })}`, '', base);
  root.querySelector('.controls').innerHTML = `<button class="btn primary" id="nexte">${t('tr.nextPos')} →</button>`;
  let task, chess, stage;

  async function next() {
    root.querySelector('.lvl').innerHTML = stripHtml(key, L, Math.min(solvedIn(key, L), PER - 1), true);
    task = await gen('genEnPassant', quizDiff(L));
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
  let extraMsg = '';
  function done(ok) { extraMsg = quizDone(root, key, L, base, ok); }

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
    if (!task.can) { done(true); fb(root, `✅ ${t('common.correct')} ${t('tr.ep.' + task.reason)}${extraMsg ? `<br>${extraMsg}` : ''}`, 'ok'); stage = 'done'; return; }
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
      fb(root, `✅ ${t('tr.epDone', { m: mv.san })}${extraMsg ? `<br>${extraMsg}` : ''}`, 'ok');
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
export function renderCastling(root, lvArg) {
  const key = 'castle';
  const base = '#/train/castle';
  if (!lvArg) { renderLevels(root, { key, title: `♜ ${t('tr.castle')}`, base, extra: `<p class="muted">${t('tr.castleRules')}</p>` }); return; }
  const L = clampLevel(lvArg);
  if (!levelOpen(key, L)) { location.hash = base; return; }
  const board = shell(root, `♜ ${t('tr.castle')} · ${t('lv.level', { l: L + 1 })}`, `<p class="muted">${t('tr.castleRules')}</p>`, base);
  root.querySelector('.controls').innerHTML = `<button class="btn primary" id="nextc">${t('tr.nextPos')} →</button>`;
  let task, stage;

  async function next() {
    root.querySelector('.lvl').innerHTML = stripHtml(key, L, Math.min(solvedIn(key, L), PER - 1), true);
    task = await gen('genCastling', quizDiff(L));
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
    const extraMsg = quizDone(root, key, L, base, ok);
    root.querySelectorAll('.answers button').forEach((x) => {
      x.disabled = true;
      if (x.dataset.a === task.answer) x.classList.add('primary');
    });
    const c = new Chess(task.fen);
    board.setHints(['b1', 'c1', 'd1', 'e1', 'f1', 'g1'].filter((sq) => c.isAttacked(sq, 'b')).map((sq) => ({ sq, cls: 'hint-attacked' })));
    const ex = task.explain;
    const side = (k) => `${t('tr.c.' + k + 'Name')}: ${ex[k] ? t('tr.no.' + ex[k].code, { sq: ex[k].squares || '' }) : t('tr.allowed')}.`;
    fb(root, `${ok ? `✅ ${t('common.correct')}` : `❌ ${t('tr.wrong')}`} ${side('short')} ${side('long')}${ex.b1tip ? ` ${t('tr.b1tip')}` : ''}${extraMsg ? `<br>${extraMsg}` : ''}`, ok ? 'ok' : 'bad');
  };
  root.querySelector('#nextc').onclick = next;
  next();
}

// ---------- Техника мата против движка (уровни: от короткого мата к длинному) ----------
export async function renderEndgame(root, type, lvArg) {
  const cfg = ENDGAMES[type];
  if (!cfg) { location.hash = '#/train'; return; }
  const key = 'end-' + type;
  const base = `#/train/end/${type}`;
  const theory = (open) => `<details class="theory" ${open ? 'open' : ''}><summary>${t('tr.howToMate')}</summary><p>${tx(THEORY[type])}</p></details>`;
  if (!lvArg) { renderLevels(root, { key, title: `${cfg.icon} ${t('end.title.' + type)}`, base, extra: theory(levelsDone(key) === 0) }); return; }
  const L = clampLevel(lvArg);
  if (!levelOpen(key, L)) { location.hash = base; return; }
  const board = shell(root, `${cfg.icon} ${t('end.title.' + type)} · ${t('lv.level', { l: L + 1 })}`, theory(false), base);
  root.querySelector('.controls').innerHTML = `
    <button class="btn" id="hintE">💡 ${t('common.hint')}</button>
    <button class="btn" id="undoE">↶ ${t('common.takeback')}</button>
    <button class="btn" id="resetE">↻ ${t('common.retry')}</button>
    <button class="btn primary" id="nextE">${t('common.next')} →</button>`;
  root.querySelector('.task').innerHTML = '<div class="par"></div><div class="moves" id="emoves"></div>';
  const list = levelSet((await loadData()).end[type]).slice(L * PER, L * PER + PER);
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
    i = Math.max(0, Math.min(idx, list.length - 1));
    start(list[i].f, list[i].n);
  }

  function start(fen, n) {
    token++;
    startFen = fen;
    par = n;
    chess = new Chess(startFen);
    over = false; busy = false; hinted = false;
    board.setArrows([]);
    board.setOrientation('w');
    redraw(null, false);
    root.querySelector('.lvl').innerHTML = stripHtml(key, L, i);
    fb(root, t('tr.yourMoveWhite'));
    root.querySelector('.par').innerHTML = `🎯 ${par ? t('tr.par', { n: par }) : type === 'kbn' ? t('tr.parKbn') : t('tr.parWin')}`;
    root.querySelector('#nextE').disabled = false;
  }


  function finish(ok, text) {
    over = true;
    if (ok) {
      if (!hinted) result(key, true);
      const before = solvedIn(key, L);
      if (markSolved(key, L, i) >= PER && before < PER) text += `<br>${levelCompleteHtml(base, L)}`;
      root.querySelector('.lvl').innerHTML = stripHtml(key, L, i);
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
  root.querySelector('#resetE').onclick = () => { if (startFen) start(startFen, par); };
  root.querySelector('#nextE').onclick = () => load(nextUnsolved(key, L, i));
  root.querySelector('.lvl').onclick = (e) => { const b = e.target.closest('.ts'); if (b) load(Number(b.dataset.k)); };
  root._cleanup = () => { token++; engine.stop(); };
  load(firstUnsolved(key, L));
}
