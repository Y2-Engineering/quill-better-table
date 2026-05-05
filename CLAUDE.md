# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`quill-better-table` is a [Quill](https://quilljs.com/) v2.0.0-dev.3 module that replaces Quill's built-in table module with a richer implementation: multi-line cells, column resize, cell merge/unmerge, per-cell background colour, a right-click operation menu, and drag-selection of cell ranges. It ships as a UMD bundle that treats `Quill` as an external global (see `webpack.config.js` `externals`) — consumers must load Quill on `window` before loading this library.

Node 20 (see `.nvmrc`).

## Commands

- `npm run dev` — start webpack-dev-server on `localhost:8080` serving `demo/demo1.html` (HMR replacement plugin is enabled but `devServer.hot` is false — reloads on change).
- `npm run build` — produces `dist/quill-better-table.js`, `dist/quill-better-table.min.js`, `dist/quill-better-table.css`, and a demo bundle. The `build` script chains two webpack invocations (minified + unminified) then `rm dist/quill-better-table` to remove a stray stylesheet entry artefact.
- No automated tests. `npm test` intentionally exits 1. Verify changes through the demo page.

`dist/` is checked into git. Running `npm run build` will produce a dirty working tree — don't commit those files unless you intend to ship a release.

## Architecture

### Entry point (`src/quill-better-table.js`)

`BetterTable` extends Quill's `core/module`. Its constructor wires three things on a live Quill instance:

1. **DOM event listeners** on `quill.root` for `click` (show/hide table tools when any ancestor in the composed event path is a `table.quill-better-table`) and `contextmenu` (open the operation menu and seed the cell selection). Browser differences around `event.path` are smoothed by `getEventComposedPath` in `src/utils/index.js`.
2. **Keyboard bindings.** A `Backspace` binding is installed directly via `quill.keyboard.addBinding`, then moved to the front of `quill.keyboard.bindings['Backspace']` — Quill only runs the first matching binding, so order matters. Additional bindings are exported on `BetterTable.keyboardBindings` and consumers must pass them into Quill's `keyboard.bindings` option (see `demo/js/demo1.js`).
3. **Clipboard matchers.** `matchTableCell` / `matchTableHeader` / `matchTable` (from `src/utils/node-matchers.js`) are registered for `td`/`th`/`table` to rebuild deltas on paste; the default `tr` matcher is removed.

`BetterTable.register()` (static) registers all Parchment blots with Quill. It is **not** called from the constructor and is not auto-invoked anywhere — consumers must call `QuillBetterTable.register()` themselves before creating the Quill instance if they need the blots available. Note that `demo/js/demo1.js` omits this call, so don't treat the demo as a complete integration template on that front.

**Host integration requirement:** consumers must register the module via `Quill.register({'modules/better-table': QuillBetterTable}, true)` (the `true` override flag matters when displacing built-ins), and disable Quill's built-in table with `modules: { table: false, 'better-table': {...} }` — the two cannot coexist.

### Blot tree (`src/formats/table.js`)

The DOM shape is strictly enforced via Parchment's `allowedChildren` / `requiredContainer`:

```
TableViewWrapper (div.quill-better-table-wrapper)
 └─ TableContainer (table.quill-better-table)
    ├─ TableColGroup (colgroup)
    │   └─ TableCol * N           // column widths live here
    └─ TableBody (tbody)
        └─ TableRow * N (tr[data-row])
            └─ TableCell * N (td[data-row], [rowspan], [colspan])
                ├─ TableCellLine (p.qlbt-cell-line)   // one per "line" in a cell
                └─ Header (h1..h6, optional)          // custom subclass, see below
```

Notes that will bite you if missed:

- `TableCellLine.tagName` is **`P`** (was `DIV` before v1.2.10). Changing back re-opens [issue #50](https://github.com/soccerloway/quill-better-table/issues/50) — pasted `DIV`s get treated as cell lines.
- `TAGS_TO_IGNORE_FORMAT = ['header', 'list', 'code']` in `TableCellLine.format` — applying these formats inside a cell is silently dropped to prevent the blot tree from breaking. `header` has a custom blot in `src/formats/header.js` that *does* work inside cells: see `src/formats/header.js:67-96`, where `optimize()` calls `this.wrap(TableCell.blotName, { row: rowId })` so a header inside a cell still lives under a `TableCell` parent. Adding list/code support means replicating that pattern (and removing the tag from `TAGS_TO_IGNORE_FORMAT`).
- Every `TableRow` / `TableCell` / `TableCellLine` carries identity attributes `data-row` / `data-cell` (random suffixes via `rowId()` / `cellId()`). `TableCell.checkMerge` and `TableRow.checkMerge` use those ids to decide whether to merge sibling blots during `optimize` — losing or duplicating ids causes rows/cells to coalesce or split unexpectedly.
- `TableRow.optimize` deliberately reimplements `ParentBlot.optimize` so that empty rows are *not* removed (see inline comment — needed during multi-step row/cell mutations).
- Column widths are authoritative on `<col>` nodes. `TableContainer.updateTableWidth` sums them in a `setTimeout(..., 0)` and writes the total to `table.style.width`; structural operations (insert/delete column) call it to re-sync.

All structural mutations (insert/delete row/column, merge, unmerge) go through methods on `TableContainer` and receive an `editorWrapper` element — rectangles are compared in that wrapper's coordinate space via `getRelativeRect` (`src/utils/index.js`) with a fuzzy `ERROR_LIMIT = 5` px. Respect that tolerance when adding new geometry code.

### Interactive modules (`src/modules/`)

Instantiated by `BetterTable.showTableTools(table, quill, options)` when the user clicks a table, destroyed by `hideTableTools`:

- `table-column-tool.js` — the row of draggable width handles rendered above the table.
- `table-selection.js` — tracks drag-selected cells and draws the highlight overlay; `repositionHelpLines` is re-called from the `TableViewWrapper` scroll listener and on document scroll.
- `table-operation-menu.js` — the right-click context menu. Menu item labels and visibility come from `options.operationMenu` (see README "Module Options"); `operationMenu.color` is hidden by default.

These three are plain classes (not Quill modules). They are recreated per table activation; don't cache references across `hideTableTools` calls.

### Clipboard pipeline (`src/utils/node-matchers.js`)

`matchTableCell` rebuilds the delta for every `<td>` so each newline inside the cell becomes a `table-cell-line` op with the correct `row` / `cell` / `rowspan` / `colspan` ids derived from the DOM position — the original Quill matcher produces `block`-level ops that break the blot tree. Empty cells require a special synthesised `\n` op (see the `delta.length() === 0` branch) or they get dropped. `matchTableHeader` does the same for `<th>`, and `matchTable` wires up `TableCol` sizing.

## Styling

`src/assets/quill-better-table.scss` is the single stylesheet; it is extracted to `dist/quill-better-table.css` by `MiniCssExtractPlugin`. Icons under `src/assets/icons/` are inlined via the `html-loader` rule for `.svg`.
