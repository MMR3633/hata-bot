// Клиентская копия hub/duel_engine.py: тот же PRNG, те же правила.
// Сервер остаётся судьёй, здесь только мгновенный отклик интерфейса.

export function makeShapes(data) {
  return data.shapes.map(s => ({
    cells: s.rows.flatMap((row, r) => [...row].map((ch, c) => ch === '#' ? [r, c] : null).filter(Boolean)),
    w: s.w,
    color: s.c,
  }));
}

export class Rng {
  constructor(seed) { this.a = seed >>> 0; }
  nextU32() {
    this.a = (this.a + 0x6D2B79F5) >>> 0;
    const a = this.a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }
  next() { return this.nextU32() / 4294967296; }
}

export function pick(rng, shapes) {
  const total = shapes.reduce((s, x) => s + x.w, 0);
  let x = rng.next() * total;
  for (let i = 0; i < shapes.length; i++) {
    x -= shapes[i].w;
    if (x < 0) return i;
  }
  return shapes.length - 1;
}

export function pieceStream(seed, n, shapes) {
  const rng = new Rng(seed);
  return Array.from({length: n}, () => pick(rng, shapes));
}

export function fits(board, size, shape, row, col) {
  return shape.cells.every(([r, c]) => {
    const rr = row + r, cc = col + c;
    return rr >= 0 && rr < size && cc >= 0 && cc < size && !board[rr * size + cc];
  });
}

export function canPlaceAnywhere(board, size, shape) {
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (fits(board, size, shape, r, c)) return true;
  return false;
}

// Что сгорит, если поставить фигуру: для подсветки до отпускания пальца
export function previewClear(board, size, shape, row, col) {
  const b = board.slice();
  for (const [r, c] of shape.cells) b[(row + r) * size + col + c] = 1;
  const rows = [], cols = [];
  for (let r = 0; r < size; r++) if ([...Array(size).keys()].every(c => b[r * size + c])) rows.push(r);
  for (let c = 0; c < size; c++) if ([...Array(size).keys()].every(r => b[r * size + c])) cols.push(c);
  return {rows, cols};
}
