// Pure geometry — no browser APIs.
//
// Wraps Clipper2-wasm via dependency injection so the import path
// (node_modules vs vendor/) is decided by the caller, not this module.
//
// Usage:
//   import Clipper2Factory from 'clipper2-wasm';          // Node / tests
//   import Clipper2Factory from '../vendor/clipper2z.js'; // browser
//   await initOffset(Clipper2Factory);
//   const cutLine = offsetPolyline(stitchPts, margin);

let C = null; // initialized Clipper2 module instance

/**
 * Initialize the Clipper2 wasm module.
 * Must be called (and awaited) once before offsetPolyline.
 *
 * @param {Function} factory - default export from clipper2-wasm
 */
export async function initOffset(factory) {
  C = await factory();
}

/**
 * Offset a stitch-line polyline outward by `margin` mm to produce the cut line.
 *
 * Open run  (closed = false): a band is created around the open path with
 *   rounded ends. The result outline is the cut line for that edge.
 * Closed loop (closed = true): the polygon expands uniformly outward.
 *
 * Returns an array of rings (usually one). Each ring is a closed polygon —
 * the last point connects back to the first. Take [0] for the typical case.
 *
 * @param {Array<{x:number, y:number}>} pts  - stitch line polyline
 * @param {number}  margin                   - offset distance in mm (> 0)
 * @param {boolean} closed                   - true for closed loop
 * @param {{ joinType?: 'round'|'square'|'miter' }} opts
 * @returns {Array<Array<{x:number, y:number}>>}
 */
export function offsetPolyline(pts, margin, closed = false, opts = {}) {
  if (!C) throw new Error('call initOffset(factory) before offsetPolyline');
  if (margin <= 0) throw new RangeError('margin must be positive');
  if (pts.length < 2) throw new RangeError('need at least 2 points');

  const { joinType = 'round' } = opts;

  // Build Clipper2 path from flat coordinate array [x0,y0, x1,y1, ...]
  const flat = [];
  for (const p of pts) { flat.push(p.x, p.y); }
  const pathD = C.MakePathD(flat);

  const inputPaths = new C.PathsD();
  inputPaths.push_back(pathD);

  const jt = joinType === 'miter'  ? C.JoinType.Miter  :
             joinType === 'square' ? C.JoinType.Square :
             C.JoinType.Round;
  const et = closed ? C.EndType.Polygon : C.EndType.Round;

  // InflatePathsD(paths, delta, joinType, endType, miterLimit, precision, arcTolerance)
  const resultPaths = C.InflatePathsD(inputPaths, margin, jt, et, 2, 4, 0.1);

  // Convert result back to [{x,y}] arrays
  const output = [];
  for (let i = 0; i < resultPaths.size(); i++) {
    const path = resultPaths.get(i);
    const ring = [];
    for (let j = 0; j < path.size(); j++) {
      const pt = path.get(j);
      ring.push({ x: pt.x, y: pt.y });
    }
    output.push(ring);
  }

  // Free wasm-heap allocations
  resultPaths.delete();
  inputPaths.delete();
  pathD.delete();

  return output;
}
