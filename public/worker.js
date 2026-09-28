import { solve } from './mix.js';

self.onmessage = ({ data: { id, target, paints, maxDrops } }) => {
  self.postMessage({ id, results: solve(target, paints, { maxDrops }) });
};
