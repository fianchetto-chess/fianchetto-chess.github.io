// Генераторы случайных тренировочных позиций. Принимают класс Chess,
// чтобы их можно было проверять и в браузере, и в Node.

const FILES = 'abcdefgh';
const rnd = (n) => Math.floor(Math.random() * n);
const sqName = (f, r) => FILES[f] + (r + 1);
const isLight = (sq) => (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 1;
const kingDist = (a, b) => Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(a[1] - b[1]));

// Собирает FEN из словаря {e1: 'K', ...}
export function buildFen(pieces, turn = 'w', castling = '-', ep = '-') {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = ''; let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces[sqName(f, r)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} ${castling} ${ep} 0 1`;
}

function freeSquare(pieces, test = () => true) {
  for (let i = 0; i < 500; i++) {
    const sq = sqName(rnd(8), rnd(8));
    if (!pieces[sq] && test(sq)) return sq;
  }
  return null;
}

function tryLoad(Chess, fen) {
  try { return new Chess(fen); } catch { return null; }
}

// Не под шахом ли сторона, которая НЕ ходит (иначе позиция невозможна)
function opponentInCheck(Chess, fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const c = tryLoad(Chess, parts.join(' '));
  return !c || c.inCheck();
}

// ---------- Техника мата: белые против одинокого короля ----------
export const ENDGAMES = {
  kq: { title: 'Queen', pieces: ['Q'], icon: '♕' },
  kr: { title: 'Rook', pieces: ['R'], icon: '♖' },
  krr: { title: 'Two rooks', pieces: ['R', 'R'], icon: '♖♖' },
  kbb: { title: 'Two bishops', pieces: ['B', 'B'], icon: '♗♗' },
  kbn: { title: 'Knight and bishop', pieces: ['B', 'N'], icon: '♗♘' },
  kpk: { title: 'Pawn to queen', pieces: ['P'], icon: '♙' },
};

export function genEndgame(Chess, type) {
  const cfg = ENDGAMES[type];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const p = {};
    // Чёрный король ближе к центру — так задача честнее
    const bk = type === 'kpk' ? freeSquare(p) : sqName(2 + rnd(4), 2 + rnd(4));
    p[bk] = 'k';
    const wk = freeSquare(p, (s) => kingDist(s, bk) >= (type === 'kpk' ? 1 : 3));
    if (!wk || kingDist(wk, bk) < 2) continue;
    p[wk] = 'K';
    let ok = true;
    let firstBishop = null;
    for (const piece of cfg.pieces) {
      let test = (s) => kingDist(s, bk) >= 2;
      if (piece === 'B' && type === 'kbb' && firstBishop) test = (s) => kingDist(s, bk) >= 2 && isLight(s) !== isLight(firstBishop);
      if (piece === 'P') test = (s) => s[0] !== 'a' && s[0] !== 'h' && s[1] >= '2' && s[1] <= '5' && kingDist(s, wk) <= 1 && Number(s[1]) <= Number(wk[1]);
      const sq = freeSquare(p, test);
      if (!sq) { ok = false; break; }
      p[sq] = piece;
      if (piece === 'B') firstBishop = sq;
    }
    if (!ok) continue;
    const fen = buildFen(p, 'w');
    if (opponentInCheck(Chess, fen)) continue;
    const c = tryLoad(Chess, fen);
    if (!c || c.isGameOver()) continue;
    // Чёрный король не должен иметь возможности сразу съесть незащищённую фигуру
    const bt = tryLoad(Chess, buildFen(p, 'b'));
    if (bt && bt.moves({ verbose: true }).some((m) => m.captured)) continue;
    return fen;
  }
  throw new Error('generation failed');
}

// ---------- Мат в 1 ход ----------
const PIECE_POOL = ['Q', 'R', 'R', 'B', 'N', 'N', 'B', 'P', 'P'];
const DEF_POOL = ['r', 'b', 'n', 'p', 'p', 'p', 'q'];

export function mateMoves(Chess, fen) {
  const c = new Chess(fen);
  return c.moves({ verbose: true }).filter((m) => {
    const t = new Chess(fen);
    t.move(m);
    return t.isCheckmate();
  });
}

export function genMateIn1(Chess) {
  for (let attempt = 0; attempt < 20000; attempt++) {
    const p = {};
    // Чёрный король на краю или рядом — там чаще бывают маты
    const edge = rnd(4);
    const a = rnd(8), b = rnd(2);
    const bk = [sqName(a, 7 - b), sqName(a, b), sqName(b, a), sqName(7 - b, a)][edge];
    p[bk] = 'k';
    // Свои пешки/фигуры чёрных рядом с королём
    const nDef = 1 + rnd(3);
    for (let i = 0; i < nDef; i++) {
      const s = freeSquare(p, (x) => kingDist(x, bk) <= 2 && x[1] !== '1' && x[1] !== '8');
      if (s) p[s] = DEF_POOL[rnd(DEF_POOL.length)];
    }
    const wk = freeSquare(p, (x) => kingDist(x, bk) >= 2);
    p[wk] = 'K';
    const nAtt = 1 + rnd(3);
    for (let i = 0; i < nAtt; i++) {
      const piece = PIECE_POOL[rnd(PIECE_POOL.length)];
      const s = freeSquare(p, (x) => (piece === 'P' ? x[1] > '1' && x[1] < '8' : true) && kingDist(x, bk) >= 2);
      if (s) p[s] = piece;
    }
    const fen = buildFen(p, 'w');
    if (opponentInCheck(Chess, fen)) continue;
    const c = tryLoad(Chess, fen);
    if (!c || c.isGameOver() || c.inCheck()) continue;
    const mates = mateMoves(Chess, fen);
    if (mates.length >= 1 && mates.length <= 2) return { fen, mates: mates.map((m) => m.lan) };
  }
  throw new Error('generation failed');
}

// ---------- Превращение: мат превращением ----------
// Задачи на «слабое превращение» в коня (найдены перебором и проверены)
const KNIGHT_PROMOS = [
  'K7/1P6/kb6/rn6/8/5B2/8/8 w - - 0 1', '8/2Pn4/3kn3/3rp2K/8/8/2R5/8 w - - 0 1',
  '8/pP6/k7/n7/1R6/5K2/8/8 w - - 0 1', '8/5Pr1/6kb/5R2/4K3/8/8/8 w - - 0 1',
  '8/rP6/kbK5/b7/8/8/5R2/8 w - - 0 1', '8/4pP2/3nk2K/3rp3/5R2/8/8/8 w - - 0 1',
  '8/pP6/k7/b7/1R5K/8/8/8 w - - 0 1', '8/pP6/k1K5/4R3/8/8/8/8 w - - 0 1',
  '7K/6P1/6pk/6rp/8/8/8/8 w - - 0 1', '8/pP6/k1K5/pp6/8/8/8/8 w - - 0 1',
  '8/3Pr3/2K1k3/5p2/8/2B5/8/8 w - - 0 1', '8/rP6/k1K5/8/2N5/8/8/8 w - - 0 1',
];

export function genPromotionMate(Chess) {
  if (Math.random() < 0.45) {
    const fen = KNIGHT_PROMOS[rnd(KNIGHT_PROMOS.length)];
    return { fen, mates: mateMoves(Chess, fen).map((m) => m.lan), under: true };
  }
  for (let attempt = 0; attempt < 40000; attempt++) {
    const p = {};
    const pf = rnd(8);
    const pawn = sqName(pf, 6);
    p[pawn] = 'P';
    const bk = freeSquare(p, (x) => x[1] >= '6' && kingDist(x, pawn) >= 1);
    if (!bk) continue;
    p[bk] = 'k';
    const nDef = rnd(3);
    for (let i = 0; i < nDef; i++) {
      const s = freeSquare(p, (x) => kingDist(x, bk) <= 2 && x[1] !== '1' && x[1] !== '8');
      if (s) p[s] = DEF_POOL[rnd(DEF_POOL.length)];
    }
    const wk = freeSquare(p, (x) => kingDist(x, bk) >= 2);
    p[wk] = 'K';
    if (rnd(2)) { const s = freeSquare(p, (x) => kingDist(x, bk) >= 2); const pc = ['R', 'B', 'N', 'Q'][rnd(4)]; if (s) p[s] = pc; }
    const fen = buildFen(p, 'w');
    if (opponentInCheck(Chess, fen)) continue;
    const c = tryLoad(Chess, fen);
    if (!c || c.isGameOver() || c.inCheck()) continue;
    const mates = mateMoves(Chess, fen);
    if (mates.length >= 1 && mates.every((m) => m.promotion)) {
      // Интереснее, когда ферзь НЕ ставит мат (нужно слабое превращение)
      return { fen, mates: mates.map((m) => m.lan), under: mates.every((m) => m.promotion !== 'q') };
    }
  }
  throw new Error('generation failed');
}

// ---------- Взятие на проходе: «можно или нельзя?» ----------
// Возвращает {fen, lastMove:[from,to], can, answerMove, explain}
export function genEnPassant(Chess) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const white = Math.random() < 0.5; // кто берёт
    const kind = ['yes', 'yes', 'yes', 'single', 'late', 'rank'][rnd(6)];
    const f = rnd(8);
    const df = Math.random() < 0.5 ? -1 : 1;
    const ef = f + df;
    if (ef < 0 || ef > 7) continue;
    const p = {};
    // Описываем позицию с точки зрения белых, потом при необходимости отражаем
    const myRank = kind === 'rank' ? 3 : 4;           // 5-я горизонталь (индекс 4) или «неправильная» 4-я
    p[sqName(f, myRank)] = 'P';
    let last;
    if (kind === 'rank') {
      p[sqName(ef, 4)] = 'p';
      last = [sqName(ef, 6), sqName(ef, 4)];
    } else {
      p[sqName(ef, 4)] = 'p';
      last = kind === 'single' ? [sqName(ef, 5), sqName(ef, 4)] : [sqName(ef, 6), sqName(ef, 4)];
    }
    const wk = freeSquare(p, (x) => x[1] <= '3');
    p[wk] = 'K';
    const bk = freeSquare(p, (x) => x[1] >= '7' && kingDist(x, wk) >= 2);
    if (!bk) continue;
    p[bk] = 'k';
    for (let i = rnd(3); i > 0; i--) {
      const s = freeSquare(p, (x) => x[1] > '1' && x[1] < '8' && x !== sqName(ef, 5) && x !== sqName(ef, 6));
      if (s) p[s] = ['N', 'B', 'n', 'b', 'P', 'p'][rnd(6)];
    }
    let lateMove = null;
    if (kind === 'late') {
      // Двойной ход был раньше, а последним ходили королём
      const kMoves = [];
      for (let df2 = -1; df2 <= 1; df2++) for (let dr = -1; dr <= 1; dr++) {
        if (!df2 && !dr) continue;
        const nf = FILES.indexOf(bk[0]) + df2, nr = Number(bk[1]) - 1 + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const s = sqName(nf, nr);
        if (!p[s] && kingDist(s, wk) >= 2) kMoves.push(s);
      }
      if (!kMoves.length) continue;
      lateMove = [kMoves[rnd(kMoves.length)], bk];
      last = lateMove;
    }
    const epSq = kind === 'yes' ? sqName(ef, 5) : '-';
    let fen = buildFen(p, 'w', '-', epSq);
    let lastMove = last;
    let answer = kind === 'yes' ? sqName(f, 4) + sqName(ef, 5) : null;
    if (!white) {
      // Отражаем доску: белые ↔ чёрные, горизонтали переворачиваются
      const q = {};
      for (const [s, pc] of Object.entries(p)) {
        const ns = s[0] + (9 - Number(s[1]));
        q[ns] = pc === pc.toUpperCase() ? pc.toLowerCase() : pc.toUpperCase();
      }
      const flipSq = (s) => s[0] + (9 - Number(s[1]));
      fen = buildFen(q, 'b', '-', epSq === '-' ? '-' : flipSq(epSq));
      lastMove = last.map(flipSq);
      answer = answer && flipSq(answer.slice(0, 2)) + flipSq(answer.slice(2));
    }
    if (opponentInCheck(Chess, fen)) continue;
    const c = tryLoad(Chess, fen);
    if (!c || c.isGameOver() || c.inCheck()) continue;
    const epMoves = c.moves({ verbose: true }).filter((m) => m.flags.includes('e'));
    const can = epMoves.length > 0;
    if (can !== (kind === 'yes')) continue;
    return { fen, lastMove, can, answer, reason: kind, color: white ? 'w' : 'b' };
  }
  throw new Error('generation failed');
}

// ---------- Рокировка: какие рокировки возможны? ----------
export function genCastling(Chess) {
  const target = ['both', 'short', 'long', 'none'][rnd(4)]; // равномерно все варианты ответа
  for (let attempt = 0; attempt < 3000; attempt++) {
    const p = { e1: 'K', a1: 'R', h1: 'R', f2: 'P', g2: 'P', h2: 'P', a2: 'P', b2: 'P', c2: 'P' };
    let rights = 'KQ';
    const notes = [];
    if (Math.random() < 0.15) { rights = rights.replace('K', ''); notes.push('rookH'); }
    if (Math.random() < 0.15) { rights = rights.replace('Q', ''); notes.push('rookA'); }
    if (Math.random() < 0.08) { rights = ''; notes.length = 0; notes.push('king'); }
    // Свои фигуры могут мешать
    if (Math.random() < 0.2) p.g1 = 'N';
    if (Math.random() < 0.2) p.b1 = 'N';
    if (Math.random() < 0.15) p.d1 = 'Q';
    // Нападающие фигуры чёрных
    const nAtt = 1 + rnd(3);
    for (let i = 0; i < nAtt; i++) {
      const s = freeSquare(p, (x) => x[1] >= '3' && x[1] <= '7');
      if (s) p[s] = ['r', 'b', 'n', 'q', 'b'][rnd(5)];
    }
    p[freeSquare(p, (x) => x[1] === '8')] = 'k';
    const fen = buildFen(p, 'w', rights || '-');
    if (opponentInCheck(Chess, fen)) continue;
    const c = tryLoad(Chess, fen);
    if (!c || c.isGameOver()) continue;
    const moves = c.moves({ verbose: true });
    const short = moves.some((m) => m.flags.includes('k'));
    const long = moves.some((m) => m.flags.includes('q'));
    // Пропускаем скучные позиции, где всё очевидно разрешено
    const answer = short && long ? 'both' : short ? 'short' : long ? 'long' : 'none';
    if (answer !== target && attempt < 2500) continue;
    // Причины для объяснения: { code, squares }
    const attacked = (sq) => c.isAttacked(sq, 'b');
    const why = (side) => {
      const flag = side === 'short' ? 'K' : 'Q';
      if (c.inCheck()) return { code: 'check' };
      if (!rights.includes(flag)) return { code: notes.includes(side === 'short' ? 'rookH' : 'rookA') ? 'rookMoved' : 'kingMoved', squares: side === 'short' ? 'h1' : 'a1' };
      const between = side === 'short' ? ['f1', 'g1'] : ['d1', 'c1', 'b1'];
      const blocked = between.filter((sq) => c.get(sq));
      if (blocked.length) return { code: 'blocked', squares: blocked.join(', ') };
      const path = side === 'short' ? ['f1', 'g1'] : ['d1', 'c1'];
      const hit = path.filter(attacked);
      if (hit.length) return { code: 'attacked', squares: hit.join(', ') };
      return null;
    };
    const explain = { short: why('short'), long: why('long'), b1tip: long && attacked('b1') };
    return { fen, answer, notes, explain };
  }
  throw new Error('generation failed');
}
