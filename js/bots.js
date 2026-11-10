// Chess bots / Шахматные боты разной силы.
// До 1250: свой «очеловеченный» выбор хода — движок смотрит неглубоко,
// выбирает среди нескольких кандидатов со случайностью и иногда «зевает».
// С 1500: встроенный ограничитель силы Stockfish (UCI_Elo).
import { Chess } from '../lib/chess.js';

export const BOTS = [
  { id: 'b350',  rating: 350,  avatar: '🐣', name: { en: 'Pawnie', ru: 'Пешкин' }, about: { en: 'Just learned how the pieces move. Blunders a lot.', ru: 'Только узнал, как ходят фигуры. Часто зевает.' }, weak: { depth: 1, mpv: 10, temp: 260, blunder: 0.32 } },
  { id: 'b500',  rating: 500,  avatar: '🐴', name: { en: 'Trotter', ru: 'Коняшка' }, about: { en: 'Loves knight jumps, but often misses threats.', ru: 'Любит прыгать конём, но не всегда видит угрозы.' }, weak: { depth: 1, mpv: 8, temp: 190, blunder: 0.22 } },
  { id: 'b700',  rating: 700,  avatar: '🐘', name: { en: 'Jumbo', ru: 'Слоник' }, about: { en: 'Knows the basics, sometimes leaves pieces hanging.', ru: 'Знает основы, иногда оставляет фигуры под боем.' }, weak: { depth: 2, mpv: 6, temp: 130, blunder: 0.14 } },
  { id: 'b1000', rating: 1000, avatar: '👵', name: { en: 'Granny Rook', ru: 'Ладья Петровна' }, about: { en: 'A seasoned amateur from the local chess club.', ru: 'Опытный любитель из шахматного клуба.' }, weak: { depth: 4, mpv: 5, temp: 80, blunder: 0.07 } },
  { id: 'b1250', rating: 1250, avatar: '🎩', name: { en: 'Gambit Gary', ru: 'Гамбитёр' }, about: { en: 'Adores gambits and attacking the king.', ru: 'Обожает гамбиты и атаку на короля.' }, weak: { depth: 6, mpv: 4, temp: 45, blunder: 0.035 } },
  { id: 'b1500', rating: 1500, avatar: '🎓', name: { en: 'Club Captain', ru: 'Разрядник' }, about: { en: 'A strong club player.', ru: 'Крепкий клубный игрок.' }, elo: 1500, movetime: 300 },
  { id: 'b1700', rating: 1700, avatar: '⚡', name: { en: 'The Tactician', ru: 'Тактик' }, about: { en: 'Sees combinations 3–4 moves deep.', ru: 'Видит комбинации на 3–4 хода вперёд.' }, elo: 1700, movetime: 400 },
  { id: 'b1800', rating: 1800, avatar: '🧱', name: { en: 'The Wall', ru: 'Позиционер' }, about: { en: 'Slowly squeezes the life out of your position.', ru: 'Медленно душит позицию.' }, elo: 1800, movetime: 500 },
  { id: 'b1900', rating: 1900, avatar: '🏅', name: { en: 'The Candidate', ru: 'Кандидат' }, about: { en: 'Almost a candidate master.', ru: 'Почти кандидат в мастера.' }, elo: 1900, movetime: 600 },
  { id: 'b2000', rating: 2000, avatar: '🥈', name: { en: 'The Expert', ru: 'КМС' }, about: { en: 'Expert level — punishes every slip.', ru: 'Кандидат в мастера спорта.' }, elo: 2000, movetime: 700 },
  { id: 'b2250', rating: 2250, avatar: '🥇', name: { en: 'FIDE Master', ru: 'Мастер' }, about: { en: 'A FIDE Master. Rarely makes mistakes.', ru: 'Мастер ФИДЕ. Ошибается редко.' }, elo: 2250, movetime: 800 },
  { id: 'b2500', rating: 2500, avatar: '👑', name: { en: 'Grandmaster', ru: 'Гроссмейстер' }, about: { en: 'A true grandmaster.', ru: 'Настоящий гроссмейстер.' }, elo: 2500, movetime: 1000 },
  { id: 'b2700', rating: 2700, avatar: '💀', name: { en: 'The Dark King', ru: 'Тёмный Король' }, about: { en: 'The final boss. World elite. Beat him and you are a legend.', ru: 'Главный босс. Элита мировых шахмат. Победите его — и вы легенда.' }, elo: 2700, movetime: 1500, boss: true },
  { id: 'cat', rating: 3200, avatar: '🐱', img: 'img/my-cat.jpg', name: { en: 'My Cat', ru: 'Мой кот', uk: 'Мій кіт', es: 'Mi gato', de: 'Meine Katze', fr: 'Mon chat', pt: 'Meu gato', tr: 'Kedim' }, about: { en: 'just my cat', ru: 'просто мой кот', uk: 'просто мій кіт', es: 'solo mi gato', de: 'einfach meine Katze', fr: 'juste mon chat', pt: 'só o meu gato', tr: 'sadece kedim' }, full: true, movetime: 3000, boss: true },
];

// Аватар бота: фото, если есть, иначе эмодзи
export function botAvatar(b, cls = '') {
  return b.img ? `<img class="bot-photo ${cls}" src="${b.img}" alt="">` : b.avatar;
}

function scoreFor(line) {
  if (line.score.mate !== undefined) return line.score.mate > 0 ? 100000 - line.score.mate * 100 : -100000 - line.score.mate * 100;
  return line.score.cp;
}

export async function botMove(bot, fen, engine) {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;
  const started = Date.now();
  let uci;

  if (bot.weak) {
    const w = bot.weak;
    if (Math.random() < w.blunder) {
      // «Зевок»: случайный ход, но взятия и шахи выбираем чуть охотнее — как человек
      const weights = legal.map((m) => 1 + (m.captured ? 2 : 0) + (m.san.includes('+') ? 1 : 0));
      uci = pick(legal, weights).lan;
    } else {
      const res = await engine.analyse(fen, { depth: w.depth, multipv: Math.min(w.mpv, legal.length) });
      const lines = res.lines.filter((l) => l.pv.length);
      if (!lines.length) uci = res.bestmove;
      else {
        const best = scoreFor(lines[0]);
        // Мат в 1 видят все боты, кроме самого слабого
        if (lines[0].score.mate === 1 && bot.rating > 350) uci = lines[0].pv[0];
        else {
          const weights = lines.map((l) => Math.exp((scoreFor(l) - best) / w.temp));
          uci = pick(lines, weights).pv[0];
        }
      }
    }
  } else if (bot.full) {
    // Полная сила Stockfish: без ограничителя, максимальный уровень, больше времени на ход
    const res = await engine.analyse(fen, { movetime: bot.movetime, options: { UCI_LimitStrength: 'false', 'Skill Level': 20 } });
    uci = res.bestmove;
  } else {
    const options = { UCI_LimitStrength: 'true', UCI_Elo: Math.max(1320, Math.min(3190, bot.elo)), 'Skill Level': 20 };
    const res = await engine.analyse(fen, { movetime: bot.movetime, options });
    uci = res.bestmove;
  }

  // Небольшая пауза, чтобы бот не отвечал мгновенно
  const minThink = 350 + Math.random() * 500;
  const wait = minThink - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return uci;
}

function pick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
