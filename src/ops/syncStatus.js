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
 * @param {string} filePath
 * @returns {{ pid: number, environment: string, cwd?: string, startedAt?: string } | null}
 */
function readStatusFile(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object') {
      return null;
    }
    const pid = Number(data.pid);
    if (!Number.isInteger(pid) || typeof data.environment !== 'string' || !data.environment) {
      return null;
    }
    return {
      pid,
      environment: data.environment,
      cwd: data.cwd,
      startedAt: data.startedAt
    };
  } catch {
    return null;
  }
}

/**
 * Aggregate live sync watches for a project. Unlinks stale/invalid status files.
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
  const dir = syncStatusDir(projectDir);

  if (!existsSync(dir)) {
    return { active: false, treatAsProduction: false, syncs: [], staleCleared: 0 };
  }

  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { active: false, treatAsProduction: false, syncs: [], staleCleared: 0 };
  }

  const syncs = [];
  let staleCleared = 0;

  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) {
      continue;
    }
    const filePath = join(dir, name);
    const entry = readStatusFile(filePath);
    if (!entry || !isAlive(entry.pid)) {
      try {
        unlinkSync(filePath);
        staleCleared += 1;
      } catch {
        // ignore
      }
      continue;
    }

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

  syncs.sort((a, b) => String(a.environment).localeCompare(String(b.environment)) || a.pid - b.pid);

  const treatAsProduction = syncs.some((s) => s.classification !== 'staging');

  return {
    active: syncs.length > 0,
    treatAsProduction: syncs.length > 0 && treatAsProduction,
    syncs,
    staleCleared
  };
}
