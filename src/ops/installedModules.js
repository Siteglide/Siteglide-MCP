import { resolveAuth, siteglideApi } from './client.js';
import { classifyEnvironment, hostnameFromUrl } from './security.js';
import {
  getCachedInstalledEntry,
  mergeInstalledIntoDocument,
  readModulesProjectConfig,
  writeModulesProjectConfig
} from './modulesProjectConfig.js';

/**
 * Normalize `/cli/list_modules` — same response shape siteglide-cli pull uses.
 * @param {unknown} body
 * @returns {string[]}
 */
export function parseListModulesResponse(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
    return [];
  }
  return body.data.filter((name) => typeof name === 'string');
}

/**
 * @param {{ environment: string, configPath?: string }} opts
 * @returns {Promise<string[]>}
 */
async function fetchInstalledModulesFromApi(opts) {
  const auth = resolveAuth(opts.environment, opts.configPath);
  const body = await siteglideApi(auth, {
    method: 'GET',
    path: '/cli/list_modules'
  });
  return parseListModulesResponse(body);
}

/**
 * @param {{
 *   environment: string,
 *   configPath?: string,
 *   projectDir?: string,
 *   refresh?: boolean,
 *   nowMs?: number,
 *   fetchModules?: (opts: { environment: string, configPath?: string }) => Promise<string[]>
 * }} opts
 */
export async function listInstalledModules(opts) {
  const auth = resolveAuth(opts.environment, opts.configPath);
  const nowMs = opts.nowMs ?? Date.now();
  const projectDir = opts.projectDir;

  if (projectDir && !opts.refresh) {
    const document = readModulesProjectConfig(projectDir);
    const cached = getCachedInstalledEntry(document, opts.environment, nowMs);
    if (cached) {
      return {
        environment: opts.environment,
        host: hostnameFromUrl(auth.url),
        classification: classifyEnvironment(auth),
        count: cached.modules.length,
        modules: cached.modules,
        cached: true,
        last_checked: cached.last_checked,
        config_path: '.siteglide/project/modules.json'
      };
    }
  }

  const fetchModules = opts.fetchModules ?? fetchInstalledModulesFromApi;
  const modules = await fetchModules({
    environment: opts.environment,
    configPath: opts.configPath
  });
  const lastChecked = new Date(nowMs).toISOString();

  if (projectDir) {
    const document = readModulesProjectConfig(projectDir);
    writeModulesProjectConfig(
      projectDir,
      mergeInstalledIntoDocument(document, opts.environment, modules, lastChecked)
    );
  }

  return {
    environment: opts.environment,
    host: hostnameFromUrl(auth.url),
    classification: classifyEnvironment(auth),
    count: modules.length,
    modules,
    cached: false,
    last_checked: lastChecked,
    config_path: projectDir ? '.siteglide/project/modules.json' : undefined
  };
}
