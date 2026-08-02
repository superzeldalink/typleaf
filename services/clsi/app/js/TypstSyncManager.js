import fsPromises from "node:fs/promises";
import Path from "node:path";
import Settings from "@overleaf/settings";
import logger from "@overleaf/logger";
import OError from "@overleaf/o-error";
import CommandRunner from "./CommandRunner.js";

const TYPST_SYNC_MAP = "output.typst-sync.json";
const TYPST_SYNC_LABEL = "<ol-typst-sync>";
const TYPST_SYNC_MAP_LABEL = "<ol-typst-sync-map>";

// A marker is a zero-size `metadata` tag, so it can be spliced into the middle
// of a line without changing layout, paragraph grouping or line numbering.
const MARKER_PATTERN =
  /#\[#metadata\(\(f:"(?:[^"\\]|\\.)*",l:\d+\)\)<ol-typst-sync>\]\/\*\*\//g;

const DEFAULT_HIGHLIGHT_SIZE = {
  heading: { width: 180, height: 30 },
  paragraph: { width: 220, height: 34 },
  figure: { width: 220, height: 40 },
  list: { width: 220, height: 24 },
  cell: { width: 120, height: 20 },
};

// Keywords that start a statement rather than a self-contained expression:
// `#foo` ends at the first character that cannot continue it, but `#let x = 5`
// runs to the end of the line.
const STATEMENT_KEYWORDS = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "if",
  "else",
  "for",
  "while",
  "context",
  "return",
  "break",
  "continue",
]);

// Statements emit nothing visible, and a tag placed before `#set page(...)`
// risks materialising the page before the rule applies. Nothing to anchor.
const SKIPPED_STATEMENT = /^#(let|set|show|import|include)\b/;

// Content blocks belonging to these are templates -- a page header, a show
// rule body, a reusable snippet. Their source lines are rendered wherever the
// template is used, so anchoring them points a click at the definition rather
// than at the text the reader clicked on.
const DEFINITION_KEYWORDS = new Set(["let", "set", "show"]);

// `= Heading` and `- item` are only parsed as such when they are the first
// thing on the line, so their markers go after the token, not before it.
const HEADING_PREFIX = /^(=+)(\s+)/;
const LIST_PREFIX = /^([-+]|\d+\.|\/)(\s+)/;

// A line of nothing but closing delimiters carries no content to anchor, and
// one that merely starts with a closer (`] else [`) is finishing off the block
// above it -- a marker there lands at the end of the previous block, not the
// start of a new one.
const CLOSERS_ONLY = /^[\])}\s,;]*$/;
const LEADING_CLOSER = /^[\])}]/;

// A label attaches to whatever precedes it, so a marker injected in front of
// one steals it: the project's `<overview>` would end up on our metadata
// instead of on the heading, and every `@overview` with it.
const LEADING_LABEL = /^<[^\s<>]+>/;

const IDENT_CHAR = /[A-Za-z0-9_-]/;

// Positional content blocks of a table or grid are its cells. Anchoring them
// is the only way a click inside a table can resolve to source.
const CELL_OWNER = /^(table|grid)(\.(cell|header|footer))?$/;

// A hash expression cannot span a line break on its own, but a line ending in
// an operator is a continuation, so the expression stays open.
const TRAILING_OPERATOR = /[+\-*/=<>|,:]\s*$/;

function getSyncMapPath(directory) {
  return Path.join(directory, TYPST_SYNC_MAP);
}

function normalizeProjectPath(file) {
  return file.replace(/\/\.\//g, "/").replace(/\\/g, "/");
}

function parsePt(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const match = value.match(/^-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function resolveIncludedPath(baseFile, includePath) {
  const candidate = Path.normalize(
    Path.join(Path.dirname(baseFile), includePath.trim()),
  );
  return normalizeProjectPath(candidate);
}

// Two wrappers, each fixing a different way the marker gets misparsed:
//
// The content block, because a bare label at the start of a heading or a figure
// caption attaches to the *enclosing* element instead of the metadata, and
// `query` then hands back a heading with no `value` field.
//
// The empty comment, because a content block is still a callable expression: a
// line of prose starting with "(" would turn into `#[...](default 2 ppc)`, a
// call with the paragraph as its arguments. The same goes for a following "["
// or ".". A comment is trivia -- it ends the expression and renders nothing,
// not even a word space.
function buildMarker(file, line) {
  return `#[#metadata((f:${JSON.stringify(file)},l:${line}))${TYPST_SYNC_LABEL}]/**/`;
}

function stripMarkers(content) {
  return content.replace(MARKER_PATTERN, "");
}

// One `context` block resolves every marker's position in a single pass. The
// CLI's `typst query` cannot report an element's location, so the positions
// have to be computed inside the document and stashed in a metadata value.
function buildQueryBlock() {
  return `#context [#metadata(query(${TYPST_SYNC_LABEL}).filter(it => it.func() == metadata).map(it => {
  let pos = it.location().position()
  (f: it.value.f, l: it.value.l, page: pos.page, x: pos.x, y: pos.y)
}))${TYPST_SYNC_MAP_LABEL}]`;
}

function modeOf(frame) {
  if (!frame) return "markup";
  if (frame.kind === "content") return "markup";
  if (frame.kind === "hash" || frame.kind === "paren" || frame.kind === "brace")
    return "code";
  return frame.kind;
}

// Tracks Typst's markup/code/math/raw modes well enough to answer two
// questions: does this line start in markup (so a marker can be spliced in at
// its first column), and where do table cells open. Getting this wrong is not
// cosmetic -- a marker emitted into code mode is a syntax error that takes the
// whole query compile down with it, so every uncertain case stays in code.
function scanTypstSource(lines) {
  const stack = [];
  const startsInMarkup = [];
  const cells = [];
  const includes = [];
  let lastIdent = "";

  function frame() {
    return stack[stack.length - 1];
  }

  function mode() {
    return modeOf(frame());
  }

  function inDefinition() {
    return stack.some((entry) => entry.definition);
  }

  function closeFrame(kind) {
    const at = stack.map((entry) => entry.kind).lastIndexOf(kind);
    if (at === -1) return;
    stack.length = at;
  }

  // `#foo(x)` and `#table.cell[y]` both need the callee so a content block can
  // tell whether it is a table cell.
  function ownerOfContentBlock() {
    const current = frame();
    if (!current) return "";
    if (current.kind === "hash" || current.kind === "paren")
      return current.callee;
    return "";
  }

  function readIdent(line, position) {
    let name = "";
    while (position < line.length) {
      const char = line[position];
      const next = line[position + 1] || "";
      if (IDENT_CHAR.test(char)) {
        name += char;
        position += 1;
      } else if (char === "." && IDENT_CHAR.test(next)) {
        name += char;
        position += 1;
      } else {
        break;
      }
    }
    return { name, position };
  }

  function openRaw(line, position) {
    let fence = 0;
    while (line[position + fence] === "`") fence += 1;
    // A bare pair of backticks is an empty raw span with nothing to close.
    if (fence !== 2) stack.push({ kind: "raw", fence });
    return position + fence;
  }

  function scanLine(line, index) {
    let position = 0;

    while (position < line.length) {
      const char = line[position];
      const next = line[position + 1] || "";
      const current = mode();

      if (current === "comment") {
        const close = line.indexOf("*/", position);
        if (close === -1) return;
        stack.pop();
        position = close + 2;
        continue;
      }

      if (current === "raw") {
        if (char !== "`") {
          position += 1;
          continue;
        }
        let run = 0;
        while (line[position + run] === "`") run += 1;
        if (run >= frame().fence) stack.pop();
        position += run;
        continue;
      }

      if (current === "string") {
        if (char === "\\") {
          position += 2;
          continue;
        }
        if (char === '"') stack.pop();
        position += 1;
        continue;
      }

      if (current === "math") {
        if (char === "\\") {
          position += 2;
          continue;
        }
        if (char === "$") stack.pop();
        position += 1;
        continue;
      }

      if (current === "markup") {
        if (char === "\\") {
          position += 2;
          continue;
        }
        if (char === "/" && next === "/") return;
        if (char === "/" && next === "*") {
          stack.push({ kind: "comment" });
          position += 2;
          continue;
        }
        if (char === "`") {
          position = openRaw(line, position);
          continue;
        }
        if (char === "$") {
          stack.push({ kind: "math" });
          position += 1;
          continue;
        }
        if (char === "]" && frame()?.kind === "content") {
          stack.pop();
          position += 1;
          continue;
        }
        if (char === "#") {
          const ident = readIdent(line, position + 1);
          stack.push({
            kind: "hash",
            callee: ident.name,
            keyword: STATEMENT_KEYWORDS.has(ident.name),
            definition: DEFINITION_KEYWORDS.has(ident.name),
          });
          lastIdent = ident.name;
          position = ident.position;
          continue;
        }
        position += 1;
        continue;
      }

      // code
      if (char === "/" && next === "/") return;
      if (char === "/" && next === "*") {
        stack.push({ kind: "comment" });
        position += 2;
        continue;
      }
      if (char === '"') {
        stack.push({ kind: "string" });
        position += 1;
        continue;
      }
      if (char === "`") {
        position = openRaw(line, position);
        continue;
      }
      if (char === "$") {
        stack.push({ kind: "math" });
        position += 1;
        continue;
      }
      if (char === "(") {
        stack.push({ kind: "paren", callee: lastIdent });
        lastIdent = "";
        position += 1;
        continue;
      }
      if (char === "{") {
        stack.push({ kind: "brace" });
        lastIdent = "";
        position += 1;
        continue;
      }
      if (char === "[") {
        const owner = ownerOfContentBlock();
        const definition = inDefinition();
        stack.push({ kind: "content", definition });
        position += 1;
        if (!definition && CELL_OWNER.test(owner)) {
          cells.push({ index, column: position });
        }
        continue;
      }
      if (char === ")") {
        closeFrame("paren");
        position += 1;
        continue;
      }
      if (char === "}") {
        closeFrame("brace");
        position += 1;
        continue;
      }
      if (char === "]") {
        closeFrame("content");
        position += 1;
        continue;
      }
      if (IDENT_CHAR.test(char)) {
        const ident = readIdent(line, position);
        lastIdent = ident.name;
        position = ident.position;
        continue;
      }
      if (char === ".") {
        position += 1;
        continue;
      }

      // `#foo bar` is a call followed by markup: a bare hash expression ends at
      // the first character that cannot continue it. A statement keyword runs
      // to the end of the line instead, so it stays open.
      const open = frame();
      if (open?.kind === "hash" && !open.keyword) {
        stack.pop();
        continue;
      }
      position += 1;
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const markupAtStart = mode() === "markup" && !inDefinition();
    startsInMarkup.push(markupAtStart);

    if (markupAtStart) {
      const include = line.trim().match(/^#include\s+"([^"]+)"\s*$/);
      if (include) includes.push(include[1]);
    }

    scanLine(line, index);

    if (!TRAILING_OPERATOR.test(line)) {
      while (stack.length && frame().kind === "hash") stack.pop();
    }
  }

  return { startsInMarkup, cells, includes };
}

function getLineStartInjection(line) {
  const leading = line.match(/^\s*/)[0].length;
  const rest = line.slice(leading);

  if (rest === "") return null;
  if (rest.startsWith("//") || rest.startsWith("/*")) return null;
  if (rest.startsWith("`")) return null;
  if (SKIPPED_STATEMENT.test(rest)) return null;
  if (CLOSERS_ONLY.test(rest) || LEADING_CLOSER.test(rest)) return null;

  const heading = rest.match(HEADING_PREFIX);
  if (heading) {
    return { column: leading + heading[0].length, kind: "heading" };
  }

  const listItem = rest.match(LIST_PREFIX);
  if (listItem) {
    return { column: leading + listItem[0].length, kind: "list" };
  }

  return {
    column: leading,
    kind: /^#figure\b/.test(rest) ? "figure" : "paragraph",
  };
}

function collectInjectionPoints(lines) {
  const { startsInMarkup, cells, includes } = scanTypstSource(lines);
  const points = [];

  for (let index = 0; index < lines.length; index++) {
    if (!startsInMarkup[index]) continue;
    const point = getLineStartInjection(lines[index]);
    if (point) {
      points.push({ line: index + 1, column: point.column, kind: point.kind });
    }
  }

  for (const cell of cells) {
    points.push({ line: cell.index + 1, column: cell.column, kind: "cell" });
  }

  return { points, includes };
}

// Injects a marker at every anchorable position. Markers never shift a line
// number, so the `l` they carry stays valid for the file they came from --
// including through `#include`, since each file is injected with its own path.
function injectMarkers(content, file) {
  const lines = stripMarkers(content).split("\n");
  const { points: candidates, includes } = collectInjectionPoints(lines);

  // Checked at the injection column rather than the line start, so it covers a
  // table cell whose content opens with a label just as well as a label sitting
  // on a line of its own.
  const points = candidates.filter(
    (point) => !LEADING_LABEL.test(lines[point.line - 1].slice(point.column)),
  );

  const byLine = new Map();
  for (const point of points) {
    const existing = byLine.get(point.line);
    if (existing) {
      existing.push(point);
    } else {
      byLine.set(point.line, [point]);
    }
  }

  // `injected` is how many markers this line really carries. Knowing it is what
  // lets the query tell "a table row with three cells" apart from "one heading
  // that an outline rendered a second time".
  const kinds = new Map();
  for (const [line, linePoints] of byLine) {
    // Right to left, so an earlier column is still where the scanner saw it.
    linePoints.sort((left, right) => right.column - left.column);
    let text = lines[line - 1];
    for (const point of linePoints) {
      text =
        text.slice(0, point.column) +
        buildMarker(file, line) +
        text.slice(point.column);
    }
    lines[line - 1] = text;
    kinds.set(line, {
      kind: linePoints[linePoints.length - 1].kind,
      injected: linePoints.length,
    });
  }

  return {
    content: lines.join("\n"),
    markerCount: points.length,
    kinds,
    includes,
  };
}

// Rewrites the compile-dir copies of every `.typ` file reachable from the root
// and remembers their original contents so the caller can put them back. The
// user's own files are never touched -- the compile dir is a scratch copy.
async function injectSyncMarkers(compileDir, rootResourcePath, originals) {
  const kinds = new Map();
  let markerCount = 0;

  async function walk(filePath, stack) {
    const file = normalizeProjectPath(filePath);
    if (stack.includes(file)) {
      logger.warn({ file, stack }, "skipping cyclic typst include");
      return;
    }

    const absolutePath = Path.join(compileDir, file);
    if (originals.has(absolutePath)) return;

    let content;
    try {
      content = await fsPromises.readFile(absolutePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        logger.warn({ file }, "typst include not found, skipping sync markers");
        return;
      }
      throw error;
    }
    originals.set(absolutePath, content);

    const injected = injectMarkers(content, file);
    await fsPromises.writeFile(absolutePath, injected.content);
    markerCount += injected.markerCount;
    for (const [line, kind] of injected.kinds) {
      kinds.set(`${file}:${line}`, kind);
    }

    for (const include of injected.includes) {
      await walk(resolveIncludedPath(file, include), [...stack, file]);
    }
  }

  await walk(rootResourcePath, []);

  const rootPath = Path.join(
    compileDir,
    normalizeProjectPath(rootResourcePath),
  );
  if (markerCount > 0 && originals.has(rootPath)) {
    const injected = await fsPromises.readFile(rootPath, "utf8");
    await fsPromises.writeFile(rootPath, `${injected}\n${buildQueryBlock()}\n`);
  }

  return { markerCount, kinds };
}

async function restoreSources(originals) {
  for (const [absolutePath, content] of originals) {
    try {
      await fsPromises.writeFile(absolutePath, content);
    } catch (error) {
      logger.error(
        { err: error, absolutePath },
        "failed to restore typst source after sync marker injection",
      );
    }
  }
}

async function queryTypstMarkers(
  compileName,
  compileDir,
  rootResourcePath,
  imageName,
  timeout,
) {
  try {
    const command = [
      "typst",
      "query",
      "--root",
      "$COMPILE_DIR",
      Path.join("$COMPILE_DIR", normalizeProjectPath(rootResourcePath)),
      TYPST_SYNC_MAP_LABEL,
      "--format",
      "json",
    ];
    const imageToUse = imageName || Settings.clsi?.typstImage;
    const { stdout } = await CommandRunner.promises.run(
      compileName,
      command,
      compileDir,
      imageToUse,
      timeout,
      {},
      "typst-sync",
      // CommandRunner.run takes (…, compileGroup, cwd, callback). Without an
      // explicit cwd, promisify passes its callback into the cwd slot and
      // run() calls _.once(undefined), which throws "Expected a function" and
      // silently aborts sync map generation.
      undefined,
    );
    const result = JSON.parse(stdout);
    return Array.isArray(result?.[0]?.value) ? result[0].value : [];
  } catch (error) {
    throw OError.tag(error, "error generating typst sync map", {
      compileDir,
      rootResourcePath,
    });
  }
}

const beforeInDocument = (a, b) => a.page - b.page || a.y - b.y;

// A marker can come back more times than it was injected. A heading is the
// common case: the marker lives inside the heading body, so an `outline()`
// renders it again on the contents page. A `#for` body does the same.
//
// Dropping the whole group loses every heading in a document with a table of
// contents, and taking the first hits the contents page instead of the heading.
// So pick the copy that sits where the file's own trajectory says it should:
// after the anchor of the nearest line above it, before the nearest line below.
// Nothing fits only when every copy is somewhere unrelated, and then dropping
// is right.
function chooseInDocumentOrder(candidates, settled) {
  const line = candidates[0].line;
  let previous = null;
  let next = null;
  for (const anchor of settled) {
    if (anchor.line < line) previous = anchor;
    else if (anchor.line > line) {
      next = anchor;
      break;
    }
  }

  return (
    candidates.find(
      (candidate) =>
        (previous == null || beforeInDocument(previous, candidate) <= 0) &&
        (next == null || beforeInDocument(candidate, next) <= 0),
    ) || null
  );
}

function buildEntries(queried, kinds) {
  const parsed = [];
  for (const item of queried) {
    const file = normalizeProjectPath(String(item?.f ?? ""));
    const line = Number(item?.l);
    const page = Number(item?.page);
    const x = parsePt(item?.x);
    const y = parsePt(item?.y);
    if (!file || !Number.isFinite(line) || !page || x == null || y == null) {
      continue;
    }
    const info = kinds.get(`${file}:${line}`);
    parsed.push({ file, line, kind: info?.kind || "paragraph", page, x, y });
  }

  // Grouped by source line, each group still in document order.
  const groups = new Map();
  for (const record of parsed) {
    const key = `${record.file}:${record.line}`;
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }

  // Lines whose marker count came back exactly as injected are trustworthy --
  // that includes a table row, where every cell is its own marker. They settle
  // first so the ambiguous lines have a trajectory to be judged against.
  const entries = [];
  const contested = [];
  for (const [key, candidates] of groups) {
    const injected = kinds.get(key)?.injected ?? 1;
    if (candidates.length <= injected) entries.push(...candidates);
    else contested.push(candidates);
  }

  const byFile = new Map();
  for (const entry of entries) {
    const list = byFile.get(entry.file);
    if (list) list.push(entry);
    else byFile.set(entry.file, [entry]);
  }
  for (const list of byFile.values()) {
    list.sort((left, right) => left.line - right.line);
  }

  for (const candidates of contested) {
    const settled = byFile.get(candidates[0].file) || [];
    const chosen = chooseInDocumentOrder(candidates, settled);
    if (chosen) entries.push(chosen);
  }

  // findCodeAnchor walks a file's entries expecting ascending line numbers.
  entries.sort(
    (left, right) =>
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) ||
      left.line - right.line ||
      left.page - right.page ||
      left.y - right.y,
  );
  return entries;
}

// Markers are injected *after* the PDF compile rather than before it: they are
// zero-size, so the positions are the same either way, and a malformed
// injection can then only cost sync rather than the user's compile. The query
// still runs against the real root in the real compile tree, so the positions
// come from the same document that produced the PDF.
async function generateSyncMap({
  compileName,
  compileDir,
  rootResourcePath,
  imageName,
  timeout = 60 * 1000,
}) {
  const originals = new Map();

  // The compile dir is reused between compiles, so a map left over from an
  // earlier build would otherwise survive a failure here and send clicks to
  // positions from a document that no longer exists.
  await fsPromises.rm(getSyncMapPath(compileDir), { force: true });

  try {
    const { markerCount, kinds } = await injectSyncMarkers(
      compileDir,
      rootResourcePath,
      originals,
    );

    if (markerCount === 0) {
      return [];
    }

    const queried = await queryTypstMarkers(
      compileName,
      compileDir,
      rootResourcePath,
      imageName,
      timeout,
    );
    const entries = buildEntries(queried, kinds);

    logger.debug(
      { markerCount, queried: queried.length, entries: entries.length },
      "generated typst sync map",
    );

    await fsPromises.writeFile(
      getSyncMapPath(compileDir),
      JSON.stringify({ version: 3, entries }, null, 2),
    );

    return entries;
  } finally {
    await restoreSources(originals);
  }
}

async function loadSyncMap(directory) {
  const raw = await fsPromises.readFile(getSyncMapPath(directory), "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

function findCodeAnchor(entries, filename, line) {
  const normalizedFile = normalizeProjectPath(filename);
  const fileEntries = entries.filter((entry) => entry.file === normalizedFile);
  if (fileEntries.length === 0) return null;

  const containingEntry = fileEntries.find(
    (entry) => line >= entry.line && line <= (entry.endLine || entry.line),
  );
  if (containingEntry) {
    return containingEntry;
  }

  let best = null;
  for (const entry of fileEntries) {
    if (entry.line <= line) {
      best = entry;
    } else if (best == null) {
      return entry;
    } else {
      break;
    }
  }

  return best || fileEntries[0];
}

function buildPdfHighlight(entry) {
  const size =
    DEFAULT_HIGHLIGHT_SIZE[entry.kind] || DEFAULT_HIGHLIGHT_SIZE.paragraph;
  return {
    page: entry.page,
    h: entry.x,
    v: entry.y,
    width: size.width,
    height: size.height,
    origin: "top-left",
  };
}

const byPosition = (a, b) => a.page - b.page || a.y - b.y;

// Anchors mark the START of a source block and y grows downward
// (buildPdfHighlight emits origin: "top-left"). The block a click belongs to is
// therefore the last anchor at or above the click -- NOT the nearest anchor by
// absolute distance, which snaps to the following block whenever the click
// falls in the lower half of a long paragraph.
function findPdfAnchor(entries, page, y) {
  if (!entries || entries.length === 0) return null;

  const samePage = entries
    .filter((entry) => entry.page === page)
    .sort(byPosition);

  if (samePage.length > 0) {
    // Block i spans [y_i, y_{i+1}), so the containing block is the last anchor
    // at or above the click. No tolerance is applied: nudging the boundaries
    // would hand the tail of every block to the block after it.
    const atOrAbove = samePage.filter((entry) => entry.y <= y);
    // Clicking above the first anchor on a page (e.g. in a running header)
    // belongs to that page's first block.
    return atOrAbove.length > 0 ? atOrAbove[atOrAbove.length - 1] : samePage[0];
  }

  // No anchors on this page: prefer the last anchor on the closest preceding
  // page. Falling back to the globally nearest could jump forward past the
  // click, which is what makes an unmapped page feel broken rather than coarse.
  const preceding = entries.filter((entry) => entry.page < page);
  if (preceding.length > 0) {
    return preceding.sort(byPosition)[preceding.length - 1];
  }

  return entries.slice().sort(byPosition)[0];
}

async function copySyncMapToBuild(compileDir, outputDir, buildId) {
  const source = getSyncMapPath(compileDir);
  try {
    await fsPromises.stat(source);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const destination = Path.join(
    outputDir,
    "generated-files",
    buildId,
    TYPST_SYNC_MAP,
  );
  await fsPromises.mkdir(Path.dirname(destination), { recursive: true });
  await fsPromises.copyFile(source, destination);
}

export default {
  TYPST_SYNC_MAP,
  buildQueryBlock,
  injectMarkers,
  stripMarkers,
  findCodeAnchor,
  findPdfAnchor,
  buildPdfHighlight,
  loadSyncMap,
  generateSyncMap,
  copySyncMapToBuild,
  normalizeProjectPath,
  promises: {
    copySyncMapToBuild,
    generateSyncMap,
    loadSyncMap,
  },
};
