import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Normalize path for comparison (forward slashes, no leading ./).
 * @param {string | null | undefined} p
 * @returns {string}
 */
function normalizePath(p) {
  if (!p || typeof p !== 'string') {
    return '';
  }
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * @param {object | null} conflict
 * @param {string} pathQuery
 * @returns {boolean}
 */
function conflictMatchesPath(conflict, pathQuery) {
  const q = normalizePath(pathQuery);
  if (!q || !conflict) {
    return false;
  }
  const candidates = [
    conflict.path,
    conflict.localPath,
    ...(Array.isArray(conflict.wavePaths) ? conflict.wavePaths : []),
    ...(Array.isArray(conflict.conflicts)
      ? conflict.conflicts.flatMap((c) => [c?.path, c?.localPath])
      : [])
  ]
    .filter(Boolean)
    .map(normalizePath);

  return candidates.some((c) => c === q || c.endsWith(`/${q}`) || q.endsWith(`/${c}`));
}

/**
 * @param {string | null | undefined} iso
 * @returns {number | null}
 */
function parseMs(iso) {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a sync conflict record is still "current" relative to an agent edit.
 *
 * Rules of thumb:
 * - If awaitingUserDecision and path matches → current for that path.
 * - If changedAt is provided: current when detectedAt >= changedAt - 2s
 *   (sync detected after / around the edit). Stale when detectedAt is clearly
 *   older than the edit (leftover from a previous save).
 * - Also compare localMtimeAtDetect vs current local mtime when available.
 *
 * @param {object} conflict
 * @param {{ path?: string, changedAt?: string, projectDir: string }} opts
 */
function evaluateConflictFreshness(conflict, opts) {
  const pathMatched = opts.path ? conflictMatchesPath(conflict, opts.path) : true;
  const detectedMs = parseMs(conflict.detectedAt);
  const changedMs = parseMs(opts.changedAt);
  const skewMs = 2000;

  let localMtimeNow = null;
  const localRel = conflict.localPath || conflict.path;
  if (localRel && opts.projectDir) {
    try {
      const abs = isAbsolute(localRel) ? localRel : join(opts.projectDir, localRel);
      localMtimeNow = new Date(statSync(abs).mtimeMs).toISOString();
    } catch {
      localMtimeNow = null;
    }
  }

  let isCurrent = Boolean(conflict.awaitingUserDecision) && pathMatched;
  let freshness = 'unknown';

  if (!pathMatched && opts.path) {
    freshness = 'path_mismatch';
    isCurrent = false;
  } else if (changedMs != null && detectedMs != null) {
    if (detectedMs + skewMs >= changedMs) {
      freshness = 'current_for_change';
      isCurrent = true;
    } else {
      freshness = 'stale_before_change';
      isCurrent = false;
    }
  } else if (conflict.awaitingUserDecision) {
    freshness = 'awaiting_user_decision';
    isCurrent = pathMatched;
  } else if (conflict.status === 'merge_in_progress') {
    freshness = 'merge_in_progress';
    isCurrent = pathMatched;
  } else {
    freshness = 'inactive';
    isCurrent = false;
  }

  const remoteMs = parseMs(conflict.remoteUpdatedAt);
  const baselineMs = parseMs(conflict.effectiveBaselineAt);
  const dates = {
    detectedAt: conflict.detectedAt || null,
    changedAt: opts.changedAt || null,
    remoteUpdatedAt: conflict.remoteUpdatedAt || null,
    effectiveBaselineAt: conflict.effectiveBaselineAt || null,
    localMtimeAtDetect: conflict.localMtimeAtDetect || null,
    localMtimeNow
  };

  let dateHint = null;
  if (remoteMs != null && baselineMs != null && remoteMs > baselineMs) {
    dateHint = 'remote_updated_at_is_newer_than_local_baseline';
  } else if (remoteMs != null && changedMs != null && remoteMs > changedMs) {
    dateHint = 'remote_updated_at_is_newer_than_agent_change';
  }

  return {
    pathMatched,
    isCurrent,
    freshness,
    dateHint,
    dates,
    advice: isCurrent
      ? 'Advise the user that sync paused on a remote conflict for this file. They must choose on the CLI prompt; do not choose for them.'
      : freshness === 'stale_before_change'
        ? 'This conflict record is older than the provided changedAt — re-check after sync processes the latest save, or treat as not about this edit.'
        : freshness === 'path_mismatch'
          ? 'Conflict record is for a different path than the one you changed.'
          : 'No current awaiting sync conflict for this query.'
  };
}

/**
 * Read AI-readable remote-check / stash / current sync conflict logs under .siteglide/
 * @param {{ projectDir: string, environment?: string, path?: string, changedAt?: string }} opts
 */
export function getRemoteCheckStatus(opts) {
  const projectDir = opts.projectDir;
  const dir = join(projectDir, '.siteglide', 'remote-check');
  const conflicts = [];

  if (existsSync(dir)) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const envName = name.replace(/\.json$/, '');
      if (opts.environment && opts.environment !== envName) {
        continue;
      }
      try {
        conflicts.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      } catch {
        // skip
      }
    }
  }

  let stashConflict = null;
  const stashPath = join(projectDir, '.siteglide', 'git', 'last-stash-conflict.json');
  if (existsSync(stashPath)) {
    try {
      stashConflict = JSON.parse(readFileSync(stashPath, 'utf8'));
    } catch {
      stashConflict = null;
    }
  }

  let mergeManifests = [];
  const mergeDir = join(projectDir, '.siteglide', 'merge');
  if (existsSync(mergeDir)) {
    try {
      for (const name of readdirSync(mergeDir)) {
        if (!name.endsWith('.json')) {
          continue;
        }
        mergeManifests.push(JSON.parse(readFileSync(join(mergeDir, name), 'utf8')));
      }
    } catch {
      mergeManifests = [];
    }
  }

  let currentSyncConflict = null;
  const currentPath = join(projectDir, '.siteglide', 'sync', 'current-conflict.json');
  if (existsSync(currentPath)) {
    try {
      currentSyncConflict = JSON.parse(readFileSync(currentPath, 'utf8'));
    } catch {
      currentSyncConflict = null;
    }
  }

  if (opts.environment && currentSyncConflict && currentSyncConflict.environment !== opts.environment) {
    currentSyncConflict = null;
  }

  const evaluationTarget = currentSyncConflict || (opts.path
    ? conflicts.find((c) => conflictMatchesPath(c, opts.path)) || null
    : null);

  const forPath = opts.path || opts.changedAt
    ? evaluationTarget
      ? evaluateConflictFreshness(evaluationTarget, {
          path: opts.path,
          changedAt: opts.changedAt,
          projectDir
        })
      : {
          pathMatched: false,
          isCurrent: false,
          freshness: 'none',
          dateHint: null,
          dates: {
            detectedAt: null,
            changedAt: opts.changedAt || null,
            remoteUpdatedAt: null,
            effectiveBaselineAt: null,
            localMtimeAtDetect: null,
            localMtimeNow: null
          },
          advice:
            'No sync conflict record found for this path yet. If sync is on, wait briefly after save and call remote_check_status again with the same path and changedAt.'
        }
    : null;

  const awaitingSync =
    Boolean(currentSyncConflict && currentSyncConflict.awaitingUserDecision) ||
    conflicts.some((c) => c.command === 'sync' && c.awaitingUserDecision);

  return {
    activeConflict: conflicts.length > 0 || !!stashConflict || !!currentSyncConflict,
    awaitingSyncUserDecision: awaitingSync,
    currentSyncConflict,
    forPath,
    environments: conflicts,
    stashConflict,
    mergeManifests
  };
}

export { normalizePath, conflictMatchesPath, evaluateConflictFreshness };
