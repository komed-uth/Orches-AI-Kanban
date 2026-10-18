import { createGame, move } from './game.mjs';
import { handleKey } from './controls.mjs';
import { renderGame } from './renderer.mjs';

let game = createGame();
const board = document.querySelector('#board');
const status = document.querySelector('#status');
const render = () => renderGame(game, board, status);
const onMove = (dx, dy) => { game = move(game, dx, dy); render(); };
const onRestart = () => { game = createGame(); render(); };
document.addEventListener('keydown', event => handleKey(event, { onMove, onRestart }));
document.querySelector('#restart').addEventListener('click', onRestart);
document.querySelectorAll('[data-move]').forEach(button => {
  button.addEventListener('click', () => onMove(...button.dataset.move.split(',').map(Number)));
});
render();
