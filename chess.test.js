import test from "node:test";
import assert from "node:assert/strict";
import { freshState, legalMoves, makeMove, positionKey, scoreMoves, statusOf } from "../src/chess.js";

function fromFen(fen) {
  const [placement, turn, castling, ep, half, full] = fen.split(" ");
  const board = [];
  for (const row of placement.split("/")) {
    for (const cell of row) {
      if (/\d/.test(cell)) board.push(...Array(Number(cell)).fill(null));
      else board.push(cell);
    }
  }
  const state = {
    board,
    turn,
    castling: castling === "-" ? "" : castling,
    ep: ep === "-" ? null : (8 - Number(ep[1])) * 8 + ep.charCodeAt(0) - 97,
    half: Number(half),
    full: Number(full),
    moves: [],
    lastMove: null,
    captured: { w: [], b: [] },
    counts: {},
    evalWhite: 0
  };
  state.counts[positionKey(state)] = 1;
  return state;
}

function findMove(state, from, to, promotion) {
  return legalMoves(state).find(move => move.from === from && move.to === to && (!promotion || move.promotion === promotion));
}

test("starting position has the standard 20 legal moves", () => {
  assert.equal(legalMoves(freshState()).length, 20);
});

test("a pinned rook cannot leave the king exposed", () => {
  const state = fromFen("k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1");
  assert.equal(findMove(state, 52, 53), undefined);
  assert.ok(findMove(state, 52, 44));
});

test("castling is legal when the king and path are safe", () => {
  const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const castles = legalMoves(state).filter(move => move.castle);
  assert.deepEqual(castles.map(move => move.castle).sort(), ["K", "Q"]);
});

test("castling through an attacked square is illegal", () => {
  const state = fromFen("k4r2/8/8/8/8/8/8/4K2R w K - 0 1");
  assert.equal(legalMoves(state).some(move => move.castle === "K"), false);
});

test("en passant is generated and removes the bypassed pawn", () => {
  const state = fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  const move = findMove(state, 28, 19);
  assert.ok(move?.epCapture !== undefined);
  const next = makeMove(state, move);
  assert.equal(next.board[27], null);
  assert.equal(next.board[19], "P");
});

test("en passant cannot expose the moving side's king", () => {
  const state = fromFen("k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  assert.equal(findMove(state, 28, 19), undefined);
});

test("promotion offers all four choices", () => {
  const state = fromFen("7k/P7/8/8/8/8/8/7K w - - 0 1");
  const promotions = legalMoves(state).filter(move => move.from === 8 && move.to === 0);
  assert.deepEqual(promotions.map(move => move.promotion).sort(), ["B", "N", "Q", "R"]);
});

test("checkmate and stalemate are distinguished", () => {
  assert.equal(statusOf(fromFen("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1")).title, "كش مات");
  assert.equal(statusOf(fromFen("7k/5Q2/5K2/8/8/8/8/8 b - - 0 1")).title, "تعادل");
});

test("threefold repetition ends in a draw", () => {
  let state = freshState();
  const sequence = [[62,45],[6,21],[45,62],[21,6],[62,45],[6,21],[45,62],[21,6]];
  for (const [from,to] of sequence) state = makeMove(state, findMove(state, from, to));
  assert.equal(statusOf(state).detail, "تكرر الوضع ثلاث مرات");
});

test("the search returns legal moves in best-first order", () => {
  const scores = scoreMoves(freshState(), 1);
  assert.equal(scores.length, 20);
  assert.ok(scores.every((entry, index) => index === 0 || scores[index - 1].score >= entry.score));
});
