import test from "node:test";
import assert from "node:assert/strict";
import { createGame, move } from "../game.mjs";
import { statusText } from "../renderer.mjs";

test("player sees score updates and a winning result", () => {
  assert.match(statusText(createGame()), /Score: 0/);
  let game = createGame();
  for (let i = 0; i < 5; i++) game = move(game, 1, 0);
  assert.match(statusText(game), /You won!.*Score: 5/);
});
