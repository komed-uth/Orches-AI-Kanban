const directions = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

export function handleKey(event, { onMove }) {
  const direction = directions[event.key];
  if (!direction) return false;
  event.preventDefault();
  onMove(...direction);
  return true;
}
