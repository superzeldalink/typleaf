# Typst PDF ↔ code sync — state and rewrite plan

Handoff notes. Branch `merge/ayakaleaf-pro-v6.2.2`. All work below is local only.

## Where it stands

Both issues below are **done**. Verified end to end over CLSI's HTTP API against
the `Archive` project: 1479 anchors across 36 files and all 61 pages, both
directions, 0 order inversions, 0 non-monotonic clicks, sources restored clean.
Sync map generation adds ~800ms to a compile.

Already fixed and committed:

| Commit | Fix |
| --- | --- |
| `d8baa9b779e` | Sync map was never generated at all, plus `findPdfAnchor` picked the wrong block |
| `eda3c0d97f1` | Replaced index-based block pairing with content alignment; reverted `d93e4b8d924` to re-enable the UI |

Details of those two, since they explain why the current code looks how it does:

1. `queryTypstBlocks` called `CommandRunner.promises.run` with 7 args, but
   `run()` takes 9 (`…, compileGroup, cwd, callback`). `promisify` put its
   callback in the `cwd` slot, so `callback` was `undefined` and
   `_.once(undefined)` threw. It was caught and logged as `failed to generate
   typst sync map`, so compiles kept succeeding while every sync silently fell
   through to `synctex`, which does not exist for Typst. **The sync map had
   never once been generated.**
2. `findPdfAnchor` picked the nearest anchor by absolute `y` distance. Anchors
   mark the *start* of a block and `y` grows downward, so a click past a
   block's midpoint resolved to the *following* block.

`findPdfAnchor` and `findCodeAnchor` are now correct and unit-tested
(`services/clsi/test/unit/js/TypstSyncManager.test.js`, 10 tests). **Keep them.**

## Issue #1 — stale `buildId` → 404 (DONE)

Sync is keyed on `buildId`. The map lives at
`output/generated-files/<buildId>/output.typst-sync.json`, and
`OutputCacheManager` prunes old build dirs.

First double-click hits the build the PDF was rendered from and works. The
editor then auto-compiles, that build is pruned, but the viewer still holds the
old `buildId` → 404 → no jump. Reads to the user as "it only went to the
section", because they are left where the previous jump put them.

Reproduced:

```
current build 19fbe276fa5-… → y=200 → 01-overview.typ:10   ✓
pruned  build 19fbe1e1db4-… → HTTP 404                     ✗
```

Fixed: `_loadTypstSyncMap` (`services/clsi/app/js/CompileManager.js:630`) now
tries the build dir and then falls back to the compile dir, which always holds
the map for the newest build. Verified with a deliberately bogus `buildId`,
which used to 404 and now returns a position:

```bash
curl ".../sync/pdf?page=8&h=100.0&v=200.0&editorId=$ED&buildId=00000000000-deadbeef"
{"code":[{"file":"sections/01-overview.typ","line":14}]}
```

Having the frontend refresh its `buildId` after a recompile is still worth
doing, but is no longer needed for sync to work.

## Issue #2 — sparse anchors and no tables (DONE)

Even on a live build, most text has no anchor, so clicks resolve to the nearest
preceding anchored block — usually the section heading. Tables never work.

Pairing counts for the `Archive` test project:

| kind | source blocks | rendered blocks | paired |
| --- | --- | --- | --- |
| heading | 107 | 109 | 95 |
| paragraph | 593 | 393 | **101** |
| figure | 18 | 56 | **0** |

Root cause: the Typst query extracts text with **`repr()`**
(`services/clsi/app/js/TypstSyncManager.js`, in `buildQueryWrapper` — the
`headings` / `paragraphs` / `figures` map bodies). `repr()` returns Typst's
*debug representation* of content, e.g. `sequence([Some ], strong[bold], [ text])`,
while the source scanner has the raw `.typ` line. `normalizeTypstInline` tries
to unwrap `sequence(...)` and `[...]` but cannot survive references, math, or
nested markup. Hence 101/593.

Figures are matched on `repr(f.caption.body)` — the **caption only**. Table
*body* text is never anchored at all, and 0/18 matched even on caption.

Compounding: `query(par)` returns *rendered* paragraphs, which do not map 1:1
to source paragraphs (593 vs 393); figures report 56 rendered vs 18 in source.

Text matching is the wrong mechanism. It is lossy by construction and no amount
of normalizer tuning makes tables work.

### The rewrite: marker injection (implemented)

Text matching is gone. `TypstSyncManager` now injects markers into the
compile-dir copies of the `.typ` files and asks Typst where they ended up.

A marker is spliced **inline**, never onto its own line:

```typst
#[#metadata((f:"sections/01-overview.typ",l:42))<ol-typst-sync>]
```

Three details that are not obvious and are load-bearing:

- **The content block around the metadata is required.** A bare label at the
  start of a heading body or a figure caption attaches to the *enclosing*
  element, so `query` hands back a `heading` with no `value` field and the
  whole query aborts with `heading does not have field "value"`. Wrapping in
  `#[...]` keeps the label on the metadata.
- **Markers go *after* line-start tokens.** `= Heading` and `- item` are only
  parsed as such at column 0, so a marker at the line start would silently turn
  a heading into body text. Headings, lists, enums and terms get the marker
  after their token.
- **Positions need one `#context` block.** `typst query` cannot report an
  element's location, so a single query block appended to the root resolves
  every marker at once and stashes the result under `<ol-typst-sync-map>`.
  `pos.page` is the *physical* page, which is what the viewer indexes — not
  `counter(page)`, which a document is free to reset.

The injected sources are restored in a `finally`, and injection strips any
markers it finds first, so a crash mid-compile cannot leave a doubled file
behind. Injection runs *after* the PDF compile, not before: markers are
zero-size so the positions are identical either way, and a malformed injection
can then only cost sync rather than the user's compile.

Deleted: `pairBlocks`, `alignBlocks`, `normalizeTypstInline`,
`collectSourceBlocks`, `buildQueryWrapper`, the `text` and `endLine` fields,
and the `pairBlocks` tests.

**Tables** get a marker inside every positional content block of a `table` /
`grid` / `table.cell` / `table.header` / `table.footer` call.

### The mode scanner

Deciding where a marker is *safe* is the whole problem: a marker emitted into
code mode is a parse error that takes the entire query compile down. So
`scanTypstSource` tracks markup / code / math / raw / comment / string modes and
a bracket stack, and injects only where a line starts in markup. Everything
uncertain stays in code, which costs an anchor rather than the map.

It also skips content blocks belonging to `#let` / `#set` / `#show`. Those are
templates — a page header, a show-rule body — rendered wherever the template is
used, so anchoring them points clicks at the definition instead of at the text
under the cursor. As a backstop, `buildEntries` drops any marker that comes back
more than once (a `#for` body, a function called repeatedly); scattered anchors
would outrank the real block sharing their coordinates.

### Three bugs a synthetic fixture never found

All three shipped green against a fixture written alongside the code, and all
three were caught only by running the `Archive` project. If you touch the marker
format, re-run against a real project before believing it.

1. **`#[...]` is callable.** A paragraph starting with `(` became
   `#[...](default 2 ppc)` — a call taking the prose as arguments. `expected
   comma`, exit 1, no map at all, silent fall-through to synctex. `[` and `.`
   bind the same way. Hence the trailing `/**/`.
2. **The marker stole labels.** A label attaches to whatever precedes it, so a
   marker in front of a line-leading `<overview>` took the label off the heading
   and every `@overview` with it — 108 of them, reported only as a
   `content labelled multiple times` warning. Injection now skips a leading
   label, checked at the injection column so table cells are covered too.
3. **An `outline()` renders every heading twice.** The marker lives inside the
   heading body, so a contents page emits a second copy. The old
   "drop anything that appears more than once" rule then discarded all 107
   headings. `injectMarkers` now reports how many markers each line really
   carries, so a duplicate is only a duplicate when the count exceeds what was
   injected — a table row with three cells is not one — and the surviving copy
   is the one that fits the file's own document-order trajectory, which rejects
   the contents-page copy and keeps the heading.

Note the failure mode in #1 and #3: sync was completely dead while compiles kept
succeeding, because `generateSyncMap` failures are caught and logged at warn.
`docker compose logs clsi | grep "failed to generate typst sync map"` is the
first thing to check. `LocalCommandRunner` swallows typst's stderr, so to see
the actual parse error you have to inject into a copy of the compile dir and run
`typst query` by hand.

### Verified

Against a fixture exercising headings, lists, terms, tables, grids, figures,
nested tables, display and inline math, raw blocks and fences, block comments,
`#let` dictionaries, code blocks, `#for` / `#if` bodies, page headers and
footers, escaped hashes and `#include`:

- **Rendering is unchanged.** Binary-thresholded page renders before/after
  injection are pixel-identical; the only residue is ~20 pixels at delta 1/255
  of antialiasing rounding. Page count unchanged.
- **0 order inversions, monotonic clicks** on a multi-page fixture with a
  `counter(page)` reset and on `Archive`.
- Table cells, figure captions and per-line paragraph anchors all resolve.

On `Archive`: headings 107/107 (was 95), figures 18/18 (was 0), 1479 anchors
over all 61 pages. 141 of 1479 "round-trip failures" are all same-y collisions —
two source lines rendering on one output line — which is benign, since
`findPdfAnchor` keys on y alone. Zero genuine mis-resolutions.

**Table cells are still unproven on real content.** `Archive` contains no
`#table(` or `#grid(` call anywhere, so whatever the original "tables never
work" note referred to, it is built some other way and has not been identified.
The cell anchoring is covered by unit tests and a fixture only.

Coverage is now per source *line* rather than per block, so a click in the
middle of a long paragraph lands on the line it hit.

## How to test

Fast loop, no stack needed — `typst` on the host is enough, and CLSI picks
`LocalCommandRunner` when `clsi.dockerRunner` is off, so `generateSyncMap` runs
end to end against a scratch dir:

```js
import M from './services/clsi/app/js/TypstSyncManager.js'
const entries = await M.promises.generateSyncMap({
  compileName: 'scratch', compileDir: '/tmp/proj',
  rootResourcePath: 'main.typ', timeout: 60000,
})
```

It restores the sources itself, so the dir is reusable. To eyeball the
injection alone, call `M.injectMarkers(source, file)` and print `.content`.

Full stack: `cd develop && bin/up …` (see repo README). Test project `Archive`,
id `6a6dfc57bbb3aac01ed9a71d`, 61 pages, login `superzeldalink@gmail.com`.

Rebuild cycle after touching CLSI (~10 min):

```bash
cd develop && bin/build clsi && docker compose up -d --force-recreate clsi
```

`sync/pdf` requires `page`, `h`, `v`, `editorId`, `buildId`. **`h` and `v` must
match `^-?\d+\.\d+$`** — integers are rejected with `invalid h parameter`.

```bash
curl -s -b cookies.jar \
  "http://localhost/project/$PID/sync/pdf?page=8&h=100.0&v=200.0&editorId=$ED&buildId=$BUILD"
```

Get `$BUILD` from the compile response's `outputFiles[].build`.

**Gotcha:** several build dirs coexist and each has its own map. Always read the
newest, or you will debug a stale file:

```bash
find …/generated-files -name "*typst-sync*" -printf "%T@ %p\n" | sort -rn | head -1
```

### Correctness checks that caught real bugs

- **Order inversions.** Within each file, later source lines must not appear at
  earlier PDF positions. Currently 0 inversions across 34 files — a regression
  here means the mapping is scrambled.
- **Round-trip.** `code → PDF → code` must return the original line.
  `line 1 ↔ y=72`, `line 47 ↔ y=490.18` on page 8.
- **Monotonic clicks.** Clicking down a page must return non-decreasing source
  lines.

### Coverage target

Anchors are now per source line, so compare `markerCount` against entries in the
`generated typst sync map` debug log rather than against the old block counts.
A large gap means either the mode scanner is bailing to code mode on something
it should handle, or the duplicate filter is eating a `#for` body.

Still expected to be coarse, by design: content generated in a loop gets one
anchor (the `#for` line), and template bodies get none.

## Note on pre-existing test failures

`services/clsi` unit tests have 10 pre-existing failures inside the container (8
in `CompileManager.test.js`, 2 in `DockerRunner.test.js`) unrelated to this
work. Run on a macOS host instead, the count is 316 — most of the suite assumes
the container. Either way the number is identical with the changes stashed, so
confirm by stashing and re-running rather than by the absolute count.
