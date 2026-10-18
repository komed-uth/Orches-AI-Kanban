export function statusText(game) {
  return game.won ? `You won! Score: ${game.score}` : `Score: ${game.score}`;
}

export function renderGame(game, board, status) {
  status.textContent = statusText(game);
  board.replaceChildren();
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      const cell = board.ownerDocument.createElement('span');
      cell.className = 'cell';
      const player = game.player.x === x && game.player.y === y;
      const gem = game.gems.some(item => item.x === x && item.y === y);
      cell.textContent = player ? '●' : gem ? '◆' : '·';
      cell.setAttribute('aria-label', `${x + 1}, ${y + 1}: ${player ? 'player' : gem ? 'gem' : 'empty'}`);
      board.append(cell);
    }
  }
}
