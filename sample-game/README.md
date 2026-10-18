# Gem Trail

A tiny dependency-free browser game. Collect five diamonds with arrow keys, WASD, or the buttons. Restart with the button. Node.js 22.13+ runs the baseline tests:

```sh
node --test tests/*.test.mjs
```

Serve this directory through a static HTTP server (for example `python3 -m http.server 8081`) and open localhost:8081. No engine or build step is needed. The orchestration app also serves the bundled game at `/sample-game/`.

`tasks.json` contains two independent enhancement tasks. They intentionally remain unimplemented in this baseline so real Codex agents can implement and verify them in separate worktrees. One changes the status renderer; the other changes keyboard controls. Baseline tests exercise game completion, bounds, score, movement controls, and winning status.
