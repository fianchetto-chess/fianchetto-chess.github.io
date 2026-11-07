// Генерация задач в отдельном потоке, чтобы страница не подвисала
import { Chess } from '../lib/chess.js';
import * as G from './train-gen.js';

self.onmessage = (e) => {
  const { id, kind, arg } = e.data;
  try { self.postMessage({ id, result: G[kind](Chess, arg) }); } catch (err) { self.postMessage({ id, error: err.message }); }
};
