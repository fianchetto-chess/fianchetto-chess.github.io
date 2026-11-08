// Переводы интерфейса. Язык по умолчанию — английский, меняется в настройках.
import en from './locales/en.js';

export const LANGS = [
  ['en', 'English'], ['ru', 'Русский'], ['es', 'Español'], ['de', 'Deutsch'],
  ['fr', 'Français'], ['pt', 'Português'], ['uk', 'Українська'], ['tr', 'Türkçe'],
];
// Языки, на которые переведены и длинные тексты уроков; остальные показывают их по-английски
export const FULL_CONTENT_LANGS = ['en', 'ru'];

let lang = 'en';
let dict = en;

function saved() { try { return JSON.parse(localStorage.getItem('lang')); } catch { return null; } }

export async function initI18n() {
  // язык из адреса (?lang=ru) — для ссылок со страниц для поисковиков
  const q = new URLSearchParams(location.search).get('lang');
  if (q && LANGS.some(([c]) => c === q)) { try { localStorage.setItem('lang', JSON.stringify(q)); } catch { /* */ } }
  const l = saved();
  lang = LANGS.some(([c]) => c === l) ? l : 'en';
  if (lang !== 'en') {
    try { dict = (await import(`./locales/${lang}.js`)).default; } catch { lang = 'en'; dict = en; }
  }
  document.documentElement.lang = lang;
}

export function setLang(l) {
  try { localStorage.setItem('lang', JSON.stringify(l)); } catch { /* */ }
  location.reload();
}

export const getLang = () => lang;

// t('key', {n: 5}) → строка с подстановкой {n}. Значение может быть функцией (для падежей и чисел).
export function t(key, params = {}) {
  const v = dict[key] ?? en[key];
  if (v === undefined) return key;
  if (typeof v === 'function') return v(params);
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
}

// Текст контента вида {en: '...', ru: '...'}
export function tx(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? obj.en;
}

// Русские окончания: plural(5, ['ход', 'хода', 'ходов'])
export function ruPlural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
