import { scoreMoves } from "./chess.js";

self.onmessage = event => {
  const { id, state, depth, maxNodes, maxTimeMs } = event.data || {};
  try {
    const scores = scoreMoves(state, depth, { maxNodes, maxTimeMs });
    self.postMessage({ id, scores });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "تعذر تحليل المباراة" });
  }
};
