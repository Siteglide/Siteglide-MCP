import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getRemoteCheckStatus,
  evaluateConflictFreshness,
  conflictMatchesPath
} from '../../src/ops/remoteCheckStatus.js';

describe('remoteCheckStatus current sync conflict', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-remote-check-'));
    mkdirSync(join(dir, 'app', 'views', 'pages'), { recursive: true });
    writeFileSync(join(dir, 'app', 'views', 'pages', 'a.liquid'), 'x\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads current-conflict.json and evaluates freshness vs changedAt', () => {
    const detectedAt = '2026-08-12T15:00:05.000Z';
    const changedAt = '2026-08-12T15:00:00.000Z';
    mkdirSync(join(dir, '.siteglide', 'sync'), { recursive: true });
    writeFileSync(
      join(dir, '.siteglide', 'sync', 'current-conflict.json'),
      JSON.stringify({
        schemaVersion: 1,
        command: 'sync',
        status: 'awaiting_user_decision',
        awaitingUserDecision: true,
        environment: 'staging',
        reason: 'remote_newer',
        detectedAt,
        path: 'views/pages/a.liquid',
        localPath: 'app/views/pages/a.liquid',
        remoteUpdatedAt: '2026-08-12T14:00:00.000Z',
        effectiveBaselineAt: '2026-08-01T00:00:00.000Z',
        localMtimeAtDetect: changedAt
      })
    );

    const status = getRemoteCheckStatus({
      projectDir: dir,
      path: 'app/views/pages/a.liquid',
      changedAt
    });
    assert.equal(status.activeConflict, true);
    assert.equal(status.awaitingSyncUserDecision, true);
    assert.equal(status.currentSyncConflict.path, 'views/pages/a.liquid');
    assert.equal(status.forPath.isCurrent, true);
    assert.equal(status.forPath.freshness, 'current_for_change');
    assert.match(status.forPath.advice, /CLI prompt/);
  });

  it('marks conflict stale when detectedAt is before changedAt', () => {
    const conflict = {
      awaitingUserDecision: true,
      detectedAt: '2026-08-12T14:00:00.000Z',
      path: 'views/pages/a.liquid',
      localPath: 'app/views/pages/a.liquid'
    };
    const evaled = evaluateConflictFreshness(conflict, {
      path: 'views/pages/a.liquid',
      changedAt: '2026-08-12T15:00:00.000Z',
      projectDir: dir
    });
    assert.equal(evaled.freshness, 'stale_before_change');
    assert.equal(evaled.isCurrent, false);
  });

  it('matches path suffixes', () => {
    assert.equal(
      conflictMatchesPath(
        { path: 'views/pages/a.liquid', localPath: 'app/views/pages/a.liquid' },
        'app/views/pages/a.liquid'
      ),
      true
    );
  });
});
