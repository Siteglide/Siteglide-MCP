import { resolveAuth, siteglideApi } from './client.js';
import { classifyEnvironment, hostnameFromUrl } from './security.js';

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
 */
export async function listInstalledModules(opts) {
  const auth = resolveAuth(opts.environment, opts.configPath);
  const body = await siteglideApi(auth, {
    method: 'GET',
    path: '/cli/list_modules'
  });
  const modules = parseListModulesResponse(body);

  return {
    environment: opts.environment,
    host: hostnameFromUrl(auth.url),
    classification: classifyEnvironment(auth),
    count: modules.length,
    modules
  };
}
