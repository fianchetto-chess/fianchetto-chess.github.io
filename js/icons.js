// Значки оценок ходов (собственный рисунок, SVG): цветной круг с белым символом.

export const MARK_COLORS = {
  brilliant: '#26c2a3',
  great: '#749bbf',
  best: '#81b64c',
  excellent: '#81b64c',
  good: '#95b776',
  book: '#a88865',
  interesting: '#c78cd9',
  inaccuracy: '#f7c631',
  mistake: '#ffa459',
  blunder: '#fa412d',
};

const excl = (x) => `<rect x="${x - 1.55}" y="4.6" width="3.1" height="10.2" rx="1.55"/><circle cx="${x}" cy="18.3" r="1.75"/>`;
const quest = (x) => `<path d="M${x - 3.3} 8.4c0-2.2 1.5-3.6 3.4-3.6s3.4 1.3 3.4 3.3c0 2.6-3.4 2.9-3.4 5.6" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${x + 0.1}" cy="18.3" r="1.75"/>`;

const GLYPHS = {
  brilliant: excl(9.2) + excl(14.8),
  great: excl(12),
  interesting: excl(8.6) + quest(15.4),
  inaccuracy: quest(8.8) + excl(15.6),
  mistake: quest(11.9),
  blunder: quest(8.4) + quest(15.6),
  best: '<path d="M12 4.2l2.35 4.9 5.35.72-3.9 3.72.95 5.32L12 16.3l-4.75 2.56.95-5.32-3.9-3.72 5.35-.72z"/>',
  excellent: '<path d="M6.3 11.1h2.5v7.6H6.3zM10.1 18.7V11l3.1-5.6c.3-.6 1.1-.7 1.6-.3.5.4.6 1 .4 1.6L14.1 10h3.9c1 0 1.7.9 1.5 1.9l-1.2 5.4c-.2.8-.9 1.4-1.7 1.4z"/>',
  good: '<path d="M6.6 12.4l3.6 3.6 7.3-7.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  book: '<path d="M5.5 7.2c2.3-.6 4.5-.3 6 .9v10.4c-1.5-1.1-3.7-1.4-6-.8zM18.5 7.2c-2.3-.6-4.5-.3-6 .9v10.4c1.5-1.1 3.7-1.4 6-.8z"/>',
};

export function markIcon(kind, size = 22) {
  const color = MARK_COLORS[kind];
  if (!color) return '';
  return `<svg class="mark-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12.6" r="11.2" fill="rgba(0,0,0,.28)"/>
    <circle cx="12" cy="12" r="11.2" fill="${color}"/>
    <g fill="#fff">${GLYPHS[kind]}</g></svg>`;
}
