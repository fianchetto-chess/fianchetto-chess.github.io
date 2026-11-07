import { t } from './i18n.js';

// Интерактивная шахматная доска: перетаскивание и клики, подсветка ходов,
// стрелки, значки оценок (!!, ?? …) на клетках, выбор фигуры при превращении.

// Фигуры cburnett (GPL, как на lichess) — файлы в /pieces
export const pieceHtml = (color, type, attrs = '') => `<div class="pc ${color}" ${attrs} style="background-image:url(pieces/${color}${type.toUpperCase()}.svg)"></div>`;
const FILES = 'abcdefgh';

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
    this.arrows = [];
    this.badges = [];         // [{sq, text, cls}]
    this.hints = [];          // подсвеченные клетки [{sq, cls}]
    this.drag = null;

    el.classList.add('board-wrap');
    el.innerHTML = `
      <div class="board"></div>
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
    this.arrowLayer = el.querySelector('.arrow-layer');
    this.promoEl = el.querySelector('.promo');

    const ro = new ResizeObserver(() => {
      const w = this.boardEl.getBoundingClientRect().width;
      el.style.setProperty('--sq', `${w / 8}px`);
    });
    ro.observe(this.boardEl);

    this.boardEl.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    this.boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
    this.render();
  }

  setPosition(fen, { lastMove = null, check = null } = {}) {
    this.pieces = parseFen(fen);
    this.lastMove = lastMove;
    this.checkSq = check;
    this.selected = null;
    this.render();
  }

  // Удобный метод: взять всё из объекта chess.js
  fromChess(chess, { movable = null, lastMove } = {}) {
    let check = null;
    if (chess.inCheck()) {
      const turn = chess.turn();
      for (const [sq, p] of Object.entries(parseFen(chess.fen()))) if (p.type === 'k' && p.color === turn) check = sq;
    }
    const hist = chess.history({ verbose: true });
    const lm = lastMove !== undefined ? lastMove : (hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : null);
    this.legal = movable ? legalMap(chess) : new Map();
    this.movable = movable;
    this.setPosition(chess.fen(), { lastMove: lm, check });
  }

  setMovable(color, legal) { this.movable = color; this.legal = legal || new Map(); this.selected = null; this.render(); }
  flip() { this.orientation = this.orientation === 'w' ? 'b' : 'w'; this.render(); }
  setOrientation(o) { this.orientation = o; this.render(); }
  setArrows(a) { this.arrows = a || []; this._drawArrows(); }
  setBadges(b) { this.badges = b || []; this.render(); }
  setHints(h) { this.hints = h || []; this.render(); }

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

  render() {
    const targets = this.selected ? (this.legal.get(this.selected) || []) : [];
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
        if (this.checkSq === sq) cls.push('check');
        for (const h of this.hints) if (h.sq === sq) cls.push(h.cls);
        const target = targets.find((m) => m.to === sq);
        if (target) cls.push(this.pieces[sq] ? 'cap' : 'dot');
        const p = this.pieces[sq];
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
  }

  _drawArrows() {
    this.arrowLayer.innerHTML = this.arrows.map((a) => {
      const p1 = this._sqXY(a.from);
      const p2 = this._sqXY(a.to);
      const x1 = p1.x + 0.5, y1 = p1.y + 0.5;
      let x2 = p2.x + 0.5, y2 = p2.y + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = (len - 0.35) / len; // не доходим до центра — место под наконечник
      x2 = x1 + (x2 - x1) * k; y2 = y1 + (y2 - y1) * k;
      const color = a.color || 'green';
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="arrow arrow-${color}" marker-end="url(#ah-${color}-${this.uid})"/>`;
    }).join('');
  }

  _down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const sq = this._sqAt(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && (this.legal.get(this.selected) || []).some((m) => m.to === sq)) {
      this._try(this.selected, sq);
      return;
    }
    const p = this.pieces[sq];
    if (p && this._canMove(p.color) && this.legal.has(sq)) {
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.render();
      const pieceEl = this.boardEl.querySelector(`.pc[data-sq="${sq}"]`);
      const ghost = pieceEl.cloneNode(true);
      ghost.classList.add('ghost');
      this.el.appendChild(ghost);
      pieceEl.classList.add('dragging');
      this.drag = { from: sq, ghost, pieceEl, wasSelected, x0: e.clientX, y0: e.clientY, moved: false };
      this._placeGhost(e.clientX, e.clientY);
      e.preventDefault();
    } else if (this.selected) {
      this.selected = null;
      this.render();
    }
  }

  _placeGhost(x, y) {
    const rect = this.el.getBoundingClientRect();
    const size = this.boardEl.getBoundingClientRect().width / 8;
    this.drag.ghost.style.left = `${x - rect.left - size / 2}px`;
    this.drag.ghost.style.top = `${y - rect.top - size / 2}px`;
  }

  _move(e) {
    if (!this.drag) return;
    if (Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) > 4) this.drag.moved = true;
    this._placeGhost(e.clientX, e.clientY);
  }

  _up(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    d.ghost.remove();
    d.pieceEl.classList.remove('dragging');
    const sq = this._sqAt(e.clientX, e.clientY);
    if (sq && sq !== d.from && (this.legal.get(d.from) || []).some((m) => m.to === sq)) {
      this._try(d.from, sq);
    } else if (sq === d.from && d.wasSelected && !d.moved) {
      this.selected = null;
      this.render();
    }
  }

  async _try(from, to) {
    const opts = (this.legal.get(from) || []).filter((m) => m.to === to);
    if (!opts.length) return;
    let promotion;
    if (opts[0].promotion) {
      promotion = await this._askPromotion(this.pieces[from].color, to);
      if (!promotion) { this.selected = null; this.render(); return; }
    }
    this.selected = null;
    // Сразу показываем ход, владелец доски затем передаст точную позицию
    this.pieces[to] = promotion ? { type: promotion, color: this.pieces[from].color } : this.pieces[from];
    delete this.pieces[from];
    this.lastMove = [from, to];
    this.legal = new Map();
    this.render();
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
