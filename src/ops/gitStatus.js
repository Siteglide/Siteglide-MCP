import { spawnSync } from 'node:child_process';

/**
 * Git readiness probe for MCP wizards (no secrets).
 * @param {{ projectDir: string }} opts
 */
export function getGitStatus(opts) {
  const cwd = opts.projectDir;
  const run = (bin, args) => {
    const res = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true });
    return {
      ok: res.status === 0,
      stdout: (res.stdout || '').trim(),
      stderr: (res.stderr || '').trim()
    };
  };

  const ver = run('git', ['--version']);
  const installed = ver.ok;
  const name = installed ? run('git', ['config', 'user.name']) : { ok: false, stdout: '' };
  const email = installed ? run('git', ['config', 'user.email']) : { ok: false, stdout: '' };
  const identityConfigured = !!(name.stdout && email.stdout);
  const inside = installed
    ? run('git', ['rev-parse', '--is-inside-work-tree'])
    : { ok: false, stdout: '' };
  const repoInitialized = inside.ok && inside.stdout === 'true';

  let remotes = [];
  if (repoInitialized) {
    const remoteOut = run('git', ['remote', '-v']);
    if (remoteOut.ok && remoteOut.stdout) {
      remotes = [
        ...new Set(
          remoteOut.stdout
            .split(/\r?\n/)
            .map((line) => line.split(/\s+/)[0])
            .filter(Boolean)
        )
      ];
    }
  }

  const gh = run('gh', ['auth', 'status']);
  const missing = [];
  if (!installed) {
    missing.push('installed');
  }
  if (installed && !identityConfigured) {
    missing.push('identity');
  }
  if (installed && !repoInitialized) {
    missing.push('repoInitialized');
  }

  const needsSetupWizard = missing.length > 0;

  return {
    installed,
    identityConfigured,
    repoInitialized,
    remotes,
    ghAuthenticated: gh.ok,
    missing,
    needsSetupWizard,
    version: installed ? ver.stdout : undefined,
    userName: name.stdout || undefined,
    userEmail: email.stdout || undefined,
    guidance: needsSetupWizard
      ? 'Offer the user a guided git setup via MCP elicitation (install git, set user.name/email, git init). Remote/GitHub is optional.'
      : remotes.length === 0
        ? 'Git is ready locally. Offering a GitHub remote remains optional.'
        : 'Git is ready. For sync/deploy conflicts, ask the user or read the CLI terminal.'
  };
}
