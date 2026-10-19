import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSyncErrors, getSyncStatus } from '../../src/ops/syncStatus.js';

function writeSyncEntry(projectDir, payload) {
  const dir = join(projectDir, '.siteglide', 'user', 'sync');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${payload.pid}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

describe('getSyncErrors', () => {
  let dir;
  let configPath;
  const prev = {};

  before(() => {
    for (const k of ['MPKIT_URL', 'MPKIT_TOKEN', 'MPKIT_EMAIL', 'CONFIG_FILE_PATH']) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-sync-errors-'));
    configPath = join(dir, '.siteglide-config');
    writeFileSync(
      configPath,
      JSON.stringify({
        staging: {
          url: 'https://demo.staging-siteglide.com/',
          email: 'a@b.com',
          token: 'SECRET_TOKEN'
        }
      })
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns errors from live sync with env metadata', () => {
    writeSyncEntry(dir, {
      pid: 111,
      environment: 'staging',
      cwd: dir,
      startedAt: '2026-08-07T12:00:00.000Z',
      syncErrors: [
        {
          at: '2026-08-07T12:05:00.000Z',
          path: 'marketplace_builder/views/pages/a.liquid',
          kind: 'validation',
          message: 'Guide: syntax error',
          logLine: '[Sync] Error: …'
        }
      ]
    });
    const result = getSyncErrors({
      projectDir: dir,
      configPath,
      isAlive: (pid) => pid === 111
    });
    assert.equal(result.activeSyncs, 1);
    assert.deepEqual(result.errors, [
      {
        pid: 111,
        environment: 'staging',
        classification: 'staging',
        host: 'demo.staging-siteglide.com',
        url: 'https://demo.staging-siteglide.com/',
        startedAt: '2026-08-07T12:00:00.000Z',
        at: '2026-08-07T12:05:00.000Z',
        path: 'marketplace_builder/views/pages/a.liquid',
        kind: 'validation',
        message: 'Guide: syntax error',
        logLine: '[Sync] Error: …'
      }
    ]);
  });

  it('filters since and until on at', () => {
    writeSyncEntry(dir, {
      pid: 111,
      environment: 'staging',
      syncErrors: [
        { at: '2026-08-07T11:00:00.000Z', path: 'a.liquid', message: 'early' },
        { at: '2026-08-07T12:00:00.000Z', path: 'b.liquid', message: 'mid' },
        { at: '2026-08-07T13:00:00.000Z', path: 'c.liquid', message: 'late' }
      ]
    });
    const result = getSyncErrors({
      projectDir: dir,
      configPath,
      isAlive: () => true,
      since: '2026-08-07T11:30:00.000Z',
      until: '2026-08-07T12:30:00.000Z'
    });
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['mid']
    );
  });

  it('filters by environment', () => {
    writeSyncEntry(dir, {
      pid: 111,
      environment: 'staging',
      syncErrors: [{ at: '2026-08-07T12:00:00.000Z', path: 'a.liquid', message: 'one' }]
    });
    writeSyncEntry(dir, {
      pid: 222,
      environment: 'production',
      syncErrors: [{ at: '2026-08-07T12:00:00.000Z', path: 'b.liquid', message: 'two' }]
    });
    writeFileSync(
      join(dir, '.siteglide-config'),
      JSON.stringify({
        staging: {
          url: 'https://demo.staging-siteglide.com/',
          email: 'a@b.com',
          token: 'SECRET_TOKEN'
        },
        production: {
          url: 'https://demo.us-siteglide.com/',
          email: 'a@b.com',
          token: 'SECRET_TOKEN'
        }
      })
    );
    const result = getSyncErrors({
      projectDir: dir,
      configPath,
      isAlive: () => true,
      environment: 'staging'
    });
    assert.equal(result.activeSyncs, 1);
    assert.deepEqual(result.errors.map((e) => e.message), ['one']);
  });

  it('excludes dead pid and does not unlink the file', () => {
    writeSyncEntry(dir, {
      pid: 999001,
      environment: 'staging',
      syncErrors: [{ at: '2026-08-07T12:00:00.000Z', path: 'a.liquid', message: 'gone' }]
    });
    const filePath = join(dir, '.siteglide', 'user', 'sync', '999001.json');
    const errors = getSyncErrors({
      projectDir: dir,
      configPath,
      isAlive: () => false
    });
    assert.deepEqual(errors.errors, []);
    assert.equal(existsSync(filePath), true);
    getSyncStatus({
      projectDir: dir,
      configPath,
      isAlive: () => false
    });
    assert.equal(existsSync(filePath), false);
  });
});
