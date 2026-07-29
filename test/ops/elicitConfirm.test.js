import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { elicitProductionMutationConfirm } from '../../src/ops/elicitConfirm.js';
import { CONFIRM_PHRASE } from '../../src/ops/security.js';

function mockMcpServer(elicitImpl) {
  return {
    server: {
      elicitInput: mock.fn(elicitImpl),
      createElicitationCompletionNotifier: mock.fn(() => async () => {})
    }
  };
}

describe('elicitProductionMutationConfirm', () => {
  it('accepts valid form challenge that is not too fast', async () => {
    process.env.SITEGLIDE_MCP_ELICIT_FAST_MS = '0';
    const mcp = mockMcpServer(async () => ({
      action: 'accept',
      content: { env_name: 'production', confirm_phrase: CONFIRM_PHRASE }
    }));
    const result = await elicitProductionMutationConfirm(mcp, {
      env: 'production',
      host: 'x.us-siteglide.com',
      preview: 'mutation { x }'
    });
    assert.deepEqual(result, { ok: true });
    delete process.env.SITEGLIDE_MCP_ELICIT_FAST_MS;
  });

  it('fails closed on decline', async () => {
    const mcp = mockMcpServer(async () => ({ action: 'decline' }));
    const result = await elicitProductionMutationConfirm(mcp, {
      env: 'production',
      host: 'x.us-siteglide.com',
      preview: 'mutation { x }'
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /decline/i);
  });

  it('escalates to URL when form unsupported', async () => {
    let calls = 0;
    const mcp = mockMcpServer(async (params) => {
      calls += 1;
      if (params.mode === 'form' || !params.mode) {
        throw new Error('Client does not support form elicitation.');
      }
      // URL mode — simulate user decline quickly
      return { action: 'decline' };
    });
    const result = await elicitProductionMutationConfirm(mcp, {
      env: 'production',
      host: 'x.us-siteglide.com',
      preview: 'mutation { x }'
    });
    assert.equal(result.ok, false);
    assert.ok(calls >= 1);
  });

  it('fails closed when form and URL unsupported', async () => {
    const mcp = mockMcpServer(async () => {
      throw new Error('Client does not support form elicitation.');
    });
    // Second call for URL also fails
    mcp.server.elicitInput = mock.fn(async (params) => {
      if (params.mode === 'url') {
        throw new Error('Client does not support url elicitation.');
      }
      throw new Error('Client does not support form elicitation.');
    });
    const result = await elicitProductionMutationConfirm(mcp, {
      env: 'production',
      host: 'x.us-siteglide.com',
      preview: 'mutation { x }'
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /elicitation/i);
  });

  it('escalates when typed challenge mismatches', async () => {
    process.env.SITEGLIDE_MCP_ELICIT_FAST_MS = '0';
    let sawUrl = false;
    const mcp = mockMcpServer(async (params) => {
      if (params.mode === 'url') {
        sawUrl = true;
        return { action: 'decline' };
      }
      return {
        action: 'accept',
        content: { env_name: 'wrong', confirm_phrase: CONFIRM_PHRASE }
      };
    });
    const result = await elicitProductionMutationConfirm(mcp, {
      env: 'production',
      host: 'x.us-siteglide.com',
      preview: 'mutation { x }'
    });
    assert.equal(result.ok, false);
    assert.equal(sawUrl, true);
    delete process.env.SITEGLIDE_MCP_ELICIT_FAST_MS;
  });
});
