import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerSiteglideTools } from '../../src/siteglide/register.js';

async function connectSiteglideToolsServer() {
  const server = new McpServer({ name: 'test-siteglide-mcp', version: '0.0.0' });
  registerSiteglideTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    async close() {
      await client.close();
      await server.close();
    }
  };
}

async function callSiteglideGuide(client, args = {}) {
  const res = await client.callTool({ name: 'siteglide_guide', arguments: args });
  const content = /** @type {Array<{ type: string; text: string }>} */ (res.content);
  assert.equal(content[0].type, 'text');
  return content[0].text;
}

describe('registerSiteglideTools', () => {
  /** @type {{ client: Client; close: () => Promise<void> } | undefined} */
  let session;

  afterEach(async () => {
    if (session) {
      await session.close();
      session = undefined;
    }
  });

  it('loads local-validation-gaps guide with public/private pull guidance', async () => {
    session = await connectSiteglideToolsServer();
    const text = await callSiteglideGuide(session.client, { name: 'local-validation-gaps' });

    assert.match(text, /private.*never downloads/);
    assert.match(text, /pull -m siteglide_system/);
    assert.match(text, /public files only/);
    assert.match(text, /must_fix_before_write/);
    assert.match(text, /does not include.*name/);
    assert.match(text, /want to install it/);
  });

  it('defaults siteglide_guide to conventions', async () => {
    session = await connectSiteglideToolsServer();
    const text = await callSiteglideGuide(session.client);

    assert.match(text, /marketplace_builder/);
  });
});
