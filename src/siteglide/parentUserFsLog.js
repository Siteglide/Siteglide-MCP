import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** @type {Set<string>} */
const loggedPathResolutionRoots = new Set();

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatFsError(error) {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  const parts = [];
  if ('code' in error && error.code) {
    parts.push(String(error.code));
  }
  if ('message' in error && error.message) {
    parts.push(String(error.message));
  }
  return parts.length ? parts.join(': ') : 'unknown error';
}

function logWarn(message) {
  console.error(`[siteglide-mcp] ${message}`);
}

function logInfo(message) {
  console.error(`[siteglide-mcp] ${message}`);
}

function logDebug(message) {
  if (process.env.DEBUG) {
    console.error(`[siteglide-mcp] ${message}`);
  }
}

/**
 * @param {string} dirPath
 * @param {string} contextLabel
 * @returns {{ ok: boolean, created: boolean, error?: unknown }}
 */
export function ensureDirWithLog(dirPath, contextLabel, opts = {}) {
  const cwd = opts.cwd != null ? resolve(String(opts.cwd)) : process.cwd();
  const existedBefore = existsSync(dirPath);
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    logWarn(`${contextLabel}: mkdir failed for ${dirPath} (cwd=${cwd}, ${formatFsError(error)})`);
    return { ok: false, created: false, error };
  }

  if (!existsSync(dirPath)) {
    logWarn(`${contextLabel}: mkdir did not create ${dirPath} (cwd=${cwd})`);
    return { ok: false, created: false };
  }

  if (!existedBefore) {
    logInfo(`${contextLabel}: created shared folder ${dirPath}`);
  } else {
    logDebug(`${contextLabel}: using existing folder ${dirPath}`);
  }

  return { ok: true, created: !existedBefore };
}

export function logSharedUserPathResolutionOnce(resolvedProjectRoot, cwd = process.cwd()) {
  const root = resolve(resolvedProjectRoot);
  if (loggedPathResolutionRoots.has(root)) {
    return;
  }
  loggedPathResolutionRoots.add(root);
  const parentUserDir = resolve(dirname(root), '.siteglide', 'user');
  logInfo(
    `Shared .siteglide/user paths: projectRoot=${root} parentUserDir=${parentUserDir} cwd=${resolve(cwd)}`
  );
}

export function logParentUserMigrationPlan(contextLabel, resolvedProjectRoot, legacyPath, parentPath) {
  logSharedUserPathResolutionOnce(resolvedProjectRoot);
  logInfo(`${contextLabel}: migrating ${legacyPath} → ${parentPath}`);
}

export function logParentUserMigrationFailure(
  contextLabel,
  resolvedProjectRoot,
  legacyPath,
  parentPath,
  error
) {
  logWarn(
    `${contextLabel}: could not move preferences to the parent folder. ` +
      `projectRoot=${resolvedProjectRoot} legacy=${legacyPath} parent=${parentPath} — ${formatFsError(error)}`
  );
}

export function logParentUserMigrationSuccess(contextLabel, parentPath, detail) {
  logInfo(`${contextLabel}: ${detail} (${parentPath})`);
}

export function warnInconsistentParentUserState(
  contextLabel,
  resolvedProjectRoot,
  legacyPath,
  parentPath
) {
  const legacyLeft = existsSync(legacyPath);
  const parentLeft = existsSync(parentPath);

  if (legacyLeft && !parentLeft) {
    logWarn(
      `${contextLabel}: project file still at ${legacyPath} but parent copy missing at ${parentPath}. ` +
        `projectRoot=${resolvedProjectRoot}. Set DEBUG=1 and retry.`
    );
    return;
  }

  if (!legacyLeft && !parentLeft) {
    logWarn(
      `${contextLabel}: no file at ${legacyPath} or ${parentPath} (projectRoot=${resolvedProjectRoot}).`
    );
  }
}
