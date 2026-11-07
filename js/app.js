import { $, store } from './ui.js';
import { t, initI18n, setLang, getLang, LANGS, FULL_CONTENT_LANGS } from './i18n.js';
import { renderLearn, renderLesson, renderOpening } from './learn.js';
import { renderBots, renderBotGame } from './botplay.js';
import { renderAnalysis } from './analysis-view.js';
import { renderTraining, renderPuzzle, renderEnPassant, renderCastling, renderEndgame } from './training.js';
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
    </div>`;
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
    </div>`;
  root.querySelector('#lang').onchange = (e) => setLang(e.target.value);
  root.querySelectorAll('.theme-btn').forEach((b) => b.onclick = () => {
    store.set('theme', b.dataset.theme);
    applyTheme();
    root.querySelectorAll('.theme-btn').forEach((x) => x.classList.toggle('active', x === b));
  });
  root.querySelector('#sound').onchange = (e) => store.set('sound', e.target.checked);
}

function renderHeader() {
  $('.logo').innerHTML = `<img src="pieces/wB.svg" alt="">${SITE_NAME}`;
  $('nav').innerHTML = [['learn', 'nav.learn'], ['train', 'nav.train'], ['bots', 'nav.bots'], ['analysis', 'nav.analysis']]
    .map(([h, k]) => `<a href="#/${h}">${t(k)}</a>`).join('');
}

function updateHeader() {
  $('#userbox').innerHTML = `<a class="btn small icon" href="#/settings" title="${t('settings.title')}">⚙ ${t('settings.title')}</a>`;
}

function route() {
  if (app._cleanup) { app._cleanup(); app._cleanup = null; }
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${parts[0]}`));
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case 'learn':
      if (parts[1] === 'lesson') renderLesson(app, parts[2]);
      else if (parts[1] === 'opening') renderOpening(app, parts[2]);
      else renderLearn(app);
      break;
    case 'train':
      if (parts[1] === 'end') renderEndgame(app, parts[2]);
      else if (parts[1] === 'mate1' || parts[1] === 'promo') renderPuzzle(app, parts[1]);
      else if (parts[1] === 'ep') renderEnPassant(app);
      else if (parts[1] === 'castle') renderCastling(app);
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
  applyTheme();
  document.title = `${SITE_NAME} — ${t('home.tagline')}`;
  renderHeader();
  window.addEventListener('hashchange', route);
  updateHeader();
  route();
})();
