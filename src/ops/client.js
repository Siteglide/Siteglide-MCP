import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_CONFIG = '.siteglide-config';
const API_URL = 'https://api.siteglide.co.uk/api';

export function loadConfig(configPath = process.env.CONFIG_FILE_PATH || DEFAULT_CONFIG) {
  const abs = resolve(configPath);
  if (!existsSync(abs)) {
    return {};
  }
  return JSON.parse(readFileSync(abs, 'utf8'));
}

export function resolveAuth(environment, configPath) {
  const env = process.env;
  if (env.MPKIT_URL && env.MPKIT_TOKEN && env.MPKIT_EMAIL) {
    return { url: env.MPKIT_URL, email: env.MPKIT_EMAIL, token: env.MPKIT_TOKEN };
  }

  const settings = loadConfig(configPath);
  const auth = settings[environment];
  if (!auth) {
    throw new Error(
      `No settings for environment "${environment}". Run siteglide-cli add, or set MPKIT_URL / MPKIT_EMAIL / MPKIT_TOKEN.`
    );
  }
  return auth;
}

export async function siteglideApi(auth, { method = 'GET', path, json, query }) {
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
      Accept: 'application/json'
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
    throw new Error(`Siteglide API ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

export function listEnvironments(configPath) {
  return Object.keys(loadConfig(configPath));
}
