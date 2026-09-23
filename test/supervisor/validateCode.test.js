import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerValidateCode } from '@platformos/platformos-mcp-supervisor';

async function connectValidateCodeServer(projectDir) {
  const server = new McpServer({ name: 'test-siteglide-mcp', version: '0.0.0' });
  registerValidateCode(server, {
    projectDir,
    log: () => {}
  });

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

async function callValidateCode(client, args) {
  const res = await client.callTool({ name: 'validate_code', arguments: args });
  const content = /** @type {Array<{ type: string; text: string }>} */ (res.content);
  assert.equal(content[0].type, 'text');
  return JSON.parse(content[0].text);
}

function writeProjectFile(projectDir, rel, body) {
  const abs = join(projectDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

describe('validate_code via platformos-mcp-supervisor', () => {
  /** @type {string} */
  let projectDir;
  /** @type {import('@modelcontextprotocol/sdk/client/index.js').Client | undefined} */
  let client;
  /** @type {(() => Promise<void>) | undefined} */
  let closeSession;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'sg-validate-code-'));
    mkdirSync(join(projectDir, '.git'));
    writeProjectFile(
      projectDir,
      'app/views/layouts/theme.liquid',
      '<html><body>{{ content_for_layout }}</body></html>'
    );
    writeProjectFile(projectDir, 'app/views/partials/card.liquid', '<div class="card">{{ title }}</div>');
    writeProjectFile(projectDir, 'app/views/pages/home.liquid', "{% render 'card' %}");

    const session = await connectValidateCodeServer(projectDir);
    client = session.client;
    closeSession = session.close;
  });

  afterEach(async () => {
    if (closeSession) {
      await closeSession();
    }
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('advertises validate_code with single-file and batch input shapes', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['validate_code']
    );
    const schema = tools[0].inputSchema;
    assert.equal(schema.type, 'object');
    assert.ok(schema.properties.file_path);
    assert.ok(schema.properties.content);
    assert.ok(schema.properties.files);
    assert.equal(schema.properties.files.type, 'array');
  });

  it('returns ok for valid single-file liquid', async () => {
    const result = await callValidateCode(client, {
      file_path: 'app/views/partials/promo.liquid',
      content: '<div>Promo</div>'
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.must_fix_before_write, false);
    assert.deepEqual(result.errors, []);
  });

  it('validates coordinated multi-file edits in one batch', async () => {
    const result = await callValidateCode(client, {
      files: [
        {
          file_path: 'app/views/pages/about.liquid',
          content: "{% render 'promo' %}"
        },
        {
          file_path: 'app/views/partials/promo.liquid',
          content: '<div>Promo</div>'
        }
      ]
    });

    assert.equal(result.must_fix_before_write, false);
    assert.equal(result.files.length, 2);
    assert.equal(result.files[0].result.status, 'ok');
    assert.equal(result.files[1].result.status, 'ok');
  });

  it('rejects whitespace-only file_path at the MCP schema boundary', async () => {
    const res = await client.callTool({
      name: 'validate_code',
      arguments: {
        file_path: '   ',
        content: '<div></div>'
      }
    });
    assert.equal(res.isError, true);
    const text = /** @type {Array<{ type: string; text: string }>} */ (res.content)[0].text;
    assert.match(text, /file_path must not be empty|MCP error/i);
  });
});
