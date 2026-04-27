import fsPromises from "node:fs/promises";
import Path from "node:path";
import Settings from "@overleaf/settings";
import logger from "@overleaf/logger";
import OError from "@overleaf/o-error";
import CommandRunner from "./CommandRunner.js";

const TYPST_SYNC_MAP = "output.typst-sync.json";
const TYPST_SYNC_QUERY = ".output.typst-sync.query.typ";
const TYPST_SYNC_LABEL = "<ol-typst-sync>";

const DEFAULT_HIGHLIGHT_SIZE = {
  heading: { width: 180, height: 30 },
  paragraph: { width: 220, height: 34 },
  figure: { width: 220, height: 40 },
};

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

function normalizeTypstInline(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/^sequence\(/, "")
    .replace(/\)$/, "")
    .replace(/\[(.*?)\]/gs, "$1")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function getHeading(line) {
  const match = line.match(/^(=+)\s+(.*?)\s*$/);
  if (!match || !match[2]) return null;
  return {
    kind: "heading",
    level: match[1].length,
    title: normalizeSourceText(match[2]),
  };
}

function getFigureStart(trimmed) {
  return /^#figure\s*\(/.test(trimmed);
}

function shouldSkipLine(trimmed) {
  return (
    trimmed === "" ||
    trimmed.startsWith("//") ||
    trimmed === "{" ||
    trimmed === "}" ||
    trimmed === "]"
  );
}

function getParenDepthDelta(line) {
  let delta = 0;
  let insideString = false;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      insideString = !insideString;
      continue;
    }
    if (insideString) continue;
    if (char === "(") delta += 1;
    if (char === ")") delta -= 1;
  }

  return delta;
}

function consumeFigureBlock(lines, startIndex) {
  let depth = 0;
  let sawOpen = false;
  let endIndex = startIndex;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    depth += getParenDepthDelta(line);
    if (line.includes("(")) {
      sawOpen = true;
    }
    endIndex = index;
    if (sawOpen && depth <= 0) {
      break;
    }
  }

  return endIndex;
}

function isParagraphCandidate(trimmed) {
  if (shouldSkipLine(trimmed)) return false;
  if (trimmed.startsWith("#include ")) return false;
  if (trimmed.startsWith("```")) return false;
  if (getHeading(trimmed)) return false;
  if (getFigureStart(trimmed)) return false;
  return true;
}

function buildParagraphText(lines) {
  return normalizeSourceText(
    lines
      .map((line) => line.trim())
      .join(" ")
      .replace(/#\w+\(/g, "")
      .replace(/[()[\]{}]/g, " "),
  );
}

async function collectSourceBlocks(compileDir, rootResourcePath) {
  const blocks = [];

  async function walk(filePath, stack = []) {
    const normalizedFilePath = normalizeProjectPath(filePath);
    if (stack.includes(normalizedFilePath)) {
      logger.warn(
        { normalizedFilePath, stack },
        "skipping cyclic typst include",
      );
      return;
    }

    const absolutePath = Path.join(compileDir, normalizedFilePath);
    const content = await fsPromises.readFile(absolutePath, "utf8");
    const lines = content.split("\n");
    let insideCodeFence = false;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();

      if (trimmed.startsWith("```")) {
        insideCodeFence = !insideCodeFence;
        continue;
      }

      if (insideCodeFence) {
        continue;
      }

      const includeMatch = trimmed.match(/^#include\s+"([^"]+)"\s*$/);
      if (includeMatch) {
        await walk(resolveIncludedPath(normalizedFilePath, includeMatch[1]), [
          ...stack,
          normalizedFilePath,
        ]);
        continue;
      }

      const heading = getHeading(trimmed);
      if (heading) {
        blocks.push({
          file: normalizedFilePath,
          line: index + 1,
          endLine: index + 1,
          kind: heading.kind,
          level: heading.level,
          text: heading.title,
        });
        continue;
      }

      if (getFigureStart(trimmed)) {
        const endIndex = consumeFigureBlock(lines, index);
        blocks.push({
          file: normalizedFilePath,
          line: index + 1,
          endLine: endIndex + 1,
          kind: "figure",
          text: normalizeSourceText(lines.slice(index, endIndex + 1).join(" ")),
        });
        index = endIndex;
        continue;
      }

      if (!isParagraphCandidate(trimmed)) {
        continue;
      }

      const startIndex = index;
      let endIndex = index;
      while (endIndex + 1 < lines.length) {
        const nextTrimmed = lines[endIndex + 1].trim();
        if (!isParagraphCandidate(nextTrimmed)) {
          break;
        }
        endIndex += 1;
      }

      blocks.push({
        file: normalizedFilePath,
        line: startIndex + 1,
        endLine: endIndex + 1,
        kind: "paragraph",
        text: buildParagraphText(lines.slice(startIndex, endIndex + 1)),
      });
      index = endIndex;
    }
  }

  await walk(rootResourcePath);
  return blocks;
}

function buildQueryWrapper(rootResourcePath) {
  return `#include ${JSON.stringify(rootResourcePath)}

#context [
  #metadata((
    headings: query(heading).map(h => {
      let loc = h.location()
      let pos = loc.position()
      (
        level: h.level,
        text: repr(h.body),
        page: counter(page).at(loc).first(),
        x: pos.x,
        y: pos.y,
      )
    }),
    paragraphs: query(par).map(p => {
      let loc = p.location()
      let pos = loc.position()
      (
        text: repr(p.body),
        page: counter(page).at(loc).first(),
        x: pos.x,
        y: pos.y,
      )
    }),
    figures: query(figure).map(f => {
      let loc = f.location()
      let pos = loc.position()
      (
        text: repr(f.caption.body),
        page: counter(page).at(loc).first(),
        x: pos.x,
        y: pos.y,
      )
    }),
  )) ${TYPST_SYNC_LABEL}
]`;
}

async function queryTypstBlocks(
  compileName,
  compileDir,
  rootResourcePath,
  imageName,
  timeout,
) {
  const wrapperPath = Path.join(compileDir, TYPST_SYNC_QUERY);
  await fsPromises.writeFile(wrapperPath, buildQueryWrapper(rootResourcePath));

  try {
    const command = [
      "typst",
      "query",
      "--root",
      "$COMPILE_DIR",
      Path.join("$COMPILE_DIR", TYPST_SYNC_QUERY),
      TYPST_SYNC_LABEL,
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
    );
    const result = JSON.parse(stdout);
    return result?.[0]?.value || {};
  } catch (error) {
    throw OError.tag(error, "error generating typst sync map", {
      compileDir,
      rootResourcePath,
    });
  } finally {
    await fsPromises.rm(wrapperPath, { force: true });
  }
}

function createEntry(source, query) {
  const entry = {
    file: source.file,
    line: source.line,
    endLine: source.endLine,
    kind: source.kind,
    level: source.level,
    text: source.text,
    page: Number(query.page),
    x: parsePt(query.x),
    y: parsePt(query.y),
  };
  return entry.page && entry.x != null && entry.y != null ? entry : null;
}

function pairBlocks(sourceBlocks, queriedBlocks) {
  const sourceByKind = {
    heading: sourceBlocks.filter((block) => block.kind === "heading"),
    paragraph: sourceBlocks.filter((block) => block.kind === "paragraph"),
    figure: sourceBlocks.filter((block) => block.kind === "figure"),
  };

  const queryByKind = {
    heading: Array.isArray(queriedBlocks.headings)
      ? queriedBlocks.headings
      : [],
    paragraph: Array.isArray(queriedBlocks.paragraphs)
      ? queriedBlocks.paragraphs
      : [],
    figure: Array.isArray(queriedBlocks.figures) ? queriedBlocks.figures : [],
  };

  const entries = [];
  for (const kind of ["heading", "paragraph", "figure"]) {
    const sourceList = sourceByKind[kind];
    const queryList = queryByKind[kind];
    const count = Math.min(sourceList.length, queryList.length);

    if (sourceList.length !== queryList.length) {
      logger.warn(
        {
          kind,
          sourceBlocks: sourceList.length,
          queriedBlocks: queryList.length,
        },
        "typst sync block count mismatch",
      );
    }

    for (let index = 0; index < count; index++) {
      const entry = createEntry(sourceList[index], queryList[index]);
      if (entry) {
        entries.push(entry);
      }
    }

    const mismatches = [];
    for (let index = 0; index < count; index++) {
      const sourceText = sourceList[index].text;
      const queryText = normalizeTypstInline(queryList[index].text);
      if (
        sourceText &&
        queryText &&
        !sourceText.includes(
          queryText.slice(0, Math.min(queryText.length, 24)),
        ) &&
        !queryText.includes(
          sourceText.slice(0, Math.min(sourceText.length, 24)),
        )
      ) {
        mismatches.push({
          source: sourceText,
          query: queryText,
        });
      }
    }

    if (mismatches.length > 0) {
      logger.debug(
        { kind, mismatches: mismatches.slice(0, 5) },
        "typst sync block text mismatch; using source order",
      );
    }
  }

  entries.sort((left, right) => left.line - right.line);
  return entries;
}

async function generateSyncMap({
  compileName,
  compileDir,
  rootResourcePath,
  imageName,
  timeout = 60 * 1000,
}) {
  const sourceBlocks = await collectSourceBlocks(compileDir, rootResourcePath);
  if (sourceBlocks.length === 0) {
    await fsPromises.rm(getSyncMapPath(compileDir), { force: true });
    return [];
  }

  const queriedBlocks = await queryTypstBlocks(
    compileName,
    compileDir,
    rootResourcePath,
    imageName,
    timeout,
  );
  const entries = pairBlocks(sourceBlocks, queriedBlocks);

  await fsPromises.writeFile(
    getSyncMapPath(compileDir),
    JSON.stringify({ version: 2, entries }, null, 2),
  );

  return entries;
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

function findPdfAnchor(entries, page, y) {
  const samePageEntries = entries.filter((entry) => entry.page === page);
  const candidates = samePageEntries.length > 0 ? samePageEntries : entries;
  if (candidates.length === 0) return null;

  return candidates.reduce((best, entry) => {
    const pageDistance = Math.abs(entry.page - page);
    const yDistance = Math.abs(entry.y - y);
    const distance = pageDistance * 10000 + yDistance;
    if (!best || distance < best.distance) {
      return { entry, distance };
    }
    return best;
  }, null)?.entry;
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
  collectSourceBlocks,
  findCodeAnchor,
  findPdfAnchor,
  buildPdfHighlight,
  loadSyncMap,
  generateSyncMap,
  copySyncMapToBuild,
  normalizeProjectPath,
  promises: {
    collectSourceBlocks,
    copySyncMapToBuild,
    generateSyncMap,
    loadSyncMap,
  },
};
