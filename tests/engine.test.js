import assert from 'node:assert/strict';
import { snapToStitches, placeMarks, VALID_PITCHES } from '../engine/stitch.js';
import { flattenCubic, flattenPath, DEFAULT_TOLERANCE } from '../engine/flatten.js';
import { initOffset, offsetPolyline } from '../engine/offset.js';
import Clipper2Factory from 'clipper2-wasm';

const EPS = 1e-6;
function near(a, b, msg) {
  assert(Math.abs(a - b) < EPS, `${msg}: expected ${b}, got ${a}`);
}
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ── snapToStitches ────────────────────────────────────────────────────────────

// Exact fit — no adjustment needed
{
  const { count, snappedLength } = snapToStitches(20, 4);
  assert.equal(count, 5);
  near(snappedLength, 20, 'exact 20mm/4mm pitch');
}

// Rounds down: 21mm / 4mm = 5.25 → 5 stitches → 20mm
{
  const { count, snappedLength } = snapToStitches(21, 4);
  assert.equal(count, 5);
  near(snappedLength, 20, '21mm snaps down to 20mm');
}

// Rounds up: 22mm / 4mm = 5.5 → 6 stitches → 24mm
{
  const { count, snappedLength } = snapToStitches(22, 4);
  assert.equal(count, 6);
  near(snappedLength, 24, '22mm snaps up to 24mm');
}

// Minimum 1 stitch even for tiny lengths
{
  const { count } = snapToStitches(0.1, 4);
  assert.equal(count, 1, 'minimum stitch count is 1');
}

// Works with all valid pitches — snappedLength = count * pitch exactly
for (const p of VALID_PITCHES) {
  const { count, snappedLength } = snapToStitches(100, p);
  near(snappedLength, count * p, `snappedLength = count * pitch for ${p}mm`);
}

// Negative pitch throws
assert.throws(() => snapToStitches(20, 0), RangeError);
assert.throws(() => snapToStitches(20, -4), RangeError);

// ── placeMarks — straight open segment ───────────────────────────────────────

// Exact 20mm segment, pitch=4 → 5 stitches, 6 marks
{
  const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
  const { marks, count, snappedLength, rawLength } = placeMarks(pts, 4);

  assert.equal(count, 5, '5 stitches');
  near(snappedLength, 20, 'snapped length = 20mm');
  near(rawLength, 20, 'raw length = 20mm');
  assert.equal(marks.length, 6, '6 marks for open run');

  near(marks[0].x, 0,  'first mark at x=0');
  near(marks[0].y, 0,  'first mark at y=0');
  near(marks[5].x, 20, 'last mark at x=20');
  near(marks[5].y, 0,  'last mark at y=0');
  near(marks[2].x, 8,  'third mark at x=8');

  // All y=0, all angle=0 on horizontal segment
  for (const [i, m] of marks.entries()) {
    near(m.y, 0, `mark ${i} on y=0`);
    near(m.angle, 0, `mark ${i} angle=0`);
  }

  // Adjacent marks are uniformly spaced
  for (let i = 1; i < marks.length; i++) {
    near(dist(marks[i], marks[i - 1]), 4, `gap between marks ${i-1}→${i}`);
  }
}

// Slightly-off length snaps, marks still uniformly spaced on adjusted geometry
{
  const pts = [{ x: 0, y: 0 }, { x: 21, y: 0 }];
  const { marks, count, snappedLength } = placeMarks(pts, 4);

  assert.equal(count, 5);
  near(snappedLength, 20, 'snapped to 20mm');
  assert.equal(marks.length, 6);

  // Spacing on drawn line = pitch * (rawLength/snappedLength) = 4 * (21/20) = 4.2mm
  const expectedGap = 4 * (21 / 20);
  for (let i = 1; i < marks.length; i++) {
    near(dist(marks[i], marks[i - 1]), expectedGap, `uniform gap mark ${i-1}→${i}`);
  }
}

// Diagonal segment — marks lie on the line, tangent angle is correct
{
  const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }]; // length = 5mm
  const { marks, count } = placeMarks(pts, 5);

  assert.equal(count, 1);
  assert.equal(marks.length, 2);
  near(marks[0].x, 0, 'start x');
  near(marks[0].y, 0, 'start y');
  near(marks[1].x, 3, 'end x');
  near(marks[1].y, 4, 'end y');
  near(marks[0].angle, Math.atan2(4, 3), 'diagonal tangent angle');
}

// ── placeMarks — closed loop ──────────────────────────────────────────────────

// 4×5mm square, perimeter=20mm, pitch=4 → 5 stitches, 5 marks
{
  const pts = [
    { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 },
  ];
  const { marks, count, snappedLength } = placeMarks(pts, 4, true);

  assert.equal(count, 5, '5 stitches around loop');
  near(snappedLength, 20, 'perimeter snapped to 20mm');
  assert.equal(marks.length, 5, '5 marks for closed loop');
}

// ── placeMarks — error guards ─────────────────────────────────────────────────

assert.throws(() => placeMarks([{ x: 0, y: 0 }], 4), RangeError, 'too few points');

// ── flattenCubic ──────────────────────────────────────────────────────────────

// Default tolerance exported
assert.equal(DEFAULT_TOLERANCE, 0.1);

// Straight cubic (control points exactly at 1/3 and 2/3 of the segment) → 2 pts
{
  const pts = flattenCubic(
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 },
  );
  assert.equal(pts.length, 2, 'straight cubic → 2 points');
  near(pts[0].x, 0,  'straight start x');
  near(pts[1].x, 30, 'straight end x');
  near(pts[0].y, 0,  'straight start y');
  near(pts[1].y, 0,  'straight end y');
}

// Diagonal straight cubic → 2 points, endpoints correct
{
  const pts = flattenCubic(
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 },
  );
  assert.equal(pts.length, 2, 'diagonal straight cubic → 2 points');
  near(pts[1].x, 3, 'end x');
  near(pts[1].y, 3, 'end y');
}

// Curved cubic (quarter circle approx, R=10mm) → more than 2 points,
// each point within (tol + Bézier-circle-error) of the true circle
{
  const R = 10;
  const k = 0.5522847498; // standard circular Bézier constant
  const tol = 0.1;
  const pts = flattenCubic(
    { x: R, y: 0 },
    { x: R, y: R * k },
    { x: R * k, y: R },
    { x: 0, y: R },
    tol,
  );

  assert(pts.length > 2, 'curved cubic produces multiple points');

  // Every output point is on the Bézier (De Casteljau guarantee).
  // The Bézier approximates the circle with max error ~0.027mm for R=10;
  // so points should be within 0.13mm of the true circle.
  for (const [i, p] of pts.entries()) {
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    assert(Math.abs(r - R) < 0.13, `point ${i} within 0.13mm of circle, got Δr=${Math.abs(r - R).toFixed(4)}`);
  }

  // First and last points are exactly P0 and P3
  near(pts[0].x, R, 'start x');
  near(pts[0].y, 0, 'start y');
  near(pts[pts.length - 1].x, 0, 'end x');
  near(pts[pts.length - 1].y, R, 'end y');
}

// Finer tolerance → at least as many points as coarser tolerance
{
  const R = 10, k = 0.5522847498;
  const p0 = { x: R, y: 0 }, p1 = { x: R, y: R * k };
  const p2 = { x: R * k, y: R }, p3 = { x: 0, y: R };
  const coarse = flattenCubic(p0, p1, p2, p3, 1.0);
  const fine   = flattenCubic(p0, p1, p2, p3, 0.1);
  assert(fine.length >= coarse.length, 'finer tolerance → more or equal points');
}

// Bad tolerance throws
assert.throws(() => flattenCubic({x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0}, 0), RangeError);

// ── flattenPath ───────────────────────────────────────────────────────────────

// Line segment
{
  const pts = flattenPath({ x: 0, y: 0 }, [{ type: 'L', to: { x: 10, y: 5 } }]);
  assert.equal(pts.length, 2);
  near(pts[0].x, 0,  'L start x');
  near(pts[1].x, 10, 'L end x');
  near(pts[1].y, 5,  'L end y');
}

// Two chained line segments
{
  const pts = flattenPath({ x: 0, y: 0 }, [
    { type: 'L', to: { x: 5, y: 0 } },
    { type: 'L', to: { x: 5, y: 5 } },
  ]);
  assert.equal(pts.length, 3);
  near(pts[2].x, 5, 'end x');
  near(pts[2].y, 5, 'end y');
}

// Cubic via flattenPath — same result as direct flattenCubic
{
  const R = 10, k = 0.5522847498;
  const start = { x: R, y: 0 };
  const direct = flattenCubic(start, { x: R, y: R*k }, { x: R*k, y: R }, { x: 0, y: R });
  const viaPath = flattenPath(start, [{
    type: 'C',
    cp1: { x: R, y: R * k },
    cp2: { x: R * k, y: R },
    to:  { x: 0, y: R },
  }]);
  assert.equal(direct.length, viaPath.length, 'flattenPath cubic matches flattenCubic');
  for (let i = 0; i < direct.length; i++) {
    near(direct[i].x, viaPath[i].x, `point ${i} x matches`);
    near(direct[i].y, viaPath[i].y, `point ${i} y matches`);
  }
}

// Quadratic via flattenPath — straight Q → 2 pts
{
  const pts = flattenPath({ x: 0, y: 0 }, [{
    type: 'Q',
    cp: { x: 5, y: 0 },
    to: { x: 10, y: 0 },
  }]);
  assert.equal(pts.length, 2, 'straight quadratic → 2 points');
  near(pts[1].x, 10, 'Q end x');
}

// ── placeMarks + flatten integration ─────────────────────────────────────────

// Flatten a quarter-circle Bézier, then place marks — verify count and spacing
{
  const R = 50, k = 0.5522847498;
  const poly = flattenCubic(
    { x: R, y: 0 }, { x: R, y: R * k }, { x: R * k, y: R }, { x: 0, y: R },
  );
  // Arc length of quarter circle = π*R/2 ≈ 78.54mm; pitch=4 → ~20 stitches
  const { marks, count } = placeMarks(poly, 4);
  assert(count >= 19 && count <= 21, `quarter circle ~20 stitches, got ${count}`);
  assert.equal(marks.length, count + 1, 'open run mark count');
}

// ── offsetPolyline ────────────────────────────────────────────────────────────

await initOffset(Clipper2Factory);

// Guard: throws before init is complete (already done, so test the error checks)
assert.throws(() => offsetPolyline([{x:0,y:0},{x:10,y:0}], 0),   RangeError, 'zero margin');
assert.throws(() => offsetPolyline([{x:0,y:0},{x:10,y:0}], -1),  RangeError, 'negative margin');
assert.throws(() => offsetPolyline([{x:0,y:0}], 2),              RangeError, 'too few points');

// Open segment — offset creates a band around the line
// Horizontal 10mm segment, margin=2 → bounding box ≈ x[-2,12], y[-2,2]
{
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const rings = offsetPolyline(pts, 2, false);

  assert(rings.length >= 1, 'open segment produces at least one ring');
  const ring = rings[0];
  assert(ring.length >= 4, 'ring has enough vertices');

  const xs = ring.map(p => p.x);
  const ys = ring.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // Band should extend margin beyond each end and margin above/below the line
  assert(minX < -1.5,  `band left of start: minX=${minX.toFixed(2)}`);
  assert(maxX > 11.5,  `band right of end:  maxX=${maxX.toFixed(2)}`);
  assert(minY < -1.5,  `band below line:    minY=${minY.toFixed(2)}`);
  assert(maxY >  1.5,  `band above line:    maxY=${maxY.toFixed(2)}`);
}

// Closed square — offset expands the polygon outward uniformly
// 10mm square (0,0)–(10,10), margin=3 → outer square ≈ (-3,-3)–(13,13)
{
  const pts = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 },
  ];
  const rings = offsetPolyline(pts, 3, true);

  assert(rings.length >= 1, 'closed square produces at least one ring');
  const ring = rings[0];

  const xs = ring.map(p => p.x);
  const ys = ring.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // With Round join the corners are slightly inside the miter point,
  // so allow ±0.5mm on exact corner positions
  assert(minX < -2.5,  `expanded left:   minX=${minX.toFixed(2)}`);
  assert(maxX > 12.5,  `expanded right:  maxX=${maxX.toFixed(2)}`);
  assert(minY < -2.5,  `expanded bottom: minY=${minY.toFixed(2)}`);
  assert(maxY > 12.5,  `expanded top:    maxY=${maxY.toFixed(2)}`);
}

// Larger margin → larger bounding box
{
  const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }];
  const small = offsetPolyline(pts, 2, true)[0];
  const large = offsetPolyline(pts, 5, true)[0];
  const spanSmall = Math.max(...small.map(p => p.x)) - Math.min(...small.map(p => p.x));
  const spanLarge = Math.max(...large.map(p => p.x)) - Math.min(...large.map(p => p.x));
  assert(spanLarge > spanSmall, 'larger margin → wider cut line');
}

// JoinType option accepted without error
{
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }];
  assert.doesNotThrow(() => offsetPolyline(pts, 2, true, { joinType: 'miter' }));
  assert.doesNotThrow(() => offsetPolyline(pts, 2, true, { joinType: 'square' }));
  assert.doesNotThrow(() => offsetPolyline(pts, 2, true, { joinType: 'round' }));
}

console.log('All tests passed.');
