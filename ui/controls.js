// ui/controls.js — parameter panel state and DOM wiring

export const VALID_PITCHES = [3, 3.38, 3.85, 4, 5, 6]; // mm

const _state = {
  pitch:          4,
  margin:         3,
  markType:       'hole',
  // Stitch tab
  cornerMarks:    true,
  cornerDedup:    true,
  // View tab — Show
  showDimensions: true,
  showCutOutline: true,
  showStitchLine: true,
  showPageBorder: false,
  showMidGuides:  true,
  // View tab — Grid
  showGrid:       false,
  gridSize:       5,     // mm
  // View tab — Snap
  snapVertices:   false,
  snapMidpoints:  false,
  snapGrid:       false,
  snapEdges:      false,
  // View tab — Page
  pageSize:       'none',
  // Print tab
  printAutoTile:  true,
  printRegMarks:  true,
  printOverlap:   10,      // mm
  printTitle:     '',
  printDesigner:  '',
  printPageSize:  'none',
  printLandscape: false,
};

const _listeners = [];

function _notify() {
  const p = getParams();
  _listeners.forEach(fn => fn(p));
}

export function getParams() {
  return { ..._state };
}

/**
 * Return params for a specific piece, applying any per-piece visibility
 * overrides on top of the global settings.
 * piece.vis: null (= use global) | { stitch, cut, dims } booleans
 */
export function getItemParams(piece) {
  const p = getParams();
  const vis = piece?.vis;

  // noStitch = pure cut-outline piece — no marks, no stitch lines, solid cut boundary
  if (piece?.noStitch) {
    return {
      ...p,
      showStitchLine: false,
      showCutOutline: vis?.cut !== undefined ? vis.cut : true,
      showDimensions: vis?.dims !== undefined ? vis.dims : p.showDimensions,
      _noStitch: true,  // tells render functions to draw solid cut line
    };
  }

  if (!vis) return p;
  return {
    ...p,
    showStitchLine: vis.stitch !== undefined ? vis.stitch : p.showStitchLine,
    showCutOutline: vis.cut    !== undefined ? vis.cut    : p.showCutOutline,
    showDimensions: vis.dims   !== undefined ? vis.dims   : p.showDimensions,
  };
}

export function onParamsChange(fn) {
  _listeners.push(fn);
}

export function initControls() {

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-pane')
        .forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    });
  });

  // ── Pitch buttons (exclusive select) ──────────────────────────────────────
  document.querySelectorAll('#pitch-btns [data-pitch]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.pitch = parseFloat(btn.dataset.pitch);
      document.querySelectorAll('#pitch-btns [data-pitch]')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _notify();
    });
  });

  // ── Margin slider ──────────────────────────────────────────────────────────
  const rangeEl = document.getElementById('margin-range');
  const valEl   = document.getElementById('margin-val');

  function syncMarginDisplay() {
    valEl.textContent = parseFloat(rangeEl.value).toFixed(1);
  }
  syncMarginDisplay();

  rangeEl.addEventListener('input', () => {
    _state.margin = parseFloat(rangeEl.value);
    syncMarginDisplay();
    _notify();
  });

  // ── Mark type buttons (exclusive select) ──────────────────────────────────
  document.querySelectorAll('#mark-btns [data-mark]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.markType = btn.dataset.mark;
      document.querySelectorAll('#mark-btns [data-mark]')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _notify();
    });
  });

  // ── All data-toggle elements (toggle-switch + btn-group variants) ──────────
  // toggle-switch = pill/switch style (Stitch and View Show sections)
  // btn-group button with data-toggle = chip style (View Snap section)
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    if (btn.disabled) return;
    const key = btn.dataset.toggle;
    // Sync initial visual state
    btn.classList.toggle('active', !!_state[key]);
    btn.addEventListener('click', () => {
      _state[key] = !_state[key];
      btn.classList.toggle('active', _state[key]);
      _notify();
    });
  });

  // ── Print tab controls ────────────────────────────────────────────────────────
  const printTitle    = document.getElementById('print-title');
  const printDesigner = document.getElementById('print-designer');
  const printPageSel  = document.getElementById('print-page-size');
  const printOverlap  = document.getElementById('print-overlap');
  const orientPort    = document.getElementById('btn-orient-port');
  const orientLand    = document.getElementById('btn-orient-land');

  printTitle?.addEventListener('input', () => { _state.printTitle = printTitle.value; _notify(); });
  printDesigner?.addEventListener('input', () => { _state.printDesigner = printDesigner.value; _notify(); });
  printOverlap?.addEventListener('input', () => {
    const v = parseInt(printOverlap.value, 10);
    if (v >= 5) { _state.printOverlap = v; _notify(); }
  });
  printPageSel?.addEventListener('change', () => {
    _state.printPageSize = printPageSel.value;
    if (_state.printPageSize !== 'none' && !_state.showPageBorder) {
      _state.showPageBorder = true;
      document.querySelector('[data-toggle="showPageBorder"]')?.classList.add('active');
    }
    _notify();
  });
  orientPort?.addEventListener('click', () => {
    _state.printLandscape = false;
    orientPort.classList.add('active'); orientLand.classList.remove('active');
    _notify();
  });
  orientLand?.addEventListener('click', () => {
    _state.printLandscape = true;
    orientLand.classList.add('active'); orientPort.classList.remove('active');
    _notify();
  });

  // ── Page size select ──────────────────────────────────────────────────────────
  const pageSizeEl = document.getElementById('page-size');
  if (pageSizeEl) {
    pageSizeEl.value = _state.pageSize;
    pageSizeEl.addEventListener('change', () => {
      _state.pageSize = pageSizeEl.value;
      // showPageBorder auto-turns on when a page is selected
      if (_state.pageSize !== 'none' && !_state.showPageBorder) {
        _state.showPageBorder = true;
        document.querySelector('[data-toggle="showPageBorder"]')?.classList.add('active');
      }
      _notify();
    });
  }

  // ── Grid size input ────────────────────────────────────────────────────────────
  const gridSizeEl = document.getElementById('grid-size');
  if (gridSizeEl) {
    gridSizeEl.value = _state.gridSize;
    gridSizeEl.addEventListener('input', () => {
      const v = parseFloat(gridSizeEl.value);
      if (v >= 0.5) { _state.gridSize = v; _notify(); }
    });
  }

  // ── Panel resize handle ────────────────────────────────────────────────────
  const panel  = document.getElementById('panel');
  const handle = document.getElementById('panel-resize');
  const STORED_WIDTH_KEY = 'lst-panel-width';

  // Restore saved width
  const savedW = parseInt(localStorage.getItem(STORED_WIDTH_KEY), 10);
  if (savedW && savedW >= 180 && savedW <= 420) panel.style.width = savedW + 'px';

  let _resizing = false;

  handle.addEventListener('mousedown', e => {
    _resizing = true;
    handle.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!_resizing) return;
    const rect  = document.getElementById('app').getBoundingClientRect();
    const newW  = Math.round(rect.right - e.clientX);
    const clamped = Math.min(Math.max(newW, 180), 420);
    panel.style.width = clamped + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!_resizing) return;
    _resizing = false;
    handle.classList.remove('dragging');
    localStorage.setItem(STORED_WIDTH_KEY, parseInt(panel.style.width, 10));
  });
}
