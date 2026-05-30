// ui/canvas.js — paper.js canvas + geometry engine wiring
// `paper` is available as a global (loaded via <script> before this module)

import { placeMarks, snapToStitches } from '../engine/stitch.js';
import { initOffset, offsetPolyline } from '../engine/offset.js';
import Clipper2Factory from '../vendor/clipper2z.js';
import { initControls, getParams, onParamsChange } from './controls.js';
import { initRectTool, activateRectMode, deactivateRectMode,
         redrawAllRects, getRectStats, getSelectedRect,
         getRectSnapPoints } from './rect-tool.js';
import { px, toMm, createMark } from './render.js';

// ── Init ──────────────────────────────────────────────────────────────────────

await initOffset(Clipper2Factory);
initControls();

const canvasEl = document.getElementById('canvas');
const wrap     = document.getElementById('canvas-wrap');

function syncSize() {
  // Paper.js reads offsetWidth/offsetHeight and handles devicePixelRatio internally
  // in paper.setup(). We only need to keep the canvas CSS dimensions correct.
  canvasEl.style.width  = wrap.offsetWidth  + 'px';
  canvasEl.style.height = wrap.offsetHeight + 'px';
  // Set the pixel buffer at physical resolution for crisp rendering on HiDPI displays
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width  = Math.round(wrap.offsetWidth  * dpr);
  canvasEl.height = Math.round(wrap.offsetHeight * dpr);
}
syncSize();
paper.setup(canvasEl);
// After setup, keep the logical coordinate space in CSS pixels regardless of DPR
paper.view.viewSize = new paper.Size(wrap.offsetWidth, wrap.offsetHeight);
window.addEventListener('resize', () => {
  syncSize();
  paper.view.viewSize = new paper.Size(wrap.offsetWidth, wrap.offsetHeight);
});

// ── Layers (bottom → top) ─────────────────────────────────────────────────────

const cutLayer    = new paper.Layer();
const stitchLayer = new paper.Layer();
const markLayer   = new paper.Layer();
const handleLayer = new paper.Layer(); // always on top — resize handles

initRectTool({ cutLayer, stitchLayer, markLayer, handleLayer }, () => { updateStatus(); updateSelInfo(); });

// ── Freehand pieces ───────────────────────────────────────────────────────────
// { pts: [{x,y}], items: paper.Item[], count: number, markCount: number }

const pieces = [];

// ── Freehand piece rendering ──────────────────────────────────────────────────

// Scale a polyline uniformly from its start point to a target arc-length.
// This makes the rendered line match the snapped piece dimension.
function snapPolyline(pts, targetLength) {
  let rawLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
    rawLen += Math.sqrt(dx*dx + dy*dy);
  }
  if (rawLen === 0) return pts;
  const k = targetLength / rawLen;
  return pts.map(p => ({
    x: pts[0].x + (p.x - pts[0].x) * k,
    y: pts[0].y + (p.y - pts[0].y) * k,
  }));
}

function renderPiece(pts) {
  const { pitch, margin, markType, showDimensions } = getParams();
  const items = [];

  // Compute raw arc length to find snapped length
  let rawLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
    rawLen += Math.sqrt(dx*dx + dy*dy);
  }
  const { snappedLength } = snapToStitches(rawLen, pitch);

  // Render the stitch line at the snapped length so dimension flex is visible
  const snappedPts = snapPolyline(pts, snappedLength);

  stitchLayer.activate();
  items.push(new paper.Path({
    segments: snappedPts.map(p => new paper.Point(px(p.x), px(p.y))),
    strokeColor: '#2c7bb6',
    strokeWidth: 1,
  }));

  // Use snappedPts for marks so first and last marks land exactly on the line endpoints
  markLayer.activate();
  const { marks, count } = placeMarks(snappedPts, pitch);
  for (const m of marks) items.push(createMark(m, markType));

  // Cut line uses snappedPts too so the offset matches the visible stitch line
  cutLayer.activate();
  for (const ring of offsetPolyline(snappedPts, margin, false)) {
    items.push(new paper.Path({
      segments: ring.map(p => new paper.Point(px(p.x), px(p.y))),
      closed: true,
      strokeColor: '#aaa',
      strokeWidth: 0.75,
      dashArray: [4, 3],
    }));
  }

  // Dimension label — shown only when showDimensions is on
  if (showDimensions) {
    const p0 = snappedPts[0];
    const p1 = snappedPts[snappedPts.length - 1];
    const perpAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.PI / 2;
    const labelOffset = px(margin) + 9;
    stitchLayer.activate();
    items.push(new paper.PointText({
      point: new paper.Point(
        px((p0.x + p1.x) / 2) + Math.cos(perpAngle) * labelOffset,
        px((p0.y + p1.y) / 2) + Math.sin(perpAngle) * labelOffset,
      ),
      content: `${(count * pitch).toFixed(1)} mm`,
      fontSize: 9,
      fillColor: '#4a8ab5',
      justification: 'center',
    }));
  }

  return { items, count, markCount: marks.length, snappedPts };
}

// ── Live redraw on parameter change ──────────────────────────────────────────

function redrawAll() {
  pieces.forEach(piece => piece.items.forEach(item => item.remove()));
  pieces.forEach(piece => {
    const { items, count, markCount, snappedPts } = renderPiece(piece.pts);
    piece.items      = items;
    piece.count      = count;
    piece.markCount  = markCount;
    piece.snappedPts = snappedPts;
  });
  redrawAllRects();
  deduplicateCorners();
  updateStatus();
  updateSelInfo();
}

onParamsChange(redrawAll);

// ── Status bar ────────────────────────────────────────────────────────────────

function updateStatus() {
  const el = document.getElementById('status');
  const rs = getRectStats();
  const totalPieces   = pieces.length + rs.count;

  if (totalPieces === 0) { el.textContent = ''; return; }

  const totalStitches = pieces.reduce((s, p) => s + p.count, 0)    + rs.stitches;
  const totalMarks    = pieces.reduce((s, p) => s + p.markCount, 0) + rs.marks;

  el.textContent = (totalPieces === 1 && pieces.length === 1)
    ? `${pieces[0].count} stitch${pieces[0].count === 1 ? '' : 'es'} · ${pieces[0].markCount} marks`
    : `${totalPieces} piece${totalPieces > 1 ? 's' : ''} · ${totalStitches} stitches · ${totalMarks} marks`;
}

// ── Shared-corner deduplication ──────────────────────────────────────────────
// When two freehand pieces have endpoints within tolerance, they share a corner.
// The "secondary" piece (higher index) has its terminal mark hidden so only
// one hole is punched at the junction.

const CORNER_TOL_MM = 0.15;

function deduplicateCorners() {
  // Reset all endpoint marks to visible first
  for (const p of pieces) {
    if (p.items[1])           p.items[1].visible           = true;
    if (p.items[p.markCount]) p.items[p.markCount].visible = true;
  }

  for (let i = 0; i < pieces.length; i++) {
    const pi  = pieces[i];
    const piS = pi.snappedPts?.[0];
    const piE = pi.snappedPts?.[pi.snappedPts.length - 1];
    if (!piS || !piE) continue;

    for (let j = i + 1; j < pieces.length; j++) {
      const pj  = pieces[j];
      const pjS = pj.snappedPts?.[0];
      const pjE = pj.snappedPts?.[pj.snappedPts.length - 1];
      if (!pjS || !pjE) continue;

      const near = (a, b) => {
        const dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy) < CORNER_TOL_MM;
      };

      // Hide j's mark at any endpoint it shares with i
      if (near(piS, pjS) || near(piE, pjS)) {
        if (pj.items[1]) pj.items[1].visible = false;
      }
      if (near(piS, pjE) || near(piE, pjE)) {
        if (pj.items[pj.markCount]) pj.items[pj.markCount].visible = false;
      }
    }
  }
}

// ── Dimensions panel ─────────────────────────────────────────────────────────

function updateSelInfo() {
  const el = document.getElementById('sel-info');
  const { margin, pitch } = getParams();

  // Rect selected?
  const ri = getSelectedRect();
  if (ri) {
    el.innerHTML =
      `<div class="sel-row"><span class="sel-label">Stitch area</span>`+
      `<span class="sel-val">${ri.w.toFixed(1)} × ${ri.h.toFixed(1)} mm</span></div>`+
      `<div class="sel-row"><span class="sel-label">Cut piece</span>`+
      `<span class="sel-val">${(ri.w + 2*margin).toFixed(1)} × ${(ri.h + 2*margin).toFixed(1)} mm</span></div>`;
    return;
  }

  // Freehand piece selected?
  if (_selFreehand) {
    const snapped = (_selFreehand.count * pitch).toFixed(1);
    el.innerHTML =
      `<div class="sel-row"><span class="sel-label">Length</span>`+
      `<span class="sel-val">${snapped} mm</span></div>`+
      `<div class="sel-row"><span class="sel-label">Stitches</span>`+
      `<span class="sel-val">${_selFreehand.count}</span></div>`;
    return;
  }

  el.innerHTML = '';
}

// ── Snap helpers ─────────────────────────────────────────────────────────────

const SNAP_MM = 3; // snap threshold in mm

function _freehandSnapPoints(piece, { vertices, midpoints }) {
  const p0 = piece.pts[0];
  const p1 = piece.pts[piece.pts.length - 1];
  const pts = [];
  if (vertices)  { pts.push(p0, p1); }
  if (midpoints) { pts.push({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }); }
  return pts;
}

// Returns { dx, dy } adjustment (in mm) to snap `movingPts` onto nearest target
function _computeSnap(movingPts, targetPts) {
  let bestDx = 0, bestDy = 0, bestDist = SNAP_MM;
  for (const m of movingPts) {
    for (const t of targetPts) {
      const dx = t.x - m.x, dy = t.y - m.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestDx = dx; bestDy = dy; }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

let _fhSnapIndicator = null;

function _showFhSnapAt(mmPt) {
  if (_fhSnapIndicator) _fhSnapIndicator.remove();
  if (!mmPt) { _fhSnapIndicator = null; return; }
  handleLayer.activate();
  _fhSnapIndicator = new paper.Path.Circle(
    new paper.Point(px(mmPt.x), px(mmPt.y)), 5);
  _fhSnapIndicator.strokeColor = '#f39c12';
  _fhSnapIndicator.strokeWidth = 2;
  _fhSnapIndicator.fillColor   = null;
}

// ── Freehand selection + move ────────────────────────────────────────────────

let _selFreehand       = null; // selected freehand piece
let _fhDragPiece       = null; // piece being dragged
let _fhDragStart       = null; // paper.Point where drag began
let _fhDragOrigPts     = null; // original pts snapshot

function _selectFreehand(piece) {
  _deselectFreehand();
  _selFreehand = piece;
  piece.items[0].strokeColor = '#5bb3f5'; // highlight stitch line
  piece.items[0].strokeWidth = 1.5;
  updateSelInfo();
}

function _deselectFreehand() {
  if (!_selFreehand) return;
  _selFreehand.items[0].strokeColor = '#2c7bb6';
  _selFreehand.items[0].strokeWidth = 1;
  _selFreehand = null;
  updateSelInfo();
}

function _findFreehandAt(point) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const hit = pieces[i].items[0].hitTest(point, { stroke: true, tolerance: 8 });
    if (hit) return pieces[i];
  }
  return null;
}

// ── Finalize a freehand path ──────────────────────────────────────────────────

function finalizePath(path) {
  const pts = path.segments.map(s => ({ x: toMm(s.point.x), y: toMm(s.point.y) }));
  path.remove();
  if (pts.length < 2) return;

  const { items, count, markCount, snappedPts } = renderPiece(pts);
  pieces.push({ pts, items, count, markCount, snappedPts });
  deduplicateCorners();
  updateStatus();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

const hintEl = document.getElementById('hint');
const HINTS = {
  freehand: 'Click to place points &nbsp;·&nbsp; Double-click to finish &nbsp;·&nbsp; Esc to cancel',
  rect:     'Drag to draw &nbsp;·&nbsp; Click edge to toggle stitch/open &nbsp;·&nbsp; Drag corner to resize &nbsp;·&nbsp; Delete to remove',
};

let _activeTool = 'freehand';

function setTool(name) {
  _activeTool = name;
  document.querySelectorAll('#tool-btns [data-tool]')
    .forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  hintEl.innerHTML = HINTS[name];
}

document.querySelectorAll('#tool-btns [data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tool;
    if (name === _activeTool) return;
    if (name === 'rect') {
      clearGhost();
      if (activePath) { activePath.remove(); activePath = null; }
      _deselectFreehand();
      activateRectMode();
    } else {
      deactivateRectMode();
      freehandTool.activate();
    }
    setTool(name);
  });
});

// ── Freehand drawing tool ─────────────────────────────────────────────────────

let activePath = null;
let ghost      = null;

function clearGhost() {
  if (ghost) { ghost.remove(); ghost = null; }
}

function cancelDraw() {
  clearGhost();
  if (activePath) { activePath.remove(); activePath = null; }
}

const freehandTool = new paper.Tool();

freehandTool.onMouseDown = (event) => {
  // If not drawing: check for piece hit first
  if (!activePath) {
    const hit = _findFreehandAt(event.point);
    if (hit) {
      if (_selFreehand !== hit) _selectFreehand(hit);
      // Prime drag state — actual drag only fires if mouse moves
      _fhDragPiece   = hit;
      _fhDragStart   = event.point;
      _fhDragOrigPts = hit.pts.map(p => ({ x: p.x, y: p.y }));
      return; // don't add a new point
    }
    _deselectFreehand();
    _fhDragPiece = null;
  }

  // Normal drawing
  if (event.count === 2) {
    clearGhost();
    if (activePath) { finalizePath(activePath); activePath = null; }
    return;
  }
  if (!activePath) {
    stitchLayer.activate();
    activePath = new paper.Path({ strokeColor: '#2c7bb6', strokeWidth: 1, opacity: 0.5 });
  }
  activePath.add(event.point);
};

freehandTool.onMouseDrag = (event) => {
  if (!_fhDragPiece) return;
  let dx = toMm(event.point.x - _fhDragStart.x);
  let dy = toMm(event.point.y - _fhDragStart.y);
  const proposedPts = _fhDragOrigPts.map(p => ({ x: p.x + dx, y: p.y + dy }));

  // Snap if enabled
  const { snapVertices, snapMidpoints } = getParams();
  if (snapVertices || snapMidpoints) {
    const types = { vertices: snapVertices, midpoints: snapMidpoints };
    const movingSnap = _freehandSnapPoints({ pts: proposedPts }, types);

    // Targets: other freehand pieces + all rects
    const targetSnap = [];
    for (const p of pieces) {
      if (p !== _fhDragPiece) targetSnap.push(..._freehandSnapPoints(p, types));
    }
    targetSnap.push(...getRectSnapPoints(types));

    const { dx: sdx, dy: sdy } = _computeSnap(movingSnap, targetSnap);
    dx += sdx;  dy += sdy;

    const snappedTo = sdx !== 0 || sdy !== 0;
    _showFhSnapAt(snappedTo
      ? { x: proposedPts[0].x + sdx, y: proposedPts[0].y + sdy }
      : null);
  } else {
    _showFhSnapAt(null);
  }

  const newPts = _fhDragOrigPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
  _fhDragPiece.items.forEach(item => item.remove());
  const { items, count, markCount } = renderPiece(newPts);
  if (_selFreehand === _fhDragPiece) {
    items[0].strokeColor = '#5bb3f5';
    items[0].strokeWidth = 1.5;
  }
  _fhDragPiece.items    = items;
  _fhDragPiece.count    = count;
  _fhDragPiece.markCount = markCount;
  _fhDragPiece.pts      = newPts;
  updateSelInfo();
};

freehandTool.onMouseUp = () => {
  if (_fhDragPiece) {
    _fhDragPiece = null;
    _showFhSnapAt(null);
    deduplicateCorners();
    updateStatus();
  }
};

freehandTool.onMouseMove = (event) => {
  if (!activePath || activePath.segments.length === 0) return;
  clearGhost();
  stitchLayer.activate();
  ghost = new paper.Path({
    segments: [activePath.lastSegment.point, event.point],
    strokeColor: '#2c7bb6',
    strokeWidth: 0.75,
    opacity: 0.35,
    dashArray: [4, 4],
  });
};

freehandTool.onKeyDown = (event) => {
  if (event.key === 'enter' && activePath) {
    clearGhost();
    finalizePath(activePath);
    activePath = null;
  }
  if (event.key === 'escape') cancelDraw();
};

// Freehand is the default active tool
freehandTool.activate();
