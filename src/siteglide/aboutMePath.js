import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalizeTargetAudienceExperience } from './experienceLevel.js';
import {
  ensureDirWithLog,
  formatFsError,
  logParentUserMigrationFailure,
  logParentUserMigrationPlan,
  logParentUserMigrationSuccess,
  logSharedUserPathResolutionOnce,
  warnInconsistentParentUserState
} from './parentUserFsLog.js';

const SITEGLIDE_DIR = '.siteglide';
const USER_DIR = 'user';
const ABOUT_ME_FILE = 'about-me.json';

/** POSIX path for docs — relative to the project root. */
export const ABOUT_ME_REL = '../.siteglide/user/about-me.json';

/** @type {Set<string>} */
const migratedProjectDirs = new Set();

function parentSiteglideUserDir(projectDir) {
  return join(dirname(resolve(projectDir)), SITEGLIDE_DIR, USER_DIR);
}

function parentAboutMePath(projectDir) {
  return join(parentSiteglideUserDir(projectDir), ABOUT_ME_FILE);
}

function ensureParentSiteglideUserDir(projectDir) {
  const resolved = resolve(projectDir);
  logSharedUserPathResolutionOnce(resolved, projectDir);
  const dir = parentSiteglideUserDir(resolved);
  const result = ensureDirWithLog(dir, 'Shared .siteglide/user', { cwd: projectDir });
  if (!result.ok) {
    throw new Error(`Could not create shared folder ${dir} (cwd=${resolve(projectDir)})`);
  }
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} contextLabel
 */
function moveFileSyncRobust(from, to, contextLabel) {
  if (!existsSync(from)) {
    return;
  }

  const dirResult = ensureDirWithLog(dirname(to), `${contextLabel} parent .siteglide/user`);
  if (!dirResult.ok) {
    throw new Error(`Could not create parent directory ${dirname(to)}`);
  }

  if (existsSync(to)) {
    return;
  }

  let renameError = null;
  try {
    renameSync(from, to);
    if (existsSync(to)) {
      logParentUserMigrationSuccess(contextLabel, to, 'moved (rename)');
      return;
    }
  } catch (error) {
    renameError = error;
  }

  try {
    copyFileSync(from, to);
  } catch (error) {
    const renameDetail = renameError ? formatFsError(renameError) : 'not attempted';
    throw new Error(`rename (${renameDetail}) and copy (${formatFsError(error)}) failed`);
  }

  if (!existsSync(to)) {
    throw new Error(`Could not move ${from} to ${to}`);
  }
  unlinkSync(from);
  logParentUserMigrationSuccess(contextLabel, to, 'moved (copy)');
}

function parentUserMigrationSettled(resolved, legacyPath) {
  if (!migratedProjectDirs.has(resolved)) {
    return false;
  }
  return !existsSync(legacyPath);
}

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
  const dirResult = ensureDirWithLog(dirname(filePath), 'about-me.json parent .siteglide/user');
  if (!dirResult.ok) {
    throw new Error(`Could not create directory for ${filePath}`);
  }
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
  ensureParentSiteglideUserDir(projectDir);
  return parentAboutMePath(projectDir);
}

/**
 * Move or merge project-level about-me.json into the parent `.siteglide/user/` folder.
 * @param {string} projectDir
 */
export function migrateAboutMeToParent(projectDir) {
  const resolved = resolve(projectDir);
  const legacyPath = legacyAboutMePath(resolved);
  const parentPath = parentAboutMePath(resolved);

  if (legacyPath === parentPath) {
    migratedProjectDirs.add(resolved);
    return;
  }

  if (parentUserMigrationSettled(resolved, legacyPath)) {
    if (!existsSync(parentPath)) {
      warnInconsistentParentUserState('about-me.json', resolved, legacyPath, parentPath);
    }
    return;
  }

  if (!existsSync(legacyPath)) {
    migratedProjectDirs.add(resolved);
    return;
  }

  logParentUserMigrationPlan('about-me.json', resolved, legacyPath, parentPath);

  try {
    if (!existsSync(parentPath)) {
      moveFileSyncRobust(legacyPath, parentPath, 'about-me.json');
    } else {
      const merged = mergeTargetAudience(
        readAboutMeFile(parentPath)?.target_audience || normalizeTargetAudience(null),
        readAboutMeFile(legacyPath)?.target_audience || normalizeTargetAudience(null)
      );
      writeAboutMeTargetAudience(parentPath, merged);
      if (existsSync(parentPath)) {
        unlinkSync(legacyPath);
        logParentUserMigrationSuccess(
          'about-me.json',
          parentPath,
          'merged project copy into existing parent file'
        );
      }
    }

    if (existsSync(parentPath)) {
      const doc = readAboutMeFile(parentPath);
      if (doc) {
        writeAboutMeTargetAudience(parentPath, doc.target_audience);
      }
    }

    if (!existsSync(legacyPath)) {
      migratedProjectDirs.add(resolved);
    } else {
      warnInconsistentParentUserState('about-me.json', resolved, legacyPath, parentPath);
    }
  } catch (error) {
    logParentUserMigrationFailure('about-me.json', resolved, legacyPath, parentPath, error);
    warnInconsistentParentUserState('about-me.json', resolved, legacyPath, parentPath);
  }
}

/**
 * Path to read after migration; falls back to legacy when move failed.
 * @param {string} projectDir
 */
export function resolveReadableAboutMePath(projectDir) {
  migrateAboutMeToParent(projectDir);
  const parentPath = parentAboutMePath(projectDir);
  if (existsSync(parentPath)) {
    return parentPath;
  }
  const legacyPath = legacyAboutMePath(projectDir);
  if (existsSync(legacyPath)) {
    return legacyPath;
  }
  return parentPath;
}
