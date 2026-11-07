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

// Звуки ходов: короткий «деревянный» стук, синтезируется на лету (без звуковых файлов)
let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function knock(ac, when, { freq = 1700, q = 1.1, gain = 0.55, len = 0.07, body = 140, bodyGain = 0.35 } = {}) {
  const n = Math.floor(ac.sampleRate * len);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + len);
  src.connect(bp); bp.connect(g); g.connect(ac.destination);
  src.start(when);
  const o = ac.createOscillator();
  const og = ac.createGain();
  o.frequency.setValueAtTime(body, when);
  o.frequency.exponentialRampToValueAtTime(body * 0.6, when + 0.06);
  og.gain.setValueAtTime(bodyGain, when);
  og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
  o.connect(og); og.connect(ac.destination);
  o.start(when); o.stop(when + 0.08);
}
function tone(ac, when, freq, len, gain = 0.12) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + len);
  o.connect(g); g.connect(ac.destination);
  o.start(when); o.stop(when + len + 0.02);
}

export function playSound(kind) {
  if (!store.get('sound', true)) return;
  try {
    const ac = ctx();
    const now = ac.currentTime + 0.01;
    switch (kind) {
      case 'capture': knock(ac, now, { freq: 1100, gain: 0.8, body: 110, bodyGain: 0.5, len: 0.09 }); knock(ac, now + 0.035, { freq: 2200, gain: 0.3, len: 0.05 }); break;
      case 'castle': knock(ac, now); knock(ac, now + 0.09, { freq: 1500 }); break;
      case 'check': knock(ac, now, { freq: 1900, gain: 0.6 }); tone(ac, now + 0.02, 880, 0.18, 0.08); break;
      case 'promote': knock(ac, now); tone(ac, now + 0.03, 1046, 0.25, 0.07); break;
      case 'end': tone(ac, now, 523, 0.5, 0.1); tone(ac, now + 0.12, 784, 0.7, 0.1); break;
      case 'wrong': tone(ac, now, 180, 0.18, 0.12); break;
      default: knock(ac, now);
    }
  } catch { /* без звука */ }
}

// Подходящий звук для хода chess.js
export function moveSound(mv) {
  if (!mv) return;
  if (mv.san && mv.san.includes('#')) return playSound('check');
  if (mv.san && mv.san.includes('+')) return playSound('check');
  if (mv.flags && (mv.flags.includes('k') || mv.flags.includes('q'))) return playSound('castle');
  if (mv.promotion) return playSound('promote');
  if (mv.captured) return playSound('capture');
  return playSound('move');
}
