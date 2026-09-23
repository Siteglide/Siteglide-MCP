import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../../src/ops/runCommand.js';

describe('runCommand', () => {
  it('returns quickly for a missing binary', () => {
    const res = runCommand('sg-mcp-missing-binary-xyz', ['--version'], { timeoutMs: 1000 });
    assert.equal(res.timedOut, false);
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'ENOENT');
  });

  it('times out instead of hanging indefinitely', () => {
    const res = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 200 });
    assert.equal(res.timedOut, true);
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, 'ETIMEDOUT');
  });
});
