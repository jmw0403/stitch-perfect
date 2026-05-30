// ui/controls.js — parameter panel state and DOM wiring

export const VALID_PITCHES = [3, 3.38, 3.85, 4, 5, 6]; // mm

const _state = {
  pitch: 4,
  margin: 3,
  markType: 'hole',
  showDimensions: true,
  snapVertices:   false,
  snapMidpoints:  false,
};
const _listeners = [];

function _notify() {
  const p = getParams();
  _listeners.forEach(fn => fn(p));
}

export function getParams() {
  return { ..._state };
}

export function onParamsChange(fn) {
  _listeners.push(fn);
}

export function initControls() {
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

  // ── Independent toggles (dims, snap) ──────────────────────────────────────
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    const key = btn.dataset.toggle;
    // Sync initial active state from _state
    btn.classList.toggle('active', !!_state[key]);
    btn.addEventListener('click', () => {
      _state[key] = !_state[key];
      btn.classList.toggle('active', _state[key]);
      _notify();
    });
  });
}
