import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { BOTS, botMove } from './bots.js';
import { getEngine } from './engine.js';
import { esc, store, moveListHtml, resultText, playSound, toast } from './ui.js';
import { openAnalysis } from './analysis-view.js';
import { t, tx } from './i18n.js';

export function renderBots(root) {
  const beaten = store.get('beaten', {});
  root.innerHTML = `
    <h1>${t('bots.title')}</h1>
    <p class="lead">${t('bots.lead', { n: BOTS.length })}</p>
    <div class="cards bots">${BOTS.map((b) => `
      <div class="card bot-card ${b.boss ? 'boss' : ''}" data-id="${b.id}">
        <div class="bot-avatar">${b.avatar}</div>
        <div class="card-title">${esc(tx(b.name))} ${beaten[b.id] ? '🏆' : ''}</div>
        <div class="bot-rating">${b.rating}</div>
        <div class="card-sub">${esc(tx(b.about))}</div>
        <div class="btn-row">
          <button class="btn small" data-c="w">${t('bots.asWhite')}</button>
          <button class="btn small" data-c="r">${t('bots.random')}</button>
          <button class="btn small" data-c="b">${t('bots.asBlack')}</button>
        </div>
      </div>`).join('')}</div>`;
  root.querySelectorAll('.bot-card button').forEach((btn) => btn.onclick = () => {
    const id = btn.closest('.bot-card').dataset.id;
    let c = btn.dataset.c;
    if (c === 'r') c = Math.random() < 0.5 ? 'w' : 'b';
    location.hash = `#/bots/${id}/${c}`;
  });
}

export function renderBotGame(root, id, color) {
  const bot = BOTS.find((b) => b.id === id);
  if (!bot) { location.hash = '#/bots'; return; }
  const me = color === 'b' ? 'b' : 'w';
  const engine = getEngine();
  const botName = tx(bot.name);
  root.innerHTML = `
    <a href="#/bots" class="back">← ${t('bots.all')}</a>
    <div class="game-layout">
      <div class="board-col">
        <div class="player top"><span class="pname">${bot.avatar} ${esc(botName)} <span class="prating">(${bot.rating})</span></span><span class="thinking hidden">${t('bots.thinkingShort')}</span></div>
        <div id="bboard"></div>
        <div class="player bottom"><span class="pname">${t('common.you')}</span></div>
      </div>
      <div class="side-col panel">
        <div class="status"></div>
        <div class="moves" id="bmoves"></div>
        <div class="btn-row">
          <button class="btn" id="undo">↶ ${t('common.takeback')}</button>
          <button class="btn" id="flip">⇅ ${t('common.flip')}</button>
          <button class="btn danger" id="resign">🏳 ${t('common.resign')}</button>
        </div>
        <div class="end-box hidden"></div>
        <div class="loading-note">${t('bots.engineLoading')}</div>
      </div>
    </div>`;
  const chess = new Chess();
  const board = new Board(root.querySelector('#bboard'), { orientation: me });
  const status = root.querySelector('.status');
  const thinking = root.querySelector('.thinking');
  const endBox = root.querySelector('.end-box');
  let over = false;
  let thinkingNow = false;
  let token = 0; // отменяет ответ бота после «хода назад»

  engine.ready.then(() => root.querySelector('.loading-note')?.remove());
  engine.newGame();

  function redraw() {
    const canMove = !over && !thinkingNow && chess.turn() === me;
    board.fromChess(chess, { movable: canMove ? me : null });
    const sans = chess.history();
    const box = root.querySelector('#bmoves');
    box.innerHTML = moveListHtml(sans, sans.length - 1);
    box.scrollTop = box.scrollHeight;
    if (!over) status.textContent = chess.turn() === me ? t('common.yourMove') : t('bots.thinking', { name: botName });
  }

  function finish(result, reason) {
    over = true;
    const won = (result === '1-0' && me === 'w') || (result === '0-1' && me === 'b');
    if (won) { const b = store.get('beaten', {}); b[bot.id] = true; store.set('beaten', b); }
    playSound('end');
    status.textContent = resultText(result, reason);
    endBox.classList.remove('hidden');
    endBox.innerHTML = `
      <div class="end-title">${won ? (bot.boss ? `👑 ${t('bots.bossBeaten')}` : `🎉 ${t('end.win')}`) : result === '1/2-1/2' ? `🤝 ${t('end.draw')}` : `😔 ${t('end.loss')}`}</div>
      <div>${esc(resultText(result, reason))}</div>
      <div class="btn-row">
        <button class="btn primary" id="analyse">🔍 ${t('common.analyseGame')}</button>
        <button class="btn" id="again">↻ ${t('bots.again')}</button>
      </div>`;
    endBox.querySelector('#analyse').onclick = () => openAnalysis({
      moves: chess.history(), white: me === 'w' ? t('common.you') : `${botName} (${bot.rating})`,
      black: me === 'b' ? t('common.you') : `${botName} (${bot.rating})`, result, orientation: me,
    });
    endBox.querySelector('#again').onclick = () => { location.hash = `#/bots/${bot.id}/${me === 'w' ? 'b' : 'w'}`; };
    redraw();
  }

  function checkEnd() {
    if (chess.isCheckmate()) { finish(chess.turn() === 'w' ? '0-1' : '1-0', 'checkmate'); return true; }
    if (chess.isStalemate()) { finish('1/2-1/2', 'stalemate'); return true; }
    if (chess.isInsufficientMaterial()) { finish('1/2-1/2', 'insufficient'); return true; }
    if (chess.isThreefoldRepetition()) { finish('1/2-1/2', 'threefold'); return true; }
    if (chess.isDrawByFiftyMoves()) { finish('1/2-1/2', 'fifty'); return true; }
    return false;
  }

  async function botTurn() {
    if (over || chess.turn() === me) return;
    const my = ++token;
    thinkingNow = true;
    thinking.classList.remove('hidden');
    redraw();
    let uci;
    try { uci = await botMove(bot, chess.fen(), engine); } catch (e) { toast(t('err.engine', { msg: e.message }), 'bad'); }
    if (my !== token || !document.body.contains(board.el)) return;
    thinkingNow = false;
    thinking.classList.add('hidden');
    if (uci) {
      const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      playSound(mv.captured ? 'capture' : 'move');
    }
    if (!checkEnd()) redraw();
  }

  board.onMove = (from, to, promotion) => {
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { redraw(); return; }
    playSound(mv.captured ? 'capture' : 'move');
    if (!checkEnd()) { redraw(); botTurn(); }
  };

  root.querySelector('#flip').onclick = () => board.flip();
  root.querySelector('#undo').onclick = () => {
    if (over) return;
    token++;
    thinkingNow = false;
    thinking.classList.add('hidden');
    engine.stop();
    chess.undo();
    if (chess.turn() !== me) chess.undo();
    redraw();
    botTurn();
  };
  root.querySelector('#resign').onclick = () => {
    if (over) return;
    token++;
    finish(me === 'w' ? '0-1' : '1-0', 'resign');
  };

  redraw();
  botTurn();
}
