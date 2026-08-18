// The wiki knowledge-graph store the enforcement hooks read from and write
// structural touches to.
//
// Faithfully ported from `vendor/token-optimizer-mcp/plugin/hooks/lib/wiki.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md). Append-only log, folded into
// a graph on read; see vendor's own module header (reproduced on `load`)
// for why.
//
// PATH-CONVENTION DECISION — read before changing any default below.
//
// Vendor's wiki.mjs resolves THREE different directories, and this port
// deliberately does NOT collapse them onto one convention:
//
//   `wikiDir(cwd)`     PROJECT-LOCAL: `<project>/.token-optimizer/wiki`
//                      (env override `TOKEN_OPTIMIZER_WIKI_DIR`). This is
//                      NOT a `~/...` home path, so the "no second
//                      `~/.token-optimizer/*` convention" instruction this
//                      phase was scoped under does not apply to it — and it
//                      MUST keep vendor's exact default. The already-merged
//                      `wiki_write`/`wiki_read` MCP tools
//                      (`src/optimizer/tools/intelligence/wiki-write.ts`,
//                      `wiki-read.ts`) call `wiki.projectRootFor`/
//                      `wiki.wikiDir` via a *dynamic* `import()` of vendor's
//                      own unmodified `hooks-core/wiki.mjs` at runtime (see
//                      `wiki-write.ts`'s `coreUrl` helper) — no env-var
//                      bridge sets `TOKEN_OPTIMIZER_WIKI_DIR` anywhere in
//                      this codebase today, so those tools resolve to
//                      vendor's literal default. If this hook used a
//                      different default, the enforcement hook and the
//                      already-shipped tools would read/write two
//                      disconnected graphs for the common case (every
//                      Read/Grep/Glob/Edit/Write/Bash call) — the single
//                      worst outcome available here. Matching what's
//                      actually shipped wins over matching the aspirational
//                      "one path convention" note for this one directory.
//
//   `sharedDir()`      HOME-BASED, cross-project lesson tier. Routed through
//                      `src/optimizer/paths.ts`'s `getOptimizerWikiDir()`
//                      (`~/.optiflow/optimizer/wiki`) per this phase's
//                      explicit instruction not to reintroduce
//                      `~/.token-optimizer/*`. NOTE: this does NOT match
//                      what `wiki-read.ts`'s own `wiki.sharedDir()` call
//                      resolves to today (it hits vendor's unreconciled
//                      `~/.token-optimizer/wiki` default, for the reason
//                      above) — this is a real, pre-existing interoperability
//                      gap in the already-merged tools (`src/optimizer/
//                      tools/**`, out of this phase's ownership), not
//                      something introduced here. See this phase's report
//                      for the follow-up options. `TOKEN_OPTIMIZER_SHARED_DIR`
//                      is still honored as an explicit override, matching
//                      vendor's own escape hatch.
//
//   `unrootedRoot()`   HOME-BASED, same reasoning as `sharedDir()`: routed
//                      through `getOptimizerUnrootedDir()`
//                      (`~/.optiflow/optimizer/unrooted`), with the same
//                      pre-existing gap against `wiki-read.ts`'s own call
//                      and the same `TOKEN_OPTIMIZER_UNROOTED_DIR` override.
//
// `isArchived` (ported in `transcript.ts`) matches the PROJECT-LOCAL
// `wikiDir` spelling above, unchanged from vendor — it must stay in lockstep
// with whatever `wikiDir`'s default is.

import {
  appendFileSync, readFileSync, existsSync, mkdirSync, chmodSync,
  openSync, closeSync, unlinkSync, statSync, writeFileSync, renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { canonicalPath, isFsSafePath } from "./paths.js";
import { getOptimizerWikiDir, getOptimizerUnrootedDir } from "../../paths.js";

/** Schema version stamped on every record. */
export const GRAPH_VERSION = 1;

/** Node kinds. `file` and `symbol` are first-class so staleness can propagate. */
export const NODE_KINDS = ["file", "symbol", "task", "finding"] as const;

export const EDGE_KINDS = [
  "derived_from", "contains", "imports", "calls",
  "supersedes", "contradicts", "answers",
  "related",
] as const;

export interface GraphNode {
  id: string;
  kind: string;
  key: string;
  at: number;
  [key: string]: unknown;
}

export interface GraphEdge {
  t: "e";
  v: number;
  from: string;
  edge: string;
  to: string;
  at: number;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/** Resolves the graph directory for a project. See path-convention note above: kept at vendor's own default. */
export function wikiDir(cwd?: string): string {
  return process.env.TOKEN_OPTIMIZER_WIKI_DIR || join(cwd || process.cwd(), ".token-optimizer", "wiki");
}

/** The one graph that is NOT per project — cross-project lesson tier. See path-convention note above. */
export function sharedDir(): string {
  return process.env.TOKEN_OPTIMIZER_SHARED_DIR || getOptimizerWikiDir();
}

/** Where a claim about a file that belongs to NO repository is kept. See path-convention note above. */
export function unrootedRoot(): string {
  return process.env.TOKEN_OPTIMIZER_UNROOTED_DIR || getOptimizerUnrootedDir();
}

/** Is this project's graph ALSO the shared one? */
export function isSharedDir(dir: string): boolean {
  try {
    return canonicalPath(dir) === canonicalPath(sharedDir());
  } catch {
    return false;
  }
}

/**
 * The project a FILE belongs to, which is not always the session's project.
 * Walks up for a VCS marker; with none, goes to one stable machine-level
 * graph (`unrootedRoot()`) rather than wherever the caller happened to be.
 */
export function projectRootFor(filePath: string, fallback?: string): string | null {
  if (!isFsSafePath(filePath)) return fallback ? canonicalPath(fallback) : null;
  const MARKERS = [".git", ".hg", ".svn"];

  let dir: string | null = dirname(canonicalPath(filePath));
  for (let depth = 0; depth < 40 && dir; depth += 1) {
    for (const marker of MARKERS) {
      if (existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return unrootedRoot();
}

const logPath = (dir: string) => join(dir, "graph.jsonl");
const snapshotsPath = (dir: string) => join(dir, "snapshots.jsonl");
const markerPath = (dir: string) => join(dir, "graph.compact.json");

/** Stable id for a node, so the same file seen twice is one node, not two. */
export function nodeId(kind: string, key: unknown): string {
  return `${kind}:${createHash("sha256").update(canonicalKey(kind, key)).digest("hex").slice(0, 16)}`;
}

/** The canonical form of a node key. */
export function canonicalKey(kind: string, key: unknown): string {
  const raw = String(key);
  if (kind === "file") return canonicalPath(raw);
  if (kind === "symbol") {
    const hash = raw.indexOf("#");
    return hash === -1 ? canonicalPath(raw) : `${canonicalPath(raw.slice(0, hash))}#${raw.slice(hash + 1)}`;
  }
  return raw;
}

/** Content hash of a file, or null when unreadable. `text` avoids a second disk read when already held. */
export function contentHash(path: string, text?: string | Buffer): string | null {
  if (text === undefined && !isFsSafePath(path)) return null;
  try {
    return createHash("sha256")
      .update(text === undefined ? readFileSync(path) : text)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return null;
  }
}

/** Appends one record under an exclusive lock (stale-tolerant, fail-open). */
function withLock(dir: string, write: () => void): void {
  const lockPath = join(dir, ".graph.lock");
  let held = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      closeSync(openSync(lockPath, "wx", 0o600));
      held = true;
      break;
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5000) unlinkSync(lockPath);
      } catch {
        // Raced with the holder releasing it; retry.
      }
    }
  }

  try {
    write();
  } finally {
    if (held) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Already released.
      }
    }
  }
}

/** Makes the store ignore itself in git, once. Strictly inside the store dir, never the parent. */
function ignoreSelf(dir: string): void {
  const marker = join(dir, ".gitignore");
  try {
    if (existsSync(marker)) return;
    appendFileSync(
      marker,
      "# Written by the optiflow optimizer. Findings are unreviewed agent output;\n" +
        "# keeping them out of git history is the default. Delete this file to\n" +
        "# opt in to committing them.\n*\n"
    );
  } catch {
    // Best effort.
  }
}

const compactFloorBytes = () => Number(process.env.TOKEN_OPTIMIZER_GRAPH_COMPACT_BYTES) || 8_000_000;
const SNAPSHOT_DEPENDENT = new Set(["finding", "map"]);
const snapshotBudgetBytes = () => Number(process.env.TOKEN_OPTIMIZER_GRAPH_SNAPSHOT_BYTES) || 8_000_000;

function compactionBaseline(dir: string): number {
  try {
    const raw = JSON.parse(readFileSync(markerPath(dir), "utf8"));
    const n = Number(raw.sizeAfter);
    return Number.isFinite(n) && n > 0 ? n : compactFloorBytes();
  } catch {
    return compactFloorBytes();
  }
}

/** Every snapshot record, latest wins. Read only when a caller asks. */
function readSnapshots(dir: string): Array<{ id: string; snapshot: string; at: number }> {
  const out: Array<{ id: string; snapshot: string; at: number }> = [];
  try {
    for (const line of readFileSync(snapshotsPath(dir), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if ((rec.v ?? 0) === GRAPH_VERSION && rec.id) out.push(rec);
      } catch {
        // A torn line costs one snapshot.
      }
    }
  } catch {
    // No sidecar yet.
  }
  return out;
}

/** Rewrites the log keeping only the surviving version of each record. Called inside the lock. */
function compactIfWasteful(dir: string): void {
  const path = logPath(dir);
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  try {
    size += statSync(snapshotsPath(dir)).size;
  } catch {
    // No sidecar yet.
  }
  if (size < compactFloorBytes() || size < compactionBaseline(dir) * 2) return;

  try {
    const nodes = new Map<string, string>();
    const edges = new Map<string, string>();
    const snaps = new Map<string, { at: number; snapshot: string }>();
    for (const rec of readSnapshots(dir)) {
      if (typeof rec.snapshot === "string" && rec.snapshot) {
        snaps.set(rec.id, { at: rec.at || 0, snapshot: rec.snapshot });
      }
    }
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if ((record.v as number ?? 0) !== GRAPH_VERSION) {
        edges.set("raw:" + edges.size, line);
        continue;
      }
      if (record.t === "n") {
        if (typeof record.snapshot === "string" && record.snapshot) {
          const { snapshot, ...rest } = record;
          nodes.set(record.id as string, JSON.stringify(rest));
          snaps.set(record.id as string, { at: (record.at as number) || 0, snapshot });
        } else {
          nodes.set(record.id as string, line);
        }
      } else if (record.t === "s") {
        if (typeof record.snapshot === "string" && record.snapshot) {
          snaps.set(record.id as string, { at: (record.at as number) || 0, snapshot: record.snapshot });
        }
      } else if (record.t === "e") {
        edges.set(`${record.from}|${record.edge}|${record.to}`, line);
      } else edges.set("raw:" + edges.size, line);
    }

    const needed = new Set<string>();
    for (const line of edges.values()) {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.t !== "e" || e.edge !== "derived_from") continue;
      const from = nodes.get(e.from as string);
      if (!from) continue;
      let f: Record<string, unknown>;
      try {
        f = JSON.parse(from);
      } catch {
        continue;
      }
      if (f.kind === "finding" && SNAPSHOT_DEPENDENT.has((f.type as string) || "finding")) {
        needed.add(e.to as string);
      }
    }

    const carriers = [...snaps.entries()]
      .map(([id, v]) => ({ id, at: v.at, size: v.snapshot.length }))
      .sort((a, b) => b.at - a.at);

    let spent = 0;
    const budget = snapshotBudgetBytes();
    const keep = new Map<string, { at: number; snapshot: string }>();
    for (const c of carriers) {
      if (!needed.has(c.id) && spent + c.size > budget) continue;
      spent += c.size;
      keep.set(c.id, snaps.get(c.id)!);
    }

    const out = [...edges.values(), ...nodes.values()].join("\n") + "\n";
    const tmp = path + ".compact";
    writeFileSync(tmp, out, { mode: 0o600 });
    renameSync(tmp, path);
    const snapOut =
      [...keep.entries()]
        .map(([id, v]) => JSON.stringify({ t: "s", v: GRAPH_VERSION, id, snapshot: v.snapshot, at: v.at }))
        .join("\n") + (keep.size ? "\n" : "");
    const snapTmp = snapshotsPath(dir) + ".compact";
    writeFileSync(snapTmp, snapOut, { mode: 0o600 });
    renameSync(snapTmp, snapshotsPath(dir));
    writeFileSync(
      markerPath(dir),
      JSON.stringify({ sizeAfter: out.length + snapOut.length, at: Date.now() }),
      { mode: 0o600 }
    );
  } catch {
    // Compaction is an optimization; a failure leaves the log as it was.
  }
}

function appendAll(dir: string, records: Array<Record<string, unknown>>): boolean {
  if (!records.length) return true;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Not POSIX, or not ours to chmod.
    }
    ignoreSelf(dir);
    const payload = records.map((record) => JSON.stringify(record) + "\n").join("");
    withLock(dir, () => {
      appendFileSync(logPath(dir), payload);
      compactIfWasteful(dir);
    });
    return true;
  } catch {
    return false;
  }
}

function append(dir: string, record: Record<string, unknown>): boolean {
  return appendAll(dir, [record]);
}

export interface PutNodeInput {
  kind: string;
  key: unknown;
  snapshot?: string;
  [key: string]: unknown;
}

/** Records a node. Repeat writes keep the LAST record for an id (an update, not a mutation). */
export function putNode(dir: string, { kind, key, ...rest }: PutNodeInput): string {
  if (!(NODE_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown node kind: ${kind}`);
  const id = nodeId(kind, key);
  const { snapshot, ...fields } = rest;
  const at = Date.now();
  const records = [{ ...fields, t: "n", v: GRAPH_VERSION, id, kind, key: canonicalKey(kind, key), at }];
  appendAll(dir, records);
  if (typeof snapshot === "string" && snapshot) {
    appendSnapshotRecord(dir, { t: "s", v: GRAPH_VERSION, id, snapshot, at });
  }
  return id;
}

/** Records an edge. */
export function putEdge(dir: string, from: string, edge: string, to: string): void {
  if (!(EDGE_KINDS as readonly string[]).includes(edge)) throw new Error(`unknown edge kind: ${edge}`);
  append(dir, { t: "e", v: GRAPH_VERSION, from, edge, to, at: Date.now() });
}

export interface PutEdgeSpec {
  edge: string;
  to: string;
}

/** Writes a node together with its outgoing edges as a SINGLE append (node written last — see vendor header). */
export function putNodeWithEdges(dir: string, { kind, key, ...rest }: PutNodeInput, edges: PutEdgeSpec[] = []): string | null {
  if (!(NODE_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown node kind: ${kind}`);

  const id = nodeId(kind, key);
  const at = Date.now();

  const records: Array<Record<string, unknown>> = [];
  for (const { edge, to } of edges) {
    if (!(EDGE_KINDS as readonly string[]).includes(edge)) throw new Error(`unknown edge kind: ${edge}`);
    records.push({ t: "e", v: GRAPH_VERSION, from: id, edge, to, at });
  }
  records.push({ ...rest, t: "n", v: GRAPH_VERSION, id, kind, key: canonicalKey(kind, key), at });

  return appendAll(dir, records) ? id : null;
}

function appendSnapshotRecord(dir: string, record: Record<string, unknown>): void {
  try {
    appendFileSync(snapshotsPath(dir), JSON.stringify(record) + "\n");
  } catch {
    // The node is already durable; the snapshot is an optimization.
  }
}

/**
 * Folds the log into a graph. Snapshots are SKIPPED BY DEFAULT (95% of the
 * bytes, only needed by the staleness diff and the zero-turn refusal — see
 * vendor's own module header measurement).
 */
export function load(dir: string, { snapshots = false }: { snapshots?: boolean } = {}): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const path = logPath(dir);
  if (!existsSync(path)) return { nodes, edges };

  const pending = snapshots ? new Map<string, string>() : null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    if (line.startsWith('{"t":"s"')) {
      if (!snapshots) continue;
      try {
        const rec = JSON.parse(line);
        if ((rec.v ?? 0) === GRAPH_VERSION) pending!.set(rec.id, rec.snapshot);
      } catch {
        // A torn line costs one snapshot, not the graph.
      }
      continue;
    }
    let record: GraphNode | GraphEdge;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (((record as { v?: number }).v ?? 0) !== GRAPH_VERSION) continue;
    if ((record as { t?: string }).t === "n") nodes.set((record as GraphNode).id, record as GraphNode);
    else if ((record as { t?: string }).t === "e") edges.push(record as GraphEdge);
  }

  if (pending) {
    for (const rec of readSnapshots(dir)) pending.set(rec.id, rec.snapshot);
    for (const [id, snapshot] of pending) {
      const node = nodes.get(id);
      if (node) nodes.set(id, { ...node, snapshot });
    }
  }

  return { nodes, edges };
}

/** Provenance multipliers for ranking findings. */
const ORIGIN_WEIGHT: Record<string, number> = { human: 1.5, agent: 1.2, harvested: 1 };

function score(node: GraphNode, now: number, DAY: number): number {
  const confidence = typeof node.confidence === "number" ? node.confidence : 0.5;
  const ageDays = (now - ((node.at as number) || now)) / DAY;
  const weight = ORIGIN_WEIGHT[node.origin as string] ?? 1;
  return confidence * weight * Math.pow(0.5, ageDays / 30);
}

/** Findings reachable from a file or symbol, by `derived_from`/`contains` traversal. */
export function findingsFor(graph: Graph, anchorId: string, { limit = 20 }: { limit?: number } = {}): GraphNode[] {
  const anchors = new Set([anchorId]);
  for (const edge of graph.edges) {
    if (edge.edge === "contains" && edge.from === anchorId) anchors.add(edge.to);
  }

  const found: GraphNode[] = [];
  for (const edge of graph.edges) {
    if (edge.edge !== "derived_from" || !anchors.has(edge.to)) continue;
    const node = graph.nodes.get(edge.from);
    if (node && node.kind === "finding" && !node.retired) found.push(node);
  }

  const now = Date.now();
  const DAY = 86_400_000;
  return found.sort((a, b) => score(b, now, DAY) - score(a, now, DAY)).slice(0, limit);
}

export interface HarvestInput {
  filePath: string;
  sessionId?: string | null;
  action?: string;
  hash?: string | null;
}

/** Structural harvest from one observed tool call: records that a file was touched, at this content hash. */
export function harvest(dir: string, { filePath, sessionId, action, hash: precomputed }: HarvestInput): string | null {
  if (!filePath) return null;

  const hash = precomputed ?? contentHash(filePath);
  if (hash === null) return null;

  const fileNode = putNode(dir, { kind: "file", key: filePath, hash, lastAction: action });

  if (sessionId) {
    const taskNode = putNode(dir, { kind: "task", key: sessionId });
    putEdge(dir, taskNode, "derived_from", fileNode);
  }
  return fileNode;
}
