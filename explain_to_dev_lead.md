# Siteglide MCP — brief for a technical (AI-sceptical) audience

**Status:** experimental desktop tooling (Cursor / Claude / Copilot / Windsurf). Not a replacement for code review, staging, or deploy discipline.

---

## What problem this solves

Agency developers already use Siteglide CLI + Siteglide-API for pull, GraphQL, Liquid evaluation, and logs. AI coding assistants (Cursor, etc.) are increasingly in that loop — but by default they:

- invent folder layouts and Liquid patterns that don’t match Siteglide
- edit files without the same Liquid/GraphQL checks platformOS expects
- guess at GraphQL or paste secrets from config files

**MCP (Model Context Protocol)** is a standard way for an IDE agent to call **our** tools instead of improvising shell scripts. Same auth path as the CLI (Siteglide-API). Same validator engine platformOS ships for agent workflows. No Partner Portal / pos-cli credentials.

This is **guardrails and shared operations**, not “let the AI own the site.”

---

## Benefits for Siteglide projects

1. **Fewer broken Liquid / GraphQL writes** — `validate_code` runs the platformOS check engine on the local tree before/after edits (same family of tooling platformOS recommends for agents).
2. **Siteglide-specific conventions stay explicit** — rules/guides tell the agent how we differ from vanilla platformOS (CMS folders, CLI auth, prefer `app/`, etc.).
3. **Ops without exposing tokens to the model** — agents must not read `.siteglide-config`. They call `envs_list({ details: true })` / ops tools; MCP classifies staging vs production from the site URL, gates production mutations/liquid, and wraps query/log results as untrusted data.
4. **Same contract across IDEs** — one MCP server registered on `pull`; Cursor, Claude Code, Copilot, Windsurf get the same tool names.
5. **Composable with platformOS** — we depend on their check package and bump versions; we don’t fork their supervisor. Siteglide owns rules + ops.
6. **Path to productised “web AI” later** — same tools can later run over HTTP/Docker behind our BFF; browser never holds site secrets. Desktop work isn’t a dead end.

Skills (guidance docs) and MCP (callable actions) are complementary: skills teach; MCP executes with structured results.

---

## Available tool calls

| Tool | What it does | Auth / gates | When an agent typically uses it |
| --- | --- | --- | --- |
| `validate_code` | Lint Liquid / GraphQL / YAML in the project (`app/`) via platformOS check-node | None (local FS) | Before proposing or after writing templates, GraphQL, schema-ish YAML — “is this valid?” |
| `siteglide_rules` | Load Siteglide MUST/prefer rules (layout, secrets, CLI auth, prod sync safety) | None | Early in a Siteglide task; whenever the agent needs project rules |
| `siteglide_guide` | Short Siteglide vs platformOS convention notes | None | When terminology or folder structure conflicts with generic pOS docs |
| `envs_list` | List envs; with `details: true` returns `classification` (`staging`\|`production`), host, url | Config **inside MCP only** (no tokens) | Before any env-scoped ops — **never** by opening `.siteglide-config` |
| `graphql_exec` | Run a GraphQL query/mutation via Siteglide-API | Token via MCP; **production mutations** need human elicitation; results marked untrusted | Prefer staging; inspect/update records with human confirm on prod writes |
| `liquid_exec` | Evaluate Liquid via Siteglide-API | Token via MCP; **blocked on production** | Staging only — write files + sync for prod |
| `logs_fetch` | Fetch recent debugging logs for an env | Token via MCP; results marked untrusted | Diagnose runtime errors after a change |

Human workflows (CLI GUI Liquid/GraphQL evaluators, Admin UI) remain available. MCP is for **agent** use of the same backend capabilities. The CLI refuses a second `sync` for the same environment in the same directory; different envs may run at once. Production-sync elicitation is driven by what the user (or terminal) says until CLI status-file writers ship.

---

## What this is not

- Not autonomous deploy or unattended production changes (still human + normal release process).
- Not a substitute for code review or QA.
- Not training on customer data as a product feature — local/IDE agent use; ops go through existing Siteglide-API auth.
- Not mandatory for every Siteglide project — useful where agencies already use AI-assisted editors.

---

## Possible use-cases for web agency customers

1. **Faster, safer template work** — Agent edits Liquid under `app/`, runs `validate_code`, fewer round-trips fixing syntax/schema mistakes.
2. **Onboarding juniors / contractors** — Rules + guides encode “how we do Siteglide” so generic ChatGPT advice doesn’t win by default.
3. **Content model / GraphQL exploration** — `graphql_exec` against staging to confirm fields/relations while implementing a feature (read-heavy; writes still reviewed).
4. **Liquid debugging** — `liquid_exec` to check a filter/include against staging without manually bouncing through the GUI every time.
5. **Incident triage** — `logs_fetch` after a reported bug while the agent inspects related templates.
6. **Multi-env awareness without leaking secrets** — `envs_list` so the agent knows `staging` vs `production` names without pasting tokens into chat.
7. **Module / CMS convention compliance** — Prefer Siteglide skills + MCP rules when building webapps, forms, pages that don’t map 1:1 to stock platformOS tutorials.
8. **Agency standardisation** — Same MCP + pull registration across the team’s IDEs; less “works on my Cursor setup.”
9. **Future: client-facing assistant (roadmap)** — Same tool surface behind a hosted UI for constrained tasks (e.g. “explain this error,” “draft Liquid with validation”) without giving the browser site tokens.
10. **Reduced support noise** — Catch invalid Liquid/GraphQL earlier in the editor, fewer “deploy then discover” tickets.

---

## Practical footprint today

- Installed/registered via Siteglide CLI (`pull` wires IDE MCP config; `siteglide-cli mcp` launches the server).
- Experimental package; preview builds can be shared as `siteglide-cli-test` so they don’t replace production CLI.
- Keep the project's existing site root (`app/` or legacy `marketplace_builder/`). Pull does **not** rename between them. Agents treat `marketplace_builder/` as equivalent to `app/` when platformOS tools only name `app/`.

---

## Bottom line

For an AI-sceptical developer: this doesn’t ask anyone to “trust the model.” It **constrains** the model to Siteglide’s validator, Siteglide’s rules, and Siteglide’s existing API — the same stack you already operate — so AI-assisted edits are closer to how a careful human would use the CLI.
