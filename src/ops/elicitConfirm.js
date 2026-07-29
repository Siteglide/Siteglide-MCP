import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyTypedChallenge, CONFIRM_PHRASE } from './security.js';

const DEFAULT_FAST_MS = 250;
const URL_TTL_MS = 2 * 60 * 1000;

function getFastMs() {
  const raw = process.env.SITEGLIDE_MCP_ELICIT_FAST_MS;
  if (raw === undefined || raw === '') {
    return DEFAULT_FAST_MS;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_FAST_MS;
}

function isFormCapabilityError(error) {
  const msg = error?.message || String(error);
  return /does not support form elicitation/i.test(msg);
}

function isUrlCapabilityError(error) {
  const msg = error?.message || String(error);
  return /does not support url elicitation/i.test(msg);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {{ env: string, host: string, preview: string, log?: (m: string) => void }} opts
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function elicitProductionMutationConfirm(mcpServer, opts) {
  const log = opts.log ?? (() => {});
  const { env, host, preview } = opts;
  const message =
    `PRODUCTION GraphQL MUTATION on env "${env}" (host: ${host}, classification: production).\n` +
    `Type the env name and ${CONFIRM_PHRASE} to approve.\n\n${preview}`;

  try {
    const started = Date.now();
    const result = await mcpServer.server.elicitInput({
      mode: 'form',
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          env_name: {
            type: 'string',
            title: 'Environment name',
            description: `Type exactly: ${env}`
          },
          confirm_phrase: {
            type: 'string',
            title: 'Confirmation phrase',
            description: `Type exactly: ${CONFIRM_PHRASE}`
          }
        },
        required: ['env_name', 'confirm_phrase']
      }
    });
    const elapsed = Date.now() - started;

    if (result.action === 'decline' || result.action === 'cancel') {
      return { ok: false, reason: `User ${result.action}ed production mutation confirmation.` };
    }

    if (result.action === 'accept') {
      const challengeOk = verifyTypedChallenge({ env, content: result.content });
      const tooFast = elapsed < getFastMs();
      if (challengeOk && !tooFast) {
        return { ok: true };
      }
      if (!challengeOk) {
        log('elicitConfirm: challenge_mismatch — escalating to URL');
      }
      if (tooFast) {
        log('elicitConfirm: suspiciously_fast — escalating to URL');
      }
      return await elicitViaUrl(mcpServer, { env, host, preview, message, log });
    }

    return { ok: false, reason: 'Unexpected elicitation result.' };
  } catch (error) {
    if (isFormCapabilityError(error)) {
      log('elicitConfirm: form unsupported — trying URL');
      return await elicitViaUrl(mcpServer, { env, host, preview, message, log });
    }
    return {
      ok: false,
      reason:
        error?.message ||
        'Production mutations require an IDE that supports MCP form or URL elicitation.'
    };
  }
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {{ env: string, host: string, preview: string, message: string, log: (m: string) => void }} opts
 */
async function elicitViaUrl(mcpServer, opts) {
  const { env, host, preview, message, log } = opts;
  const elicitationId = randomUUID();
  let server;
  let settle;
  const outcome = new Promise((resolve) => {
    settle = resolve;
  });

  try {
    server = await startConfirmServer({
      env,
      host,
      preview,
      onApprove: async () => {
        try {
          const notify = mcpServer.server.createElicitationCompletionNotifier(elicitationId);
          await notify();
        } catch {
          /* client may not need notify if elicitInput already waiting */
        }
        settle({ ok: true });
      },
      onCancel: async () => {
        try {
          const notify = mcpServer.server.createElicitationCompletionNotifier(elicitationId);
          await notify();
        } catch {
          /* ignore */
        }
        settle({ ok: false, reason: 'User cancelled production mutation confirmation (URL).' });
      }
    });

    const timeout = setTimeout(() => {
      settle({ ok: false, reason: 'Production mutation confirmation timed out.' });
    }, URL_TTL_MS);

    try {
      const result = await mcpServer.server.elicitInput({
        mode: 'url',
        message,
        url: server.url,
        elicitationId
      });

      if (result.action === 'decline' || result.action === 'cancel') {
        clearTimeout(timeout);
        return { ok: false, reason: `User ${result.action}ed production mutation confirmation (URL).` };
      }

      // Some clients resolve accept when the URL flow completes via notification.
      if (result.action === 'accept') {
        clearTimeout(timeout);
        return { ok: true };
      }
    } catch (error) {
      clearTimeout(timeout);
      if (isUrlCapabilityError(error)) {
        return {
          ok: false,
          reason:
            'Client does not support form or URL elicitation. Production mutations are blocked.'
        };
      }
      // If elicitInput throws after page already approved, check outcome
      const pageResult = await Promise.race([
        outcome,
        Promise.resolve({
          ok: false,
          reason: error?.message || 'URL elicitation failed.'
        })
      ]);
      return pageResult;
    }

    const pageResult = await outcome;
    clearTimeout(timeout);
    return pageResult;
  } catch (error) {
    log(`elicitConfirm URL error: ${error?.message || error}`);
    return {
      ok: false,
      reason:
        error?.message ||
        'Production mutations require an IDE that supports MCP elicitation.'
    };
  } finally {
    if (server) {
      await server.close();
    }
  }
}

/**
 * @param {{ env: string, host: string, preview: string, onApprove: () => Promise<void>, onCancel: () => Promise<void> }} opts
 */
function startConfirmServer(opts) {
  const { env, host, preview, onApprove, onCancel } = opts;

  return new Promise((resolve, reject) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Confirm production mutation</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
    pre { background: #f4f4f4; padding: 0.75rem; overflow: auto; font-size: 0.85rem; }
    .warn { color: #8a1f11; font-weight: 600; }
    label { display: block; margin: 0.75rem 0 0.25rem; }
    input[type=text] { width: 100%; padding: 0.4rem; }
    button { margin: 1rem 0.5rem 0 0; padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1 class="warn">Production GraphQL mutation</h1>
  <p>Env: <code>${escapeHtml(env)}</code> · Host: <code>${escapeHtml(host)}</code></p>
  <pre>${escapeHtml(preview)}</pre>
  <form method="POST" action="/confirm">
    <label>Type environment name exactly</label>
    <input type="text" name="env_name" autocomplete="off" required />
    <label>Type confirmation phrase exactly (${escapeHtml(CONFIRM_PHRASE)})</label>
    <input type="text" name="confirm_phrase" autocomplete="off" required />
    <div>
      <button type="submit" name="action" value="approve">Approve</button>
      <button type="submit" name="action" value="cancel">Cancel</button>
    </div>
  </form>
</body>
</html>`;

    const server = createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/confirm') {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const params = new URLSearchParams(body);
        const action = params.get('action');
        const envName = params.get('env_name');
        const phrase = params.get('confirm_phrase');

        if (action === 'cancel') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<p>Cancelled. You can close this tab.</p>');
          await onCancel();
          return;
        }

        if (envName === env && phrase === CONFIRM_PHRASE) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<p>Approved. You can close this tab.</p>');
          await onApprove();
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Typed values did not match. Close and try again.</p>');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind confirm server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          })
      });
    });

    server.on('error', reject);
  });
}
