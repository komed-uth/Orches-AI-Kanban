export function createGame() {
  return {
    width: 6,
    height: 6,
    player: { x: 0, y: 0 },
    gems: [1, 2, 3, 4, 5].map((x) => ({ x, y: 0 })),
    score: 0,
    won: false,
  };
}

export function move(game, dx, dy) {
  if (game.won) return game;
  const player = {
    x: Math.max(0, Math.min(game.width - 1, game.player.x + dx)),
    y: Math.max(0, Math.min(game.height - 1, game.player.y + dy)),
  };
  const gems = game.gems.filter(
    (gem) => gem.x !== player.x || gem.y !== player.y,
  );
  return {
    ...game,
    player,
    gems,
    score: game.score + game.gems.length - gems.length,
    won: gems.length === 0,
  };
}
