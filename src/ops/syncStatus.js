import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAuth } from './client.js';
import { classifyEnvironment, hostnameFromUrl } from './security.js';

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} projectDir
 * @returns {string}
 */
export function syncStatusDir(projectDir) {
  return join(projectDir, '.siteglide', 'user', 'sync');
}

/**
 * @param {unknown} data
 * @returns {object[] | undefined}
 */
function parseSyncErrorsFromData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.syncErrors)) {
    return undefined;
  }
  const valid = data.syncErrors.filter((item) => {
    return (
      item &&
      typeof item === 'object' &&
      typeof item.at === 'string' &&
      item.at &&
      typeof item.path === 'string' &&
      typeof item.message === 'string'
    );
  });
  if (valid.length === 0) {
    return undefined;
  }
  return valid;
}

/**
 * @param {string} filePath
 * @returns {{
 *   pid: number,
 *   environment: string,
 *   cwd?: string,
 *   startedAt?: string,
 *   syncErrors?: object[]
 * } | null}
 */
export function readStatusFile(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object') {
      return null;
    }
    const pid = Number(data.pid);
    if (!Number.isInteger(pid) || typeof data.environment !== 'string' || !data.environment) {
      return null;
    }
    const syncErrors = parseSyncErrorsFromData(data);
    const entry = {
      pid,
      environment: data.environment,
      cwd: data.cwd,
      startedAt: data.startedAt
    };
    if (syncErrors) {
      entry.syncErrors = syncErrors;
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   projectDir: string,
 *   isAlive?: (pid: number) => boolean,
 *   removeStale?: boolean
 * }} opts
 * @returns {{ entries: object[], staleCleared: number }}
 */
export function listSyncStatusEntries(opts) {
  const projectDir = opts.projectDir;
  const isAlive = opts.isAlive || isPidAlive;
  const removeStale = Boolean(opts.removeStale);
  const dir = syncStatusDir(projectDir);

  if (!existsSync(dir)) {
    return { entries: [], staleCleared: 0 };
  }

  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { entries: [], staleCleared: 0 };
  }

  const entries = [];
  let staleCleared = 0;

  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) {
      continue;
    }
    const filePath = join(dir, name);
    const entry = readStatusFile(filePath);
    if (!entry || !isAlive(entry.pid)) {
      if (removeStale) {
        try {
          unlinkSync(filePath);
          staleCleared += 1;
        } catch {
          // ignore
        }
      }
      continue;
    }
    entries.push(entry);
  }

  entries.sort(
    (a, b) => String(a.environment).localeCompare(String(b.environment)) || a.pid - b.pid
  );

  return { entries, staleCleared };
}

/**
 * @param {string} at ISO timestamp
 * @param {{ since?: string, until?: string }} window
 * @returns {boolean}
 */
function errorInTimeWindow(at, window) {
  if (window.since && at < window.since) {
    return false;
  }
  if (window.until && at > window.until) {
    return false;
  }
  return true;
}

/**
 * Aggregate live sync watches for a project. Unlinks stale/invalid status files when removeStale is true.
 *
 * @param {{ projectDir: string, configPath?: string, isAlive?: (pid: number) => boolean }} opts
 * @returns {{
 *   active: boolean,
 *   treatAsProduction: boolean,
 *   syncs: Array<{
 *     pid: number,
 *     environment: string,
 *     classification: 'staging' | 'production' | null,
 *     host: string | null,
 *     startedAt?: string,
 *     note?: string
 *   }>,
 *   staleCleared: number
 * }}
 */
export function getSyncStatus(opts) {
  const projectDir = opts.projectDir;
  const configPath = opts.configPath;
  const isAlive = opts.isAlive || isPidAlive;

  const { entries, staleCleared } = listSyncStatusEntries({
    projectDir,
    isAlive,
    removeStale: true
  });

  const syncs = [];

  for (const entry of entries) {
    let classification = null;
    let host = null;
    let note;
    try {
      const auth = resolveAuth(entry.environment, configPath);
      classification = classifyEnvironment(auth);
      host = hostnameFromUrl(auth.url);
    } catch {
      note = 'Environment not found in Siteglide config; treating as production for safety.';
    }

    const item = {
      pid: entry.pid,
      environment: entry.environment,
      classification,
      host,
      startedAt: entry.startedAt
    };
    if (note) {
      item.note = note;
    }
    syncs.push(item);
  }

  const treatAsProduction = syncs.some((s) => s.classification !== 'staging');

  return {
    active: syncs.length > 0,
    treatAsProduction: syncs.length > 0 && treatAsProduction,
    syncs,
    staleCleared
  };
}

/**
 * Read validation/API sync errors from live sync status files (read-only; never unlinks stale pids).
 *
 * @param {{
 *   projectDir: string,
 *   configPath?: string,
 *   isAlive?: (pid: number) => boolean,
 *   since?: string,
 *   until?: string,
 *   environment?: string
 * }} opts
 * @returns {{ activeSyncs: number, errors: object[] }}
 */
export function getSyncErrors(opts) {
  const projectDir = opts.projectDir;
  const configPath = opts.configPath;
  const isAlive = opts.isAlive || isPidAlive;
  const envFilter = opts.environment;
  const window = { since: opts.since, until: opts.until };

  const { entries } = listSyncStatusEntries({
    projectDir,
    isAlive,
    removeStale: false
  });

  const errors = [];

  for (const entry of entries) {
    if (envFilter && entry.environment !== envFilter) {
      continue;
    }
    if (!entry.syncErrors || entry.syncErrors.length === 0) {
      continue;
    }

    let classification = null;
    let host = null;
    let url = null;
    let note;
    try {
      const auth = resolveAuth(entry.environment, configPath);
      classification = classifyEnvironment(auth);
      host = hostnameFromUrl(auth.url);
      url = auth.url;
    } catch {
      note = 'Environment not found in Siteglide config.';
    }

    for (const err of entry.syncErrors) {
      if (!errorInTimeWindow(err.at, window)) {
        continue;
      }
      const row = {
        pid: entry.pid,
        environment: entry.environment,
        classification,
        host,
        url,
        startedAt: entry.startedAt,
        ...err
      };
      if (note) {
        row.note = note;
      }
      errors.push(row);
    }
  }

  errors.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.pid - b.pid);

  return {
    activeSyncs: entries.filter((e) => !envFilter || e.environment === envFilter).length,
    errors
  };
}
