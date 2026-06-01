// ui/tpocket.js — T-Pocket geometry helpers
//
// The T-Pocket is an 8-vertex polygon shaped like the card-slot piece
// used in bifold wallets. Five parameters fully define it; the angled
// sides auto-derive from the rest so the user never touches an angle.
//
//  ┌────────────────────────────────────────────────┐  ← tw (T width)
//  │  ear(tt)  │        (pocket mouth)       │ ear  │  ← th (T height)
//  └──────┐                                  ┌──────┘
//          \                                /          ← angled (auto)
//           \                              /
//            └──────────────────────────┘              ← bw (base width)
//  ←─────────────────── h (total height) ──────────────────────────→

export const DEFAULT_PARAMS = {
  tw: 100,  // T width    — total piece width at top (mm)
  th:  18,  // T height   — height of the ear section (mm)
  tt:  14,  // T tab      — horizontal width of each ear (mm)
  bw:  60,  // Base width — width of the bottom stitched seam (mm)
  h:   80,  // Total height — top to bottom seam (mm)
};

/**
 * Compute the 8 vertices of the T-pocket polygon.
 * Coordinate origin = outer top-left corner.
 * Vertices run clockwise.
 */
export function tpocketVertices({ tw, th, tt, bw, h }) {
  const leftBase  = (tw - bw) / 2;
  const rightBase = (tw + bw) / 2;
  return [
    { x: 0,          y: 0  },  // 0 outer top-left
    { x: tw,         y: 0  },  // 1 outer top-right
    { x: tw,         y: th },  // 2 outer bottom of right ear
    { x: tw - tt,    y: th },  // 3 inner T-shoulder right
    { x: rightBase,  y: h  },  // 4 bottom-right
    { x: leftBase,   y: h  },  // 5 bottom-left
    { x: tt,         y: th },  // 6 inner T-shoulder left
    { x: 0,          y: th },  // 7 outer bottom of left ear
  ];
}

/**
 * Default edge states for the 8 edges (indexed 0→1, 1→2, ..., 7→0).
 *
 * Edge  Path                  State     Reason
 * 0→1   top (pocket mouth)    hidden    opening, no stitching
 * 1→2   right outer ear       stitched  right tab stitch
 * 2→3   right T-shoulder step hidden    horizontal step, not stitched
 * 3→4   right angled side     open      cut edge
 * 4→5   bottom seam           stitched  seam to wallet body
 * 5→6   left angled side      open      cut edge
 * 6→7   left T-shoulder step  hidden    horizontal step
 * 7→0   left outer ear        stitched  left tab stitch
 */
export function tpocketEdges() {
  return ['hidden', 'stitched', 'hidden', 'open', 'stitched', 'open', 'hidden', 'stitched'];
}

/**
 * Translate all vertices by (dx, dy).
 * Used when placing the T-pocket at a canvas position.
 */
export function translatePts(pts, dx, dy) {
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Validate params — returns a corrected copy where constraints hold.
 * - tt must be < tw/2
 * - bw must be < tw - 2*tt (base must fit inside the body)
 * - th must be < h
 */
export function clampParams({ tw, th, tt, bw, h }) {
  const tw2 = Math.max(tw, 20);
  const tt2 = Math.min(tt, tw2 / 2 - 5);
  const bw2 = Math.min(bw, tw2 - 2 * tt2 - 2);
  const h2  = Math.max(h, th + 10);
  return {
    tw: tw2,
    th: Math.min(th, h2 - 10),
    tt: Math.max(tt2, 5),
    bw: Math.max(bw2, 10),
    h:  h2,
  };
}
