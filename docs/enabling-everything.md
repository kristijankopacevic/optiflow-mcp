# Turning everything on

What a fresh install actually runs, what it doesn't, and what each thing
costs you if you switch it on. Every default below is read from
`src/config/defaults.ts`; run `optiflow doctor` to see what your machine
actually resolved.

## What already runs after a plain install

No configuration needed. These are on by default:

| Feature | Default | What it does |
|---|---|---|
| `mcpCompression` | `enabled: true`, `minOutputBytes: 400` | Compresses MCP tool **results** before they enter context |
| `toon` | `enabled: true`, `minSavingsPercent: 30`, `minRows: 5` | Tabular re-encoding of uniform JSON arrays |
| `smartCrusher` | `enabled: true`, `minSavingsPercent: 20` | Rust→WASM lossy compression, with `ccr_retrieve` to recover what it drops |
| `handoff` | `enabled: true`, `keep: 20` | Checkpoints on PreCompact/SessionEnd, auto-restored on `SessionStart[compact]` |
| Enforcement hooks | mode `enforce` | Routes large/repeat reads; substitutes compressed code inline |
| MCP server | 77 tools | `smart_*`, analytics, dashboards, `ccr_retrieve` |

The enforcement layer is the part that saves the most, and it needs nothing
from you.

## Things that are off, and why

### `chop.enabled` — off, and deliberately kept off

```jsonc
{ "chop": { "enabled": true } }   // opt in per project
```

Chop intercepts **Bash commands** and rewrites them via `updatedInput`. That
changes what Claude Code's permission system matches against: a command you
allowlisted is not necessarily the command that ends up running. This is a
locked decision (ADR / plan risk R4), and it was independently validated by
a competing plugin's issue #141, where exactly this rewriting broke
whitelisted commands.

Turn it on if you run a lot of noisy tooling (`git`, `docker`, `kubectl`,
`npm`, `terraform` are the default allowlist) **and** you are comfortable
with that trade. Note that compressing MCP *results* is a different thing
entirely and is already on — those two were split apart precisely because
they carry different risks.

### `kompress` — off, downloads a ~274 MB model

```jsonc
{ "kompress": { "enabled": true, "allowDownload": true } }
```

Both flags are required; `enabled` alone degrades gracefully on a cache miss
rather than silently pulling 274 MB. `variant` is `"int8"` (default) or
`"fp32"` (~601 MB). This is the only feature that touches the network.

### `telemetry.enabled` — off

Local ledger only; nothing is transmitted. On means richer `optiflow report`
output.

### `report.includeOptimizer` — off

Folds the MCP server's own analytics into `optiflow report`.

## Things that need a command, not a config key

### Statusline

Installing the plugin does **not** activate it. Claude Code's `statusLine`
setting is single-valued and global — it lives in your own settings, never
in a plugin manifest.

```bash
optiflow install --statusline
```

Backs up your `~/.claude/settings.json` first, writes atomically, and
refuses rather than clobbering a statusline you already have (`--force` to
override). See `docs/statusline-manual-setup.md`.

### Optional accelerators

```bash
npm install better-sqlite3 tiktoken
```

Neither is required and neither is bundled — a marketplace install ships no
`node_modules`, so the plugin is built to run without them.

- **`better-sqlite3`** — persistent cache across sessions. Without it the
  cache is in-memory and dies with the session, so cross-session diffing in
  `smart_read` degrades to full reads.
- **`tiktoken`** — exact token counts. Without it, counts are estimated, so
  the savings guards (`minSavingsPercent`) and the statusline meter work off
  an approximation.

`optiflow doctor` reports which of these it found. It reports honestly —
"available" means it actually loaded, not that it appears in a manifest.

## Environment knobs (enforcement layer)

These are env vars rather than config keys, matching the rest of the
vendored enforcement layer.

| Variable | Default | Effect |
|---|---|---|
| `TOKEN_OPTIMIZER_MODE` | `enforce` | `advise` downgrades every denial to a note; `off` disables routing |
| `TOKEN_OPTIMIZER_LARGE_READ_BYTES` | `25600` | Size at which a `Read` is challenged |
| `TOKEN_OPTIMIZER_REFUSAL_FLOOR_BYTES` | `1024` | Below this, a refusal costs more than it saves, so none is made |
| `TOKEN_OPTIMIZER_SUPPRESS_REPEAT_READS` | on (`0` disables) | Refuse an unchanged unranged re-read outright |
| `TOKEN_OPTIMIZER_REPEAT_READ_WINDOW_MINUTES` | `30` | How long a recorded read keeps licensing that |
| `OPTIFLOW_DEBUG_SUBSTITUTE` | unset | Log why inline code compression declined — see below |

## If something seems not to be working

Nearly every path here is **fail-open by design**: a broken dependency
degrades to "no compression" rather than crashing your session. That is the
right default and it is also why three separate bugs once shipped without
anyone noticing.

So when compression appears to do nothing, silence is the expected symptom,
not an error. Start here:

```bash
OPTIFLOW_DEBUG_SUBSTITUTE=1 claude
```

That surfaces the exception the code-compression path would otherwise
swallow.

## The maximal configuration

Everything on, for a project where you accept the Bash-rewrite trade and
want the ONNX model:

```jsonc
// optiflow.config.json
{
  "chop": { "enabled": true },
  "kompress": { "enabled": true, "allowDownload": true },
  "telemetry": { "enabled": true },
  "report": { "includeOptimizer": true }
}
```

```bash
optiflow install --statusline
npm install better-sqlite3 tiktoken
```

Everything else is already on.

## What this does not claim

Savings depend entirely on what your session does. A session dominated by
large file reads benefits a lot; one dominated by conversation benefits
close to nothing. The percentage figures that appear elsewhere in this
repo's docs were measured on **fixtures chosen to compress well** and should
not be read as expected real-world savings — correcting that is tracked
work, not a settled number.
