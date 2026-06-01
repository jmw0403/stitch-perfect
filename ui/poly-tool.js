// ui/poly-tool.js — Polygon shape tool
// `paper` is a global set by the paper.js script tag.

import { placeMarks, snapToStitches } from '../engine/stitch.js';
import { offsetPolyline } from '../engine/offset.js';
import { getParams } from './controls.js';
import { px, toMm, createMark } from './render.js';

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
  const { pitch } = getParams();
  let stitches = 0, marks = 0;
  _polys.forEach(poly => {
    poly.edges.forEach((state, i) => {
      if (state !== 'stitched') return;
      const pts = _edgePts(poly, i);
      const { count } = placeMarks(pts, pitch);
      stitches += count; marks += count + 1;
    });
  });
  return { count: _polys.length, stitches, marks };
}

export function getAllPolys() { return _polys; }

// ── Edge / vertex geometry ────────────────────────────────────────────────────

function _edgePts(poly, i) {
  const { pts } = poly;
  return [pts[i], pts[(i + 1) % pts.length]];
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// Build the cut outline for a mixed-edge polygon:
// - Stitched edges → their individual cut-side lines (offset outward by margin)
// - Non-stitched edges → flush (the drawn edge itself)
// We assemble these into a closed path approximating the cut outline.
function _buildCutOutline(poly) {
  const { margin } = getParams();
  const n = poly.pts.length;
  const outPts = []; // collect outward side of each edge

  for (let i = 0; i < n; i++) {
    const a = poly.pts[i];
    const b = poly.pts[(i + 1) % n];
    const state = poly.edges[i];

    if (state === 'stitched') {
      // Normal vector outward (perpendicular, pointing left of a→b direction)
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const nx = -dy / len * margin, ny = dx / len * margin;
      outPts.push({ x: a.x + nx, y: a.y + ny });
      outPts.push({ x: b.x + nx, y: b.y + ny });
    } else {
      // Flush — use the actual vertices
      outPts.push({ x: a.x, y: a.y });
      outPts.push({ x: b.x, y: b.y });
    }
  }

  // Deduplicate consecutive identical points
  const clean = [outPts[0]];
  for (let i = 1; i < outPts.length; i++) {
    const p = outPts[i], q = clean[clean.length - 1];
    if (Math.abs(p.x - q.x) > 0.001 || Math.abs(p.y - q.y) > 0.001) clean.push(p);
  }
  return clean;
}

function _renderPoly(poly) {
  const { pitch, margin, markType, showStitchLine, showCutOutline, showDimensions } = getParams();
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
        items.push(new paper.Path({
          segments: [[px(a.x), px(a.y)], [px(b.x), px(b.y)]],
          strokeColor: '#2c7bb6',
          strokeWidth: 1,
        }));
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
    poly:      _selected,
    idx,
    origPts:   _selected.pts.map(p => ({...p})),
    startPoint: point,
  };
}

function _updateVertexDrag(point) {
  if (!_dragVertex) return;
  const { poly, idx, origPts, startPoint } = _dragVertex;
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
