# Third-Party Licenses

optiflow-mcp is an orchestration layer that wires together two independent
upstream projects via git submodule reference (provenance only, not built or
modified) and subprocess invocation at runtime (via pinned `npx` for
token-optimizer-mcp, and the `headroom` binary from PATH when present for
headroom). Neither upstream's source is copied into or derived from within
optiflow-mcp's own code.

## token-optimizer-mcp

- Repository: https://github.com/ooples/token-optimizer-mcp
- License: MIT
- License text: see `vendor/token-optimizer-mcp/LICENSE` after the submodule
  is initialized (`git submodule update --init`), or view upstream directly:
  https://github.com/ooples/token-optimizer-mcp/blob/master/LICENSE
- Runtime invocation: `npx -y @ooples/token-optimizer-mcp@<pinned-version>`
  (version-pinned, never `@latest` — see `docs/ADR/0001-provenance-only-submodules.md`)

## headroom

- Repository: https://github.com/headroomlabs-ai/headroom
- License: Apache License 2.0
- License text: see `vendor/headroom/LICENSE` after the submodule is
  initialized (`git submodule update --init`), or view upstream directly:
  https://github.com/headroomlabs-ai/headroom/blob/main/LICENSE
- NOTICE propagation: per Apache-2.0 §4(d), headroom's own `NOTICE` file (once
  read from the vendored submodule) must be reproduced in this repo's own
  `NOTICE` file. See `NOTICE` for the current (unpopulated) placeholder.
- Runtime invocation: the `headroom` binary from PATH, if installed
  (`headroom mcp serve`); optional per the plan — `optiflow doctor` warns but
  does not fail when it is absent.

## optiflow-mcp itself

- License: MIT — see `LICENSE` in this repository's root.
