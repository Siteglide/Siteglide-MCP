import { spawnSync } from 'node:child_process';

/**
 * Run a subprocess synchronously with a timeout so a stuck CLI cannot block the whole MCP stdio server.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number, windowsHide?: boolean }} [opts]
 * @returns {{
 *   ok: boolean,
 *   stdout: string,
 *   stderr: string,
 *   timedOut: boolean,
 *   signal: string | null,
 *   errorCode?: string
 * }}
 */
export function runCommand(bin, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const res = spawnSync(bin, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    windowsHide: opts.windowsHide !== false,
    timeout: timeoutMs,
    killSignal: 'SIGTERM'
  });

  const timedOut = res.error?.code === 'ETIMEDOUT';
  const spawnError = res.error && !timedOut ? res.error.code : undefined;

  return {
    ok: res.status === 0 && !timedOut && !spawnError,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    timedOut,
    signal: res.signal,
    errorCode: timedOut ? 'ETIMEDOUT' : spawnError
  };
}
