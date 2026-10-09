import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalizeTargetAudienceExperience } from './experienceLevel.js';

const SITEGLIDE_DIR = '.siteglide';
const USER_DIR = 'user';
const ABOUT_ME_FILE = 'about-me.json';

/** POSIX path for docs — relative to the project root. */
export const ABOUT_ME_REL = '../.siteglide/user/about-me.json';

/** @type {Set<string>} */
const migratedProjectDirs = new Set();

/**
 * @param {unknown} ta
 * @returns {{ role: string|null, git: string|null, siteglideCli: string|null }}
 */
function normalizeTargetAudience(ta) {
  return canonicalizeTargetAudienceExperience(ta);
}

/**
 * @param {string} filePath
 * @param {{ role: string|null, git: string|null, siteglideCli: string|null }} ta
 */
function writeAboutMeTargetAudience(filePath, ta) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({ target_audience: canonicalizeTargetAudienceExperience(ta) }, null, 2)}\n`,
    'utf8'
  );
}

/**
 * @param {string} filePath
 * @returns {{ target_audience: { role: string|null, git: string|null, siteglideCli: string|null } } | null}
 */
function readAboutMeFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    return {
      target_audience: normalizeTargetAudience(data.target_audience)
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ role: string|null, git: string|null, siteglideCli: string|null }} primary
 * @param {{ role: string|null, git: string|null, siteglideCli: string|null }} secondary
 */
function mergeTargetAudience(primary, secondary) {
  return {
    role: primary.role != null ? primary.role : secondary.role,
    git: primary.git != null ? primary.git : secondary.git,
    siteglideCli: primary.siteglideCli != null ? primary.siteglideCli : secondary.siteglideCli
  };
}

/** Legacy project-level path (pre parent-directory layout). */
export function legacyAboutMePath(projectDir) {
  return join(resolve(projectDir), SITEGLIDE_DIR, USER_DIR, ABOUT_ME_FILE);
}

/** Parent-of-project about-me path — matches siteglide-cli `joinAboutMe`. */
export function aboutMePath(projectDir) {
  migrateAboutMeToParent(projectDir);
  return join(dirname(resolve(projectDir)), SITEGLIDE_DIR, USER_DIR, ABOUT_ME_FILE);
}

/**
 * Move or merge project-level about-me.json into the parent `.siteglide/user/` folder.
 * @param {string} projectDir
 */
export function migrateAboutMeToParent(projectDir) {
  const resolved = resolve(projectDir);
  if (migratedProjectDirs.has(resolved)) {
    return;
  }
  migratedProjectDirs.add(resolved);

  const legacyPath = legacyAboutMePath(resolved);
  const parentPath = join(dirname(resolved), SITEGLIDE_DIR, USER_DIR, ABOUT_ME_FILE);

  if (legacyPath === parentPath) {
    return;
  }

  const legacyExists = existsSync(legacyPath);
  const parentExists = existsSync(parentPath);

  if (!legacyExists) {
    return;
  }

  if (!parentExists) {
    mkdirSync(dirname(parentPath), { recursive: true });
    try {
      renameSync(legacyPath, parentPath);
    } catch {
      try {
        copyFileSync(legacyPath, parentPath);
        unlinkSync(legacyPath);
      } catch {
        // Reads fall back to the legacy path.
      }
    }
    if (existsSync(parentPath)) {
      const doc = readAboutMeFile(parentPath);
      if (doc) {
        writeAboutMeTargetAudience(parentPath, doc.target_audience);
      }
    }
    return;
  }

  const merged = mergeTargetAudience(
    readAboutMeFile(parentPath)?.target_audience || normalizeTargetAudience(null),
    readAboutMeFile(legacyPath)?.target_audience || normalizeTargetAudience(null)
  );
  writeAboutMeTargetAudience(parentPath, merged);
  try {
    unlinkSync(legacyPath);
  } catch {
    // Parent copy is authoritative.
  }
}

/**
 * Path to read after migration; falls back to legacy when move failed.
 * @param {string} projectDir
 */
export function resolveReadableAboutMePath(projectDir) {
  migrateAboutMeToParent(projectDir);
  const parentPath = aboutMePath(projectDir);
  if (existsSync(parentPath)) {
    return parentPath;
  }
  const legacyPath = legacyAboutMePath(projectDir);
  if (existsSync(legacyPath)) {
    return legacyPath;
  }
  return parentPath;
}
