import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getServerHealth, MCP_TIMEOUT_GUIDANCE } from '../../src/ops/serverHealth.js';
import { writeMcpSessionMarker } from '../../src/ops/sessionMarker.js';

describe('getServerHealth', () => {
  it('returns alive payload with timeout guidance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-health-'));
    try {
      writeMcpSessionMarker({
        projectDir: dir,
        startedAt: new Date().toISOString(),
        version: '0.0.0-test'
      });
      const health = getServerHealth({
        projectDir: dir,
        version: '0.0.0-test',
        startedAt: new Date(Date.now() - 1000).toISOString(),
        startedAtMs: Date.now() - 1000
      });
      assert.equal(health.ok, true);
      assert.equal(health.alive, true);
      assert.equal(health.pid, process.pid);
      assert.equal(health.sessionMarker.present, true);
      assert.equal(health.timeoutGuidance, MCP_TIMEOUT_GUIDANCE);
      assert.match(health.nextSteps[0], /handling requests/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
