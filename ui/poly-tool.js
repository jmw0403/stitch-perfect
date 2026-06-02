// ui/poly-tool.js — Polygon shape tool
// `paper` is a global set by the paper.js script tag.

import { placeMarks, snapToStitches } from '../engine/stitch.js';
import { offsetPolyline } from '../engine/offset.js';
import { getParams, getItemParams } from './controls.js';
import { px, toMm, createMark } from './render.js';
import { tpocketVertices, translatePts, clampParams } from './tpocket.js';

const HANDLE_PX      = 8;
const EDGE_HIT_PX    = 10;
const VERTEX_HIT_PX  = 10;
const CLOSE_THRESHOLD_PX = 14; // click this close to first vertex to close polygon

let _layers  = null;
let _polyTool = null;
let _onChange = () => {};
let _onAdded  = () => {};
let _onDeleted = () => {};

// ── State ─────────────────────────────────────────────────────────────────────

const _polys   = [];  // committed PolyPiece[]
let _selected  = null;
let _handles   = [];  // vertex handle items

// Draw state
let _drawState = null; // { pts: [{x,y}], draftItems, ghostLine }

// Drag vertex state
let _dragVertex = null; // { polyRef, vertexIdx, origPts }

// Move state
let _moveState = null; // { start: paper.Point, origPts }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initPolyTool(layers, onChangeFn, onAddedFn, onDeletedFn) {
  _layers = layers;
  if (onChangeFn)  _onChange  = onChangeFn;
  if (onAddedFn)   _onAdded   = onAddedFn;
  if (onDeletedFn) _onDeleted = onDeletedFn;

  _polyTool = new paper.Tool();

  _polyTool.onMouseDown = (event) => {
    // Trap mode: click-drag defines bounding box → committed as 4-vertex trapezoid
    if (_trapMode && !_drawState) {
      _trapStart = { x: toMm(event.point.x), y: toMm(event.point.y) };
      _layers.stitchLayer.activate();
      _trapDraft = new paper.Path({ strokeColor: '#2c7bb6', strokeWidth: 1, opacity: 0.45, fillColor: null });
      return;
    }

    // Drawing mode: click near first vertex to close; otherwise add vertex
    if (_drawState) {
      if (_drawState.pts.length >= 3) {
        const first = _drawState.pts[0];
        const d = event.point.getDistance(
          new paper.Point(px(first.x), px(first.y)));
        if (d < CLOSE_THRESHOLD_PX) { _commitDraw(); return; }
      }
      _addDrawVertex(event.point);
      return;
    }

    // If selected: check vertex drag, then edge click, then inside-move
    if (_selected) {
      const vIdx = _hitVertex(_selected, event.point);
      if (vIdx !== -1) { _startVertexDrag(vIdx, event.point); return; }

      const eIdx = _hitEdge(_selected, event.point);
      if (eIdx !== -1) { _toggleEdge(_selected, eIdx); return; }

      if (_hitInside(_selected, event.point)) { _startMove(event.point); return; }
    }

    // Click any existing poly to select it
    const hit = _hitAnyPoly(event.point);
    if (hit) { _deselectPoly(); _selectPoly(hit); return; }

    // Empty canvas: deselect and start drawing
    _deselectPoly();
    _startDraw(event.point);
  };

  _polyTool.onMouseMove = (event) => {
    if (!_drawState || _drawState.pts.length === 0) return;
    _updateGhost(event.point);
    // Highlight first vertex when mouse is near (close indicator)
    if (_drawState.pts.length >= 3 && _drawState.draftItems[0]) {
      const first = _drawState.pts[0];
      const d = event.point.getDistance(new paper.Point(px(first.x), px(first.y)));
      _drawState.draftItems[0].fillColor = d < CLOSE_THRESHOLD_PX ? '#f39c12' : '#2c7bb6';
    }
  };

  _polyTool.onMouseDrag = (event) => {
    // Trap drag: update preview
    if (_trapMode && _trapStart) {
      const ex = toMm(event.point.x), ey = toMm(event.point.y);
      const x = Math.min(_trapStart.x, ex), y = Math.min(_trapStart.y, ey);
      const w = Math.abs(ex - _trapStart.x), h = Math.abs(ey - _trapStart.y);
      const inset = w * 0.2; // 20% narrower at bottom (classic card-slot shape)
      if (_trapDraft) _trapDraft.remove();
      _layers.stitchLayer.activate();
      _trapDraft = new paper.Path({
        segments: [
          [px(x),         px(y)],
          [px(x + w),     px(y)],
          [px(x + w - inset), px(y + h)],
          [px(x + inset), px(y + h)],
        ],
        closed: true,
        strokeColor: '#2c7bb6', strokeWidth: 1, opacity: 0.45, fillColor: null,
      });
      _trapDraft._trapData = { x, y, w, h, inset };
      return;
    }
    if (_dragVertex) { _updateVertexDrag(event.point); return; }
    if (_moveState)  { _updateMove(event.point);       return; }
  };

  _polyTool.onMouseUp = () => {
    // Commit trap
    if (_trapMode && _trapStart) {
      const td = _trapDraft?._trapData;
      if (_trapDraft) { _trapDraft.remove(); _trapDraft = null; }
      _trapStart = null;
      if (td && td.w > 4 && td.h > 4) {
        const { x, y, w, h, inset } = td;
        const pts = [
          { x,                  y },
          { x: x + w,           y },
          { x: x + w - inset,   y: y + h },
          { x: x + inset,       y: y + h },
        ];
        const poly = { pts, edges: pts.map(() => 'stitched'), items: [] };
        poly.items = _renderPoly(poly);
        _polys.push(poly);
        _deselectPoly();
        _selectPoly(poly);
        _onAdded(poly);
        _onChange();
      }
      return;
    }
    if (_dragVertex) { _commitVertexDrag(); }
    if (_moveState)  { _commitMove(); }
  };

  _polyTool.onKeyDown = (event) => {
    if (event.key === 'enter' && _drawState && _drawState.pts.length >= 3) {
      _commitDraw();
    }
    if (event.key === 'escape') {
      if (_drawState) _cancelDraw();
      else _deselectPoly();
    }
    if ((event.key === 'delete' || event.key === 'backspace') && _selected) {
      _deleteSelected();
    }
  };
}

export function activatePolyMode() {
  _trapMode = false;
  if (_polyTool) _polyTool.activate();
}

// Trap mode: click-drag creates a 4-vertex trapezoid (wider at top, narrower at bottom)
// then switches to normal poly vertex-edit mode.
let _trapMode    = false;
let _trapDraft   = null; // draft paper item during drag
let _trapStart   = null; // {x,y} mm at drag start

export function activateTrapMode() {
  _trapMode = true;
  if (_polyTool) _polyTool.activate();
}

// Override onMouseDown/Drag/Up for trap when _trapMode is active
// (inserted before the normal poly handler)

export function deactivatePolyMode() {
  _trapMode = false;
  if (_trapDraft) { _trapDraft.remove(); _trapDraft = null; }
  if (_drawState) _cancelDraw();
  _deselectPoly();
}

export function redrawAllPolys() {
  _polys.forEach(poly => {
    poly.items.forEach(i => i.remove());
    poly.items = _renderPoly(poly);
  });
  if (_selected) _showVertexHandles(_selected);
}

export function getPolyStats() {
  const { pitch, margin } = getParams();
  let stitches = 0, marks = 0;
  _polys.forEach(poly => {
    poly.edges.forEach((state, i) => {
      if (state !== 'stitched') return;
      const [a, b] = _edgePts(poly, i);
      let stPts = [a, b];
      if (poly.tpocketParams) {
        // Use inset pts for accurate stitch count
        const { nx, ny } = _inwardNormal(a, b);
        stPts = [{ x: a.x + nx*margin, y: a.y + ny*margin },
                 { x: b.x + nx*margin, y: b.y + ny*margin }];
      }
      const { count } = placeMarks(stPts, pitch);
      stitches += count; marks += count + 1;
    });
  });
  return { count: _polys.length, stitches, marks };
}

export function getAllPolys()      { return _polys; }
export function getSelectedPoly() { return _selected; }
export function selectPoly(poly)  { _selectPoly(poly); }

export function movePolyBy(poly, dx, dy) {
  poly.pts = poly.pts.map(p => ({ x: p.x+dx, y: p.y+dy }));
  if (poly.tpocketParams) {
    // keep tpocketParams in sync with the new origin
    // (params store relative dimensions; position is poly.pts[0])
    // No change needed — tpocketVertices is called with translatePts each time
  }
  rerenderPoly(poly);
}

// Re-render a poly whose pts or edges have been updated externally (e.g. T-pocket param change).
export function rerenderPoly(poly) {
  poly.items.forEach(i => i.remove());
  poly.items = _renderPoly(poly);
  if (_selected === poly) _showVertexHandles(poly);
  _onChange();
}

// ── Edge / vertex geometry ────────────────────────────────────────────────────

function _edgePts(poly, i) {
  const { pts } = poly;
  return [pts[i], pts[(i + 1) % pts.length]];
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// Signed area of a polygon (positive = CW in screen coords where y increases down).
function _signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

// Build the cut outline for a polygon.
// All-stitched closed polygons use Clipper2 (handles winding automatically).
// Mixed-edge polygons use per-edge offsets with winding-corrected outward normals.
function _buildCutOutline(poly) {
  const { margin } = getParams();
  const n = poly.pts.length;

  // All-stitched: use Clipper2 for correct winding handling
  if (poly.edges.every(e => e === 'stitched')) {
    const rings = offsetPolyline([...poly.pts, poly.pts[0]], margin, true);
    return rings.length > 0 ? rings[0] : poly.pts;
  }

  // Mixed-edge: manual per-edge offset.
  // Detect winding: positive area = CW on screen (y-down) → outward = (dy,-dx)/len
  //                 negative area = CCW on screen          → outward = (-dy,dx)/len
  const cw = _signedArea(poly.pts) > 0;
  const outPts = [];

  for (let i = 0; i < n; i++) {
    const a = poly.pts[i], b = poly.pts[(i + 1) % n];
    const state = poly.edges[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    // Outward normal differs by winding direction
    const nx = cw ?  dy / len : -dy / len;
    const ny = cw ? -dx / len :  dx / len;

    if (state === 'stitched') {
      outPts.push({ x: a.x + nx * margin, y: a.y + ny * margin });
      outPts.push({ x: b.x + nx * margin, y: b.y + ny * margin });
    } else {
      outPts.push({ x: a.x, y: a.y });
      outPts.push({ x: b.x, y: b.y });
    }
  }

  const clean = [outPts[0]];
  for (let i = 1; i < outPts.length; i++) {
    const p = outPts[i], q = clean[clean.length - 1];
    if (Math.abs(p.x - q.x) > 0.001 || Math.abs(p.y - q.y) > 0.001) clean.push(p);
  }
  return clean;
}

// ── T-pocket cut-first rendering ─────────────────────────────────────────────
// The drawn pts ARE the cut outline. Stitch line + marks sit INSIDE, inset
// by margin using the edge's inward normal (CW polygon convention).

function _inwardNormal(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return { nx: 0, ny: 0, len: 0 };
  // CW polygon in screen coords (y-down): inward normal = (-dy, dx) / len
  return { nx: -dy / len, ny: dx / len, len };
}

function _renderTPocketCutFirst(poly) {
  const { pitch, margin, markType, showStitchLine, showCutOutline, showDimensions } = getItemParams(poly);
  const { pts } = poly;
  // Enforce T-pocket constraints: top edge (0) always hidden, shoulders (2,6) always hidden
  const edges = [...poly.edges];
  edges[0] = 'hidden';
  edges[2] = 'hidden';
  edges[6] = 'hidden';
  const n = pts.length;
  const items = [];
  const hasStitch = edges.some(e => e === 'stitched');

  // The drawn polygon IS the cut outline — draw it directly
  if (showCutOutline) {
    _layers.cutLayer.activate();
    const cutPath = new paper.Path({
      segments: pts.map(p => new paper.Point(px(p.x), px(p.y))),
      closed: true,
      strokeColor: hasStitch ? '#aaa' : '#555',
      strokeWidth:  hasStitch ? 0.75 : 1,
      strokeJoin: 'miter', miterLimit: 20,   // sharp right-angle corners
      strokeCap:  'square',
    });
    if (hasStitch) cutPath.dashArray = [4, 3];
    items.push(cutPath);
  }

  // Per-edge: stitch line and marks are INSET from the cut outline by margin
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const state = edges[i];
    if (state !== 'stitched') continue;

    const { nx, ny, len } = _inwardNormal(a, b);
    if (len === 0) continue;

    // Stitch endpoints — inset from the cut edge
    const as = { x: a.x + nx * margin, y: a.y + ny * margin };
    const bs = { x: b.x + nx * margin, y: b.y + ny * margin };
    const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x);

    if (showStitchLine) {
      _layers.stitchLayer.activate();
      const sp = new paper.Path({
        segments: [new paper.Point(px(as.x), px(as.y)), new paper.Point(px(bs.x), px(bs.y))],
        strokeColor: '#2c7bb6',
        strokeWidth: 1,
      });
      sp.data = { isStitch: true };
      items.push(sp);
    }

    // Marks on the inset stitch line
    _layers.markLayer.activate();
    const sMark = { x: as.x, y: as.y, angle: edgeAngle };
    const eMark = { x: bs.x, y: bs.y, angle: edgeAngle };
    const { marks } = placeMarks([as, bs], pitch);
    for (const m of marks) items.push(createMark(m, markType));

    // Dimension label outside the cut edge (outward direction = -inward)
    if (showDimensions) {
      const { snappedLength } = snapToStitches(len, pitch);
      const ox = (a.x + b.x) / 2 + (-nx) * (margin + 2.5); // outward offset
      const oy = (a.y + b.y) / 2 + (-ny) * (margin + 2.5);
      _layers.stitchLayer.activate();
      items.push(new paper.PointText({
        point: new paper.Point(px(ox), px(oy)),
        content: `${snappedLength.toFixed(1)} mm`,
        fontSize: 9,
        fillColor: '#4a8ab5',
        justification: 'center',
      }));
    }
  }

  return items;
}

function _renderPoly(poly) {
  // T-pocket: pts = cut outline, stitch inset by margin (cut-first model)
  if (poly.tpocketParams) return _renderTPocketCutFirst(poly);

  const { pitch, margin, markType, showStitchLine, showCutOutline, showDimensions } = getItemParams(poly);
  const items = [];
  const n = poly.pts.length;

  // Cut outline
  if (showCutOutline) {
    const cutPts = _buildCutOutline(poly);
    const hasStitch = poly.edges.some(e => e === 'stitched');
    _layers.cutLayer.activate();
    const cutPath = new paper.Path({
      segments: cutPts.map(p => new paper.Point(px(p.x), px(p.y))),
      closed: true,
      strokeColor: hasStitch ? '#aaa' : '#555',
      strokeWidth:  hasStitch ? 0.75 : 1,
      strokeJoin: 'miter', miterLimit: 20,
    });
    if (hasStitch) cutPath.dashArray = [4, 3];
    items.push(cutPath);
  }

  // Per-edge rendering
  for (let i = 0; i < n; i++) {
    const [a, b] = _edgePts(poly, i);
    const state  = poly.edges[i];

    if (state === 'stitched') {
      if (showStitchLine) {
        _layers.stitchLayer.activate();
        const sp = new paper.Path({
          segments: [[px(a.x), px(a.y)], [px(b.x), px(b.y)]],
          strokeColor: '#2c7bb6',
          strokeWidth: 1,
        });
        sp.data = { isStitch: true };
        items.push(sp);
      }
      _layers.markLayer.activate();
      const { marks } = placeMarks([a, b], pitch);
      for (const m of marks) items.push(createMark(m, markType));

      // Edge dim label
      if (showDimensions) {
        const edgeLen = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2);
        const { snappedLength } = snapToStitches(edgeLen, pitch);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const perpAngle = angle - Math.PI / 2;
        const offset = px(margin) + 9;
        _layers.stitchLayer.activate();
        items.push(new paper.PointText({
          point: new paper.Point(
            px((a.x + b.x) / 2) + Math.cos(perpAngle) * offset,
            px((a.y + b.y) / 2) + Math.sin(perpAngle) * offset,
          ),
          content: `${snappedLength.toFixed(1)} mm`,
          fontSize: 9,
          fillColor: '#4a8ab5',
          justification: 'center',
        }));
      }
    } else if (state === 'open') {
      _layers.stitchLayer.activate();
      items.push(new paper.Path({
        segments: [[px(a.x), px(a.y)], [px(b.x), px(b.y)]],
        strokeColor: '#666',
        strokeWidth: 0.75,
        dashArray: [3, 3],
      }));
    }
    // hidden — nothing drawn
  }

  return items;
}

// ── Vertex handles ─────────────────────────────────────────────────────────────

function _showVertexHandles(poly) {
  if (poly.tpocketParams) { _showTPocketHandles(poly); return; }
  _clearHandles();
  _layers.handleLayer.activate();
  poly.pts.forEach((p, i) => {
    const h = HANDLE_PX / 2;
    const sq = new paper.Path.Rectangle(
      new paper.Point(px(p.x) - h, px(p.y) - h),
      new paper.Size(HANDLE_PX, HANDLE_PX),
    );
    sq.fillColor   = 'white';
    sq.strokeColor = '#2c7bb6';
    sq.strokeWidth = 1;
    sq.data = { vertexIdx: i };
    _handles.push(sq);
  });
}

// ── T-Pocket named handles ────────────────────────────────────────────────────
// 5 constrained handles — each controls exactly one parameter.
// Ear corners always stay 90°; left and right are always symmetric.

function _showTPocketHandles(poly) {
  _clearHandles();
  const p  = poly.tpocketParams;
  const ox = poly.pts[0].x, oy = poly.pts[0].y;

  // [ param, x_mm, y_mm, drag-axis, color ]
  const defs = [
    { param: 'tw', x: ox,                       y: oy + p.th / 2,  dir: 'h', label: 'T width'  },
    { param: 'th', x: ox + p.tw / 2,            y: oy,             dir: 'v', label: 'T height' },
    { param: 'tt', x: ox + p.tt,                y: oy + p.th,      dir: 'h', label: 'T tab'   },
    { param: 'bw', x: ox + (p.tw - p.bw) / 2,  y: oy + p.h,       dir: 'h', label: 'Base W'  },
    { param: 'h',  x: ox + p.tw / 2,            y: oy + p.h,       dir: 'v', label: 'Height'  },
  ];

  _layers.handleLayer.activate();
  defs.forEach((def, i) => {
    const h = HANDLE_PX / 2;
    const sq = new paper.Path.Rectangle(
      new paper.Point(px(def.x) - h, px(def.y) - h),
      new paper.Size(HANDLE_PX, HANDLE_PX),
    );
    sq.fillColor   = '#f39c12';   // orange — distinguishes T-pocket handles
    sq.strokeColor = '#e67e22';
    sq.strokeWidth = 1;
    sq.data = { vertexIdx: i, tpParam: def.param, tpDir: def.dir };
    _handles.push(sq);
  });
}

function _isTPocketHandle(handle) {
  return !!handle?.data?.tpParam;
}

function _clearHandles() {
  _handles.forEach(h => h.remove());
  _handles = [];
}

function _hitVertex(poly, point) {
  for (const h of _handles) {
    if (point.getDistance(h.position) <= VERTEX_HIT_PX) return h.data.vertexIdx;
  }
  return -1;
}

// ── Selection ──────────────────────────────────────────────────────────────────

function _selectPoly(poly) {
  _selected = poly;
  _showVertexHandles(poly);
  _onChange();
}

function _deselectPoly() {
  _clearHandles();
  _selected = null;
  _onChange();
}

// ── Edge hit + toggle ──────────────────────────────────────────────────────────

function _distToSeg(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return pt.getDistance(new paper.Point(a.x, a.y));
  const t = Math.max(0, Math.min(1, ((pt.x - a.x)*dx + (pt.y - a.y)*dy) / lenSq));
  return pt.getDistance(new paper.Point(a.x + t*dx, a.y + t*dy));
}

function _hitEdge(poly, point) {
  let closest = -1, minDist = EDGE_HIT_PX;
  const n = poly.pts.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = _edgePts(poly, i);
    const d = _distToSeg(point, { x: px(a.x), y: px(a.y) }, { x: px(b.x), y: px(b.y) });
    if (d < minDist) { minDist = d; closest = i; }
  }
  return closest;
}

const _EDGE_CYCLE = { stitched: 'open', open: 'hidden', hidden: 'stitched' };

function _toggleEdge(poly, idx) {
  // T-pocket: top edge (index 0) is the pocket mouth — never stitchable
  if (poly.tpocketParams && idx === 0) return;
  poly.edges[idx] = _EDGE_CYCLE[poly.edges[idx]] ?? 'open';
  poly.items.forEach(i => i.remove());
  poly.items = _renderPoly(poly);
  if (_selected === poly) _showVertexHandles(poly);
  _onChange();
}

// ── Inside hit (for move) ──────────────────────────────────────────────────────

function _hitInside(poly, point) {
  // Simple bounding box check, inset from edges
  const { margin } = getParams();
  const xs = poly.pts.map(p => px(p.x));
  const ys = poly.pts.map(p => px(p.y));
  const pad = EDGE_HIT_PX;
  return point.x > Math.min(...xs) + pad && point.x < Math.max(...xs) - pad &&
         point.y > Math.min(...ys) + pad && point.y < Math.max(...ys) - pad;
}

function _hitAnyPoly(point) {
  for (let i = _polys.length - 1; i >= 0; i--) {
    if (_hitEdge(_polys[i], point) !== -1 || _hitInside(_polys[i], point)) return _polys[i];
  }
  return null;
}

// ── Draw ───────────────────────────────────────────────────────────────────────

function _startDraw(point) {
  const ptMm = { x: toMm(point.x), y: toMm(point.y) };
  _layers.stitchLayer.activate();
  const vertex = new paper.Path.Circle(point, 3);
  vertex.fillColor = '#2c7bb6';
  _drawState = { pts: [ptMm], draftItems: [vertex], ghostLine: null };
}

function _addDrawVertex(point) {
  if (!_drawState) return;
  const ptMm = { x: toMm(point.x), y: toMm(point.y) };
  _drawState.pts.push(ptMm);
  _layers.stitchLayer.activate();
  const vertex = new paper.Path.Circle(point, 3);
  vertex.fillColor = '#2c7bb6';
  _drawState.draftItems.push(vertex);

  // Draw edge from previous point
  const prev = _drawState.pts[_drawState.pts.length - 2];
  const edge = new paper.Path({
    segments: [new paper.Point(px(prev.x), px(prev.y)), point],
    strokeColor: '#2c7bb6',
    strokeWidth: 1,
    opacity: 0.5,
  });
  _drawState.draftItems.push(edge);
}

function _updateGhost(point) {
  if (_drawState.ghostLine) _drawState.ghostLine.remove();
  const last = _drawState.pts[_drawState.pts.length - 1];
  _layers.stitchLayer.activate();
  _drawState.ghostLine = new paper.Path({
    segments: [new paper.Point(px(last.x), px(last.y)), point],
    strokeColor: '#2c7bb6',
    strokeWidth: 1,
    opacity: 0.35,
    dashArray: [4, 4],
  });
}

function _commitDraw() {
  if (!_drawState) return;
  const { pts, draftItems, ghostLine } = _drawState;
  draftItems.forEach(i => i.remove());
  if (ghostLine) ghostLine.remove();
  _drawState = null;

  if (pts.length < 3) return; // need at least a triangle

  const poly = {
    pts,
    edges: pts.map(() => 'stitched'), // all stitched by default
    items: [],
  };
  poly.items = _renderPoly(poly);
  _polys.push(poly);
  _deselectPoly();
  _selectPoly(poly);
  _onAdded(poly);
  _onChange();
}

function _cancelDraw() {
  if (!_drawState) return;
  _drawState.draftItems.forEach(i => i.remove());
  if (_drawState.ghostLine) _drawState.ghostLine.remove();
  _drawState = null;
}

// ── Vertex drag (reshape) ──────────────────────────────────────────────────────

function _startVertexDrag(idx, point) {
  _dragVertex = {
    poly:         _selected,
    idx,
    origPts:      _selected.pts.map(p => ({...p})),
    startPoint:   point,
    origTPParams: _selected.tpocketParams ? { ..._selected.tpocketParams } : null,
  };
}

function _updateVertexDrag(point) {
  if (!_dragVertex) return;
  const { poly, idx, origPts, startPoint, origTPParams } = _dragVertex;
  const handle = _handles[idx];

  // ── T-pocket constrained drag ─────────────────────────────────────────────
  if (origTPParams && _isTPocketHandle(handle)) {
    const { tpParam: param, tpDir: dir } = handle.data;
    const rawDx = toMm(point.x - startPoint.x);
    const rawDy = toMm(point.y - startPoint.y);
    const dx = (dir === 'h') ? rawDx : 0;
    const dy = (dir === 'v') ? rawDy : 0;

    let np = { ...origTPParams };
    if      (param === 'tw') np.tw = Math.max(20, origTPParams.tw - 2 * dx); // left edge → symmetric
    else if (param === 'th') np.th = Math.max(5,  origTPParams.th + dy);     // top center → ear height
    else if (param === 'tt') np.tt = Math.max(5,  origTPParams.tt + dx);     // inner shoulder → mirrors
    else if (param === 'bw') np.bw = Math.max(10, origTPParams.bw - 2 * dx); // base corner → symmetric
    else if (param === 'h')  np.h  = Math.max(20, origTPParams.h  + dy);     // bottom center → height

    const clamped = clampParams(np);
    poly.tpocketParams = clamped;
    poly.pts = translatePts(tpocketVertices(clamped), poly.pts[0].x, poly.pts[0].y);
    poly.items.forEach(i => i.remove());
    poly.items = _renderPoly(poly);
    _showTPocketHandles(poly);
    _onChange();
    return;
  }

  // ── Generic polygon vertex drag ────────────────────────────────────────────
  const newPts = origPts.map((p, i) => i === idx
    ? { x: toMm(point.x), y: toMm(point.y) }
    : p);
  poly.pts = newPts;
  poly.items.forEach(i => i.remove());
  poly.items = _renderPoly(poly);
  _showVertexHandles(poly);
}

function _commitVertexDrag() {
  _dragVertex = null;
  _onChange();
}

// ── Move ───────────────────────────────────────────────────────────────────────

function _startMove(point) {
  _moveState = { start: point, origPts: _selected.pts.map(p => ({...p})) };
}

function _updateMove(point) {
  if (!_moveState || !_selected) return;
  const dx = toMm(point.x - _moveState.start.x);
  const dy = toMm(point.y - _moveState.start.y);
  _selected.pts = _moveState.origPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
  _selected.items.forEach(i => i.remove());
  _selected.items = _renderPoly(_selected);
  _showVertexHandles(_selected);
}

function _commitMove() {
  _moveState = null;
  _onChange();
}

// ── Delete ─────────────────────────────────────────────────────────────────────

function _deleteSelected() {
  if (!_selected) return;
  _selected.items.forEach(i => i.remove());
  _clearHandles();
  _polys.splice(_polys.indexOf(_selected), 1);
  _onDeleted(_selected);
  _selected = null;
  _onChange();
}
