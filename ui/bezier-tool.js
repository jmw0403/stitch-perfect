// ui/bezier-tool.js — Illustrator-style Bezier pen tool
// `paper` is a global set by the paper.js script tag.
//
// Click          = corner anchor (no handles, sharp)
// Click+drag     = smooth anchor (drag sets forward handle, back mirror auto)
// Shift+click    = angle-snap to 45° increments from previous anchor
// Click ≈ start  = close shape (click within CLOSE_PX of first anchor)
// Enter          = close shape
// Escape         = cancel draw
// Backspace      = remove last anchor
//
// After commit: anchors and handles are draggable for reshaping.

import { placeMarks } from '../engine/stitch.js';
import { offsetPolyline } from '../engine/offset.js';
import { flattenCubic } from '../engine/flatten.js';
import { getParams } from './controls.js';
import { px, toMm, createMark } from './render.js';

const ANCHOR_PX  = 7;   // anchor square half-size
const HANDLE_PX  = 5;   // handle circle radius
const CLOSE_PX   = 14;  // click within this of first anchor to close

let _layers   = null;
let _bezTool  = null;
let _onChange = () => {};
let _onAdded  = () => {};
let _onDeleted = () => {};

// ── State ─────────────────────────────────────────────────────────────────────

const _beziers = []; // committed BezierPiece[]
let _selected  = null;
let _selHandles = []; // anchor + handle paper items for selected piece

// Draw state
let _ds = null;
// {
//   segs: [{pt:{x,y}, hi:{x,y}|null, ho:{x,y}|null}],
//   closed: false,
//   pathItem: paper.Path,   // live curve as it's drawn
//   previewItem: paper.Path,// preview segment to cursor
//   anchorItems: [],        // small squares at each anchor
//   handleItems: [],        // handle lines and circles during draw
//   dragOut: bool,          // currently dragging out a handle?
//   startPt: paper.Point,   // snap start of handle drag
// }

// Reshape state
let _rs = null;
// { kind: 'anchor'|'handle-in'|'handle-out', piece, segIdx, startPt, origSegs }

// ── Flatten bezier segments to polyline ───────────────────────────────────────

export function flattenSegs(segs, closed, tol = 0.1) {
  const n = segs.length;
  const all = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const s1 = segs[i], s2 = segs[(i + 1) % n];
    const p0 = s1.pt;
    const p3 = s2.pt;
    const p1 = s1.ho ? { x: p0.x + s1.ho.x, y: p0.y + s1.ho.y } : { ...p0 };
    const p2 = s2.hi ? { x: p3.x + s2.hi.x, y: p3.y + s2.hi.y } : { ...p3 };
    const flat = flattenCubic(p0, p1, p2, p3, tol);
    if (i === 0) all.push(...flat);
    else all.push(...flat.slice(1));
  }
  if (closed && all.length > 0) all.push({ ...all[0] });
  return all;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initBezierTool(layers, onChangeFn, onAddedFn, onDeletedFn) {
  _layers = layers;
  if (onChangeFn)  _onChange  = onChangeFn;
  if (onAddedFn)   _onAdded   = onAddedFn;
  if (onDeletedFn) _onDeleted = onDeletedFn;

  _bezTool = new paper.Tool();

  _bezTool.onMouseDown = (event) => {
    // ── Reshape mode (piece selected, not drawing) ─────────────────────────
    if (_selected && !_ds) {
      const hit = _hitHandle(event.point);
      if (hit) {
        _rs = {
          ...hit,
          startPt:  event.point,
          origSegs: _selected.segs.map(s => ({
            pt: {...s.pt},
            hi: s.hi ? {...s.hi} : null,
            ho: s.ho ? {...s.ho} : null,
          })),
        };
        return;
      }
      // Click elsewhere — deselect
      _deselect();
      const bz = _hitAny(event.point);
      if (bz) { _select(bz); return; }
    }

    // ── Click on existing bezier to select it ─────────────────────────────
    if (!_ds) {
      const bz = _hitAny(event.point);
      if (bz) { _select(bz); return; }
    }

    // ── Drawing mode ─────────────────────────────────────────────────────────
    if (!_ds) {
      // Start a new bezier
      _ds = { segs: [], closed: false, dragOut: false,
               pathItem: null, previewItem: null,
               anchorItems: [], handleItems: [] };
    }

    // Close if clicking near first anchor and we have ≥ 3 segments
    if (_ds.segs.length >= 3) {
      const first = _ds.segs[0].pt;
      const d = event.point.getDistance(new paper.Point(px(first.x), px(first.y)));
      if (d < CLOSE_PX) { _commitDraw(true); return; }
    }

    // Apply angle-snap if Shift held
    let ptMm = { x: toMm(event.point.x), y: toMm(event.point.y) };
    if (event.modifiers?.shift && _ds.segs.length > 0) {
      ptMm = _angleSnap45(_ds.segs[_ds.segs.length - 1].pt, ptMm);
    }

    _ds.segs.push({ pt: ptMm, hi: null, ho: null });
    _ds.dragOut  = true;
    _ds.startPt  = event.point;
    _rebuildDrawPath();
    _addAnchorDot(ptMm);
  };

  _bezTool.onMouseDrag = (event) => {
    // ── Reshape drag ───────────────────────────────────────────────────────
    if (_rs) {
      _applyReshape(event.point);
      return;
    }

    // ── Drag out handles during draw ───────────────────────────────────────
    if (_ds && _ds.dragOut && _ds.segs.length > 0) {
      const seg = _ds.segs[_ds.segs.length - 1];
      const delta = {
        x: toMm(event.point.x - _ds.startPt.x),
        y: toMm(event.point.y - _ds.startPt.y),
      };
      // Forward handle (ho) follows drag direction; backward (hi) is mirror
      seg.ho = { x:  delta.x, y:  delta.y };
      seg.hi = { x: -delta.x, y: -delta.y };
      _rebuildDrawPath();
      _updateHandleDisplayForSeg(_ds.segs.length - 1, seg);
    }
  };

  _bezTool.onMouseMove = (event) => {
    if (!_ds || _ds.segs.length === 0) return;
    _updatePreview(event.point);
    // Highlight first anchor when close enough to close
    if (_ds.segs.length >= 3 && _ds.anchorItems[0]) {
      const first = _ds.segs[0].pt;
      const d = event.point.getDistance(new paper.Point(px(first.x), px(first.y)));
      _ds.anchorItems[0].fillColor = d < CLOSE_PX ? '#f39c12' : '#2c7bb6';
    }
  };

  _bezTool.onMouseUp = () => {
    if (_rs) { _rs = null; _onChange(); return; }
    if (_ds) _ds.dragOut = false;
  };

  _bezTool.onKeyDown = (event) => {
    if (event.key === 'enter' && _ds && _ds.segs.length >= 2) {
      _commitDraw(_ds.segs.length >= 3); // close if ≥ 3 anchors
    }
    if (event.key === 'escape') {
      if (_ds) _cancelDraw();
      else _deselect();
    }
    if (event.key === 'backspace' && _ds && _ds.segs.length > 0) {
      _ds.segs.pop();
      _ds.anchorItems.pop()?.remove();
      _ds.handleItems.splice(-3).forEach(i => i?.remove()); // line + 2 circles
      _rebuildDrawPath();
    }
    if ((event.key === 'delete' || event.key === 'backspace') && _selected && !_ds) {
      _deleteSelected();
    }
  };
}

export function activateBezierMode() { if (_bezTool) _bezTool.activate(); }

export function deactivateBezierMode() {
  if (_ds) _cancelDraw();
  _deselect();
}

export function redrawAllBeziers() {
  _beziers.forEach(bz => {
    bz.items.forEach(i => i.remove());
    bz.items = _renderBezier(bz);
  });
  if (_selected) _showSelectHandles(_selected);
}

export function getBezierStats() {
  const { pitch } = getParams();
  let stitches = 0, marks = 0;
  _beziers.forEach(bz => {
    const pts = flattenSegs(bz.segs, bz.closed);
    if (pts.length < 2) return;
    const { count } = placeMarks(pts, pitch, bz.closed);
    stitches += count;
    marks    += bz.closed ? count : count + 1;
  });
  return { count: _beziers.length, stitches, marks };
}

export function getAllBeziers() { return _beziers; }

export function rerenderBezier(bz) {
  bz.items.forEach(i => i.remove());
  bz.items = _renderBezier(bz);
  if (_selected === bz) _showSelectHandles(bz);
  _onChange();
}

export function moveBezierBy(bz, dx, dy) {
  bz.segs = bz.segs.map(s => ({ ...s, pt: { x: s.pt.x+dx, y: s.pt.y+dy } }));
  rerenderBezier(bz);
}

// ── Angle snap ─────────────────────────────────────────────────────────────────

function _angleSnap45(fromMm, toMm_) {
  const dx = toMm_.x - fromMm.x, dy = toMm_.y - fromMm.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 0.1) return toMm_;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: fromMm.x + len * Math.cos(snapped), y: fromMm.y + len * Math.sin(snapped) };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderBezier(bz) {
  const { pitch, margin, markType, showStitchLine, showCutOutline, showDimensions } = getParams();
  const items = [];
  const pts = flattenSegs(bz.segs, bz.closed);
  if (pts.length < 2) return items;

  // Cut outline
  if (showCutOutline) {
    cutLayer.activate();
    const rings = offsetPolyline(pts, margin, bz.closed);
    for (const ring of rings) {
      items.push(new paper.Path({
        segments: ring.map(p => new paper.Point(px(p.x), px(p.y))),
        closed: bz.closed,
        strokeColor: '#aaa', strokeWidth: 0.75, dashArray: [4, 3],
      }));
    }
  }

  // Stitch line
  if (showStitchLine) {
    stitchLayer.activate();
    const seg = bz.segs;
    const pp = new paper.Path({ strokeColor: '#2c7bb6', strokeWidth: 1, fillColor: null });
    seg.forEach((s, i) => {
      const p = new paper.Point(px(s.pt.x), px(s.pt.y));
      const hi = s.hi ? new paper.Point(px(s.hi.x), px(s.hi.y)) : new paper.Point(0, 0);
      const ho = s.ho ? new paper.Point(px(s.ho.x), px(s.ho.y)) : new paper.Point(0, 0);
      pp.add(new paper.Segment(p, hi, ho));
    });
    if (bz.closed) pp.closed = true;
    items.push(pp);
  }

  // Marks
  markLayer.activate();
  const { marks } = placeMarks(pts, pitch, bz.closed);
  for (const m of marks) items.push(createMark(m, markType));

  // Dimension label
  if (showDimensions && pts.length >= 2) {
    const p0 = pts[0], p1 = pts[Math.floor(pts.length / 2)];
    const perpAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.PI / 2;
    const labelOffset = px(margin) + 9;
    let rawLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
      rawLen += Math.sqrt(dx*dx + dy*dy);
    }
    stitchLayer.activate();
    items.push(new paper.PointText({
      point: new paper.Point(
        px((p0.x + p1.x) / 2) + Math.cos(perpAngle) * labelOffset,
        px((p0.y + p1.y) / 2) + Math.sin(perpAngle) * labelOffset,
      ),
      content: `${rawLen.toFixed(1)} mm`,
      fontSize: 9, fillColor: '#4a8ab5', justification: 'center',
    }));
  }

  return items;
}

// Layer references (set from canvas.js via initBezierTool)
let cutLayer, stitchLayer, markLayer, handleLayer;

export function initBezierToolLayers(layers) {
  ({ cutLayer, stitchLayer, markLayer, handleLayer } = layers);
}

// ── Draw path management ──────────────────────────────────────────────────────

function _rebuildDrawPath() {
  if (_ds.pathItem) _ds.pathItem.remove();
  if (_ds.segs.length < 2) { _ds.pathItem = null; return; }

  stitchLayer.activate();
  const pp = new paper.Path({ strokeColor: '#2c7bb6', strokeWidth: 1, opacity: 0.6, fillColor: null });
  _ds.segs.forEach(s => {
    const p  = new paper.Point(px(s.pt.x), px(s.pt.y));
    const hi = s.hi ? new paper.Point(px(s.hi.x), px(s.hi.y)) : new paper.Point(0, 0);
    const ho = s.ho ? new paper.Point(px(s.ho.x), px(s.ho.y)) : new paper.Point(0, 0);
    pp.add(new paper.Segment(p, hi, ho));
  });
  _ds.pathItem = pp;
}

function _updatePreview(cursorPt) {
  if (_ds.previewItem) _ds.previewItem.remove();
  if (_ds.segs.length === 0) return;

  const last = _ds.segs[_ds.segs.length - 1];
  const p0 = new paper.Point(px(last.pt.x), px(last.pt.y));
  const ho = last.ho
    ? p0.add(new paper.Point(px(last.ho.x), px(last.ho.y)))
    : p0;

  stitchLayer.activate();
  const prev = new paper.Path({ strokeColor: '#2c7bb6', strokeWidth: 1, opacity: 0.35, dashArray: [4,3], fillColor: null });
  prev.add(new paper.Segment(p0, new paper.Point(0,0), ho.subtract(p0)));
  prev.add(new paper.Segment(cursorPt));
  _ds.previewItem = prev;
}

function _addAnchorDot(ptMm) {
  handleLayer.activate();
  const h = ANCHOR_PX / 2;
  const sq = new paper.Path.Rectangle(
    new paper.Point(px(ptMm.x) - h, px(ptMm.y) - h),
    new paper.Size(ANCHOR_PX, ANCHOR_PX));
  sq.fillColor = '#2c7bb6';
  sq.strokeColor = 'white';
  sq.strokeWidth = 1;
  _ds.anchorItems.push(sq);
}

function _updateHandleDisplayForSeg(idx, seg) {
  // Remove old handle items for this seg (last 3 items: line + 2 circles)
  _ds.handleItems.splice(idx * 3, 3).forEach(i => i?.remove());

  if (!seg.ho && !seg.hi) return;
  const cp = new paper.Point(px(seg.pt.x), px(seg.pt.y));

  handleLayer.activate();
  const newItems = [];
  if (seg.ho) {
    const hp = cp.add(new paper.Point(px(seg.ho.x), px(seg.ho.y)));
    const hline = new paper.Path({ segments: [cp, hp], strokeColor: '#999', strokeWidth: 0.75 });
    const hcirc = new paper.Path.Circle(hp, HANDLE_PX);
    hcirc.fillColor = 'white'; hcirc.strokeColor = '#2c7bb6'; hcirc.strokeWidth = 1;
    newItems.push(hline, hcirc);
  }
  if (seg.hi) {
    const hp = cp.add(new paper.Point(px(seg.hi.x), px(seg.hi.y)));
    const hcirc = new paper.Path.Circle(hp, HANDLE_PX);
    hcirc.fillColor = 'white'; hcirc.strokeColor = '#2c7bb6'; hcirc.strokeWidth = 1;
    newItems.push(hcirc);
  }
  _ds.handleItems.splice(idx * 3, 0, ...newItems);
}

// ── Commit / cancel draw ──────────────────────────────────────────────────────

function _commitDraw(closed) {
  if (!_ds || _ds.segs.length < 2) { _cancelDraw(); return; }

  // Clean up draw visuals
  _ds.pathItem?.remove();
  _ds.previewItem?.remove();
  _ds.anchorItems.forEach(i => i.remove());
  _ds.handleItems.forEach(i => i.remove());

  const bz = { segs: _ds.segs, closed, items: [] };
  _ds = null;
  bz.items = _renderBezier(bz);
  _beziers.push(bz);
  _deselect();
  _select(bz);
  _onAdded(bz);
  _onChange();
}

function _cancelDraw() {
  if (!_ds) return;
  _ds.pathItem?.remove();
  _ds.previewItem?.remove();
  _ds.anchorItems.forEach(i => i.remove());
  _ds.handleItems.forEach(i => i.remove());
  _ds = null;
}

// ── Selection + reshape handles ───────────────────────────────────────────────

function _showSelectHandles(bz) {
  _clearSelectHandles();
  handleLayer.activate();
  bz.segs.forEach((s, i) => {
    const cp = new paper.Point(px(s.pt.x), px(s.pt.y));
    const h  = ANCHOR_PX / 2;

    // Anchor square
    const sq = new paper.Path.Rectangle(
      new paper.Point(cp.x - h, cp.y - h), new paper.Size(ANCHOR_PX, ANCHOR_PX));
    sq.fillColor = '#2c7bb6'; sq.strokeColor = 'white'; sq.strokeWidth = 1;
    sq.data = { kind: 'anchor', segIdx: i };
    _selHandles.push(sq);

    // Handle-out circle + line
    if (s.ho) {
      const hp = cp.add(new paper.Point(px(s.ho.x), px(s.ho.y)));
      const hl = new paper.Path({ segments: [cp, hp], strokeColor: '#999', strokeWidth: 0.75 });
      const hc = new paper.Path.Circle(hp, HANDLE_PX);
      hc.fillColor = 'white'; hc.strokeColor = '#2c7bb6'; hc.strokeWidth = 1;
      hc.data = { kind: 'handle-out', segIdx: i };
      _selHandles.push(hl, hc);
    }

    // Handle-in circle + line
    if (s.hi) {
      const hp = cp.add(new paper.Point(px(s.hi.x), px(s.hi.y)));
      const hl = new paper.Path({ segments: [cp, hp], strokeColor: '#999', strokeWidth: 0.75 });
      const hc = new paper.Path.Circle(hp, HANDLE_PX);
      hc.fillColor = 'white'; hc.strokeColor = '#aaa'; hc.strokeWidth = 1;
      hc.data = { kind: 'handle-in', segIdx: i };
      _selHandles.push(hl, hc);
    }
  });
}

function _clearSelectHandles() {
  _selHandles.forEach(h => h.remove()); _selHandles = [];
}

function _hitHandle(point) {
  for (const h of _selHandles) {
    if (!h.data?.kind) continue;
    const d = point.getDistance(h.position);
    if (d <= ANCHOR_PX + 3) return { kind: h.data.kind, segIdx: h.data.segIdx, piece: _selected };
  }
  return null;
}

function _hitAny(point) {
  for (let i = _beziers.length - 1; i >= 0; i--) {
    const bz = _beziers[i];
    const hit = bz.items[1]?.hitTest(point, { stroke: true, tolerance: 8 }); // [1] = stitch path
    if (hit) return bz;
  }
  return null;
}

function _select(bz) {
  _selected = bz;
  _showSelectHandles(bz);
  _onChange();
}

function _deselect() {
  _clearSelectHandles();
  _selected = null;
  _onChange();
}

// ── Reshape ───────────────────────────────────────────────────────────────────

function _applyReshape(point) {
  const { kind, segIdx, piece, startPt, origSegs } = _rs;
  const dx = toMm(point.x - startPt.x), dy = toMm(point.y - startPt.y);
  const os = origSegs[segIdx];

  if (kind === 'anchor') {
    piece.segs[segIdx].pt = { x: os.pt.x + dx, y: os.pt.y + dy };
  } else if (kind === 'handle-out') {
    const ho = { x: (os.ho?.x ?? 0) + dx, y: (os.ho?.y ?? 0) + dy };
    piece.segs[segIdx].ho = ho;
    // Mirror to handle-in for G1 continuity (unless very short = corner)
    const len = Math.sqrt(ho.x**2 + ho.y**2);
    const inLen = os.hi ? Math.sqrt(os.hi.x**2 + os.hi.y**2) : len;
    piece.segs[segIdx].hi = len > 0.01
      ? { x: -ho.x / len * inLen, y: -ho.y / len * inLen }
      : null;
  } else if (kind === 'handle-in') {
    const hi = { x: (os.hi?.x ?? 0) + dx, y: (os.hi?.y ?? 0) + dy };
    piece.segs[segIdx].hi = hi;
    const len = Math.sqrt(hi.x**2 + hi.y**2);
    const outLen = os.ho ? Math.sqrt(os.ho.x**2 + os.ho.y**2) : len;
    piece.segs[segIdx].ho = len > 0.01
      ? { x: -hi.x / len * outLen, y: -hi.y / len * outLen }
      : null;
  }

  piece.items.forEach(i => i.remove());
  piece.items = _renderBezier(piece);
  _showSelectHandles(piece);
}

// ── Delete ────────────────────────────────────────────────────────────────────

function _deleteSelected() {
  if (!_selected) return;
  _selected.items.forEach(i => i.remove());
  _clearSelectHandles();
  _beziers.splice(_beziers.indexOf(_selected), 1);
  _onDeleted(_selected);
  _selected = null;
  _onChange();
}
