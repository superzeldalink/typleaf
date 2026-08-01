# Typst PDF ↔ code sync — state and rewrite plan

Handoff notes. Branch `merge/ayakaleaf-pro-v6.2.2`. All work below is local only.

## Where it stands

Double-clicking the PDF to jump to source is **re-enabled** and no longer jumps
to *wrong* locations, but coverage is sparse and it is intermittent. Two open
issues, described below.

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

## Issue #1 — stale `buildId` → 404 (small, do this first)

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

Fix: in `_loadTypstSyncMap` (`services/clsi/app/js/CompileManager.js:630`),
fall back to the compile dir when the build dir is missing. Optionally also
have the frontend refresh its `buildId` after a recompile. ~10 lines. This is
independent of #2 and survives the rewrite.

## Issue #2 — sparse anchors and no tables (the real work)

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

### The rewrite: marker injection

Stop inferring the mapping from text. Make Typst report it directly.

**1. Inject markers into the compile dir.** It is already a scratch copy, so
rewrite the `.typ` files in place. At the start of each block's first line:

```typst
#metadata((f: "sections/01-overview.typ", l: 42)) <ol-typst-sync>
```

Inline at the line start, **not** on its own line — a standalone line creates a
paragraph break and would change layout. `metadata` is invisible and zero-size,
so inline injection does not affect rendering.

**2. Query the markers, not the content.**

```typst
query(<ol-typst-sync>).map(m => (
  file: m.value.f,
  line: m.value.l,
  page: counter(page).at(m.location()).first(),
  x: m.location().position().x,
  y: m.location().position().y,
))
```

Each result carries its own source location. Exact 1:1 — no matching, no
`repr()`, no normalizer.

**3. Delete** `pairBlocks`, `alignBlocks`, `normalizeTypstInline`, and the
`text` fields on entries. The LCS alignment only exists to paper over the text
mismatch and becomes dead code. Remove `pairBlocks` from the module exports and
drop its tests; keep the `findPdfAnchor` tests.

**4. Tables** get a marker inside each cell. That is the only way in-table
clicks will ever resolve.

### Bonus correctness win

The query today is a **separate compile** from the PDF — `buildQueryWrapper`
`#include`s the root and compiles it standalone. So even correctly-matched
anchors are positions from a different compilation than the PDF being clicked.
Injecting markers into the real compile tree and querying that same build
removes this entire class of drift.

### Risks to watch

- Marker injection must not alter paragraph detection. Verify page count and a
  visual diff of the PDF before/after injection.
- Line numbers must be tracked correctly through `#include`.
- Injection happens on the compile-dir copy, never the user's source.

## How to test

Stack: `cd develop && bin/up …` (see repo README). Test project `Archive`,
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

Post-rewrite, paragraph coverage should approach 100% (from 101/593) and
figures should be non-zero (from 0/18). If paragraphs are still well under
100%, marker injection is being skipped for some block kind.

## Note on pre-existing test failures

`services/clsi` unit tests have 10 pre-existing failures (8 in
`CompileManager.test.js`, 2 in `DockerRunner.test.js`) unrelated to this work.
Confirmed by stashing the changes and re-running. Do not chase them.
