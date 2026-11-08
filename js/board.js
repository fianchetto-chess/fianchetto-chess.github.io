import { t } from './i18n.js';

// Интерактивная шахматная доска в стиле chess.com:
// плавное скольжение фигур, «поднятие» фигуры при перетаскивании, подсветка клетки под курсором,
// мягкий возврат при недопустимом ходе, стрелки и выделения правой кнопкой мыши,
// значки оценок (!!, ?? …), выбор фигуры при превращении.

export const pieceHtml = (color, type, attrs = '') => `<div class="pc ${color}" ${attrs} style="background-image:url(pieces/${color}${type.toUpperCase()}.svg)"></div>`;
const FILES = 'abcdefgh';
const ANIM_MS = 210;

// Неподвижная мини-доска (для главной страницы)
export function staticBoardHtml(fen, orientation = 'w') {
  const pieces = parseFen(fen);
  let html = '<div class="mini-board">';
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const f = orientation === 'w' ? col : 7 - col;
    const r = orientation === 'w' ? 7 - row : row;
    const sq = FILES[f] + (r + 1);
    const p = pieces[sq];
    html += `<div class="${(f + r) % 2 ? 'light' : 'dark'}">${p ? `<img src="pieces/${p.color}${p.type.toUpperCase()}.svg" alt="">` : ''}</div>`;
  }
  return html + '</div>';
}

export function legalMap(chess) {
  const map = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!map.has(m.from)) map.set(m.from, []);
    map.get(m.from).push({ to: m.to, promotion: m.promotion, capture: !!m.captured });
  }
  return map;
}

export function parseFen(fen) {
  const pieces = {};
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      pieces[FILES[file] + (8 - i)] = { type: ch.toLowerCase(), color };
      file++;
    }
  });
  return pieces;
}

const samePiece = (a, b) => a && b && a.type === b.type && a.color === b.color;
const dist = (a, b) => Math.hypot(FILES.indexOf(a[0]) - FILES.indexOf(b[0]), a[1] - b[1]);

// Что изменилось между двумя позициями: какие фигуры переехали и какие исчезли
function diffPositions(oldP, newP) {
  const removed = [];
  const added = [];
  for (const sq of new Set([...Object.keys(oldP), ...Object.keys(newP)])) {
    if (samePiece(oldP[sq], newP[sq])) continue;
    if (oldP[sq]) removed.push({ sq, p: oldP[sq] });
    if (newP[sq]) added.push({ sq, p: newP[sq] });
  }
  const moves = [];
  const used = new Set();
  for (const a of added) {
    let best = null;
    for (const r of removed) {
      if (used.has(r.sq) || r.p.color !== a.p.color) continue;
      const ok = r.p.type === a.p.type || (r.p.type === 'p' && a.p.type !== 'p' && Math.abs(a.sq[1] - r.sq[1]) === 1);
      if (ok && (!best || dist(r.sq, a.sq) < dist(best.sq, a.sq))) best = r;
    }
    if (best) { used.add(best.sq); moves.push({ from: best.sq, to: a.sq }); }
  }
  const captures = removed.filter((r) => !used.has(r.sq));
  return { moves, captures, changes: added.length + removed.length };
}

// Поля, куда фигура могла бы пойти, не учитывая другие фигуры (для предхода)
function pseudoTargets(pieces, from) {
  const p = pieces[from];
  if (!p) return [];
  const f = FILES.indexOf(from[0]), r = Number(from[1]) - 1;
  const out = [];
  const add = (ff, rr) => { if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) out.push(FILES[ff] + (rr + 1)); };
  const ray = (df, dr) => { for (let k = 1; k < 8; k++) add(f + df * k, r + dr * k); };
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], LINE = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  switch (p.type) {
    case 'p': {
      const d = p.color === 'w' ? 1 : -1;
      add(f, r + d);
      if ((p.color === 'w' && r === 1) || (p.color === 'b' && r === 6)) add(f, r + 2 * d);
      add(f - 1, r + d); add(f + 1, r + d);
      break;
    }
    case 'n': for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(f + a, r + b); break;
    case 'b': DIAG.forEach(([a, b]) => ray(a, b)); break;
    case 'r': LINE.forEach(([a, b]) => ray(a, b)); break;
    case 'q': [...DIAG, ...LINE].forEach(([a, b]) => ray(a, b)); break;
    case 'k':
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) add(f + a, r + b);
      if (f === 4 && r === (p.color === 'w' ? 0 : 7)) { add(6, r); add(2, r); }
      break;
  }
  return out.filter((sq) => !(pieces[sq] && pieces[sq].color === p.color));
}

export class Board {
  constructor(el, { orientation = 'w', onMove = null, coords = true } = {}) {
    this.el = el;
    this.orientation = orientation;
    this.onMove = onMove;
    this.coords = coords;
    this.pieces = {};
    this.legal = new Map();
    this.movable = null;      // 'w' | 'b' | 'both' | null
    this.selected = null;
    this.lastMove = null;
    this.checkSq = null;
    this.arrows = [];         // стрелки программы (подсказки, лучший ход)
    this.userArrows = [];     // стрелки, нарисованные правой кнопкой
    this.userMarks = [];      // клетки, выделенные правой кнопкой
    this.badges = [];
    this.hints = [];
    this.drag = null;
    this.rdrag = null;
    this.hoverSq = null;
    this.premoveColor = null; // чьи фигуры можно двигать заранее, пока ход соперника
    this.premove = null;      // {from, to} — запланированный предход

    el.classList.add('board-wrap');
    el.innerHTML = `
      <div class="board"></div>
      <div class="fx-layer"></div>
      <svg class="arrows" viewBox="0 0 8 8" preserveAspectRatio="none">
        <defs>
          ${['green', 'red', 'blue', 'orange'].map((c) => `
          <marker id="ah-${c}-${Board.uid}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L4,2 L0,4 z" class="ah ah-${c}"/></marker>`).join('')}
        </defs>
        <g class="arrow-layer"></g>
      </svg>
      <div class="promo hidden"></div>`;
    this.uid = Board.uid++;
    this.boardEl = el.querySelector('.board');
    this.fxEl = el.querySelector('.fx-layer');
    this.arrowLayer = el.querySelector('.arrow-layer');
    this.promoEl = el.querySelector('.promo');

    const ro = new ResizeObserver(() => {
      const w = this.boardEl.getBoundingClientRect().width;
      el.style.setProperty('--sq', `${w / 8}px`);
    });
    ro.observe(this.boardEl);

    this.boardEl.addEventListener('pointerdown', (e) => this._down(e));
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    this.boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.render();
  }

  get sqSize() { return this.boardEl.getBoundingClientRect().width / 8; }

  setPosition(fen, { lastMove = null, check = null, animate = true } = {}) {
    const old = this.pieces;
    const next = parseFen(fen);
    const d = diffPositions(old, next);
    this.pieces = next;
    this.lastMove = lastMove;
    this.checkSq = check;
    this.selected = null;
    if (d.changes > 0) this.activeAnim = null; // новая позиция — старая анимация больше не нужна
    this.render();
    const hadPieces = Object.keys(old).length > 0;
    if (animate && hadPieces && d.changes > 0 && d.changes <= 8 && d.moves.length <= 3 && !document.hidden) {
      this._animate(d.moves, d.captures);
    }
  }

  // Удобный метод: взять всё из объекта chess.js
  fromChess(chess, { movable = null, lastMove, animate = true, premove = null } = {}) {
    let check = null;
    if (chess.inCheck()) {
      const turn = chess.turn();
      for (const [sq, p] of Object.entries(parseFen(chess.fen()))) if (p.type === 'k' && p.color === turn) check = sq;
    }
    const hist = chess.history({ verbose: true });
    const lm = lastMove !== undefined ? lastMove : (hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : null);
    this.legal = movable ? legalMap(chess) : new Map();
    this.movable = movable;
    this.premoveColor = movable ? null : premove;
    if (this.premove && !movable && !premove) this.premove = null; // предход больше не нужен
    this.setPosition(chess.fen(), { lastMove: lm, check, animate });
    if (this.premove && movable && movable !== 'both') {
      const pm = this.premove;
      this.premove = null;
      if ((this.legal.get(pm.from) || []).some((m) => m.to === pm.to)) {
        // ждём, пока доедет фигура соперника, и делаем запланированный ход
        setTimeout(() => { if (this.movable === movable && this.pieces[pm.from]) this._try(pm.from, pm.to, true, true); }, ANIM_MS + 20);
      } else this.render();
    }
  }

  cancelPremove() { if (this.premove) { this.premove = null; this.render(); } }

  setMovable(color, legal) { this.movable = color; this.legal = legal || new Map(); this.selected = null; this.premoveColor = null; this.premove = null; this.render(); }
  flip() { this.orientation = this.orientation === 'w' ? 'b' : 'w'; this.render(); }
  setOrientation(o) { if (o !== this.orientation) { this.orientation = o; this.render(); } }
  setArrows(a) { this.arrows = a || []; this._drawArrows(); }
  setBadges(b) { this.badges = b || []; this.render(); }
  setHints(h) { this.hints = h || []; this.render(); }
  clearUserDrawings() { if (this.userArrows.length || this.userMarks.length) { this.userArrows = []; this.userMarks = []; this.render(); } }

  _sqXY(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return this.orientation === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
  }

  _sqAt(x, y) {
    const rect = this.boardEl.getBoundingClientRect();
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.orientation === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
  }

  _canMove(color) {
    return this.movable === 'both' || this.movable === color;
  }

  _isPre(sq) {
    const p = this.pieces[sq];
    return !!p && !this._canMove(p.color) && this.premoveColor === p.color;
  }

  _targets(from) {
    return this._isPre(from) ? pseudoTargets(this.pieces, from).map((to) => ({ to })) : (this.legal.get(from) || []);
  }

  _selectable(sq) {
    const p = this.pieces[sq];
    return !!p && ((this._canMove(p.color) && this.legal.has(sq)) || this._isPre(sq));
  }

  _commit(from, to, animate) {
    if (this._isPre(from)) {
      this.premove = { from, to };
      this.selected = null;
      this.render();
      return;
    }
    this._try(from, to, animate);
  }

  render() {
    const targets = this.selected ? this._targets(this.selected) : [];
    const html = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const f = this.orientation === 'w' ? col : 7 - col;
        const r = this.orientation === 'w' ? 7 - row : row;
        const sq = FILES[f] + (r + 1);
        const dark = (f + r) % 2 === 0;
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (this.lastMove && this.lastMove.includes(sq)) cls.push('last');
        if (this.selected === sq) cls.push('sel');
        if (this.premove && (this.premove.from === sq || this.premove.to === sq)) cls.push('premove');
        if (this.checkSq === sq) cls.push('check');
        if (this.userMarks.includes(sq)) cls.push('marked');
        for (const h of this.hints) if (h.sq === sq) cls.push(h.cls);
        const target = targets.find((m) => m.to === sq);
        if (target) cls.push(this.pieces[sq] ? 'cap' : 'dot');
        const p = this.pieces[sq];
        if (this._selectable(sq)) cls.push('can');
        let inner = '';
        if (p) inner += pieceHtml(p.color, p.type, `data-sq="${sq}"`);
        if (this.coords && col === 0) inner += `<span class="co rank">${r + 1}</span>`;
        if (this.coords && row === 7) inner += `<span class="co file">${FILES[f]}</span>`;
        const badge = this.badges.find((b) => b.sq === sq);
        if (badge) inner += `<span class="badge">${badge.html}</span>`;
        html.push(`<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`);
      }
    }
    this.boardEl.innerHTML = html.join('');
    this._drawArrows();
    if (this.activeAnim) this._applyAnim(); // перерисовка не обрывает скольжение фигуры
  }

  // Плавное перемещение фигур и исчезновение взятых
  _animate(moves, captures) {
    const size = this.sqSize;
    for (const c of captures) {
      const { x, y } = this._sqXY(c.sq);
      const ghost = document.createElement('div');
      ghost.innerHTML = pieceHtml(c.p.color, c.p.type);
      const el = ghost.firstChild;
      el.classList.add('fx-piece', 'fx-capture');
      el.style.left = `${x * size}px`;
      el.style.top = `${y * size}px`;
      this.fxEl.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '0'; el.style.transform = 'scale(.6)'; });
      setTimeout(() => el.remove(), ANIM_MS + 80);
    }
    this.activeAnim = { moves, start: performance.now() };
    this._applyAnim();
  }

  _applyAnim() {
    const anim = this.activeAnim;
    const elapsed = performance.now() - anim.start;
    if (elapsed >= ANIM_MS) { this.activeAnim = null; return; }
    const size = this.sqSize;
    const p = elapsed / ANIM_MS;
    const left = Math.pow(1 - p, 3); // какая часть пути ещё не пройдена (ease-out)
    const remain = ANIM_MS - elapsed;
    for (const m of anim.moves) {
      const el = this.boardEl.querySelector(`.pc[data-sq="${m.to}"]`);
      if (!el) continue;
      const a = this._sqXY(m.from);
      const b = this._sqXY(m.to);
      el.style.transition = 'none';
      el.style.transform = `translate(${(a.x - b.x) * size * left}px, ${(a.y - b.y) * size * left}px)`;
      el.style.zIndex = '30';
      el.getBoundingClientRect();
      el.style.transition = `transform ${remain}ms cubic-bezier(.3,.65,.35,1)`;
      el.style.transform = '';
      setTimeout(() => { el.style.zIndex = ''; el.style.transition = ''; }, remain + 30);
    }
  }

  _drawArrows() {
    const all = [...this.arrows, ...this.userArrows.map((a) => ({ ...a, color: a.color || 'orange' }))];
    this.arrowLayer.innerHTML = all.map((a) => {
      const p1 = this._sqXY(a.from);
      const p2 = this._sqXY(a.to);
      const x1 = p1.x + 0.5, y1 = p1.y + 0.5;
      let x2 = p2.x + 0.5, y2 = p2.y + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = (len - 0.35) / len;
      x2 = x1 + (x2 - x1) * k; y2 = y1 + (y2 - y1) * k;
      const color = a.color || 'green';
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="arrow arrow-${color}" marker-end="url(#ah-${color}-${this.uid})"/>`;
    }).join('');
  }

  _setHover(sq) {
    if (sq === this.hoverSq) return;
    this.boardEl.querySelector('.sq.hover')?.classList.remove('hover');
    this.hoverSq = sq;
    if (sq) this.boardEl.querySelector(`.sq[data-sq="${sq}"]`)?.classList.add('hover');
  }

  _down(e) {
    const sq = this._sqAt(e.clientX, e.clientY);
    if (!sq) return;
    // правая кнопка — рисование стрелок и выделение клеток
    if (e.button === 2) { this.cancelPremove(); this.rdrag = { from: sq }; e.preventDefault(); return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.clearUserDrawings();
    if (this.selected && this._targets(this.selected).some((m) => m.to === sq)) {
      this._commit(this.selected, sq, true);
      return;
    }
    if (this._selectable(sq)) {
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.render();
      const pieceEl = this.boardEl.querySelector(`.pc[data-sq="${sq}"]`);
      const ghost = pieceEl.cloneNode(true);
      ghost.classList.add('ghost');
      this.el.appendChild(ghost);
      pieceEl.classList.add('dragging');
      this.el.classList.add('is-dragging');
      this.drag = { from: sq, ghost, pieceEl, wasSelected, x0: e.clientX, y0: e.clientY, moved: false };
      this._placeGhost(e.clientX, e.clientY);
      e.preventDefault();
    } else if (this.selected || this.premove) {
      this.selected = null;
      this.premove = null; // щелчок мимо отменяет предход
      this.render();
    }
  }

  _placeGhost(x, y) {
    const rect = this.el.getBoundingClientRect();
    const size = this.sqSize;
    this.drag.ghost.style.left = `${x - rect.left - size / 2}px`;
    this.drag.ghost.style.top = `${y - rect.top - size / 2}px`;
  }

  _move(e) {
    if (!this.drag) return;
    if (Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) > 4) this.drag.moved = true;
    this._placeGhost(e.clientX, e.clientY);
    if (this.drag.moved) this._setHover(this._sqAt(e.clientX, e.clientY));
  }

  _up(e) {
    if (this.rdrag && e.button === 2) {
      const from = this.rdrag.from;
      const to = this._sqAt(e.clientX, e.clientY);
      this.rdrag = null;
      if (!to) return;
      if (to === from) {
        const i = this.userMarks.indexOf(to);
        if (i >= 0) this.userMarks.splice(i, 1); else this.userMarks.push(to);
        this.render();
      } else {
        const i = this.userArrows.findIndex((a) => a.from === from && a.to === to);
        if (i >= 0) this.userArrows.splice(i, 1); else this.userArrows.push({ from, to, color: e.shiftKey ? 'red' : e.altKey ? 'blue' : 'orange' });
        this._drawArrows();
      }
      return;
    }
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this._setHover(null);
    this.el.classList.remove('is-dragging');
    const sq = this._sqAt(e.clientX, e.clientY);
    if (sq && sq !== d.from && this._targets(d.from).some((m) => m.to === sq)) {
      d.ghost.remove();
      if (this._isPre(d.from)) d.pieceEl.classList.remove('dragging');
      this._commit(d.from, sq, false);
      return;
    }
    if (sq === d.from && d.wasSelected && !d.moved) {
      d.ghost.remove();
      d.pieceEl.classList.remove('dragging');
      this.selected = null;
      this.render();
      return;
    }
    if (!d.moved) { d.ghost.remove(); d.pieceEl.classList.remove('dragging'); return; }
    // недопустимое поле — фигура мягко возвращается на место
    const { x, y } = this._sqXY(d.from);
    const size = this.sqSize;
    const g = d.ghost;
    g.style.transition = 'left 130ms ease-out, top 130ms ease-out, transform 130ms ease-out';
    g.style.left = `${x * size}px`;
    g.style.top = `${y * size}px`;
    g.style.transform = 'scale(1)';
    setTimeout(() => { g.remove(); d.pieceEl.classList.remove('dragging'); }, 140);
  }

  async _try(from, to, animate, fromPremove = false) {
    const opts = (this.legal.get(from) || []).filter((m) => m.to === to);
    if (!opts.length) return;
    let promotion;
    if (opts[0].promotion) {
      promotion = fromPremove ? 'q' : await this._askPromotion(this.pieces[from].color, to);
      if (!promotion) { this.selected = null; this.render(); return; }
    }
    this.selected = null;
    // Сразу показываем ход (при клике — с анимацией), владелец доски затем передаст точную позицию
    const moving = this.pieces[from];
    const captured = this.pieces[to];
    this.pieces = { ...this.pieces, [to]: promotion ? { type: promotion, color: moving.color } : moving };
    delete this.pieces[from];
    this.lastMove = [from, to];
    this.legal = new Map();
    this.render();
    if (animate) this._animate([{ from, to }], captured ? [{ sq: to, p: captured }] : []);
    else if (captured) this._animate([], [{ sq: to, p: captured }]);
    if (this.onMove) this.onMove(from, to, promotion);
  }

  _askPromotion(color, to) {
    return new Promise((resolve) => {
      const names = { q: t('piece.q'), r: t('piece.r'), b: t('piece.b'), n: t('piece.n') };
      this.promoEl.innerHTML = `<div class="promo-box"><div class="promo-title">${t('board.promotion')}</div>
        ${['q', 'r', 'b', 'n'].map((p) => `<button data-t="${p}" title="${names[p]}">${pieceHtml(color, p)}</button>`).join('')}
        <button data-t="" class="promo-cancel">✕</button></div>`;
      this.promoEl.classList.remove('hidden');
      this.promoEl.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this.promoEl.classList.add('hidden');
        resolve(b.dataset.t || null);
      };
    });
  }
}
Board.uid = 0;
