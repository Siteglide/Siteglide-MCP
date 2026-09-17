import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSyncStatus } from '../../src/ops/syncStatus.js';

function writeSyncEntry(projectDir, { pid, environment, startedAt = '2026-08-07T12:00:00.000Z' }) {
  const dir = join(projectDir, '.siteglide', 'user', 'sync');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${pid}.json`),
    JSON.stringify({ pid, environment, cwd: projectDir, startedAt }, null, 2),
    'utf8'
  );
}

describe('getSyncStatus', () => {
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
    dir = mkdtempSync(join(tmpdir(), 'sg-sync-status-'));
    configPath = join(dir, '.siteglide-config');
    writeFileSync(
      configPath,
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
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns inactive when no sync dir exists', () => {
    const status = getSyncStatus({ projectDir: dir, configPath });
    assert.deepEqual(status, {
      active: false,
      treatAsProduction: false,
      syncs: [],
      staleCleared: 0
    });
  });

  it('clears dead pid files and reports inactive', () => {
    writeSyncEntry(dir, { pid: 999001, environment: 'production' });
    const status = getSyncStatus({
      projectDir: dir,
      configPath,
      isAlive: () => false
    });
    assert.equal(status.active, false);
    assert.equal(status.treatAsProduction, false);
    assert.equal(status.staleCleared, 1);
    assert.equal(existsSync(join(dir, '.siteglide', 'user', 'sync', '999001.json')), false);
  });

  it('reports one live staging sync without treatAsProduction', () => {
    writeSyncEntry(dir, { pid: 111, environment: 'staging' });
    const status = getSyncStatus({
      projectDir: dir,
      configPath,
      isAlive: (pid) => pid === 111
    });
    assert.equal(status.active, true);
    assert.equal(status.treatAsProduction, false);
    assert.deepEqual(status.syncs, [
      {
        pid: 111,
        environment: 'staging',
        classification: 'staging',
        host: 'demo.staging-siteglide.com',
        startedAt: '2026-08-07T12:00:00.000Z'
      }
    ]);
    assert.equal(status.staleCleared, 0);
  });

  it('treats staging + production together as treatAsProduction', () => {
    writeSyncEntry(dir, { pid: 111, environment: 'staging' });
    writeSyncEntry(dir, { pid: 222, environment: 'production' });
    const status = getSyncStatus({
      projectDir: dir,
      configPath,
      isAlive: (pid) => pid === 111 || pid === 222
    });
    assert.equal(status.active, true);
    assert.equal(status.treatAsProduction, true);
    assert.equal(status.syncs.length, 2);
    assert.deepEqual(
      status.syncs.map((s) => s.environment),
      ['production', 'staging']
    );
  });

  it('counts unknown env as treatAsProduction', () => {
    writeSyncEntry(dir, { pid: 333, environment: 'mystery' });
    const status = getSyncStatus({
      projectDir: dir,
      configPath,
      isAlive: (pid) => pid === 333
    });
    assert.equal(status.active, true);
    assert.equal(status.treatAsProduction, true);
    assert.equal(status.syncs.length, 1);
    assert.equal(status.syncs[0].classification, null);
    assert.match(status.syncs[0].note, /not found/i);
  });

  it('keeps live entries and clears only dead ones in a mixed scan', () => {
    writeSyncEntry(dir, { pid: 111, environment: 'staging' });
    writeSyncEntry(dir, { pid: 999002, environment: 'production' });
    const status = getSyncStatus({
      projectDir: dir,
      configPath,
      isAlive: (pid) => pid === 111
    });
    assert.equal(status.active, true);
    assert.equal(status.treatAsProduction, false);
    assert.equal(status.staleCleared, 1);
    assert.deepEqual(readdirSync(join(dir, '.siteglide', 'user', 'sync')), ['111.json']);
  });
});
