import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyEnvironment,
  hostnameFromUrl,
  assertPayloadSize,
  MAX_BODY_BYTES
} from './security.js';

const DEFAULT_CONFIG = '.siteglide-config';
const API_URL = 'https://api.siteglide.co.uk/api';

const __dirname = dirname(fileURLToPath(import.meta.url));

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function loadConfig(configPath = process.env.CONFIG_FILE_PATH || DEFAULT_CONFIG) {
  const abs = resolve(configPath);
  if (!existsSync(abs)) {
    return {};
  }
  return JSON.parse(readFileSync(abs, 'utf8'));
}

/**
 * @returns {{ url: string, email: string, token: string }}
 */
export function resolveAuth(environment, configPath) {
  const env = process.env;
  if (env.MPKIT_URL && env.MPKIT_TOKEN && env.MPKIT_EMAIL) {
    return { url: env.MPKIT_URL, email: env.MPKIT_EMAIL, token: env.MPKIT_TOKEN };
  }

  const settings = loadConfig(configPath);
  const auth = settings[environment];
  if (!auth || !auth.url) {
    throw new Error(
      `No settings for environment "${environment}". Run siteglide-cli add, or set MPKIT_URL / MPKIT_EMAIL / MPKIT_TOKEN.`
    );
  }
  return { url: auth.url, email: auth.email, token: auth.token };
}

export async function siteglideApi(auth, { method = 'GET', path, json, query }) {
  if (json !== undefined) {
    const serialized = JSON.stringify(json);
    assertPayloadSize('Request body', serialized, MAX_BODY_BYTES);
  }

  const url = new URL(`${API_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `${auth.token}`,
      From: auth.email,
      site: auth.url,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Siteglide-Client': `siteglide-mcp/${packageVersion()}`
    },
    body: json !== undefined ? JSON.stringify(json) : undefined
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const safe =
      typeof body === 'string'
        ? body
        : JSON.stringify(body && typeof body === 'object' ? { error: body.error || body.message || 'request failed' } : body);
    throw new Error(`Siteglide API ${res.status}: ${safe}`);
  }
  return body;
}

/**
 * @param {string} [configPath]
 * @param {{ details?: boolean }} [opts]
 */
export function listEnvironments(configPath, opts = {}) {
  const details = Boolean(opts.details);
  const env = process.env;

  if (env.MPKIT_URL && env.MPKIT_TOKEN && env.MPKIT_EMAIL) {
    const auth = { url: env.MPKIT_URL, email: env.MPKIT_EMAIL, token: env.MPKIT_TOKEN };
    const host = hostnameFromUrl(auth.url);
    const item = { name: '(MPKIT)', host };
    if (details) {
      item.url = auth.url;
      item.classification = classifyEnvironment(auth);
    }
    return [item];
  }

  const settings = loadConfig(configPath);
  return Object.keys(settings).map((name) => {
    const entry = settings[name] || {};
    const host = hostnameFromUrl(entry.url);
    const item = { name, host };
    if (details) {
      item.url = entry.url || '';
      item.classification = classifyEnvironment({ url: entry.url });
    }
    return item;
  });
}
