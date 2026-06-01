// ui/rect-tool.js — rectangle shape tool
// `paper` is a global set by the paper.js script tag.

import { placeMarks, snapToStitches } from '../engine/stitch.js';
import { offsetPolyline } from '../engine/offset.js';
import { getParams, getItemParams } from './controls.js';
import { px, toMm, createMark } from './render.js';

const HANDLE_PX   = 8;   // handle square side length in px
const EDGE_HIT_PX = 10;  // click-to-edge tolerance in px

// Injected by initRectTool
let _layers = null; // { cutLayer, stitchLayer, markLayer, handleLayer }

// State
const _rects    = []; // committed RectPiece[]
let _selected   = null;
let _handles    = []; // paper items for corner handles

let _drawState   = null; // { startMm, endMm, draft }
let _resizeState = null; // { corner, fixed: {x,y} mm }
let _moveState   = null; // { start: paper.Point, origX, origY }

let _onChange = () => {}; // callback → canvas.js calls updateStatus + updateSelInfo

const _dimLabelEl = () => document.getElementById('dim-label');

// ── Init ──────────────────────────────────────────────────────────────────────

let _onRectAdded   = () => {};
let _onRectDeleted = () => {};

export function initRectTool(layers, onChangeFn, onAddedFn, onDeletedFn) {
  _layers = layers;
  if (onChangeFn)  _onChange      = onChangeFn;
  if (onAddedFn)   _onRectAdded   = onAddedFn;
  if (onDeletedFn) _onRectDeleted = onDeletedFn;

  const tool = new paper.Tool();

  tool.onMouseDown = (event) => {
    if (_resizeState || _moveState) return;

    // 1. Handle hit on selected rect → resize
    if (_selected) {
      const corner = _hitHandle(event.point);
      if (corner) { _startResize(corner); return; }
    }

    // 2. Edge click on selected rect → toggle stitch/open
    if (_selected) {
      const side = _hitEdge(_selected, event.point);
      if (side) { _toggleEdge(_selected, side); return; }
    }

    // 3. Click inside selected rect → move
    if (_selected && _hitInside(_selected, event.point)) {
      _startMove(event.point); return;
    }

    // 4. Click on any other rect → select it
    const hit = _hitAnyRect(event.point);
    if (hit) {
      if (hit !== _selected) { _deselectRect(); _selectRect(hit); }
      return; // don't start drawing
    }

    // 5. Click on empty canvas → deselect and start drawing
    _deselectRect();
    _startDraw(event.point);
  };

  tool.onMouseDrag = (event) => {
    if (_drawState)   { _updateDraw(event.point);   return; }
    if (_resizeState) { _updateResize(event.point); return; }
    if (_moveState)   { _updateMove(event.point);   return; }
  };

  tool.onMouseUp = () => {
    if (_drawState)   _commitDraw();
    if (_resizeState) _commitResize();
    if (_moveState)   _commitMove();
  };

  tool.onKeyDown = (event) => {
    if ((event.key === 'delete' || event.key === 'backspace') && _selected) {
      _deleteSelected();
    }
    if (event.key === 'escape') {
      if (_drawState) _cancelDraw();
      else _deselectRect();
    }
  };

  // Store on module so canvas.js can activate it
  _rectTool = tool;
}

let _rectTool = null;

export function activateRectMode() {
  if (_rectTool) _rectTool.activate();
}

export function deactivateRectMode() {
  if (_drawState)  _cancelDraw();
  _deselectRect();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function redrawAllRects() {
  const { pitch } = getParams();
  _rects.forEach(rect => {
    // Re-snap to new pitch — dimensions jump by at most pitch/2
    rect.w = snapToStitches(rect.w, pitch).snappedLength;
    rect.h = snapToStitches(rect.h, pitch).snappedLength;
    rect.items.forEach(item => item.remove());
    rect.items = _renderRect(rect);
  });
  if (_selected) _showHandles(_selected);
}

// Returns the live selected rect object (for vis override and direct mutation).
export function getSelectedRectRef() { return _selected; }

// Returns a snapshot of the selected rect (including edge states) for the Piece tab.
export function getSelectedRect() {
  if (!_selected) return null;
  return {
    x: _selected.x, y: _selected.y,
    w: _selected.w, h: _selected.h,
    edges: { ..._selected.edges },
  };
}

// Toggle a named edge of the selected rect — called from the Piece tab edge buttons.
export function toggleSelectedEdge(side) {
  if (!_selected) return;
  _toggleEdge(_selected, side);
}

// Returns the live _rects array — for multi-select / group coordination.
export function getAllRects() { return _rects; }

// Move a specific rect to an absolute position (used by group move).
export function moveRectTo(rect, x, y) {
  rect.x = x;
  rect.y = y;
  rect.items.forEach(i => i.remove());
  rect.items = _renderRect(rect);
  if (_selected === rect) _showHandles(rect);
}

// Delete a specific rect (used by multi-delete and group-delete).
export function deleteRect(rect) {
  if (_selected === rect) { _clearHandles(); _selected = null; }
  rect.items.forEach(i => i.remove());
  const idx = _rects.indexOf(rect);
  if (idx !== -1) _rects.splice(idx, 1);
  _onRectDeleted(rect);
  _onChange();
}

// Returns a deep copy of the selected rect's data for clipboard use.
export function copySelectedRect() {
  if (!_selected) return null;
  return {
    x: _selected.x, y: _selected.y,
    w: _selected.w, h: _selected.h,
    edges: { ..._selected.edges },
  };
}

// Paste a previously copied rect, offset by `pitchMm` diagonally.
export function pasteRect(data, pitchMm) {
  const rect = {
    x: data.x + pitchMm, y: data.y + pitchMm,
    w: data.w, h: data.h,
    edges: { ...data.edges },
    items: [],
  };
  rect.items = _renderRect(rect);
  _rects.push(rect);
  _deselectRect();
  _selectRect(rect);
  _onChange();
}

// Flip the selected rect horizontally (mirror across its vertical centre axis).
// Edge L↔R swap; geometry unchanged (still a rectangle, same size).
export function flipSelectedRect(axis) {
  if (!_selected) return;
  const e = _selected.edges;
  if (axis === 'h') {
    [e.left, e.right] = [e.right, e.left];
  } else {
    [e.top, e.bottom] = [e.bottom, e.top];
  }
  _selected.items.forEach(i => i.remove());
  _selected.items = _renderRect(_selected);
  _showHandles(_selected);
  _onChange();
}

export function getRectStats() {
  const { pitch } = getParams();
  let stitches = 0, marks = 0;
  _rects.forEach(rect => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (rect.edges[side] !== 'stitched') continue;
      const { count } = placeMarks(_edgePts(rect, side), pitch);
      stitches += count;
      marks    += count + 1;
    }
  });
  return { count: _rects.length, stitches, marks };
}

// ── Edge geometry ─────────────────────────────────────────────────────────────

function _edgePts(rect, side) {
  const { x, y, w, h } = rect;
  return ({
    top:    [{ x,     y     }, { x: x + w, y       }],
    right:  [{ x: x + w, y }, { x: x + w, y: y + h }],
    bottom: [{ x: x + w, y: y + h }, { x, y: y + h }],
    left:   [{ x, y: y + h }, { x, y               }],
  })[side];
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderRect(rect) {
  const { pitch, margin, markType, showStitchLine, showCutOutline } = getItemParams(rect);
  const { x, y, w, h } = rect;
  const items = [];

  // Cut outline — gated by showCutOutline
  if (showCutOutline) {
    const closedPts = [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y },
    ];
    // No stitches → solid cut line; has stitches → dashed ghost
    const hasStitch = Object.values(rect.edges).some(e => e === 'stitched');
    _layers.cutLayer.activate();
    for (const ring of offsetPolyline(closedPts, margin, true, { joinType: 'miter' })) {
      const cutPath = new paper.Path({
        segments: ring.map(p => new paper.Point(px(p.x), px(p.y))),
        closed: true,
        strokeColor: hasStitch ? '#aaa' : '#555',
        strokeWidth:  hasStitch ? 0.75 : 1,
        strokeJoin: 'miter', miterLimit: 20,
      });
      if (hasStitch) cutPath.dashArray = [4, 3];
      items.push(cutPath);
    }
  }

  // Per-edge: stitch line + marks (stitched) or dim dashed line (open)
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const pts = _edgePts(rect, side);

    if (rect.edges[side] === 'stitched') {
      if (showStitchLine) {
        _layers.stitchLayer.activate();
        items.push(new paper.Path({
          segments: pts.map(p => new paper.Point(px(p.x), px(p.y))),
          strokeColor: '#2c7bb6',
          strokeWidth: 1,
        }));
      }
      _layers.markLayer.activate();
      const { marks } = placeMarks(pts, pitch);
      for (const m of marks) items.push(createMark(m, markType));
    } else if (rect.edges[side] === 'open') {
      _layers.stitchLayer.activate();
      items.push(new paper.Path({
        segments: pts.map(p => new paper.Point(px(p.x), px(p.y))),
        strokeColor: '#666',
        strokeWidth: 0.75,
        dashArray: [3, 3],
      }));
    }
    // 'hidden' — nothing drawn for this edge
  }

  // Per-side dimension labels — only when showDimensions is on
  if (!getParams().showDimensions) return items;
  _layers.stitchLayer.activate();
  const GAP = 9; // px clearance outside cut line

  const sideLabels = [
    // side, content-mm, point, justification
    { side: 'top',
      pt: new paper.Point(px(x + w / 2), px(y - margin) - GAP),
      just: 'center', dim: w },
    { side: 'bottom',
      pt: new paper.Point(px(x + w / 2), px(y + h + margin) + GAP + 9),
      just: 'center', dim: w },
    { side: 'left',
      pt: new paper.Point(px(x - margin) - GAP, px(y + h / 2) + 3),
      just: 'right', dim: h },
    { side: 'right',
      pt: new paper.Point(px(x + w + margin) + GAP, px(y + h / 2) + 3),
      just: 'left', dim: h },
  ];

  for (const { side, pt, just, dim } of sideLabels) {
    items.push(new paper.PointText({
      point: pt,
      content: `${dim.toFixed(1)} mm`,
      fontSize: 9,
      fillColor: rect.edges[side] === 'stitched' ? '#4a8ab5'
               : rect.edges[side] === 'open'     ? '#666'
               : '#333', // hidden — very dim, just to show dimension still exists
      justification: just,
    }));
  }

  return items;
}

// ── Handles ───────────────────────────────────────────────────────────────────

function _handleCenter(rect, corner) {
  const { x, y, w, h } = rect;
  return ({
    nw: new paper.Point(px(x),     px(y)),
    ne: new paper.Point(px(x + w), px(y)),
    se: new paper.Point(px(x + w), px(y + h)),
    sw: new paper.Point(px(x),     px(y + h)),
  })[corner];
}

function _showHandles(rect) {
  _clearHandles();
  _layers.handleLayer.activate();
  for (const corner of ['nw', 'ne', 'se', 'sw']) {
    const c = _handleCenter(rect, corner);
    const h = HANDLE_PX / 2;
    const handle = new paper.Path.Rectangle(
      new paper.Point(c.x - h, c.y - h),
      new paper.Size(HANDLE_PX, HANDLE_PX),
    );
    handle.fillColor   = 'white';
    handle.strokeColor = '#2c7bb6';
    handle.strokeWidth = 1.5;
    handle.data = { corner };
    _handles.push(handle);
  }
}

function _clearHandles() {
  _handles.forEach(h => h.remove());
  _handles = [];
}

function _hitHandle(point) {
  for (const h of _handles) {
    if (point.getDistance(h.position) <= HANDLE_PX + 2) return h.data.corner;
  }
  return null;
}

// ── Selection ─────────────────────────────────────────────────────────────────

function _selectRect(rect) {
  _selected = rect;
  _showHandles(rect);
  _onChange();
}

function _deselectRect() {
  _clearHandles();
  _selected = null;
  _onChange();
}

// True if point is strictly inside the rect (away from edges)
function _hitInside(rect, point) {
  return point.x > px(rect.x) + EDGE_HIT_PX &&
         point.x < px(rect.x + rect.w) - EDGE_HIT_PX &&
         point.y > px(rect.y) + EDGE_HIT_PX &&
         point.y < px(rect.y + rect.h) - EDGE_HIT_PX;
}

// True if point is anywhere on or near the rect boundary/interior
function _hitRect(rect, point) {
  return point.x >= px(rect.x)         - EDGE_HIT_PX &&
         point.x <= px(rect.x + rect.w) + EDGE_HIT_PX &&
         point.y >= px(rect.y)         - EDGE_HIT_PX &&
         point.y <= px(rect.y + rect.h) + EDGE_HIT_PX;
}

// Returns the topmost rect hit by point, or null
function _hitAnyRect(point) {
  for (let i = _rects.length - 1; i >= 0; i--) {
    if (_hitRect(_rects[i], point)) return _rects[i];
  }
  return null;
}

// ── Edge toggle ───────────────────────────────────────────────────────────────

function _distToSegment(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return pt.getDistance(new paper.Point(a.x, a.y));
  const t = Math.max(0, Math.min(1,
    ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  return pt.getDistance(new paper.Point(a.x + t * dx, a.y + t * dy));
}

function _hitEdge(rect, point) {
  const { x, y, w, h } = rect;
  const edgesPx = {
    top:    [{ x: px(x),     y: px(y)     }, { x: px(x + w), y: px(y)     }],
    right:  [{ x: px(x + w), y: px(y)     }, { x: px(x + w), y: px(y + h) }],
    bottom: [{ x: px(x + w), y: px(y + h) }, { x: px(x),     y: px(y + h) }],
    left:   [{ x: px(x),     y: px(y + h) }, { x: px(x),     y: px(y)     }],
  };
  let closest = null, minDist = EDGE_HIT_PX;
  for (const [side, [a, b]] of Object.entries(edgesPx)) {
    const d = _distToSegment(point, a, b);
    if (d < minDist) { minDist = d; closest = side; }
  }
  return closest;
}

// Cycle: stitched → open → hidden → stitched
const _EDGE_CYCLE = { stitched: 'open', open: 'hidden', hidden: 'stitched' };

function _toggleEdge(rect, side) {
  rect.edges[side] = _EDGE_CYCLE[rect.edges[side]] ?? 'open';
  rect.items.forEach(i => i.remove());
  rect.items = _renderRect(rect);
  if (_selected === rect) _showHandles(rect);
  _onChange();
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function _startDraw(point) {
  const startMm = { x: toMm(point.x), y: toMm(point.y) };
  _layers.stitchLayer.activate();
  const draft = new paper.Path.Rectangle(point, new paper.Size(1, 1));
  draft.strokeColor = '#2c7bb6';
  draft.strokeWidth = 1.5;
  draft.opacity     = 0.45;
  draft.fillColor   = null;
  _drawState = { startMm, endMm: startMm, draft };
}

function _updateDraw(point) {
  if (!_drawState) return;
  const { startMm, draft } = _drawState;
  const endMm = { x: toMm(point.x), y: toMm(point.y) };
  const x = Math.min(startMm.x, endMm.x);
  const y = Math.min(startMm.y, endMm.y);
  const w = Math.abs(endMm.x - startMm.x);
  const h = Math.abs(endMm.y - startMm.y);

  draft.remove();
  _layers.stitchLayer.activate();
  const newDraft = new paper.Path.Rectangle(
    new paper.Point(px(x), px(y)),
    new paper.Size(px(w), px(h)),
  );
  newDraft.strokeColor = '#2c7bb6';
  newDraft.strokeWidth = 1.5;
  newDraft.opacity     = 0.45;
  newDraft.fillColor   = null;
  _drawState.draft  = newDraft;
  _drawState.endMm  = endMm;

  const lbl = _dimLabelEl();
  lbl.style.display = 'block';
  lbl.style.left    = (point.x + 14) + 'px';
  lbl.style.top     = (point.y + 14) + 'px';
  const { snappedLength: sW } = snapToStitches(w, getParams().pitch);
  const { snappedLength: sH } = snapToStitches(h, getParams().pitch);
  lbl.textContent = `${sW.toFixed(2)} × ${sH.toFixed(2)} mm`;
}

function _commitDraw() {
  if (!_drawState) return;
  const { startMm, endMm, draft } = _drawState;
  draft.remove();
  _dimLabelEl().style.display = 'none';
  _drawState = null;

  const x = Math.min(startMm.x, endMm.x);
  const y = Math.min(startMm.y, endMm.y);
  const w = Math.abs(endMm.x - startMm.x);
  const h = Math.abs(endMm.y - startMm.y);

  const { pitch } = getParams();
  if (w < pitch || h < pitch) return; // too small to fit any stitches

  // Snap dimensions to whole-pitch multiples so the piece matches true stitch counts
  const { snappedLength: snappedW } = snapToStitches(w, pitch);
  const { snappedLength: snappedH } = snapToStitches(h, pitch);

  // Edge states: 'stitched' | 'open' | 'hidden'
  const rect = {
    x, y, w: snappedW, h: snappedH,
    edges: { top: 'stitched', right: 'stitched', bottom: 'stitched', left: 'stitched' },
    items: [],
  };
  rect.items = _renderRect(rect);
  _rects.push(rect);
  _selectRect(rect);
  _onRectAdded(rect);
  _onChange();
}

function _cancelDraw() {
  if (!_drawState) return;
  _drawState.draft.remove();
  _dimLabelEl().style.display = 'none';
  _drawState = null;
}

// ── Resize ────────────────────────────────────────────────────────────────────

function _startResize(corner) {
  if (!_selected) return;
  const { x, y, w, h } = _selected;
  const fixed = ({
    nw: { x: x + w, y: y + h },
    ne: { x: x,     y: y + h },
    se: { x: x,     y         },
    sw: { x: x + w, y         },
  })[corner];
  _resizeState = { corner, fixed };
}

function _updateResize(point) {
  if (!_resizeState || !_selected) return;
  const { fixed } = _resizeState;
  const moveMm = { x: toMm(point.x), y: toMm(point.y) };
  const { pitch } = getParams();

  const rawW = Math.abs(moveMm.x - fixed.x);
  const rawH = Math.abs(moveMm.y - fixed.y);
  if (rawW < pitch || rawH < pitch) return;

  // Snap to whole-pitch multiples live during resize
  const { snappedLength: newW } = snapToStitches(rawW, pitch);
  const { snappedLength: newH } = snapToStitches(rawH, pitch);
  const newX = fixed.x <= moveMm.x ? fixed.x : fixed.x - newW;
  const newY = fixed.y <= moveMm.y ? fixed.y : fixed.y - newH;

  _selected.x = newX;
  _selected.y = newY;
  _selected.w = newW;
  _selected.h = newH;

  _selected.items.forEach(i => i.remove());
  _selected.items = _renderRect(_selected);
  _showHandles(_selected);

  const lbl = _dimLabelEl();
  lbl.style.display = 'block';
  lbl.style.left    = (point.x + 14) + 'px';
  lbl.style.top     = (point.y + 14) + 'px';
  lbl.textContent   = `${newW.toFixed(2)} × ${newH.toFixed(2)} mm`;
}

function _commitResize() {
  _dimLabelEl().style.display = 'none';
  _resizeState = null;
}

// ── Snap helpers ──────────────────────────────────────────────────────────────

const SNAP_MM = 3;

function _rectSnapPoints(rect, { vertices, midpoints }) {
  const { x, y, w, h } = rect;
  const pts = [];
  if (vertices)  pts.push({x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h});
  if (midpoints) pts.push({x:x+w/2,y},{x:x+w,y:y+h/2},{x:x+w/2,y:y+h},{x,y:y+h/2});
  return pts;
}

// Public: lets canvas.js collect rect snap points for cross-piece snapping
export function getRectSnapPoints(types) {
  const pts = [];
  for (const r of _rects) pts.push(..._rectSnapPoints(r, types));
  return pts;
}

let _snapIndicator = null;

function _showSnapAt(mmPt) {
  if (_snapIndicator) { _snapIndicator.remove(); _snapIndicator = null; }
  if (!mmPt) return;
  _layers.handleLayer.activate();
  _snapIndicator = new paper.Path.Circle(new paper.Point(px(mmPt.x), px(mmPt.y)), 5);
  _snapIndicator.strokeColor = '#f39c12';
  _snapIndicator.strokeWidth = 1.5;
  _snapIndicator.fillColor   = null;
}

// ── Move ──────────────────────────────────────────────────────────────────────

function _startMove(point) {
  _moveState = { start: point, origX: _selected.x, origY: _selected.y };
}

function _updateMove(point) {
  if (!_moveState || !_selected) return;
  let dx = toMm(point.x - _moveState.start.x);
  let dy = toMm(point.y - _moveState.start.y);

  // Snap if enabled
  const { snapVertices, snapMidpoints } = getParams();
  if (snapVertices || snapMidpoints) {
    const types = { vertices: snapVertices, midpoints: snapMidpoints };
    const proposed = { x: _moveState.origX + dx, y: _moveState.origY + dy,
                       w: _selected.w, h: _selected.h };
    const movingPts = _rectSnapPoints(proposed, types);

    // Target: all other rects
    let bestDx = 0, bestDy = 0, bestDist = SNAP_MM;
    let snapPt = null;
    for (const r of _rects) {
      if (r === _selected) continue;
      for (const tp of _rectSnapPoints(r, types)) {
        for (const mp of movingPts) {
          const ddx = tp.x - mp.x, ddy = tp.y - mp.y;
          const d   = Math.sqrt(ddx*ddx + ddy*ddy);
          if (d < bestDist) { bestDist = d; bestDx = ddx; bestDy = ddy; snapPt = tp; }
        }
      }
    }
    dx += bestDx; dy += bestDy;
    _showSnapAt(snapPt);
  } else {
    _showSnapAt(null);
  }

  _selected.x = _moveState.origX + dx;
  _selected.y = _moveState.origY + dy;
  _selected.items.forEach(i => i.remove());
  _selected.items = _renderRect(_selected);
  _showHandles(_selected);
}

function _commitMove() {
  _showSnapAt(null);
  _moveState = null;
  _onChange();
}

// ── Delete ────────────────────────────────────────────────────────────────────

function _deleteSelected() {
  if (!_selected) return;
  _selected.items.forEach(i => i.remove());
  _clearHandles();
  _rects.splice(_rects.indexOf(_selected), 1);
  _selected = null;
  _onChange();
}
