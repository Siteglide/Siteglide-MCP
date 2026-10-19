import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRemoteCheckStatus } from '../../src/ops/remoteCheckStatus.js';

describe('getRemoteCheckStatus', () => {
  it('reads conflict logs from .siteglide/user/remote-check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-rcs-'));
    try {
      const logDir = join(dir, '.siteglide', 'user', 'remote-check');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(
        join(logDir, 'staging.json'),
        `${JSON.stringify({
          environment: 'staging',
          status: 'conflict',
          recommendedActions: [{ id: 'merge_first', priority: 1 }]
        })}\n`
      );
      const status = getRemoteCheckStatus({ projectDir: dir, environment: 'staging' });
      assert.equal(status.activeConflict, true);
      assert.equal(status.environments.length, 1);
      assert.equal(status.environments[0].recommendedActions[0].id, 'merge_first');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not read leftover .siteglide/IDE logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-rcs-ide-'));
    try {
      const logDir = join(dir, '.siteglide', 'IDE', 'remote-check');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(
        join(logDir, 'staging.json'),
        '{"environment":"staging","status":"conflict"}\n'
      );
      const status = getRemoteCheckStatus({ projectDir: dir, environment: 'staging' });
      assert.equal(status.activeConflict, false);
      assert.equal(status.environments.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to legacy .siteglide/remote-check when user/ is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-rcs-legacy-'));
    try {
      const logDir = join(dir, '.siteglide', 'remote-check');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, 'staging.json'), '{"environment":"staging","status":"conflict"}\n');
      const status = getRemoteCheckStatus({ projectDir: dir });
      assert.equal(status.activeConflict, true);
      assert.equal(status.environments[0].environment, 'staging');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
