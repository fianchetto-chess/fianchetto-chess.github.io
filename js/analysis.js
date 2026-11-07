// Анализ партии: Stockfish оценивает каждую позицию, затем каждый ход
// получает знак (!!, !, !?, ?!, ?, ??) и текстовое объяснение на русском.
// Классификация основана на падении «шансов на победу» (как на lichess).
import { Chess } from '../lib/chess.js';
import { OPENINGS } from './lessons-data.js';
import { markIcon } from './icons.js';
import { t, tx } from './i18n.js';

export const MARKS = {
  brilliant:   { sym: '!!', cls: 'm-brilliant', badge: '!!' },
  great:       { sym: '!',  cls: 'm-great', badge: '!' },
  best:        { sym: '',   cls: 'm-best', badge: '★' },
  excellent:   { sym: '',   cls: 'm-excellent', badge: '👍' },
  good:        { sym: '',   cls: 'm-good', badge: '✓' },
  book:        { sym: '',   cls: 'm-book', badge: '📖' },
  interesting: { sym: '!?', cls: 'm-interesting', badge: '!?' },
  inaccuracy:  { sym: '?!', cls: 'm-inaccuracy', badge: '?!' },
  mistake:     { sym: '?',  cls: 'm-mistake', badge: '?' },
  blunder:     { sym: '??', cls: 'm-blunder', badge: '??' },
};

for (const [k, m] of Object.entries(MARKS)) {
  m.kind = k;
  m.icon = (size = 22) => markIcon(k, size);
  Object.defineProperty(m, 'name', { get: () => t('mark.' + k) });
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ACC = (p) => t('piece.acc.' + p);
const GEN = (p) => t('piece.gen.' + p);

// Шансы белых на победу 0..100 по оценке в сантипешках (формула lichess)
export function winPercent(ev) {
  if (ev.mate !== null && ev.mate !== undefined) return ev.mate > 0 ? 100 : ev.mate < 0 ? 0 : (ev.matedSide === 'w' ? 0 : 100);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ev.cp)) - 1);
}

export function evalText(ev) {
  if (!ev) return '';
  if (ev.mate !== null && ev.mate !== undefined) {
    if (ev.mate === 0) return ev.matedSide === 'w' ? '0-1' : '1-0';
    return ev.mate > 0 ? `#${ev.mate}` : `#-${-ev.mate}`;
  }
  const v = ev.cp / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

function humanEval(ev, color) {
  if (ev.mate === 0) return t('ev.mate');
  if (ev.mate) {
    const mine = (ev.mate > 0) === (color === 'w');
    return t(mine ? 'ev.youMate' : 'ev.oppMate', { n: Math.abs(ev.mate) });
  }
  const v = (color === 'w' ? ev.cp : -ev.cp) / 100;
  if (Math.abs(v) < 0.3) return t('ev.equal');
  const a = Math.abs(v);
  const size = a < 1 ? 'slight' : a < 2.5 ? 'clear' : 'decisive';
  return t(`ev.${size}.${v > 0 ? 'you' : 'opp'}`, { v: `${v > 0 ? '+' : '−'}${a.toFixed(1)}` });
}

function material(chess, color) {
  let s = 0;
  for (const row of chess.board()) for (const p of row) if (p) s += (p.color === color ? 1 : -1) * VALUE[p.type];
  return s;
}

const uciMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

function pvToSan(fen, pv, max = 5) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(c.move(uciMove(u)).san); } catch { break; }
  }
  return out;
}

function formatLine(fen, pv, max = 5) {
  const sans = pvToSan(fen, pv, max);
  const c = new Chess(fen);
  let num = Number(fen.split(' ')[5]);
  let white = c.turn() === 'w';
  const parts = [];
  sans.forEach((s, i) => {
    if (white) parts.push(`${num}.${s}`);
    else { parts.push(i === 0 ? `${num}...${s}` : s); num++; }
    white = !white;
  });
  return parts.join(' ');
}

function detectOpening(sans) {
  let best = null;
  for (const o of OPENINGS) {
    let n = 0;
    while (n < o.line.length && n < sans.length && o.line[n][0] === sans[n]) n++;
    if (n >= 2 && (!best || n > best.n)) best = { opening: o, n };
  }
  return best;
}

// Оценка позиции с точки зрения белых
async function evaluate(engine, fen, depth) {
  const c = new Chess(fen);
  const turn = c.turn();
  if (c.isCheckmate()) return { cp: null, mate: 0, matedSide: turn, best: null, pv: [], second: null, terminal: true };
  if (c.isDraw() || c.isStalemate()) return { cp: 0, mate: null, best: null, pv: [], second: null, terminal: true };
  const res = await engine.analyse(fen, { depth, multipv: 2 });
  const sign = turn === 'w' ? 1 : -1;
  const conv = (line) => line && ({
    cp: line.score.cp !== undefined ? sign * line.score.cp : null,
    mate: line.score.mate !== undefined ? sign * line.score.mate : null,
  });
  const main = res.lines[0];
  return {
    ...conv(main), best: res.bestmove || (main && main.pv[0]), pv: main ? main.pv : [],
    second: res.lines[1] ? conv(res.lines[1]) : null,
  };
}

export async function analyzeGame({ moves, startFen }, engine, { depth = 14, onProgress } = {}) {
  const chess = new Chess(startFen || undefined);
  const fens = [chess.fen()];
  const played = [];
  for (const m of moves) {
    const mv = typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m) ? chess.move(uciMove(m)) : chess.move(m);
    played.push(mv);
    fens.push(chess.fen());
  }
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    evals.push(await evaluate(engine, fens[i], depth));
    if (onProgress) onProgress((i + 1) / fens.length);
  }
  const sans = played.map((m) => m.san);
  const opening = detectOpening(sans);

  const results = played.map((mv, i) => classify(mv, i, fens, evals, opening));
  const summary = {};
  for (const color of ['w', 'b']) {
    const mine = results.filter((r) => r.color === color);
    const counts = {};
    for (const k of Object.keys(MARKS)) counts[k] = mine.filter((r) => r.kind === k).length;
    const acc = mine.length ? mine.reduce((s, r) => s + r.accuracy, 0) / mine.length : 100;
    summary[color] = { accuracy: Math.round(acc * 10) / 10, counts };
  }
  return { fens, moves: played, evals, results, summary, opening: opening && tx(opening.opening.title) };
}

function classify(mv, i, fens, evals, opening) {
  const color = mv.color;
  const before = evals[i];
  const after = evals[i + 1];
  const wf = (ev) => (color === 'w' ? winPercent(ev) : 100 - winPercent(ev));
  const bestWin = wf(before);
  const playedWin = wf(after);
  const loss = Math.max(0, bestWin - playedWin);
  const isBest = before.best === mv.lan;
  const secondWin = before.second ? wf(before.second) : null;
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

  // Жертва: материал после лучшего ответа соперника заметно меньше, чем до хода
  const base = material(new Chess(fens[i]), color);
  const sim = new Chess(fens[i + 1]);
  const diffs = [];
  let hitMoved = false; // соперник бьёт именно ту фигуру, которой мы пошли
  for (let k = 0; k < Math.min(4, after.pv.length); k++) {
    let r;
    try { r = sim.move(uciMove(after.pv[k])); } catch { break; }
    if (k % 2 === 0 && r.captured && r.to === mv.to) hitMoved = true;
    if (k % 2 === 1 || k === after.pv.length - 1) diffs.push(material(sim, color));
  }
  const sacrifice = hitMoved && diffs.length > 0 && diffs.every((d) => d <= base - 2) && after.mate !== 0;
  const sacrificedPiece = mv.piece !== 'p' ? mv.piece : null;

  let kind;
  const inBook = opening && i < opening.n;
  if (inBook) kind = 'book';
  else if (loss >= 30) kind = 'blunder';
  else if (loss >= 20) kind = 'mistake';
  else if (loss >= 10) kind = 'inaccuracy';
  else if (sacrifice && loss < 3 && playedWin >= 45 && bestWin < 98) kind = 'brilliant';
  else if (sacrifice && playedWin >= 30) kind = 'interesting';
  else if (isBest && secondWin !== null && bestWin - secondWin >= 15 && playedWin >= 25 && bestWin < 98) kind = 'great';
  else if (isBest || loss < 1) kind = 'best';
  else if (loss < 4) kind = 'excellent';
  else kind = 'good';

  const bestSan = before.best ? pvToSan(fens[i], [before.best], 1)[0] : null;
  const bestLine = before.pv.length ? formatLine(fens[i], before.pv, 5) : '';
  const text = explain({ kind, mv, color, before, after, bestSan, bestLine, fens, i, isBest, sacrificedPiece, bestWin, playedWin, opening });

  return {
    ply: i, color, san: mv.san, uci: mv.lan, from: mv.from, to: mv.to, kind, mark: MARKS[kind],
    loss: Math.round(loss * 10) / 10, accuracy, text, evalAfter: after, bestUci: before.best, bestSan,
  };
}

function explain({ kind, mv, color, before, after, bestSan, bestLine, fens, i, sacrificedPiece, bestWin, playedWin, opening }) {
  const evalNow = humanEval(after, color);
  const s = [];
  switch (kind) {
    case 'book':
      s.push(opening ? t('ex.bookNamed', { name: tx(opening.opening.title) }) : t('ex.book'));
      break;
    case 'brilliant':
      s.push(t('ex.brilliant', { piece: GEN(sacrificedPiece || 'material') }));
      if (after.mate && (after.mate > 0) === (color === 'w')) s.push(t('ex.nowMate', { n: Math.abs(after.mate) }));
      else s.push(t('ex.evalIs', { e: evalNow }));
      break;
    case 'great':
      s.push(t('ex.great'));
      s.push(t('ex.evalIs', { e: evalNow }));
      break;
    case 'interesting':
      s.push(t('ex.interesting', { piece: ACC(sacrificedPiece || 'material') }));
      if (bestSan && bestSan !== mv.san) s.push(t('ex.saferWas', { m: bestSan }));
      break;
    case 'best':
      if (after.mate === 0) s.push(t('ex.mateDone'));
      else { s.push(t('ex.best')); s.push(t('ex.evalIs', { e: evalNow })); }
      break;
    case 'excellent':
      s.push(t('ex.excellent', { m: bestSan || '' }));
      break;
    case 'good':
      s.push(t('ex.good', { m: bestSan }));
      break;
    default:
      s.push(t('ex.' + kind, { before: humanEval(before, color), after: evalNow }));
      s.push(reason({ mv, color, before, after, fens, i }));
      if (bestLine) s.push(t('ex.betterWas', { m: bestSan, line: bestLine }));
      if (bestWin >= 80 && playedWin < 55) s.push(t('ex.missedWin'));
  }
  return s.filter(Boolean).join(' ');
}

function reason({ color, before, after, fens, i }) {
  const myMate = (ev) => ev.mate && (ev.mate > 0) === (color === 'w');
  const oppMate = (ev) => ev.mate && (ev.mate > 0) !== (color === 'w');
  if (oppMate(after)) {
    return t('ex.oppMates', { n: Math.abs(after.mate), line: formatLine(fens[i + 1], after.pv, Math.abs(after.mate) * 2 - 1) });
  }
  if (myMate(before) && !myMate(after)) return t('ex.missedMate', { n: Math.abs(before.mate) });
  if (after.pv.length) {
    const c = new Chess(fens[i + 1]);
    try {
      const reply = c.move(uciMove(after.pv[0]));
      if (reply.captured && VALUE[reply.captured] >= 3) return t('ex.hangs', { m: reply.san, piece: ACC(reply.captured) });
      if (reply.captured) return t('ex.losesMaterial', { m: reply.san });
      return t('ex.oppBest', { m: reply.san });
    } catch { /* ignore */ }
  }
  return '';
}
