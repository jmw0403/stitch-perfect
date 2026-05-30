// Pure geometry — no browser APIs, no imports

export const VALID_PITCHES = [3, 3.38, 3.85, 4, 5, 6]; // mm

/**
 * Snap a raw arc length to the nearest whole number of stitches.
 * Pitch is never altered; the piece length moves instead.
 *
 * @param {number} rawLength - measured path length in mm
 * @param {number} pitch     - stitch pitch in mm (sacred)
 * @returns {{ count: number, snappedLength: number }}
 */
export function snapToStitches(rawLength, pitch) {
  if (pitch <= 0) throw new RangeError('pitch must be positive');
  const count = Math.max(1, Math.round(rawLength / pitch));
  return { count, snappedLength: count * pitch };
}

// --- internal helpers ---

function cumulativeLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return cum;
}

// Sample {x, y, angle} at arc distance s along a polyline defined by pts + cum.
// angle is the local tangent in radians (used to orient slash marks).
function sampleAt(pts, cum, s) {
  s = Math.max(0, Math.min(s, cum[cum.length - 1]));
  for (let i = 1; i < cum.length; i++) {
    if (s <= cum[i] + 1e-9) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 1e-9 ? (s - cum[i - 1]) / segLen : 0;
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      return {
        x: pts[i - 1].x + t * dx,
        y: pts[i - 1].y + t * dy,
        angle: Math.atan2(dy, dx),
      };
    }
  }
  // Exact end of polyline
  const n = pts.length - 1;
  return {
    x: pts[n].x,
    y: pts[n].y,
    angle: Math.atan2(pts[n].y - pts[n - 1].y, pts[n].x - pts[n - 1].x),
  };
}

// --- public API ---

/**
 * Place stitch marks along a polyline (already flattened from Béziers if needed).
 *
 * Open run  (closed = false): count + 1 marks, first at start, last at end.
 * Closed loop (closed = true):  count marks evenly around the perimeter.
 *
 * For closed loops pass pts with the closing vertex repeated
 * (pts[last] === pts[0]) so the final segment is included in the perimeter.
 *
 * The polyline is treated as if its length were snappedLength; marks are then
 * placed at exact pitch intervals on that adjusted geometry.
 *
 * @param {Array<{x:number, y:number}>} pts
 * @param {number}  pitch
 * @param {boolean} closed
 * @returns {{
 *   marks:         Array<{x:number, y:number, angle:number}>,
 *   count:         number,
 *   snappedLength: number,
 *   rawLength:     number,
 * }}
 */
export function placeMarks(pts, pitch, closed = false) {
  if (pts.length < 2) throw new RangeError('need at least 2 points');

  const cum = cumulativeLengths(pts);
  const rawLength = cum[cum.length - 1];
  const { count, snappedLength } = snapToStitches(rawLength, pitch);

  // Map snapped-piece arc distance back to drawn-polyline arc distance
  const scale = rawLength > 0 ? rawLength / snappedLength : 1;

  const markCount = closed ? count : count + 1;
  const marks = [];

  for (let i = 0; i < markCount; i++) {
    marks.push(sampleAt(pts, cum, i * pitch * scale));
  }

  return { marks, count, snappedLength, rawLength };
}
