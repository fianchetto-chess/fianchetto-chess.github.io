import { $, store, toast } from './ui.js';
import { t, initI18n, setLang, getLang, LANGS, FULL_CONTENT_LANGS } from './i18n.js';
import { renderLearn, renderLesson, renderOpening } from './learn.js';
import { renderBots, renderBotGame } from './botplay.js';
import { renderAnalysis } from './analysis-view.js';
import { renderTraining, renderPuzzleTrack, renderEnPassant, renderCastling, renderEndgame, loadData, dailyPuzzles, dailyProgress, DAILY_N } from './training.js';
import { staticBoardHtml } from './board.js';
import { METRIKA_ID } from './config.js';
import { BOTS } from './bots.js';

export const SITE_NAME = 'Fianchetto';
const app = $('#app');

const THEMES = { brown: ['#f0d9b5', '#b58863'], green: ['#eeeed2', '#769656'], blue: ['#dee3e6', '#8ca2ad'], purple: ['#e8e0f0', '#9a7fb8'], gray: ['#e0e0e0', '#9e9e9e'] };
function applyTheme() {
  const [l, d] = THEMES[store.get('theme', 'brown')] || THEMES.brown;
  document.documentElement.style.setProperty('--light', l);
  document.documentElement.style.setProperty('--dark', d);
}

function renderHome(root) {
  root.innerHTML = `
    <section class="hero">
      <div>
        <h1>${SITE_NAME}</h1>
        <p class="tagline">${t('home.tagline')}</p>
        <p class="lead">${t('home.lead')}</p>
        <div class="btn-row">
          <a class="btn primary big" href="#/bots">⚔ ${t('home.playBots')}</a>
          <a class="btn big" href="#/learn">📚 ${t('home.startLearning')}</a>
        </div>
      </div>
      <div class="hero-pieces" aria-hidden="true">
        ${['wK', 'bQ', 'wN', 'bB', 'wR', 'bP'].map((p) => `<img src="pieces/${p}.svg" alt="">`).join('')}
      </div>
    </section>
    <div class="cards features">
      <a class="card" href="#/learn"><div class="card-title">📚 ${t('nav.learn')}</div><div class="card-sub">${t('home.f.learn')}</div></a>
      <a class="card" href="#/train"><div class="card-title">🎯 ${t('nav.train')}</div><div class="card-sub">${t('home.f.train')}</div></a>
      <a class="card" href="#/bots"><div class="card-title">🤖 ${t('nav.bots')}</div><div class="card-sub">${t('home.f.bots', { n: BOTS.length, min: BOTS[0].rating, max: BOTS.at(-1).rating })}</div></a>
      <a class="card" href="#/analysis"><div class="card-title">🔍 ${t('nav.analysis')}</div><div class="card-sub">${t('home.f.analysis')}</div></a>
    </div>
    <section class="panel home-daily" id="homeDaily"></section>`;
  loadData().then((data) => {
    const box = root.querySelector('#homeDaily');
    if (!box) return;
    const dp = dailyProgress();
    const pz = dailyPuzzles(data)[Math.min(dp, DAILY_N - 1)];
    const color = pz.f.split(' ')[1];
    box.innerHTML = `
      <a class="hd-board" href="#/train/p/daily">${staticBoardHtml(pz.f, color)}</a>
      <div class="hd-text">
        <h2>📅 ${t('daily.title')}</h2>
        <p>${t(color === 'w' ? 'tr.whiteToMove' : 'tr.blackToMove')} ${pz.n ? t('tr.mateTask', { n: pz.n }) : t('tr.tacticTask')}</p>
        <p class="hd-stats">${t('daily.lead', { total: DAILY_N })} ${t('daily.progress', { n: dp, total: DAILY_N })}</p>
        <a class="btn primary big" href="#/train/p/daily">${dp >= DAILY_N ? '✓ ' + t('daily.doneToday') : t('daily.cta')}</a>
      </div>`;
  });
}

// Яндекс Метрика — включается, когда в js/config.js указан номер счётчика
function loadMetrika() {
  if (!METRIKA_ID) return;
  (function (m, e, t, r, i, k, a) { m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date(); k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a); })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
  window.ym(METRIKA_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, trackHash: true });
}

function renderSettings(root) {
  const lang = getLang();
  const theme = store.get('theme', 'brown');
  const sound = store.get('sound', true);
  root.innerHTML = `
    <h1>⚙ ${t('settings.title')}</h1>
    <div class="panel settings">
      <label class="set-row"><span>🌐 ${t('settings.language')}</span>
        <select id="lang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      ${FULL_CONTENT_LANGS.includes(lang) ? '' : `<p class="muted">${t('settings.contentNote')}</p>`}
      <div class="set-row"><span>♟ ${t('settings.board')}</span>
        <div class="themes">${Object.entries(THEMES).map(([k, [l, d]]) => `
          <button class="theme-btn ${k === theme ? 'active' : ''}" data-theme="${k}" title="${k}">
            <span style="background:${l}"></span><span style="background:${d}"></span><span style="background:${d}"></span><span style="background:${l}"></span>
          </button>`).join('')}</div>
      </div>
      <label class="set-row"><span>🔊 ${t('settings.sound')}</span><input type="checkbox" id="sound" ${sound ? 'checked' : ''}></label>
    </div>
    <h2>📱 ${t('app.title')}</h2>
    <div class="panel settings app-box">
      <p>${t('app.lead')}</p>
      ${appSettingsHtml()}
    </div>
    <p class="muted settings-foot"><a href="privacy.html">${t('app.privacy')}</a> · Fianchetto</p>`;
  const ib = root.querySelector('#installApp');
  if (ib) ib.onclick = installApp;
  root.querySelector('#lang').onchange = (e) => setLang(e.target.value);
  root.querySelectorAll('.theme-btn').forEach((b) => b.onclick = () => {
    store.set('theme', b.dataset.theme);
    applyTheme();
    root.querySelectorAll('.theme-btn').forEach((x) => x.classList.toggle('active', x === b));
  });
  root.querySelector('#sound').onchange = (e) => store.set('sound', e.target.checked);
}

// ---------- приложение (PWA) ----------
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Вид «как приложение»: при запуске с иконки, из Google Play или с ?app=1 (для проверки)
const APP_MODE = (() => {
  const q = new URLSearchParams(location.search);
  if (q.get('app') === '0') { try { sessionStorage.removeItem('appMode'); } catch { /* */ } return false; }
  let on = isStandalone() || q.get('source') === 'app' || q.get('app') === '1';
  try { if (on) sessionStorage.setItem('appMode', '1'); else on = sessionStorage.getItem('appMode') === '1'; } catch { /* */ }
  return on;
})();
if (APP_MODE) document.documentElement.classList.add('app');

// значки нижней панели (рисуются цветом текста)
const TAB_ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h4.5v-6h4v6h4.5V10"/>',
  learn: '<path d="M4 5.5C6.5 4.3 9.5 4.3 12 6c2.5-1.7 5.5-1.7 8-.5v13c-2.5-1.2-5.5-1.2-8 .5-2.5-1.7-5.5-1.7-8-.5z"/><path d="M12 6v13"/>',
  train: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  bots: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V4.5"/><circle cx="12" cy="4" r="1" fill="currentColor"/><circle cx="9" cy="13" r="1.3" fill="currentColor"/><circle cx="15" cy="13" r="1.3" fill="currentColor"/><path d="M9.5 16.5h5"/>',
  analysis: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
};
const TABS = [['home', 'nav.home'], ['learn', 'nav.learn'], ['train', 'nav.train'], ['bots', 'nav.bots'], ['analysis', 'nav.analysis']];
function renderTabbar() {
  if (!APP_MODE) return;
  let bar = $('.tabbar');
  if (!bar) { bar = document.createElement('nav'); bar.className = 'tabbar'; document.body.appendChild(bar); }
  bar.innerHTML = TABS.map(([id, k]) => `<a href="#/${id === 'home' ? '' : id}" data-tab="${id}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[id]}</svg><span>${t(k)}</span></a>`).join('');
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function setupApp() {
  if ('serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('sw.js').catch(() => { /* без офлайна */ });
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // показываем свою кнопку вместо системной плашки
    installPrompt = e;
    updateHeader();
    if (location.hash === '#/settings') renderSettings(app);
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateHeader();
    toast(t('app.installed'));
  });
}
async function installApp() {
  if (!installPrompt) { location.hash = '#/settings'; return; }
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  updateHeader();
}
function appSettingsHtml() {
  if (isStandalone()) return `<p>✅ ${t('app.installed')}</p>`;
  if (installPrompt) return `<button class="btn primary" id="installApp">📲 ${t('app.install')}</button>`;
  return `<p class="muted">${isIOS() ? t('app.hintIOS') : t('app.hintOther')}</p>`;
}

function renderHeader() {
  $('.logo').innerHTML = `<img src="pieces/wB.svg" alt="">${SITE_NAME}`;
  renderTabbar();
  $('.topbar nav').innerHTML = [['learn', 'nav.learn'], ['train', 'nav.train'], ['bots', 'nav.bots'], ['analysis', 'nav.analysis']]
    .map(([h, k]) => `<a href="#/${h}">${t(k)}</a>`).join('');
}

function updateHeader() {
  const inst = installPrompt && !isStandalone() && !APP_MODE ? `<button class="btn small primary" id="installBtn">📲 ${t('app.installShort')}</button> ` : '';
  $('#userbox').innerHTML = `${inst}<a class="btn small icon" href="#/settings" title="${t('settings.title')}">⚙<span class="lbl"> ${t('settings.title')}</span></a>`;
  const b = $('#installBtn');
  if (b) b.onclick = installApp;
}

function route() {
  if (app._cleanup) { app._cleanup(); app._cleanup = null; }
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);
  document.querySelectorAll('.topbar nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${parts[0]}`));
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === parts[0]));
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case 'learn':
      if (parts[1] === 'lesson') renderLesson(app, parts[2]);
      else if (parts[1] === 'opening') renderOpening(app, parts[2]);
      else renderLearn(app);
      break;
    case 'train':
      if (parts[1] === 'end') renderEndgame(app, parts[2], parts[3]);
      else if (parts[1] === 'p') renderPuzzleTrack(app, parts[2], parts[3]);
      else if (parts[1] === 'mate1' || parts[1] === 'promo') renderPuzzleTrack(app, parts[1], parts[2]);
      else if (parts[1] === 'ep') renderEnPassant(app, parts[2]);
      else if (parts[1] === 'castle') renderCastling(app, parts[2]);
      else renderTraining(app);
      break;
    case 'bots': parts[1] ? renderBotGame(app, parts[1], parts[2]) : renderBots(app); break;
    case 'analysis': renderAnalysis(app); break;
    case 'settings': renderSettings(app); break;
    default: renderHome(app);
  }
}

(async () => {
  await initI18n();
  loadMetrika();
  setupApp();
  applyTheme();
  document.title = `${SITE_NAME} — ${t('home.tagline')}`;
  renderHeader();
  window.addEventListener('hashchange', route);
  updateHeader();
  route();
})();
