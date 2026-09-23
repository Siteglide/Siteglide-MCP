# Siteglide MCP

Experimental **Siteglide MCP server** for desktop AI agents (Cursor, Claude Code, VS Code, Windsurf). HTTP/Docker for browser agents is deferred.

## Capabilities (stdio / desktop)

| Tool | Purpose | Auth / gates |
| --- | --- | --- |
| `validate_code` | Lint Liquid/GraphQL/YAML before write — single file or coordinated `files[]` batch (platformOS supervisor) | None (local FS) |
| `siteglide_rules` | Load Siteglide agent rules | None |
| `siteglide_guide` | Load short Siteglide convention guide | None |
| `envs_list` | List envs with host; `details: true` adds `url` + `classification` (`staging`\|`production`) | Config (MCP only — never tokens/emails) |
| `modules_list` | Installed module names; caches in `.siteglide/project/modules.json` (`installed.<env>`, 2h TTL). `refresh: true` to bust cache | Auth via MCP |
| `audience` | Read/fill `.siteglide/user/about-me.json` (role, git, CLI experience); languageGuidance for agents | None (local FS); optional MCP form elicitation |
| `remote_check_status` | Read CLI conflict logs under `.siteglide/user/` (remote-check, sync current-conflict, merge manifests, stash conflicts) | None (local FS) |
| `graphql_exec` | Run GraphQL via Siteglide-API | Auth via MCP; **production mutations** need human elicitation; results wrapped as untrusted |
| `liquid_exec` | Evaluate Liquid via Siteglide-API | Auth via MCP; **blocked on production**; staging OK; results wrapped as untrusted |
| `logs_fetch` | Fetch recent site logs | Auth via MCP; results wrapped as untrusted |

**Secrets:** Agents must **never** read `.siteglide-config`. Always call `envs_list({ details: true })` before env-scoped ops. Ops tools load tokens internally.

**Sync safety:** Call `sync_status` to detect live `siteglide-cli sync` (reads `.siteglide/user/sync/`). If unavailable, ask the user or read the CLI terminal. The CLI refuses a second sync for the same environment in the same directory; different envs may run together.

**Classification:** MCP classifies from the site URL hostname (not the env key name). Staging hosts match `.staging-siteglide.com` / `.staging.oregon.platform-os.com`; everything else (including custom domains) is `production`.

**Project layout:** Siteglide projects may use `app/` or legacy `marketplace_builder/` (same site-root role). `siteglide-cli pull` keeps whichever root already exists — it does not rename. Agents should treat `marketplace_builder/` as equivalent to `app/` when platformOS packages only reference `app/`.

## Run

```bash
cd Siteglide-MCP
npm install
node bin/siteglide-mcp.js --project /path/to/site

# Or via siteglide-cli:
siteglide-cli pull staging   # also registers MCP in IDE configs if missing
siteglide-cli mcp --project .
```

## Compose model

Registers `validate_code` from `@platformos/platformos-mcp-supervisor` (^0.2.0 — batch-aware write gate). Siteglide owns stdio lifecycle, rules, and ops tools.

## Workspace role

| Related root | Role |
| --- | --- |
| **This repo** | Source of truth for Siteglide MCP |
| `siteglide-cli` | `pull` (skills + MCP IDE registration + app layout migrate), thin `mcp` launcher |
| `platformos-tools` | Upstream supervisor / check architecture reference |
| `Siteglide-API` | Auth proxy for ops tools |

## Status

Desktop / stdio v1. HTTP/SSE + Docker later.
