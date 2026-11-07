import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

export const auth = {
  token: store.get('token'),
  user: null,
  listeners: new Set(),
  set(token, user) {
    this.token = token; this.user = user;
    if (token) store.set('token', token); else store.del('token');
    for (const l of this.listeners) l(user);
  },
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? t('err.' + data.error) : t('err.http', { code: res.status }));
  return data;
}

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

export function formatClock(ms) {
  ms = Math.max(0, ms);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (ms < 10000) return `${m}:${String(s).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const CATS = ['bullet', 'blitz', 'rapid', 'classical'];
export const catName = (c) => t('cat.' + c);
export const CAT_ICONS = { bullet: '🔫', blitz: '⚡', rapid: '🐇', classical: '🐢' };

export function ratingStr(r) {
  return `${r.rating}${r.provisional ? '?' : ''}`;
}

// Список ходов. marks — массив классификаций из анализа (необязательно)
export function moveListHtml(sans, current, marks = null) {
  let html = '';
  for (let i = 0; i < sans.length; i += 2) {
    html += `<div class="mrow"><span class="mnum">${i / 2 + 1}.</span>`;
    for (const j of [i, i + 1]) {
      if (j >= sans.length) { html += '<span class="mv empty"></span>'; continue; }
      const m = marks && marks[j];
      const sym = m && (m.mark.sym || m.kind === 'book') ? m.mark.icon(17) : '';
      html += `<span class="mv ${j === current ? 'cur' : ''} ${m ? m.mark.cls : ''}" data-ply="${j}">${esc(sans[j])}${sym}</span>`;
    }
    html += '</div>';
  }
  return html;
}

export function resultText(result, reason) {
  const r = t(result === '1-0' ? 'result.white' : result === '0-1' ? 'result.black' : result === 'aborted' ? 'result.aborted' : 'result.draw');
  return reason ? `${r} — ${t('reason.' + reason)}` : r;
}

export function checkSquare(chess) {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
  return null;
}

export function playSound(kind) {
  if (!store.get('sound', true)) return;
  try {
    const ctx = playSound.ctx || (playSound.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = kind === 'capture' ? 330 : kind === 'end' ? 520 : 440;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'end' ? 0.5 : 0.09));
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch { /* без звука */ }
}
