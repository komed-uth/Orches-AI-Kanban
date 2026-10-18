import test from "node:test";
import assert from "node:assert/strict";
import { handleKey } from "../controls.mjs";

test("arrow keys move and prevent browser scrolling", () => {
  const moves = [];
  let prevented = false;
  assert.equal(
    handleKey(
      {
        key: "ArrowRight",
        preventDefault() {
          prevented = true;
        },
      },
      { onMove: (...direction) => moves.push(direction) },
    ),
    true,
  );
  assert.deepEqual(moves, [[1, 0]]);
  assert.equal(prevented, true);
});

test("unrelated keys remain available to the browser", () => {
  assert.equal(
    handleKey(
      { key: "Tab" },
      {
        onMove() {
          assert.fail("unexpected movement");
        },
      },
    ),
    false,
  );
});
