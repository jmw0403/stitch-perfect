# StitchPerfect — Project Plan

**App name:** StitchPerfect &nbsp;·&nbsp; **Internal folder:** `leather-stitch-tool`
**Repo:** to be created on GitHub as `stitch-perfect`, deployed to Vercel
**Reference apps:** sequencediagram.org, Mermaid live editor (browser-based, no backend)

---

## Product Thesis

Traditional leatherwork cuts the piece first, then hopes the stitches space evenly — they
rarely do, so the maker fudges one short or long stitch. That correction stitch is visible
and reads as a mistake.

**This tool inverts the process: the stitch pitch is held sacred; the piece dimensions flex
to absorb the remainder.** Adjusting a dimension by a fraction of a millimeter is invisible
to the eye. Because every mating piece in the same project is adjusted by the same rule, the
parts still fit each other — the tiny change reads as intentional design, not an error.

> **Move the leather, never the stitch.**

---

## How It Works (Inside-Out Workflow)

1. User sets **margin**, **pitch**, and **mark type** in the parameter panel.
2. User draws a **stitch line** on the canvas (the line the holes sit on).
3. Tool **snaps dimensions** so every run is a whole number of stitches, places marks
   (corner marks first).
4. Tool generates the **ghost / cut outline** by offsetting the stitch line outward by the
   margin.
5. On **commit**, stitch line and cut line become editable vector paths; marks become marker
   objects.

The **stitch line is master.** The cut line is always derived from it.

---

## Constraints

### Definable (user picks these)

| Parameter | Values |
|---|---|
| Stitch pitch | 3, 3.38, 3.85, 4, 5, 6 mm (picklist) |
| Margin width | Any value in mm, half-mm increments |
| Mark type | 1 mm hole (open circle), 1 mm dot (filled), 2 mm slash fwd `/`, 2 mm slash back `\` |

- Slash angle is relative to the **local tangent of the stitch line**, not fixed to the page.
  Marks rotate to follow the edge direction — critical for curves and angled corners.
- Mark length must stay shorter than pitch so adjacent marks never overlap.

### Fixed (never violated)

- Stitch line must **start and end on a mark**.
- **Pitch is sacred** — never altered to make geometry fit. Dimensions move instead.
- Supported line types: straight segments, closed curves (loops), angled/cornered shapes,
  and combinations.

---

## Core Geometric Rules

1. **Marks are source of truth.** A stitch is the span between two adjacent marks.
2. **Every run starts and ends on a mark.**
3. **No partial stitches.**
   - Open run of N stitches → N+1 marks, length = N × pitch.
   - Closed loop of N stitches → N marks, perimeter = N × pitch.
4. **Pitch fixed, dimension flexes.** Snap to nearest valid length; never alter pitch.
5. **Corners get marks.** Default: a mark exactly on each corner vertex; each edge is its
   own independent run. Configurable.
6. **Curves spaced by arc length**, not chord. Béziers flattened to polyline at defined
   tolerance before mark placement.
7. **Cut line = stitch line offset outward by margin.** No divisibility constraint on cut
   line.
8. **Stitch line is master.** Any change re-derives cut line and re-solves marks.
9. **Mated seams carry equal stitch counts.** Where two pieces are sewn together, the shared
   seam must have the same number of marks on both. Count is the shared currency, not length.

---

## Mating Pieces

When two pieces share a seam, every mark on one pairs with a mark on the other.

**Master / Dependent pattern:**
- **Master** — the easier piece to fix (usually a straight gusset/strip). Length = count × pitch.
- **Dependent** — the harder piece (usually a curved panel). Deformed until its seam length
  matches master count × pitch.

**Curve deformation default: Uniform Scale**
- Scale factor `k = L_target / L_current`
- Arc length scales linearly with k → exact, closed-form, no iteration needed
- Preserves shape/aspect ratio; changes both dimensions
- Single-axis stretch available as option when one dimension is pinned

**Worked example (oval purse, pitch = 4 mm):**
1. Gusset loop target ~602 mm → 602/4 = 150.5 → snap up → **151 stitches**, gusset = **604 mm**
2. Oval panel must mate at N=151 → target perimeter = 151 × 4 = **604 mm**
3. Drawn oval = 590 mm → k = 604/590 = **1.0237** → grow ~2.4%
4. Both pieces now share exactly 151 marks ✓

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | JavaScript (ES modules) | Runs in browser, no build step required |
| Canvas / path math | paper.js | Bézier arc-length, node editing, hit-testing built in |
| Polygon offset (cut line) | Clipper2-wasm | Industry-standard offset; handles corners cleanly |
| Styling | Plain CSS | No framework needed at this scale |
| Testing | Node + plain assertions | Engine is pure JS — testable without browser |
| Hosting | Vercel | Static site, push-to-deploy via GitHub |
| Editor | VS Code + Claude Code | File/folder creation, code generation |

---

## Project Folder Structure

```
leather-stitch-tool/
├── index.html              ← app shell
├── package.json
├── .gitignore              ← ✅ created
├── PLAN.md                 ← this file
│
├── engine/                 ← ✅ folder created — pure math, no browser APIs
│   ├── stitch.js           ← pitch snapping, mark placement (START HERE)
│   ├── flatten.js          ← Bézier arc-length flattening
│   └── offset.js           ← cut line derivation (wraps Clipper2)
│
├── ui/                     ← ✅ folder created — all DOM/canvas code
│   ├── canvas.js           ← paper.js surface, drawing tools
│   ├── controls.js         ← parameter panel (pitch, margin, mark type)
│   └── export.js           ← SVG / DXF download
│
├── vendor/                 ← ✅ folder created — checked-in third-party libs
│   └── (paper.js, clipper2-wasm land here)
│
├── styles/                 ← ✅ folder created
│   └── app.css
│
└── tests/                  ← ✅ folder created
    └── engine.test.js      ← unit tests for stitch math
```

---

## Build Order

### Phase 1 — Geometry Engine (no UI) ✅
- [x] `engine/stitch.js` — pitch snapping, stitch count, mark placement on a straight run
- [x] `tests/engine.test.js` — verify math with concrete numeric examples
- [x] `engine/flatten.js` — Bézier/arc flattening to polyline for arc-length spacing
- [x] `engine/offset.js` — outward offset for cut line generation

### Phase 2 — Minimal Canvas Shell ✅
- [x] `index.html` + `package.json` — app skeleton
- [x] `vendor/` — download and check in paper.js
- [x] `ui/canvas.js` — paper.js canvas; draw a polyline, run engine, see marks appear
- [x] `styles/app.css` — basic layout

### Phase 3 — Parameter Panel ✅
- [x] `ui/controls.js` — pitch picklist, margin input, mark type selector
- [x] Wire controls → engine → canvas (live update on parameter change)

### Phase 3.5 — Rectangle Shape Tool + Toolbar
Right angles are structurally enforced — the user positions and sizes a
rectangle rather than drawing freehand. This is the primary entry point
for the majority of real leather pieces (wallets, card pockets, straps).

**Toolbar (buttons, not keyboard-only):**
- Rect tool button | Freehand tool button  (active tool highlighted)
- Hover on a button can reveal variations in a future phase

**Cut-outline model (RESOLVED):**
The cut outline is ALWAYS stitch rectangle + margin on ALL four sides,
regardless of which edges carry stitches. An unstitched edge still has
margin leather — it just has no marks punched. This matches how real
patterns are cut (one rectangle per piece, margin all around).

Two edge states per side:
- **Stitched** — marks placed, margin shown in cut outline
- **Open/unstitched** — no marks, margin still in cut outline (material
  present for beveling/burnishing)

Future variation (Phase 4+):
- **Fold edge** — no marks, but fold allowance (user-specified, different
  from stitch margin) instead of standard margin. Needed for wrapped-top
  pockets where thread goes over the raw edge.

**Interaction:**
- [x] Click-drag to place rectangle; W × H shown live in mm as you drag (snapped)
- [x] Corner drag handles for resizing; dimensions snap to whole-pitch multiples live
- [x] Click an edge to toggle: stitched ↔ open/unstitched
- [x] Active (stitched) edges show stitch marks; cut outline always shown
- [x] Delete key removes selected rectangle
- [x] **Move** — click and drag inside a committed rect to reposition it
- [x] **Dimensions panel** — when selected, show stitch area W×H and cut piece W×H
- [ ] Corner radius (0–N mm) — rounds the corners of the cut outline; stitches
      follow the arc at the corner (future, after move+dims are stable)

**Freehand tool additions:**
- [x] Click a committed freehand line to select it (highlight)
- [x] Drag selected freehand line to move it
- [x] Dimensions panel for freehand: show snapped length and stitch count

**Constraints:**
- [x] Right angles implicit — rectangle cannot be skewed
- [x] Minimum dimension per active edge = 1 × pitch
- [x] Snapping anchor = top-left corner (piece grows right and down)

### Phase 3.52 — Four-Tab Panel Redesign

Replaces the current single-column panel with a 4-tab structure.
Wireframes designed in a separate session confirm the layout below.
The panel right edge is drag-resizable (see note at end of section).

---

#### Tab 1 — Shapes
*Tool selection and object editing. Active tool button highlighted.*

**DRAW** sub-section:
`Line` · `Rect` · `Oval` · `Trap` · `Poly` — one active at a time.
(Text tool added here when Phase 4.5 Annotations is built.)

**EDIT** sub-section (populated as Phase 3.55 features ship):
`Cut` · `Copy` · `Paste` · `Flip H` · `Flip V` · `Bring Forward` · `Send Back`
(Enabled only when a piece is selected; greyed out otherwise.)

**GROUP** sub-section:
`Group (Ctrl+G)` · `Ungroup` buttons.

---

#### Tab 2 — Stitch
*Stitch parameters — affects all pieces globally.*

**PITCH**: 6-button picklist (3 / 3.38 / 3.85 / 4 / 5 / 6 mm).

**MARGIN**: slider 1–15 mm with live mm readout in label.

**MARK TYPE**: `Hole ○` · `Dot ●` · `/ Slash` · `\ Slash` (2×2 grid).

**Toggles** (new items from wireframe):
- `Corner marks` — on/off; when off, corner vertices get no mark even
  if they are run endpoints (useful for T-card slot angles).
- `Shared corner dedup` — on/off; suppresses duplicate endpoint marks
  when two pieces share a junction (already implemented in engine).

---

#### Tab 3 — Piece
*Context-sensitive; shows data for the currently selected piece.
Empty state: "Select a piece to see its properties."*

**STITCH AREA**:
`W: 80.0 mm` · `H: 30.0 mm` (inline editable — type to resize)
`STITCHES W: 20` · `STITCHES H: 7`

**CUT PIECE**:
`W: 86.0 mm` · `H: 36.0 mm` (stitch area + 2×margin; read-only)

**EDGES**:
Four buttons `↑ Top` · `→ Right` · `↓ Bottom` · `← Left`.
Click to cycle edge state on canvas without having to click the edge
directly. Colour-coded: blue=stitched, amber=open/unstitched, dim=hidden.
Legend: `■ stitched` · `■ open/unstitched`

**POSITION**:
`X: 40.0 mm` · `Y: 22.0 mm` (top-left corner of the piece, from
canvas origin; inline editable for precise placement).

**MATE** (Phase 6 placeholder):
"No mate assigned" · `Assign mate edge…` button (disabled until Phase 6).

---

#### Tab 4 — View
*Display toggles, snap, page setup, and export.*

**SHOW** toggles:
- `Dimensions` (on/off) — already implemented
- `Cut outline` (on/off) — new; hides all dashed cut lines globally
- `Stitch line` (on/off) — new; hides all blue stitch lines globally
- `Page border` (on/off) — Phase 3.6 page layout overlay

**SNAP** buttons (independent toggles):
`Corners` · `Midpoints` · `Grid` · `Edges`
(Grid and Edges snap are new; add to Phase 3.55 backlog.)

**PAGE SIZE** dropdown: `None` / `A4 210×297` / `Letter 216×279` / `A3 297×420`

**EXPORT**:
`Download SVG` · `Download DXF` (Phase 4)

---

#### Persistent status bar (all tabs)
Fixed at panel bottom: `Rect – 20 + 7 stitches` (left) · `pitch 4 mm` (right).
Updates live; shows selected piece type and count when something is selected,
total counts when nothing is selected.

---

#### Resizable panel
- [ ] Drag handle on the left edge of the panel (thin vertical bar,
      changes cursor to `col-resize` on hover)
- [ ] Panel width constrained: min 200 px, max 400 px
- [ ] Width persisted in `localStorage` so it survives page refresh
- [ ] Canvas reflows to fill remaining width on resize

**Corner stitch rule (applies to ALL shape types):**
The last stitch mark on any run is placed *exactly* at the corner vertex
— never past it. When two runs share a corner (joined at their endpoints),
that shared point carries **one mark**, not two overlapping marks.

**Shared-corner deduplication (bug fix — already shipped):**
When two committed pieces have endpoints within `0.15 mm` of each other,
the secondary piece's terminal mark is hidden so only one hole is punched.
The `Shared corner dedup` toggle in the Stitch tab controls this behaviour.

### Phase 3.55 — Object Manipulation (copy/paste, flip, angle readout)

Applies to all piece types: rect, freehand, and polygon (Phase 3.6).

**Copy / Paste**
- [ ] Ctrl+C copies selected piece (any type); Ctrl+V pastes a duplicate offset
      by one stitch pitch diagonally so it doesn't land exactly on top
- [ ] Paste carries over all edge states (stitched/open/hidden), dimensions,
      and pitch-snapped values — ready to use immediately
- [ ] Primary use case: mirror-image card pockets (copy left pocket → paste →
      flip horizontal → position on right side of bifold)

**Flip Horizontal / Flip Vertical**
- [ ] Flip buttons in panel (or keyboard F / Shift+F) when a piece is selected
- [ ] Flip horizontal: reflects the piece across its own vertical centre axis
      — for a rect, swaps which edges are on left vs. right; for a polygon,
      mirrors all vertices; for a freehand line, mirrors the endpoint
- [ ] Flip vertical: same idea across the horizontal centre axis
- [ ] Edge stitching states follow the geometry (e.g. a stitched right edge
      becomes a stitched left edge after horizontal flip)
- [ ] Dimensions do not change — a flipped 80×60mm piece is still 80×60mm

**Line / Edge Angle Readout**
- [ ] When a freehand line is selected, show its angle in the dimensions panel
      e.g. "Angle: 23.5°" relative to horizontal (0° = left→right,
      90° = straight down, −45° = diagonal up-right)
- [ ] When a rect edge or polygon edge is clicked/hovered, show that edge's
      angle in the panel — useful for matching angles across two pieces
      (e.g. both sides of a T-card slot trapezoid must be the same angle)
- [ ] Angle displayed to one decimal place; updates live during polygon drawing

**Multi-select**
- [ ] Shift+click to add/remove a piece from the current selection
- [ ] Click-drag on empty canvas to rubber-band select all enclosed pieces
- [ ] Selection outline shown for all selected pieces
- [ ] Move, Delete, Copy/Paste all operate on the full selection at once

**Group / Ungroup**
- [ ] Ctrl+G groups selected pieces into a single logical unit
- [ ] A group moves, copies, and deletes as one; internal pieces retain their
      individual stitch states
- [ ] Ctrl+Shift+G ungroups, returning all pieces to independent selection
- [ ] Groups can be nested (a group may contain other groups)
- [ ] Primary use case: card pocket (rect) + its two freehand stitch stubs
      grouped so they stay aligned when repositioning inside the wallet layout

**Z-order / Click-Through Selection**
Objects are stacked in draw order (last drawn = on top). When pieces
overlap, normal click always hits the topmost object. This section
provides access to objects underneath.

- [ ] **Alt+click** (Option+click on Mac) — cycles through all objects at
      the click point in Z-order, top → bottom → top. Each click selects
      the next object down; wraps back to the top after the bottommost.
      Selected object highlights so the user knows which layer they're on.
- [ ] **Z-order panel indicator** — when a piece is selected, the sel-info
      panel shows "Layer 3 of 5" (or similar) so the user knows where in
      the stack they are.
- [ ] **Bring to Front / Send to Back** — two buttons in the panel when a
      piece is selected; also accessible via Ctrl+] (forward one) and
      Ctrl+[ (back one). Matches Illustrator/Figma convention.
- [ ] **Right-click context menu** — "Select → [list of piece names/types
      at this point]" for cases where many objects overlap and cycling
      would take too many clicks.
- [ ] Primary use case: wallet body rect is on the bottom; card pocket
      rect sits on top of it; stitch stub lines are on top of the pocket.
      Alt+click lets the user reach the wallet body to edit its edge states
      without having to move the pieces off each other first.

### Phase 3.6 — Polygon Shape Tool (cut pieces + mixed-edge pieces)

Handles pieces that are non-rectangular or have edges that don't carry
stitch marks — wallet bodies, T-card slots, trapezoidal dividers, etc.

**T-card slot example (from Atelier Grinda bifold):**
- Trapezoidal shape — angled sides are cut edges, no stitching
- Bottom edge stitched (seam to wallet body) → cut line pushed out by margin
- Two short top-corner stubs stitched → cut line pushed out there too
- Angled side edges: raw cut → cut outline sits flush at the drawn edge

**Cut geometry model:**
- **Stitched edge**: cut outline = edge + margin (outward offset)
- **Open edge**: cut outline = edge (flush, material present, no marks)
- **Hidden edge**: cut outline = edge (flush, not rendered)
- On a closed polygon, stitched and non-stitched edges meet at vertices;
  Clipper2 handles the per-edge offset join cleanly via open-path offsetting.

**Interaction:**
- [ ] Tool button: **Polygon** (in Shapes section)
- [ ] Click to place vertices; double-click to close the shape
- [ ] After close: each edge cycles stitched → open → hidden (same as rect)
- [ ] Stitched edges show stitch marks + cut outline pushed outward
- [ ] Non-stitched edges show the drawn edge as the cut line (flush)
- [ ] Dimension label per edge (outside the cut outline, same style as rect)
- [ ] Select + drag to move; drag vertex handle to reshape
- [ ] Delete removes selected polygon

**Oval (Ellipse)**
- [ ] Click-drag to define bounding box; shape is inscribed ellipse
- [ ] All mark placement uses arc-length spacing on the Bézier-approximated curve
      (flatten.js already handles this — ellipse = 4 cubic Bézier arcs)
- [ ] Cut outline = ellipse offset outward by margin (Clipper2 EndType.Polygon)
- [ ] Single edge state for the whole ellipse (stitched / open / hidden)
      since ellipses have no natural edge boundaries
- [ ] Dimension label: "W × H mm" outside the cut outline

**Trapezoid**
- [ ] 4-corner quadrilateral; all 4 corners are independently draggable
- [ ] Essentially a 4-vertex polygon with named corners (TL, TR, BR, BL)
- [ ] Each of the 4 edges follows the same stitched/open/hidden cycle
- [ ] Dimension + angle label per edge (angle readout critical for matching
      the angled sides of opposing T-card slot pieces)

**Workflow for T-card slot:**
1. Switch to Polygon tool
2. Click the 4–6 vertices of the trapezoid, double-click to close
3. Click bottom edge → stitched; click top stubs → stitched; angled sides stay open/hidden
4. Engine places marks on stitched edges; cut outline hugs non-stitched edges flush

**Purely cut-only pieces** (wallet body, spacers with no stitching):
- Draw the polygon
- Leave all edges as hidden
- Cut outline shows the complete shape boundary
- No marks, no margin — just the physical cut shape

**Page layout overlay (pre-export):**
- [ ] Toggle to show A4 / US Letter page border on canvas
- [ ] Pieces must sit inside the border to print at correct scale on one sheet
- [ ] Page size selector: A4 (210×297mm), Letter (216×279mm), A3 (297×420mm)
- [ ] Visual only — does not affect the stitch math

### Phase 3.65 — Prebuilt Shape Templates

Common leather pattern pieces appear in almost every project. Rather than
constructing them from scratch with the polygon tool, these templates drop
a fully configured shape onto the canvas. All parameters are live-editable
via named handles; stitch states are pre-wired to the typical use case.

---

#### T-Pocket (card slot)

The defining piece of a bifold wallet card section. Seen on every Atelier
Grinda-style bifold (ref PDF pages 2/7/12/17/22).

```
┌────┬──────────────────────┬────┐  top width (W)
│    │                      │    │  T-bar height (Ht)
├────┘                      └────┤  T-shoulder step
 \                              /   slant angle (α)
  \                            /
   └────────────────────────────┘  bottom stitch seam
```

**Four named parameters (all drag-adjustable via handles):**

| Handle | Controls | Derived value |
|---|---|---|
| Top-edge width handle | Overall width W | — |
| T-shoulder handle (L or R step) | T-bar height Ht | Short vert stitch run length |
| Bottom-corner handle | Slant angle α | Bottom width = W − 2·Ht·tan(α) |
| Bottom-midpoint handle | Overall height H | Slant run length |

**Pre-wired stitch states:**
- Top edge → **hidden** (pocket mouth, no stitching)
- T-bar left side → **stitched** (short vertical run, length = Ht)
- T-bar right side → **stitched** (short vertical run, mirrored)
- Slant sides (L and R) → **open** (cut edge, no marks)
- Bottom edge → **stitched** (seam to wallet body)

**Stitch count constraint:**
Left and right T-bar runs must have the same count (symmetric). Ht snaps
to nearest whole-stitch multiple. Bottom snaps independently.

**Interaction:**
- [ ] Drop from a "Templates" sub-section in the Shapes tab (or right-click
      canvas → Insert Template → T-Pocket)
- [ ] On drop: shape appears centred on canvas with default dimensions
      (e.g. W=100mm, H=70mm, Ht=15mm, α=20°)
- [ ] Named handles visible when selected — drag any handle to reshape live
- [ ] Piece tab shows all four parameters as editable fields
- [ ] Flip H mirrors the piece (creates the right-hand counterpart)
- [ ] Stitch states editable per-edge as with any polygon

**Future templates (same pattern — parameterised prebuilts):**
- Card window (rectangular cutout with stitched surround)
- Bill divider (flat trapezoid, no stitching)
- Gusset strip (long narrow rect, 2-side or 4-side stitch)
- D-ring slot (small rect with one stitched end)
- Zipper pocket (rect with zipper-edge treatment)

### Phase 4 — Export
- [ ] `ui/export.js` — SVG download (stitch line + cut line + marks)
- [ ] Print layout: page border visible, pieces arranged inside, export to scale
- [ ] DXF export (for laser cutters)

### Phase 4.5 — Annotations (text boxes, title, footer)

Pattern sheets need identifying information for printing, cutting, and
sharing — pattern name, pitch label, date, designer name, notes.

**Text Box**
- [ ] Add text tool in Shapes section
- [ ] Click to place a text box; type inline
- [ ] Font size selector (small / medium / large → approx 8 / 11 / 14pt at
      print scale)
- [ ] Move like any other object; resize bounding box
- [ ] Text content does NOT affect stitch math
- [ ] Included in SVG export as `<text>` element (preserves font, position)

**Sheet Header / Footer**
- [ ] Optional fixed header bar at top of the page layout:
      left: project name, centre: pitch + margin label, right: date
- [ ] Optional footer bar: page number, scale bar ("——— 10 mm ———")
- [ ] Both are populated from fields in the panel and auto-update when
      parameters change (e.g. pitch display reflects current selection)
- [ ] Toggled on/off independently; printed with the page layout

**Scale Bar**
- [ ] A fixed-length reference bar (e.g. 50 mm) rendered on the canvas
      and included in export so the user can calibrate their printer
      (same function as the "1 inch Scale" box on the Atelier Grinda sheets)

### Phase 5 — Deploy
- [ ] Initialize Git repo
- [ ] Push to GitHub
- [ ] Connect to Vercel, get public URL

### Phase 6 — Mating Pieces + Assembled View (v2)
Inspired by the Atelier Grinda bifold pattern (pages 4/9/14/19/24):
pieces can be overlaid to verify stitch alignment across seams, then
decoupled to individual patterns for cutting and punching.

**Assembled view:**
- [ ] "Snap to mate" — drag one piece's edge onto another's; they lock
      in position and shared seam is highlighted
- [ ] Stitch count on both sides of a seam must match (engine enforces)
- [ ] Toggle between assembled view (all pieces nested) and individual
      view (each piece isolated, print-ready)
- [ ] Visual diff if counts don't match — shows which piece needs to flex

**Mating engine:**
- [ ] Master / dependent model (straight gusset = master, curved panel
      = dependent; dependent scales to match master count)
- [ ] Uniform scale solver: k = L_target / L_current
- [ ] Chain-of-mates resolution (gusset → panel A → panel B)

**Reference:** Atelier Grinda bifold pattern shows this workflow — the
"Le Right" assembly page overlays all pieces in sewing position before
the individual cut templates are used separately.

---

## Scale and Print Accuracy

**Screen display:** `PX_PER_MM = 3.78` (96 DPI standard, 1 mm = 3.7795 px). At 100% browser
zoom the canvas represents real-world mm. Zoom-in/out changes apparent size but not the data.

**Stitch line snapping is visible:** The rendered stitch line (and rect edges) are drawn at the
*snapped* length (count × pitch), not the drawn length. When pitch changes, the line visibly
adjusts — this confirms to the user that the dimension has flexed to match whole stitches.

**Canonical output = SVG/DXF export (Phase 4).** Export uses mm units directly from the engine,
so printed dimensions are exact regardless of screen DPI or browser zoom. The screen display is
a faithful preview but the export is the document of record.

**Future option:** A print-calibration page (like the Atelier Grinda "1 inch Scale" box) that
lets the user verify on-screen scale against a physical ruler — useful if they want to trace
directly off a laptop screen.

---

## Open Decisions

| Decision | Status | Notes |
|---|---|---|
| Custom pitch (beyond picklist)? | Open | Lock to list for v1; add free entry in v2 |
| Snapping anchor (standalone piece) | Open | Options: pin corner, preserve aspect, spread delta |
| Corner join type on cut line offset | Open | Round vs. miter on convex corners |
| Bézier flattening tolerance | Open | Recommend 0.1 mm as default |
| Slash orientation at corners | Open | Per-segment rotation vs. blended across vertex |
| Editing after commit (parametric?) | Open | Fully parametric preferred; frozen as fallback |
| Mate topology UI | Phase 6 | How user declares which edge mates with which |
| Rectangle snapping anchor | **Resolved** | Top-left corner pinned; piece grows right and down |
| Unstitched-edge margin treatment | **Resolved** | Cut outline always = stitch rect + margin on ALL sides; unstitched = no marks but margin leather present |
| Tool mode switching | **Resolved** | Toolbar buttons (Rect / Freehand); hover can show variations in a later phase |
| Fold-edge allowance | Phase 4+ | Wrapped-top pockets need fold allowance (≠ stitch margin) on open edge; defer to v2 |
| Assembled view coupling UI | Phase 6 | How user snaps pieces together and toggles assembled ↔ individual view |
| Click-near-endpoint: select vs. start-new-line | Open | When snap is active and user clicks within snap threshold of an existing endpoint, should it START a new snapped line or SELECT the existing one? Current: selects. Proposed: start new line when actively drawing; select only when idle. |
| Corner stitch — shared mark ownership | Open | When two pieces share a corner, which piece "owns" the corner mark for export (counts, DXF output)? Current: primary piece (drawn first) owns it. |
| Piece tab — inline editable dimensions | Open | Typing a new W/H in the Piece tab should resize the piece; confirm on Enter, cancel on Escape. Needs to respect pitch-snapping (entered value snaps to nearest whole stitch). |
| Position origin | Open | Piece tab shows X,Y position. Origin = top-left of canvas? Or top-left of page border when page is set? Recommend: page border origin when a page is set, canvas origin otherwise. |
| Grid snap — grid size | Open | When "Grid" snap is active, what is the grid pitch? Options: fixed (1mm), user-set, or equals stitch pitch. |
| Stitch line / cut outline visibility toggles | Phase 3.52 | Wireframe shows separate toggles for stitch line visibility and cut outline visibility in View tab — more granular than the current single "Dimensions" toggle. |

---

## Key Vocabulary

| Term | Definition |
|---|---|
| Pitch / stitch width | Distance between adjacent marks (mm). The sacred value. |
| Pricking iron | Toothed tool that marks evenly spaced holes. Tooth spacing = pitch. |
| Margin / edge distance | Distance from cut edge to stitch line. |
| Stitch line | The line marks sit on. Master geometry. |
| Cut line / ghost outline | Physical leather edge. Stitch line offset outward by margin. |
| Run | Continuous sequence of stitches; must be whole multiple of pitch. |
| Mark / stitch mark | Single hole, dot, or slash. Stitches span between adjacent marks. |
| Mated seam | Shared edge between two pieces that are sewn together. |
| Master piece | The piece whose stitch count is set first (usually rectilinear). |
| Dependent piece | The piece that deforms to match the master's count (usually curved). |
