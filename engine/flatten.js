// Pure geometry — no browser APIs, no imports

export const DEFAULT_TOLERANCE = 0.1; // mm

// --- internal recursive helper ---

// Recursively subdivide a cubic Bézier (a,b,c,d) until it is flat within tol².
// Appends only the endpoint of each leaf segment to `out` (caller holds the start).
// depth guard prevents infinite recursion on degenerate curves.
function subdivideCubic(out, ax, ay, bx, by, cx, cy, dx, dy, tol2, depth) {
  if (depth > 32) {
    out.push({ x: dx, y: dy });
    return;
  }

  // Flatness criterion (Antigrain/Freetype derivation):
  // max(|3P1 - 2P0 - P3|², |3P2 - 2P3 - P0|²) ≤ 16·tol²
  const ux = 3 * bx - 2 * ax - dx;
  const uy = 3 * by - 2 * ay - dy;
  const vx = 3 * cx - 2 * dx - ax;
  const vy = 3 * cy - 2 * dy - ay;

  if (Math.max(ux * ux + uy * uy, vx * vx + vy * vy) <= 16 * tol2) {
    out.push({ x: dx, y: dy });
    return;
  }

  // De Casteljau subdivision at t = 0.5
  const abx = (ax + bx) * 0.5,  aby = (ay + by) * 0.5;
  const bcx = (bx + cx) * 0.5,  bcy = (by + cy) * 0.5;
  const cdx = (cx + dx) * 0.5,  cdy = (cy + dy) * 0.5;
  const abcx = (abx + bcx) * 0.5, abcy = (aby + bcy) * 0.5;
  const bcdx = (bcx + cdx) * 0.5, bcdy = (bcy + cdy) * 0.5;
  const mx = (abcx + bcdx) * 0.5, my = (abcy + bcdy) * 0.5;

  subdivideCubic(out, ax, ay, abx, aby, abcx, abcy, mx, my, tol2, depth + 1);
  subdivideCubic(out, mx, my, bcdx, bcdy, cdx, cdy, dx, dy, tol2, depth + 1);
}

// --- public API ---

/**
 * Flatten a cubic Bézier to a polyline.
 *
 * Every point in the output lies exactly on the Bézier curve (De Casteljau
 * only produces on-curve points). The chord between consecutive points
 * deviates from the curve by at most `tolerance` mm.
 *
 * @param {{x,y}} p0 - anchor start
 * @param {{x,y}} p1 - control point 1
 * @param {{x,y}} p2 - control point 2
 * @param {{x,y}} p3 - anchor end
 * @param {number} tolerance - max chord-to-curve error in mm
 * @returns {Array<{x:number,y:number}>} polyline including both endpoints
 */
export function flattenCubic(p0, p1, p2, p3, tolerance = DEFAULT_TOLERANCE) {
  if (tolerance <= 0) throw new RangeError('tolerance must be positive');
  const out = [{ x: p0.x, y: p0.y }];
  subdivideCubic(out, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y,
    tolerance * tolerance, 0);
  return out;
}

/**
 * Flatten a path (sequence of segments) to a polyline.
 *
 * Segment types:
 *   { type: 'L', to: {x,y} }                        — line
 *   { type: 'Q', cp: {x,y}, to: {x,y} }             — quadratic Bézier
 *   { type: 'C', cp1: {x,y}, cp2: {x,y}, to: {x,y} } — cubic Bézier
 *
 * Quadratics are degree-elevated to cubics before flattening — no separate
 * code path needed.
 *
 * @param {{x,y}} start
 * @param {Array<object>} segments
 * @param {number} tolerance
 * @returns {Array<{x:number,y:number}>}
 */
export function flattenPath(start, segments, tolerance = DEFAULT_TOLERANCE) {
  if (tolerance <= 0) throw new RangeError('tolerance must be positive');
  const tol2 = tolerance * tolerance;
  const out = [{ x: start.x, y: start.y }];
  let cx = start.x, cy = start.y;

  for (const seg of segments) {
    const { x: tx, y: ty } = seg.to;

    if (seg.type === 'L') {
      out.push({ x: tx, y: ty });
    } else if (seg.type === 'Q') {
      // Degree elevation: Q(p0,p1,p2) → C(p0, p0+⅔(p1-p0), p2+⅔(p1-p2), p2)
      const qx = seg.cp.x, qy = seg.cp.y;
      subdivideCubic(out,
        cx, cy,
        cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy),
        tx + (2 / 3) * (qx - tx), ty + (2 / 3) * (qy - ty),
        tx, ty,
        tol2, 0);
    } else if (seg.type === 'C') {
      subdivideCubic(out,
        cx, cy,
        seg.cp1.x, seg.cp1.y,
        seg.cp2.x, seg.cp2.y,
        tx, ty,
        tol2, 0);
    }

    cx = tx;
    cy = ty;
  }

  return out;
}
