import {readFileSync} from 'node:fs';
import {makeShapes, pieceStream, Rng} from '../webapp/js/engine.js';

const shapes = makeShapes(JSON.parse(readFileSync(new URL('../webapp/shapes.json', import.meta.url), 'utf8')));
const out = {};
for (const seed of [0, 1, 42, 777, 123456789, 4294967295]) {
  const r = new Rng(seed);
  out[seed] = {u32: [r.nextU32(), r.nextU32(), r.nextU32()], pieces: pieceStream(seed, 60, shapes)};
}
console.log(JSON.stringify(out));
