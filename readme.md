# Siteglide MCP

Experimental **Siteglide MCP server** for desktop AI agents (Cursor, Claude Code, VS Code, Windsurf). HTTP/Docker for browser agents is deferred.

## Capabilities (stdio / desktop)

| Tool | Purpose | Auth / gates |
| --- | --- | --- |
| `validate_code` | Lint Liquid/GraphQL/YAML before write (platformOS check engine) | None (local FS) |
| `siteglide_rules` | Load Siteglide agent rules | None |
| `siteglide_guide` | Load short Siteglide convention guide | None |
| `envs_list` | List envs with host; `details: true` adds `url` + `classification` (`staging`\|`production`) | Config (MCP only — never tokens/emails) |
| `sync_status` | Report live `siteglide-cli sync` watches for this project; `treatAsProduction` if any prod/unknown sync is live | Local status files under `.siteglide/sync/` (pid-checked) |
| `graphql_exec` | Run GraphQL via Siteglide-API | Auth via MCP; **production mutations** need human elicitation; results wrapped as untrusted |
| `liquid_exec` | Evaluate Liquid via Siteglide-API | Auth via MCP; **blocked on production**; staging OK; results wrapped as untrusted |
| `logs_fetch` | Fetch recent site logs | Auth via MCP; results wrapped as untrusted |

**Secrets:** Agents must **never** read `.siteglide-config`. Always call `envs_list({ details: true })` before env-scoped ops. Ops tools load tokens internally.

**Sync safety:** Before editing project files, agents must call `sync_status`. If `treatAsProduction` is true (any live sync is production, or staging+production together), follow the production sync elicit in `siteglide_rules`. Do not infer sync from IDE terminals. The CLI refuses a second sync for the same environment in the same directory; different envs may run together.

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

Depends on `@platformos/platformos-check-node` (same engine as `@platformos/platformos-mcp-supervisor`) without forking supervisor source. Siteglide owns stdio lifecycle, rules, and ops tools.

## Workspace role

| Related root | Role |
| --- | --- |
| **This repo** | Source of truth for Siteglide MCP |
| `siteglide-cli` | `pull` (skills + MCP IDE registration + app layout migrate), thin `mcp` launcher |
| `platformos-tools` | Upstream supervisor / check architecture reference |
| `Siteglide-API` | Auth proxy for ops tools |

## Status

Desktop / stdio v1. HTTP/SSE + Docker later.
