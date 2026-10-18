import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, move } from '../game.mjs';

test('player collects the five gems and wins', () => {
  let game = createGame();
  for (let x = 0; x < 5; x++) game = move(game, 1, 0);
  assert.equal(game.score, 5);
  assert.equal(game.won, true);
  assert.equal(game.gems.length, 0);
});

test('movement stays on the board and never collects a gem twice', () => {
  const start = createGame();
  assert.deepEqual(move(start, -1, -1).player, { x: 0, y: 0 });
  const collected = move(start, 1, 0);
  const revisited = move(move(collected, -1, 0), 1, 0);
  assert.equal(revisited.score, 1);
  assert.equal(start.score, 0);
});
