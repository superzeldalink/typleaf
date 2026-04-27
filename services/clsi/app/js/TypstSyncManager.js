import fsPromises from "node:fs/promises";
import Path from "node:path";
import Settings from "@overleaf/settings";
import logger from "@overleaf/logger";
import OError from "@overleaf/o-error";
import CommandRunner from "./CommandRunner.js";

const TYPST_SYNC_MAP = "output.typst-sync.json";
const TYPST_SYNC_QUERY = ".output.typst-sync.query.typ";
const TYPST_SYNC_LABEL = "<ol-typst-sync>";
const DEFAULT_HIGHLIGHT_WIDTH = 140;
const DEFAULT_HIGHLIGHT_HEIGHT = 28;

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

function normalizeTypstTitle(value) {
  if (typeof value !== "string") return "";
  return value.replace(/^\[|\]$/g, "").trim();
}

function normalizeSourceTitle(value) {
  return value.trim();
}

function resolveIncludedPath(baseFile, includePath) {
  const candidate = Path.normalize(
    Path.join(Path.dirname(baseFile), includePath.trim()),
  );
  return normalizeProjectPath(candidate);
}

function getHeadingLevel(line) {
  const match = line.match(/^(=+)\s+(.*?)\s*$/);
  if (!match || !match[2]) return null;
  return {
    level: match[1].length,
    title: normalizeSourceTitle(match[2]),
  };
}

async function collectSourceHeadings(compileDir, rootResourcePath) {
  const headings = [];

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

      const heading = getHeadingLevel(line);
      if (!heading) continue;

      headings.push({
        file: normalizedFilePath,
        line: index + 1,
        level: heading.level,
        title: heading.title,
      });
    }
  }

  await walk(rootResourcePath);
  return headings;
}

function buildQueryWrapper(rootResourcePath) {
  return `#include ${JSON.stringify(rootResourcePath)}

#context [
  #metadata(
    query(heading).map(h => {
      let loc = h.location()
      let pos = loc.position()
      (
        level: h.level,
        title: repr(h.body),
        page: counter(page).at(loc).first(),
        x: pos.x,
        y: pos.y,
      )
    })
  ) ${TYPST_SYNC_LABEL}
]`;
}

async function queryTypstHeadings(
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
    return Array.isArray(result?.[0]?.value) ? result[0].value : [];
  } catch (error) {
    throw OError.tag(error, "error generating typst sync map", {
      compileDir,
      rootResourcePath,
    });
  } finally {
    await fsPromises.rm(wrapperPath, { force: true });
  }
}

function pairHeadings(sourceHeadings, queriedHeadings) {
  const count = Math.min(sourceHeadings.length, queriedHeadings.length);
  const entries = [];

  for (let index = 0; index < count; index++) {
    const source = sourceHeadings[index];
    const query = queriedHeadings[index];
    const entry = {
      file: source.file,
      line: source.line,
      level: source.level,
      title: source.title,
      page: Number(query.page),
      x: parsePt(query.x),
      y: parsePt(query.y),
    };
    if (entry.page && entry.x != null && entry.y != null) {
      entries.push(entry);
    }
  }

  if (sourceHeadings.length !== queriedHeadings.length) {
    logger.warn(
      {
        sourceHeadings: sourceHeadings.length,
        queriedHeadings: queriedHeadings.length,
      },
      "typst sync heading count mismatch",
    );
  } else {
    const mismatches = entries.filter((entry, index) => {
      const queriedTitle = normalizeTypstTitle(queriedHeadings[index].title);
      return queriedTitle && queriedTitle !== entry.title;
    });
    if (mismatches.length > 0) {
      logger.debug(
        { mismatches: mismatches.slice(0, 5) },
        "typst sync title mismatch; using source order",
      );
    }
  }

  return entries;
}

async function generateSyncMap({
  compileName,
  compileDir,
  rootResourcePath,
  imageName,
  timeout = 60 * 1000,
}) {
  const sourceHeadings = await collectSourceHeadings(
    compileDir,
    rootResourcePath,
  );
  if (sourceHeadings.length === 0) {
    await fsPromises.rm(getSyncMapPath(compileDir), { force: true });
    return [];
  }

  const queriedHeadings = await queryTypstHeadings(
    compileName,
    compileDir,
    rootResourcePath,
    imageName,
    timeout,
  );
  const entries = pairHeadings(sourceHeadings, queriedHeadings);

  await fsPromises.writeFile(
    getSyncMapPath(compileDir),
    JSON.stringify({ version: 1, entries }, null, 2),
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
  return {
    page: entry.page,
    h: entry.x,
    v: entry.y,
    width: DEFAULT_HIGHLIGHT_WIDTH,
    height: DEFAULT_HIGHLIGHT_HEIGHT,
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
  collectSourceHeadings,
  findCodeAnchor,
  findPdfAnchor,
  buildPdfHighlight,
  loadSyncMap,
  generateSyncMap,
  copySyncMapToBuild,
  normalizeProjectPath,
  promises: {
    collectSourceHeadings,
    copySyncMapToBuild,
    generateSyncMap,
    loadSyncMap,
  },
};
