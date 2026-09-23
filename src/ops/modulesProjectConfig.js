import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Same path as siteglide-cli `pullIgnoredModules` — team-shareable under `.siteglide/project/`. */
export const MODULES_PROJECT_CONFIG_REL = '.siteglide/project/modules.json';

/** Default cache TTL for `installed` entries (2 hours). */
export const INSTALLED_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * @param {string} projectDir
 * @returns {string}
 */
export function resolveModulesProjectConfigPath(projectDir) {
  return join(projectDir, '.siteglide', 'project', 'modules.json');
}

/**
 * @param {string} projectDir
 * @returns {Record<string, unknown>}
 */
export function readModulesProjectConfig(projectDir) {
  const configPath = resolveModulesProjectConfigPath(projectDir);
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Treat corrupt file as empty — fetch will rewrite installed.
  }
  return {};
}

/**
 * @param {unknown} value
 * @returns {string[]|null}
 */
export function normalizeModuleNameList(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const modules = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      modules.push(entry.trim());
    }
  }
  return modules;
}

/**
 * @param {unknown} lastChecked
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isInstalledCacheFresh(lastChecked, nowMs = Date.now()) {
  if (typeof lastChecked !== 'string' || !lastChecked.trim()) {
    return false;
  }
  const parsed = Date.parse(lastChecked);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return nowMs - parsed < INSTALLED_CACHE_MAX_AGE_MS;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} environment
 * @param {number} [nowMs]
 * @returns {{ modules: string[], last_checked: string } | null}
 */
export function getCachedInstalledEntry(document, environment, nowMs = Date.now()) {
  const installed = document.installed;
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) {
    return null;
  }
  const envEntry = /** @type {Record<string, unknown>} */ (installed)[environment];
  if (!envEntry || typeof envEntry !== 'object' || Array.isArray(envEntry)) {
    return null;
  }
  const modules = normalizeModuleNameList(envEntry.modules);
  if (modules === null) {
    return null;
  }
  const lastChecked = envEntry.last_checked;
  if (typeof lastChecked !== 'string' || !isInstalledCacheFresh(lastChecked, nowMs)) {
    return null;
  }
  return { modules, last_checked: lastChecked };
}

/**
 * Merge `installed.<env>` without removing other keys (e.g. `pull_behaviour`).
 *
 * @param {Record<string, unknown>} document
 * @param {string} environment
 * @param {string[]} modules
 * @param {string} lastChecked ISO-8601 timestamp
 * @returns {Record<string, unknown>}
 */
export function mergeInstalledIntoDocument(document, environment, modules, lastChecked) {
  const installed =
    document.installed && typeof document.installed === 'object' && !Array.isArray(document.installed)
      ? { .../** @type {Record<string, unknown>} */ (document.installed) }
      : {};

  installed[environment] = {
    modules: modules.slice(),
    last_checked: lastChecked
  };

  return {
    ...document,
    installed
  };
}

/**
 * @param {string} projectDir
 * @param {Record<string, unknown>} document
 */
export function writeModulesProjectConfig(projectDir, document) {
  const configPath = resolveModulesProjectConfigPath(projectDir);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(document, null, '\t')}\n`, 'utf8');
}
