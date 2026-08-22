// Probes which OPTIONAL runtime accelerators are actually loadable here.
//
// Every one of these is a lazy, optional accelerator with a working pure-JS
// or in-memory fallback (see `src/optimizer/core/cache-engine.ts` and
// `src/native/kompress.ts` for the pattern) — the plugin is fully functional
// without any of them. They are probed rather than required because a
// marketplace install ships no `node_modules`, and Claude Code's automatic
// dependency install runs with `--ignore-scripts`, which cannot build a
// native addon.
//
// This exists because `optiflow doctor` previously reported a clean bill of
// health on a host where the persistent cache and the real tokenizer were
// both silently unavailable — accurate per-check, misleading overall.

import { createRequire } from "node:module";

export interface AcceleratorStatus {
  name: string;
  available: boolean;
  /** What is lost when this is unavailable. Never phrased as an error. */
  degradedTo: string;
  detail?: string;
}

export interface RuntimeProbe {
  /** Node major version this process is running on. */
  nodeMajor: number;
  /** True when every accelerator loaded. */
  allAvailable: boolean;
  accelerators: AcceleratorStatus[];
}

function tryRequire(id: string): { ok: boolean; detail?: string } {
  try {
    createRequire(import.meta.url)(id);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: message.split("\n")[0]?.slice(0, 120) };
  }
}

export function probeRuntime(): RuntimeProbe {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  const sqlite = tryRequire("better-sqlite3");
  const tiktoken = tryRequire("tiktoken");

  const accelerators: AcceleratorStatus[] = [
    {
      name: "better-sqlite3 (persistent cache)",
      available: sqlite.ok,
      degradedTo: "in-memory cache — entries do not survive a restart",
      detail: sqlite.ok
        ? undefined
        : nodeMajor < 22
          ? `not loadable (better-sqlite3 requires Node >=22; this is Node ${nodeMajor})`
          : sqlite.detail,
    },
    {
      name: "tiktoken (exact token counts)",
      available: tiktoken.ok,
      degradedTo: "heuristic estimate (chars/4) — savings figures become estimates",
      detail: tiktoken.ok ? undefined : tiktoken.detail,
    },
  ];

  return {
    nodeMajor,
    allAvailable: accelerators.every((a) => a.available),
    accelerators,
  };
}
