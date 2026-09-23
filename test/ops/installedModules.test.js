import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listInstalledModules, parseListModulesResponse } from '../../src/ops/installedModules.js';

function writeSiteglideConfig(root, body) {
  writeFileSync(join(root, '.siteglide-config'), JSON.stringify(body, null, 2), 'utf8');
}

function writeModulesCache(root, document) {
  const dir = join(root, '.siteglide', 'project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'modules.json'), `${JSON.stringify(document, null, '\t')}\n`, 'utf8');
}

describe('parseListModulesResponse', () => {
  it('returns module names from pull-style API payload', () => {
    assert.deepEqual(parseListModulesResponse({ data: ['core', 'module_984', 'payments'] }), [
      'core',
      'module_984',
      'payments'
    ]);
  });

  it('returns empty array when no modules are installed', () => {
    assert.deepEqual(parseListModulesResponse({ data: [] }), []);
  });

  it('returns empty array for missing or malformed payloads', () => {
    assert.deepEqual(parseListModulesResponse(null), []);
    assert.deepEqual(parseListModulesResponse({}), []);
    assert.deepEqual(parseListModulesResponse({ data: 'core' }), []);
  });

  it('drops non-string entries', () => {
    assert.deepEqual(parseListModulesResponse({ data: ['core', 42, null, 'user'] }), ['core', 'user']);
  });
});

describe('listInstalledModules cache', () => {
  let root;
  let configPath;
  const nowMs = Date.parse('2026-09-17T15:00:00.000Z');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sg-mcp-modules-list-'));
    configPath = join(root, '.siteglide-config');
    writeSiteglideConfig(root, {
      staging: {
        url: 'https://example.staging-siteglide.com/',
        email: 'admin@example.com',
        token: 'secret-token'
      }
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns cached modules without calling the API when fresh', async () => {
    writeModulesCache(root, {
      installed: {
        staging: {
          modules: ['core', 'siteglide_system'],
          last_checked: '2026-09-17T14:30:00.000Z'
        }
      }
    });

    let apiCalls = 0;
    const result = await listInstalledModules({
      environment: 'staging',
      configPath,
      projectDir: root,
      nowMs,
      fetchModules: async () => {
        apiCalls += 1;
        return ['should-not-fetch'];
      }
    });

    assert.equal(apiCalls, 0);
    assert.equal(result.cached, true);
    assert.deepEqual(result.modules, ['core', 'siteglide_system']);
    assert.equal(result.last_checked, '2026-09-17T14:30:00.000Z');
  });

  it('fetches live, writes installed to modules.json, and returns cached: false', async () => {
    const result = await listInstalledModules({
      environment: 'staging',
      configPath,
      projectDir: root,
      nowMs,
      fetchModules: async () => {
        return ['core', 'payments'];
      }
    });

    assert.equal(result.cached, false);
    assert.deepEqual(result.modules, ['core', 'payments']);
    assert.equal(result.last_checked, '2026-09-17T15:00:00.000Z');

    const saved = JSON.parse(readFileSync(join(root, '.siteglide', 'project', 'modules.json'), 'utf8'));
    assert.deepEqual(saved.installed.staging, {
      modules: ['core', 'payments'],
      last_checked: '2026-09-17T15:00:00.000Z'
    });
  });

  it('refresh bypasses a fresh cache and updates modules.json', async () => {
    writeModulesCache(root, {
      pull_behaviour: { include: [], exclude: [] },
      installed: {
        staging: {
          modules: ['old_module'],
          last_checked: '2026-09-17T14:59:00.000Z'
        }
      }
    });

    const result = await listInstalledModules({
      environment: 'staging',
      configPath,
      projectDir: root,
      refresh: true,
      nowMs,
      fetchModules: async () => {
        return ['core', 'new_module'];
      }
    });

    assert.equal(result.cached, false);
    assert.deepEqual(result.modules, ['core', 'new_module']);

    const saved = JSON.parse(readFileSync(join(root, '.siteglide', 'project', 'modules.json'), 'utf8'));
    assert.deepEqual(saved.pull_behaviour, { include: [], exclude: [] });
    assert.deepEqual(saved.installed.staging.modules, ['core', 'new_module']);
  });

  it('namespaces installed entries by environment', async () => {
    writeSiteglideConfig(root, {
      staging: {
        url: 'https://example.staging-siteglide.com/',
        email: 'admin@example.com',
        token: 'secret-token'
      },
      production: {
        url: 'https://example.siteglide.com/',
        email: 'admin@example.com',
        token: 'secret-token'
      }
    });

    await listInstalledModules({
      environment: 'staging',
      configPath,
      projectDir: root,
      nowMs,
      fetchModules: async () => {
        return ['core'];
      }
    });

    await listInstalledModules({
      environment: 'production',
      configPath,
      projectDir: root,
      nowMs: nowMs + 1000,
      fetchModules: async () => {
        return ['core', 'payments'];
      }
    });

    const saved = JSON.parse(readFileSync(join(root, '.siteglide', 'project', 'modules.json'), 'utf8'));
    assert.deepEqual(saved.installed.staging.modules, ['core']);
    assert.deepEqual(saved.installed.production.modules, ['core', 'payments']);
  });
});
