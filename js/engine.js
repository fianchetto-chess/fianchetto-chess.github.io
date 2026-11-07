// Обёртка над Stockfish 16 (WebAssembly, работает прямо в браузере в Web Worker).

export class Engine {
  constructor() {
    this.worker = new Worker(new URL('../engine/stockfish-19-lite-single.js', import.meta.url));
    this.handlers = new Set();
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const h of [...this.handlers]) h(line);
    };
    this.lock = Promise.resolve();
    this.ready = this._init();
  }

  send(cmd) { this.worker.postMessage(cmd); }

  waitFor(test) {
    return new Promise((resolve) => {
      const h = (line) => { if (test(line)) { this.handlers.delete(h); resolve(line); } };
      this.handlers.add(h);
    });
  }

  async _init() {
    const ok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await ok;
    this.send('setoption name Hash value 32');
    await this.isReady();
  }

  async isReady() {
    const r = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await r;
  }

  // Выполняет задачи строго по очереди
  _queue(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  setOptions(opts) {
    return this._queue(async () => {
      await this.ready;
      for (const [k, v] of Object.entries(opts)) this.send(`setoption name ${k} value ${v}`);
      await this.isReady();
    });
  }

  newGame() {
    return this._queue(async () => {
      await this.ready;
      this.send('ucinewgame');
      await this.isReady();
    });
  }

  // Анализ позиции. Возвращает { lines: [{score:{cp}|{mate}, pv:[uci], depth}], bestmove }
  // Оценка — с точки зрения стороны, которая ходит.
  // options — UCI-опции именно для этого поиска (например, ограничение силы для бота)
  analyse(fen, { depth = 14, multipv = 1, movetime = null, onInfo = null, options = null } = {}) {
    return this._queue(async () => {
      await this.ready;
      const opts = options || { UCI_LimitStrength: 'false', 'Skill Level': 20 };
      for (const [k, v] of Object.entries(opts)) this.send(`setoption name ${k} value ${v}`);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      const lines = [];
      const handler = (line) => {
        if (!line.startsWith('info') || !line.includes(' pv ')) return;
        const parsed = parseInfo(line);
        if (!parsed || parsed.bound) return;
        lines[parsed.multipv - 1] = parsed;
        if (onInfo) onInfo(parsed);
      };
      this.handlers.add(handler);
      const done = this.waitFor((l) => l.startsWith('bestmove'));
      this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
      const bm = await done;
      this.handlers.delete(handler);
      const bestmove = bm.split(' ')[1];
      return { lines: lines.filter(Boolean), bestmove: bestmove === '(none)' ? null : bestmove };
    });
  }

  stop() { this.send('stop'); }
  terminate() { this.worker.terminate(); }
}

function parseInfo(line) {
  const tok = line.split(' ');
  const out = { multipv: 1, depth: 0, pv: [], score: null, bound: false };
  for (let i = 0; i < tok.length; i++) {
    switch (tok[i]) {
      case 'depth': out.depth = Number(tok[++i]); break;
      case 'multipv': out.multipv = Number(tok[++i]); break;
      case 'score': {
        const kind = tok[++i];
        const val = Number(tok[++i]);
        out.score = kind === 'mate' ? { mate: val } : { cp: val };
        if (tok[i + 1] === 'lowerbound' || tok[i + 1] === 'upperbound') out.bound = true;
        break;
      }
      case 'pv': out.pv = tok.slice(i + 1); i = tok.length; break;
      default: break;
    }
  }
  return out.score ? out : null;
}

let shared = null;
export function getEngine() {
  if (!shared) shared = new Engine();
  return shared;
}
