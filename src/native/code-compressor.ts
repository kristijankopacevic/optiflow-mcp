// CodeCompressor — TypeScript port of headroom's AST-preserving code
// compressor, using `web-tree-sitter` (the tree-sitter project's own
// actively-maintained WASM/JS binding) instead of headroom's Rust
// `tree-sitter` crate integration.
//
// Primary reference: `native/headroom-core/src/transforms/code_compressor.rs`
// (2027 lines — headroom's own byte-parity Rust port of the Python
// original at `vendor/headroom/headroom/transforms/code_compressor.py`).
// This module follows that Rust file's structure closely (same helper
// names in camelCase, same section ordering) so a reviewer can diff
// behavior function-for-function against the primary reference.
//
// ── Why a different implementation path, not a literal translation ──────
//
// headroom's own Rust port slices source by *UTF-8 byte offset*
// (`&code[start_byte..end_byte]`), which is only correct for ASCII input —
// its own doc comment (lines 22-31) declares non-ASCII slicing out of
// parity scope for exactly this reason. `web-tree-sitter`'s Node API
// reports `startIndex`/`endIndex` (and `.text`) in *UTF-16 code-unit*
// offsets, i.e. the same indexing scheme JS strings natively use — so
// `code.slice(node.startIndex, node.endIndex)` (or just `node.text`) is
// always correct here, including for non-ASCII input. This is a strict
// improvement over both the Python and Rust references, not a parity gap;
// verified empirically (see this module's test file) with a Python
// docstring containing CJK characters.
//
// ── Deliberate scoping simplifications vs. the Rust reference ────────────
//
// - `pyRound3` (CPython `round(x, 3)`, ties-to-even) is approximated with
//   `Number(x.toFixed(3))`. This matches CPython for the overwhelming
//   majority of inputs (verified against the Rust file's own test vectors)
//   but diverges at exact binary-representable half-way ties (e.g. exactly
//   0.0625 rounds to 0.063 here vs Python/Rust's 0.062). This only affects
//   the cosmetic `symbolScores` debug numbers exposed on the result, never
//   the compressed *text* output — `pyRoundInt` (below), which *does*
//   affect real body-line budgets, is implemented exactly (half-to-even,
//   verified against all 9 of the Rust file's test vectors) because it
//   changes actual compression behavior, not just a displayed number.
// - `estimateTokens` counts Unicode code points (`[...text].length`, via
//   the iterator protocol) rather than approximating with `.length`
//   (UTF-16 code units) — done properly since it's cheap, matching the
//   Rust file's `.chars().count()` exactly rather than approximating.
// - The Rust file's `enable_ccr`/`fallback_to_kompress` config fields are
//   accepted (for config-object fidelity with the Python/Rust dataclass
//   surface, and so recorded fixtures round-trip without extra parsing
//   logic) but are inert no-ops here: CCR offload and Kompress fallback
//   are dispatcher-level concerns owned elsewhere in both upstream
//   references too (see the Rust file's own comments at lines 33-39 and
//   866-877) — this port never owned them either.
//
// ── Loading mechanism (verified empirically against the installed
//    packages, not assumed from memory — package APIs here are known to
//    have changed non-trivially across versions) ─────────────────────────
//
// `web-tree-sitter@0.26.x` rewrote per-language grammar loading to require
// an Emscripten "dylink" side-module ABI (`Language.load` calls
// `loadWebAssemblyModule` which hard-requires a `dylink.0` custom section).
// The prebuilt grammars in `tree-sitter-wasms@0.1.13` predate that rewrite
// (standalone/reactor-style WASM, no dylink section) and fail to load under
// `web-tree-sitter@0.26.x` with an opaque `Error` (empty message) from deep
// inside `getDylinkMetadata`. This was confirmed empirically with a
// throwaway script before writing any of this module (loading each of the
// 8 language grammars and failing identically on all of them under 0.26.x).
//
// `web-tree-sitter@0.24.7` (the last release before that rewrite) loads
// every one of the 8 language grammars in `tree-sitter-wasms@0.1.13`
// successfully — confirmed the same way. `package.json` in this repo pins
// `web-tree-sitter@^0.24.7`, not the `0.26.12` originally suggested, for
// this reason (a version-pairing correction, not a scope change — still
// the same two packages, same loading API shape: `Parser.init()` then
// `Parser.Language.load(path)`, just the actually-compatible pairing).
// The 0.24.x API is the pre-namespace-split shape: `import Parser from
// "web-tree-sitter"` (CJS-interop default export), `Parser.Language.load`,
// `Parser.SyntaxNode`/`Parser.Tree`/`Parser.Language` as namespace types.

import { createRequire } from "node:module";
import Parser from "web-tree-sitter";

type TSLanguage = Parser.Language;
type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

const nodeRequire = createRequire(import.meta.url);

// ─── Public types ─────────────────────────────────────────────────────────

/** Supported programming languages, plus `"unknown"` for undetected/unsupported input. */
export type CodeLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "unknown";

/** How to handle Python docstrings. Mirrors the Rust `DocstringMode` enum. */
export type DocstringMode = "full" | "first_line" | "remove" | "none";

/** Configuration for code-aware compression. Field defaults match the Python/Rust references. */
export interface CodeCompressorConfig {
  preserveImports: boolean;
  preserveSignatures: boolean;
  preserveTypeAnnotations: boolean;
  preserveDecorators: boolean;
  docstringMode: DocstringMode;
  targetCompressionRate: number;
  maxBodyLines: number;
  compressComments: boolean;
  minTokensForCompression: number;
  languageHint: string | null;
  /** Inert here — Kompress fallback is a dispatcher-level concern in both upstream references too. */
  fallbackToKompress: boolean;
  semanticAnalysis: boolean;
  /** Inert here — CCR offload is a dispatcher-level concern in both upstream references too. */
  enableCcr: boolean;
  ccrTtl: number;
}

export const DEFAULT_CODE_COMPRESSOR_CONFIG: CodeCompressorConfig = {
  preserveImports: true,
  preserveSignatures: true,
  preserveTypeAnnotations: true,
  preserveDecorators: true,
  docstringMode: "first_line",
  targetCompressionRate: 0.2,
  maxBodyLines: 5,
  compressComments: true,
  minTokensForCompression: 100,
  languageHint: null,
  fallbackToKompress: true,
  semanticAnalysis: true,
  enableCcr: true,
  ccrTtl: 300,
};

/** Result of code-aware compression. Field set mirrors the Python/Rust `CodeCompressionResult`. */
export interface CodeCompressionResult {
  compressed: string;
  original: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  language: CodeLanguage;
  languageConfidence: number;
  preservedImports: number;
  preservedSignatures: number;
  /**
   * Always 0 — mirrors the Python/Rust references exactly: `function_bodies`
   * is a real field on their `CodeStructure` type but is never populated by
   * any current code path in either upstream reference (only ever
   * `function_signatures`, which holds the already-compressed text). If you
   * need a count of elided bodies, count `[N lines omitted...]` occurrences
   * in `compressed` instead.
   */
  compressedBodies: number;
  syntaxValid: boolean;
  cacheKey: string | null;
  /** Short-name -> importance score (0..1, round-3). */
  symbolScores: Record<string, number>;
  /** Convenience flag: `compressed !== original`. */
  wasModified: boolean;
}

export interface CompressCodeOptions {
  /** Overrides language auto-detection. Case-insensitive. */
  language?: string;
  /** Relevance query used to boost matching symbols' importance scores. */
  queryContext?: string;
  /** Partial config overriding `DEFAULT_CODE_COMPRESSOR_CONFIG`. */
  config?: Partial<CodeCompressorConfig>;
}

// ─── WASM loading (module init side-effects live only here) ──────────────

const ALL_LANGUAGES: readonly CodeLanguage[] = [
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
];

function grammarWasmDir(): string {
  // `tree-sitter-wasms` ships no `exports` map, so any subpath under the
  // installed package resolves normally; resolving `package.json` first
  // (rather than guessing a `node_modules` layout) is robust to hoisting,
  // workspaces, and bundling.
  const pkgJsonPath = nodeRequire.resolve("tree-sitter-wasms/package.json");
  return pkgJsonPath.slice(0, -"package.json".length) + "out";
}

let initPromise: Promise<void> | null = null;
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

const languageCache = new Map<CodeLanguage, TSLanguage>();
const parserCache = new Map<CodeLanguage, Parser>();

async function getLanguage(lang: CodeLanguage): Promise<TSLanguage | null> {
  if (lang === "unknown") return null;
  await ensureInit();
  let language = languageCache.get(lang);
  if (!language) {
    const wasmPath = `${grammarWasmDir()}/tree-sitter-${lang}.wasm`;
    language = await Parser.Language.load(wasmPath);
    languageCache.set(lang, language);
  }
  return language;
}

// One dedicated `Parser` instance per language (never shared across
// languages), so concurrent `compressCode` calls for different languages
// never race on `setLanguage`. Concurrent calls for the *same* language
// redundantly (but harmlessly) re-`setLanguage` to the one grammar that
// instance ever holds; `parser.parse()` itself has no internal await, so
// there's no window where a parse can observe the wrong grammar.
async function getParser(lang: CodeLanguage): Promise<Parser | null> {
  const language = await getLanguage(lang);
  if (!language) return null;
  let parser = parserCache.get(lang);
  if (!parser) {
    parser = new Parser();
    parserCache.set(lang, parser);
  }
  parser.setLanguage(language);
  return parser;
}

async function parseCode(code: string, language: CodeLanguage): Promise<Tree | null> {
  const parser = await getParser(language);
  if (!parser) return null;
  return parser.parse(code) ?? null;
}

/**
 * Pre-warms the WASM runtime and (by default) all 8 supported language
 * grammars. Optional — `compressCode`/`detectLanguage` lazily load
 * whatever they need on first use — but useful to call once at process
 * startup to avoid paying the load latency on the first real request.
 */
export async function initCodeCompressor(
  languages: readonly CodeLanguage[] = ALL_LANGUAGES
): Promise<void> {
  await ensureInit();
  await Promise.all(languages.map((l) => getLanguage(l)));
}

// ─── Language config (data-driven per-language node-type tables) ─────────

interface LangConfig {
  importNodes: readonly string[];
  functionNodes: readonly string[];
  classNodes: readonly string[];
  typeNodes: readonly string[];
  bodyNodeTypes: readonly string[];
  decoratorNode: string | null;
  commentPrefix: string;
  usesColonAfterSignature: boolean;
  packageNode: string | null;
}

const LANG_CONFIGS: Record<Exclude<CodeLanguage, "unknown">, LangConfig> = {
  python: {
    importNodes: ["import_statement", "import_from_statement"],
    functionNodes: ["function_definition"],
    classNodes: ["class_definition"],
    typeNodes: ["type_alias_statement"],
    bodyNodeTypes: ["block"],
    decoratorNode: "decorated_definition",
    commentPrefix: "#",
    usesColonAfterSignature: true,
    packageNode: null,
  },
  javascript: {
    importNodes: ["import_statement", "import_declaration"],
    functionNodes: ["function_declaration", "method_definition"],
    classNodes: ["class_declaration"],
    typeNodes: [],
    // `class_body` (a class's own body container) is a distinct node type
    // from `statement_block` (a function/method's) in this grammar, unlike
    // Python/Go/Rust/Java/C/C++ where the Rust reference's shared
    // `body_node_types` config already covers both shapes with one node
    // type. Without it, `compressClassAst`'s body-node lookup never
    // matches for JS/TS, so no class (bare or exported) ever gets its
    // methods truncated -- listed here (not as a separate "classBodyNode"
    // field) because `compressFunctionAst`'s own body lookup only ever
    // walks a function/method node's direct children, which never include
    // a `class_body`, so sharing the list is safe.
    bodyNodeTypes: ["statement_block", "class_body"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: null,
  },
  typescript: {
    importNodes: ["import_statement", "import_declaration"],
    functionNodes: ["function_declaration", "method_definition"],
    classNodes: ["class_declaration"],
    typeNodes: ["interface_declaration", "type_alias_declaration"],
    bodyNodeTypes: ["statement_block", "class_body"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: null,
  },
  go: {
    importNodes: ["import_declaration"],
    functionNodes: ["function_declaration", "method_declaration"],
    classNodes: [],
    typeNodes: ["type_declaration"],
    bodyNodeTypes: ["block"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: "package_clause",
  },
  rust: {
    importNodes: ["use_declaration"],
    functionNodes: ["function_item"],
    classNodes: ["impl_item"],
    typeNodes: ["struct_item", "enum_item", "type_item", "trait_item"],
    bodyNodeTypes: ["block"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: null,
  },
  java: {
    importNodes: ["import_declaration"],
    functionNodes: ["method_declaration", "constructor_declaration"],
    classNodes: ["class_declaration", "interface_declaration"],
    typeNodes: ["enum_declaration"],
    bodyNodeTypes: ["block"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: "package_declaration",
  },
  c: {
    importNodes: ["preproc_include"],
    functionNodes: ["function_definition"],
    classNodes: [],
    typeNodes: ["struct_specifier", "enum_specifier", "type_definition"],
    bodyNodeTypes: ["compound_statement"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: null,
  },
  cpp: {
    importNodes: ["preproc_include"],
    functionNodes: ["function_definition"],
    classNodes: ["class_specifier"],
    typeNodes: ["struct_specifier", "enum_specifier", "type_definition"],
    bodyNodeTypes: ["compound_statement"],
    decoratorNode: null,
    commentPrefix: "//",
    usesColonAfterSignature: false,
    packageNode: null,
  },
};

function getLangConfig(language: CodeLanguage): LangConfig | null {
  return language === "unknown" ? null : LANG_CONFIGS[language];
}

// ─── Structure + analysis types ───────────────────────────────────────────

interface CodeStructure {
  imports: string[];
  typeDefinitions: string[];
  classDefinitions: string[];
  functionSignatures: string[];
  /** Never populated by the current paths — mirrors the Rust reference exactly. */
  functionBodies: Array<[string, string, number]>;
  topLevelCode: string[];
  other: string[];
}

function emptyStructure(): CodeStructure {
  return {
    imports: [],
    typeDefinitions: [],
    classDefinitions: [],
    functionSignatures: [],
    functionBodies: [],
    topLevelCode: [],
    other: [],
  };
}

interface SymbolAnalysis {
  /** qname -> normalized score (round-3), insertion order preserved. */
  scores: Array<[string, number]>;
  /** qname -> set of short names it calls, insertion order preserved (matters for `makeOmittedComment`). */
  calls: Array<[string, Set<string>]>;
  /** qname -> short name. */
  bareNames: Map<string, string>;
  /** qname -> body line count. */
  bodyLineCounts: Map<string, number>;
}

function emptyAnalysis(): SymbolAnalysis {
  return { scores: [], calls: [], bareNames: new Map(), bodyLineCounts: new Map() };
}

/** Shared per-compression context, mirrors the Rust file's `Ctx<'a>`. */
interface Ctx {
  code: string;
  codeLines: string[];
  language: CodeLanguage;
  lang: LangConfig;
  bodyLimits: Map<string, number>;
  analysis: SymbolAnalysis;
  config: CodeCompressorConfig;
}

// ─── Module helpers (stateless) ───────────────────────────────────────────

/** First child whose kind is a name token; returns its text. Mirrors `_get_definition_name`. */
function getDefinitionName(node: SyntaxNode): string | undefined {
  for (const child of node.children) {
    if (!child) continue;
    const k = child.type;
    if (k === "identifier" || k === "name" || k === "type_identifier" || k === "property_identifier") {
      return child.text;
    }
  }
  return undefined;
}

/**
 * `export const NAME = (...) => {...}` / `export const NAME = function
 * (...) {...}`: the arrow/function value isn't itself a `functionNodes`
 * entry -- the `lexical_declaration`/`variable_declaration` wrapping it is
 * neither a function nor a class node -- but it's extremely common in real
 * ESM code, so it's special-cased here. Deliberate divergence from the
 * Rust/Python references, which don't handle this shape either (see the
 * module's own doc comment on divergences). Only a single, non-destructured
 * declarator is matched: `export const a = 1, b = () => {}` (multiple
 * declarators) falls through untouched, same as any other pattern this
 * port doesn't special-case.
 */
function findExportedFunctionValue(
  declNode: SyntaxNode
): { name: string | undefined; valueNode: SyntaxNode } | undefined {
  const declarators = declNode.children.filter(
    (c): c is SyntaxNode => c !== null && c.type === "variable_declarator"
  );
  if (declarators.length !== 1) return undefined;
  const declarator = declarators[0];
  let name: string | undefined;
  let valueNode: SyntaxNode | undefined;
  for (const child of declarator.children) {
    if (!child) continue;
    if (child.type === "identifier" && name === undefined) name = child.text;
    if (child.type === "arrow_function" || child.type === "function_expression") valueNode = child;
  }
  return valueNode ? { name, valueNode } : undefined;
}

// Same delimiter/CJK character classes as the Rust `_CONTEXT_DELIMS`/`_CJK_CHARS`.
const CONTEXT_DELIMS =
  /[\s,;:.()[\]{}"'，、；：。．！？（）【】「」『』《》〈〉·…—　]+/gm;
const CJK_CHARS = /[　-鿿가-힯＀-￯]/;

/** Tokenize a relevance query for symbol-name matching (CJK-aware). Mirrors `_query_context_tokens`. */
function queryContextTokens(context: string): [Set<string>, string, boolean] {
  if (context === "") return [new Set(), "", false];
  const lowered = context.toLowerCase();
  const words = new Set(lowered.split(CONTEXT_DELIMS).filter((s) => s.length > 0));
  const hasCjk = CJK_CHARS.test(lowered);
  return [words, lowered, hasCjk];
}

/** Whether the relevance query names this symbol. Mirrors `_symbol_in_context`. */
function symbolInContext(
  nameLower: string,
  words: Set<string>,
  contextLower: string,
  hasCjk: boolean
): boolean {
  if (words.size === 0 || nameLower === "") return false;
  if (words.has(nameLower)) return true;
  return contextLower.includes(nameLower) && ([...nameLower].length > 3 || hasCjk);
}

function isUppercaseChar(ch: string): boolean {
  return ch !== "" && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function isPublicSymbol(name: string, language: CodeLanguage): boolean {
  if (name === "") return false;
  if (language === "go") return isUppercaseChar(name.charAt(0));
  return !name.startsWith("_");
}

/** Look up the allocated body-line limit for a function. `maxBodyLines` always acts as a hard cap. */
function getBodyLimit(
  funcName: string | undefined,
  bodyLimits: Map<string, number>,
  maxBodyLines: number
): number {
  if (funcName !== undefined && bodyLimits.size > 0) {
    const v = bodyLimits.get(funcName);
    if (v !== undefined) return Math.min(v, maxBodyLines);
  }
  return maxBodyLines;
}

/** Leading-whitespace prefix of a line. */
function leadingWs(line: string): string {
  const m = line.match(/^\s*/);
  return m ? m[0] : "";
}

/** Detect the indentation used in a list of code lines. Mirrors `_detect_indent`. */
function detectIndent(lines: readonly string[]): string {
  for (const line of lines) {
    if (line.trim() !== "") return leadingWs(line);
  }
  return "    ";
}

/** Build the omitted-body comment with call info. Mirrors `_make_omitted_comment`. */
function makeOmittedComment(
  funcName: string | undefined,
  omittedCount: number,
  indent: string,
  commentPrefix: string,
  analysis: SymbolAnalysis
): string {
  let callsInfo = "";
  if (funcName !== undefined) {
    const suffix = `.${funcName}`;
    const candidates: string[] = [funcName];
    for (const [k] of analysis.calls) {
      if (k.endsWith(suffix)) candidates.push(k);
    }
    for (const key of candidates) {
      const entry = analysis.calls.find(([k]) => k === key);
      if (entry) {
        const called = entry[1];
        if (called.size > 0) {
          const sorted = [...called].sort();
          const shown = sorted.slice(0, 5);
          callsInfo = `; calls: ${shown.join(", ")}`;
          if (called.size > 5) callsInfo += ` +${called.size - 5} more`;
        }
        break;
      }
    }
  }
  return `${indent}${commentPrefix} [${omittedCount} lines omitted${callsInfo}]`;
}

/** Count ERROR + MISSING nodes (recursive, over all children). Mirrors `_count_error_nodes`. */
function countErrorNodes(node: SyntaxNode): number {
  let count = node.type === "ERROR" || node.isMissing ? 1 : 0;
  for (const child of node.children) {
    if (child) count += countErrorNodes(child);
  }
  return count;
}

/** True if the tree contains an ERROR or MISSING node. Mirrors `_has_syntax_issues`. */
function hasSyntaxIssues(node: SyntaxNode): boolean {
  if (node.type === "ERROR" || node.isMissing) return true;
  for (const child of node.children) {
    if (child && hasSyntaxIssues(child)) return true;
  }
  return false;
}

/**
 * CPython `round(x)` (ndigits=None): nearest int, ties to even. Exact
 * (verified against all 9 of the Rust file's test vectors) — this affects
 * real body-line budgets, not just a displayed number, so it is not
 * approximated the way `pyRound3` below is.
 */
function pyRoundInt(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Approximates CPython `round(x, 3)`. See the module-level doc comment for
 * the documented divergence at exact binary half-way ties (cosmetic-only,
 * affects `symbolScores` debug numbers, never compressed text output).
 */
function pyRound3(x: number): number {
  return Number(x.toFixed(3));
}

/** Unicode-code-point count / 4, min 1. Mirrors `_estimate_tokens` with `tokenizer=None`. */
function estimateTokens(text: string): number {
  const count = [...text].length;
  return Math.max(1, Math.floor(count / 4));
}

/** First `n` Unicode code points of `s` (Python `s[:n]` semantics, not UTF-16 `.slice`). */
function charPrefix(s: string, n: number): string {
  if (s.length <= n) return s; // UTF-16 length >= code-point count, always safe here.
  let out = "";
  let count = 0;
  for (const ch of s) {
    if (count >= n) break;
    out += ch;
    count++;
  }
  return out;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const VALID_LANGUAGES = new Set<string>([
  "python",
  "javascript",
  "typescript",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "unknown",
]);

function normalizeLanguage(input: string): CodeLanguage | undefined {
  const lower = input.toLowerCase();
  return VALID_LANGUAGES.has(lower) ? (lower as CodeLanguage) : undefined;
}

// ─── Language detection ────────────────────────────────────────────────────

interface PrefilterEntry {
  lang: CodeLanguage;
  patterns: RegExp[];
}

// (language, patterns) in the Python/Rust `_LANGUAGE_PREFILTER` insertion
// order — that order is the stable tie-break for detection.
const PREFILTER: PrefilterEntry[] = [
  {
    lang: "python",
    patterns: [
      /^\s*(def|class|import|from|async def)\s+\w+/gm,
      /^\s*@\w+/gm,
      /^\s*"""/gm,
      /^\s*if __name__\s*==/gm,
    ],
  },
  {
    lang: "javascript",
    patterns: [
      /^\s*(function|const|let|var|class|export)\s+\w+/gm,
      /^\s*async\s+(function|=>)/gm,
      /^\s*module\.exports/gm,
      /^\s*(import|export)\s+.*\s+from\s+['"]/gm,
    ],
  },
  {
    lang: "typescript",
    patterns: [/^\s*(interface|type|enum|namespace)\s+\w+/gm, /:\s*(string|number|boolean|any|void|Promise)\b/gm],
  },
  {
    lang: "go",
    patterns: [/^\s*(func|type|package|import)\s+/gm, /^\s*func\s+\([^)]+\)\s+\w+/gm, /\bstruct\s*\{/gm],
  },
  {
    lang: "rust",
    patterns: [/^\s*(fn|struct|enum|impl|mod|use|pub)\s+/gm, /^\s*#\[/gm],
  },
  {
    lang: "java",
    patterns: [/^\s*(public|private|protected)\s+(class|interface|enum)/gm, /^\s*package\s+[\w.]+;/gm],
  },
  {
    lang: "c",
    patterns: [
      /^\s*#include\s*[<"]/gm,
      /^\s*(int|void|char|float|double)\s+\w+\s*\(/gm,
      /^\s*typedef\s+/gm,
    ],
  },
  {
    lang: "cpp",
    patterns: [/^\s*#include\s*[<"]/gm, /\bnamespace\s+\w+/gm, /::\w+/gm],
  },
];

function countMatches(re: RegExp, sample: string): number {
  const matches = sample.match(re);
  return matches ? matches.length : 0;
}

/**
 * Detect the language of `code`. Mirrors `detect_language`: regex prefilter
 * -> tree-sitter fewest-errors -> regex-only fallback. Needs grammar
 * loading for phase 2, hence async (unlike the Rust reference, where
 * tree-sitter is always synchronously available).
 */
export async function detectLanguage(code: string): Promise<[CodeLanguage, number]> {
  if (code.trim() === "") return ["unknown", 0];

  const sample = charPrefix(code, 5000);

  // Phase 1: prefilter scores, in fixed order.
  const candidates: Array<[CodeLanguage, number]> = [];
  for (const { lang, patterns } of PREFILTER) {
    let score = 0;
    for (const pat of patterns) score += countMatches(pat, sample);
    if (score > 0) candidates.push([lang, score]);
  }
  if (candidates.length === 0) return ["unknown", 0];

  const get = (cs: ReadonlyArray<[CodeLanguage, number]>, l: CodeLanguage): number | undefined =>
    cs.find(([x]) => x === l)?.[1];

  // Disambiguation: TS superset of JS; C++ superset of C.
  const tsScore = get(candidates, "typescript");
  const jsScore = get(candidates, "javascript");
  if (tsScore !== undefined && jsScore !== undefined && tsScore >= 2) {
    const jsEntry = candidates.find(([x]) => x === "javascript");
    if (jsEntry) jsEntry[1] = 0;
  }
  const cppScore = get(candidates, "cpp");
  const cScore = get(candidates, "c");
  if (cppScore !== undefined && cScore !== undefined && cppScore >= 2) {
    const cEntry = candidates.find(([x]) => x === "c");
    if (cEntry) cEntry[1] = 0;
  }

  // Phase 2: tree-sitter, fewest errors then most top-level children.
  const codeSample10k = charPrefix(code, 10000);
  let bestLang: CodeLanguage = "unknown";
  let minErrors = Infinity;
  let bestNodeCount = 0;

  // Stable sort by score desc (Array#sort is spec-guaranteed stable since ES2019).
  const sortedCandidates = [...candidates].sort((a, b) => b[1] - a[1]);

  for (const [lang] of sortedCandidates) {
    if (lang === "unknown" || get(candidates, lang) === 0) continue;
    const tree = await parseCode(codeSample10k, lang);
    if (!tree) continue;
    const root = tree.rootNode;
    const errorCount = countErrorNodes(root);
    const nodeCount = root.childCount;
    if (errorCount < minErrors || (errorCount === minErrors && nodeCount > bestNodeCount)) {
      minErrors = errorCount;
      bestLang = lang;
      bestNodeCount = nodeCount;
    }
  }

  if (bestLang !== "unknown") {
    const totalLines = Math.max(1, code.trim().split("\n").length);
    const errorRatio = minErrors / totalLines;
    const confidence = clamp(1 - errorRatio, 0.3, 1.0);
    return [bestLang, confidence];
  }

  // Phase 3: regex-only fallback (first max in insertion order).
  let best = candidates[0];
  for (const cand of candidates.slice(1)) {
    if (cand[1] > best[1]) best = cand;
  }
  if (best[1] === 0) return ["unknown", 0];
  const confidence = Math.min(1, 0.3 + best[1] * 0.1);
  return [best[0], confidence];
}

// ─── Symbol collection (DFS) ───────────────────────────────────────────────

/** DFS collect of qualified definition names -> node. Mirrors the nested `collect_definitions`. */
function collectDefinitions(
  node: SyntaxNode,
  parentName: string,
  isDef: (kind: string) => boolean,
  decoratorNode: string | null,
  definitions: Map<string, SyntaxNode>,
  bareNames: Map<string, string>
): void {
  const nt = node.type;
  if (isDef(nt)) {
    const short = getDefinitionName(node);
    if (short !== undefined) {
      const qualified = parentName === "" ? short : `${parentName}.${short}`;
      definitions.set(qualified, node);
      bareNames.set(qualified, short);
      for (const child of node.children) {
        if (child) collectDefinitions(child, qualified, isDef, decoratorNode, definitions, bareNames);
      }
      return;
    }
  }
  if (decoratorNode !== null && nt === decoratorNode) {
    for (const child of node.children) {
      if (!child) continue;
      if (isDef(child.type)) {
        const short = getDefinitionName(child);
        if (short !== undefined) {
          const qualified = parentName === "" ? short : `${parentName}.${short}`;
          definitions.set(qualified, child);
          bareNames.set(qualified, short);
          for (const grandchild of child.children) {
            if (grandchild) {
              collectDefinitions(grandchild, qualified, isDef, decoratorNode, definitions, bareNames);
            }
          }
          return;
        }
      }
    }
  }
  for (const child of node.children) {
    if (child) collectDefinitions(child, parentName, isDef, decoratorNode, definitions, bareNames);
  }
}

/** DFS count of identifier-like nodes by text. Mirrors `collect_identifiers`. */
function collectIdentifiers(node: SyntaxNode, out: Map<string, number>): void {
  const k = node.type;
  if (k === "identifier" || k === "property_identifier" || k === "type_identifier") {
    out.set(node.text, (out.get(node.text) ?? 0) + 1);
  }
  for (const child of node.children) {
    if (child) collectIdentifiers(child, out);
  }
}

/** DFS collect of calls within a function. Mirrors `collect_calls_in_function`. */
function collectCalls(
  node: SyntaxNode,
  definedShortNames: Set<string>,
  funcShort: string,
  calls: Set<string>
): void {
  const k = node.type;
  if (k === "identifier" || k === "property_identifier") {
    const name = node.text;
    if (definedShortNames.has(name) && name !== funcShort) calls.add(name);
  }
  for (const child of node.children) {
    if (child) collectCalls(child, definedShortNames, funcShort, calls);
  }
}

// ─── Symbol importance + body budget ───────────────────────────────────────

/** Distribution-based symbol importance. Mirrors `_analyze_symbol_importance`. */
function analyzeSymbolImportance(
  root: SyntaxNode,
  language: CodeLanguage,
  context: string,
  config: CodeCompressorConfig
): SymbolAnalysis {
  if (!config.semanticAnalysis) return emptyAnalysis();
  const lang = getLangConfig(language);
  if (!lang) return emptyAnalysis();

  const isDef = (k: string) => lang.functionNodes.includes(k) || lang.classNodes.includes(k);

  const definitions = new Map<string, SyntaxNode>();
  const bareNames = new Map<string, string>();
  collectDefinitions(root, "", isDef, lang.decoratorNode, definitions, bareNames);
  if (definitions.size === 0) return emptyAnalysis();

  const allIdentifiers = new Map<string, number>();
  collectIdentifiers(root, allIdentifiers);

  const definedShortNames = new Set(bareNames.values());
  const functionCalls: Array<[string, Set<string>]> = [];
  const bodyLineCounts = new Map<string, number>();
  for (const [qname, node] of definitions) {
    const funcShort = bareNames.get(qname) ?? "";
    const calls = new Set<string>();
    collectCalls(node, definedShortNames, funcShort, calls);
    functionCalls.push([qname, calls]);
    const lineCount = node.text.split("\n").length;
    bodyLineCounts.set(qname, Math.max(1, lineCount - 2));
  }

  const shortNameDefCount = new Map<string, number>();
  for (const short of bareNames.values()) {
    shortNameDefCount.set(short, (shortNameDefCount.get(short) ?? 0) + 1);
  }
  const refCounts = new Map<string, number>();
  for (const qname of definitions.keys()) {
    const short = bareNames.get(qname) as string;
    const count = allIdentifiers.get(short) ?? 0;
    const defCount = shortNameDefCount.get(short) ?? 1;
    refCounts.set(qname, Math.max(0, count - defCount));
  }

  const [contextWords, contextLower, contextHasCjk] = queryContextTokens(context);

  const rawSignals: Array<[string, number]> = [];
  for (const qname of definitions.keys()) {
    const short = bareNames.get(qname) as string;
    const refs = refCounts.get(qname) ?? 0;
    const callsEntry = functionCalls.find(([k]) => k === qname);
    const fanOut = callsEntry ? callsEntry[1].size : 0;
    const isPublic = isPublicSymbol(short, language);

    let raw = refs;
    raw += isPublic ? 1 : 0;
    raw += fanOut * 0.5;

    if (language === "python" && short.startsWith("__") && short.endsWith("__")) {
      raw += 2;
    } else if (language === "go" && isUppercaseChar(short.charAt(0))) {
      raw += 1;
    }

    if (symbolInContext(short.toLowerCase(), contextWords, contextLower, contextHasCjk)) {
      raw += 3;
    }
    rawSignals.push([qname, raw]);
  }

  const values = rawSignals.map(([, v]) => v);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const rangeVal = maxVal - minVal;

  const scores: Array<[string, number]> = [];
  if (rangeVal > 0) {
    for (const [name, v] of rawSignals) {
      scores.push([name, pyRound3((v - minVal) / rangeVal)]);
    }
  } else {
    for (const [name] of rawSignals) scores.push([name, 0.5]);
  }

  return { scores, calls: functionCalls, bareNames, bodyLineCounts };
}

/** Allocate per-symbol body-line budgets. Mirrors `_allocate_body_budget`. */
function allocateBodyBudget(
  analysis: SymbolAnalysis,
  code: string,
  config: CodeCompressorConfig
): Map<string, number> {
  if (analysis.scores.length === 0 || analysis.bodyLineCounts.size === 0) return new Map();

  const targetRate = config.targetCompressionRate;
  const totalLines = code.trim().split("\n").length;
  let totalBodyLines = 0;
  for (const v of analysis.bodyLineCounts.values()) totalBodyLines += v;
  const fixedLines = Math.max(0, totalLines - totalBodyLines);
  const targetTotal = totalLines * targetRate;
  const bodyBudget = Math.max(0, targetTotal - fixedLines);

  if (totalBodyLines === 0) return new Map();

  const scoreFloor = 0.05;
  const weights: Array<[string, number]> = [];
  for (const [name, score] of analysis.scores) {
    const s = Math.max(score, scoreFloor);
    const size = analysis.bodyLineCounts.get(name) ?? 0;
    weights.push([name, s * size]);
  }
  let totalWeight = 0;
  for (const [, w] of weights) totalWeight += w;

  const limits = new Map<string, number>();
  if (totalWeight === 0) {
    const perFunc = Math.max(0, Math.trunc(bodyBudget / Math.max(1, analysis.scores.length)));
    for (const [name] of analysis.scores) {
      const size = analysis.bodyLineCounts.get(name) ?? 0;
      limits.set(name, Math.min(perFunc, size));
    }
    return limits;
  }

  for (const [qname] of analysis.scores) {
    const weight = weights.find(([k]) => k === qname)?.[1] ?? 0;
    const allocation = (bodyBudget * weight) / totalWeight;
    const maxLines = analysis.bodyLineCounts.get(qname) ?? 0;
    const limit = Math.min(pyRoundInt(allocation), maxLines);
    limits.set(qname, limit);
    const short = analysis.bareNames.get(qname) ?? qname;
    const existing = limits.get(short);
    if (existing === undefined || limit > existing) {
      limits.set(short, limit);
    }
  }
  return limits;
}

// ─── Structure extraction ──────────────────────────────────────────────────

function rangeKey(node: SyntaxNode): string {
  return `${node.startIndex}:${node.endIndex}`;
}

/** Extract structure from the AST. Mirrors `_extract_structure`. */
function extractStructure(ctx: Ctx, root: SyntaxNode): CodeStructure {
  const structure = emptyStructure();
  const captured = new Set<string>();
  visit(ctx, root, structure, captured);

  for (const child of root.children) {
    if (!child) continue;
    if (!captured.has(rangeKey(child))) {
      const text = child.text.trim();
      if (text !== "") structure.topLevelCode.push(text);
    }
  }
  return structure;
}

function visit(ctx: Ctx, node: SyntaxNode, structure: CodeStructure, captured: Set<string>): void {
  const nt = node.type;
  const key = rangeKey(node);

  // Package declarations (Go, Java).
  if (ctx.lang.packageNode === nt) {
    structure.imports.unshift(node.text);
    captured.add(key);
    return;
  }
  // Import statements.
  if (ctx.lang.importNodes.includes(nt)) {
    structure.imports.push(node.text);
    captured.add(key);
    return;
  }
  // Export statements (JS/TS).
  if (nt === "export_statement") {
    const text = node.text;
    let hasFuncOrClass = false;
    for (const child of node.children) {
      if (!child) continue;
      if (ctx.lang.functionNodes.includes(child.type)) {
        hasFuncOrClass = true;
        const compressed = compressFunctionAst(ctx, child, { clipToOwnSpan: true });
        const exportPrefix = ctx.code.slice(node.startIndex, child.startIndex);
        const exportSuffix = ctx.code.slice(child.endIndex, node.endIndex);
        structure.functionSignatures.push(`${exportPrefix}${compressed}${exportSuffix}`);
        break;
      }
      if (ctx.lang.classNodes.includes(child.type)) {
        hasFuncOrClass = true;
        // Deliberate divergence from the Rust/Python references, which
        // always run the *function* compressor here (even for an exported
        // class) and so never actually truncate an exported class's method
        // bodies -- see `bodyNodeTypes`' own comment. Routed through
        // `compressClassAst` instead so an exported class compresses the
        // same way its bare counterpart does (verified to have zero
        // fixture-parity coverage: no recorded JS/TS fixture exercises a
        // compressible class body either way).
        const compressed = compressClassAst(ctx, child, true);
        const exportPrefix = ctx.code.slice(node.startIndex, child.startIndex);
        const exportSuffix = ctx.code.slice(child.endIndex, node.endIndex);
        structure.classDefinitions.push(`${exportPrefix}${compressed}${exportSuffix}`);
        break;
      }
      if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
        const found = findExportedFunctionValue(child);
        if (found) {
          hasFuncOrClass = true;
          const compressed = compressFunctionAst(ctx, found.valueNode, {
            nameOverride: found.name,
            clipToOwnSpan: true,
          });
          const exportPrefix = ctx.code.slice(node.startIndex, found.valueNode.startIndex);
          const exportSuffix = ctx.code.slice(found.valueNode.endIndex, node.endIndex);
          structure.functionSignatures.push(`${exportPrefix}${compressed}${exportSuffix}`);
          break;
        }
      }
    }
    if (!hasFuncOrClass) structure.imports.push(text);
    captured.add(key);
    return;
  }
  // Decorated definitions (Python).
  if (ctx.lang.decoratorNode !== null && nt === ctx.lang.decoratorNode) {
    const decoratorText: string[] = [];
    let definitionCompressed: string | undefined;
    let hasClassChild = false;
    for (const child of node.children) {
      if (!child) continue;
      const ck = child.type;
      if (ck === "decorator") {
        decoratorText.push(child.text);
      } else if (ctx.lang.functionNodes.includes(ck)) {
        definitionCompressed = compressFunctionAst(ctx, child);
      } else if (ctx.lang.classNodes.includes(ck)) {
        definitionCompressed = compressClassAst(ctx, child);
      }
      if (ctx.lang.classNodes.includes(ck)) hasClassChild = true;
    }
    if (definitionCompressed !== undefined && decoratorText.length > 0) {
      const fullDef = `${decoratorText.join("\n")}\n${definitionCompressed}`;
      if (hasClassChild) structure.classDefinitions.push(fullDef);
      else structure.functionSignatures.push(fullDef);
    } else if (definitionCompressed !== undefined) {
      structure.functionSignatures.push(definitionCompressed);
    }
    captured.add(key);
    return;
  }
  // Function/method definitions.
  if (ctx.lang.functionNodes.includes(nt)) {
    structure.functionSignatures.push(compressFunctionAst(ctx, node));
    captured.add(key);
    return;
  }
  // Class definitions.
  if (ctx.lang.classNodes.includes(nt)) {
    structure.classDefinitions.push(compressClassAst(ctx, node));
    captured.add(key);
    return;
  }
  // Type definitions.
  if (ctx.lang.typeNodes.includes(nt)) {
    structure.typeDefinitions.push(node.text);
    captured.add(key);
    return;
  }
  // Recurse.
  for (const child of node.children) {
    if (child) visit(ctx, child, structure, captured);
  }
}

const SKIP_BODY_STMT_TYPES = new Set(["{", "}", ";", ",", "comment", "line_comment", "block_comment"]);

/** FIRST_LINE multi-line docstring reconstruction. Mirrors the same-named inline block in the Rust file. */
function firstLineDocstring(firstDsLine: string, bodyLines: readonly string[], dsStartRel: number): string {
  const dsIndent = leadingWs(firstDsLine);
  const stripped = firstDsLine.trim();

  const OPENERS = ['r"""', "r'''", '"""', "'''"];
  let quote = '"""';
  let contentStart = 0;
  for (const opener of OPENERS) {
    if (stripped.startsWith(opener)) {
      quote = opener.slice(-3);
      contentStart = opener.length;
      break;
    }
  }

  let firstContent = stripped.slice(contentStart).trim();
  for (const q of ['"""', "'''"]) {
    if (firstContent.endsWith(q)) firstContent = firstContent.slice(0, -q.length).trim();
  }

  if (firstContent !== "") {
    const prefixPart = stripped.slice(0, contentStart);
    return `${dsIndent}${prefixPart}${firstContent}${quote}`;
  }
  if (dsStartRel + 1 < bodyLines.length) {
    let secondLine = bodyLines[dsStartRel + 1].trim();
    for (const q of ['"""', "'''"]) {
      if (secondLine.endsWith(q)) secondLine = secondLine.slice(0, -q.length).trim();
    }
    if (secondLine !== "") return `${dsIndent}${quote}${secondLine}${quote}`;
    return firstDsLine;
  }
  return firstDsLine;
}

/**
 * Row-based reconstruction (`compressFunctionAst`/`compressClassAst` below)
 * assumes `node` owns its first and last source rows outright. That holds
 * for every bare top-level/class-member call site these were originally
 * written for -- including ones where a sibling (not this node) owns a
 * same-row trailing terminator the node's own `endIndex` excludes, e.g. a
 * C++ `class_specifier`'s trailing `;` actually belongs to the wrapping
 * `field_declaration`/plain `declaration`, not the class itself, and
 * nothing re-adds it if this function strips it — so clipping must stay
 * opt-in (`clip = true`), never a default.
 *
 * It's needed for exactly one caller shape: a `function_declaration`/
 * `arrow_function`/`class_declaration` reached through the
 * `export_statement` branch in `visit()`. There, sibling text on the same
 * row (`export `/`export default ` before the node, or a trailing `;`
 * after an arrow function's closing brace, owned by the enclosing
 * `lexical_declaration`) would otherwise leak into the sliced lines, get
 * reconstructed as-is, and then get *duplicated* when that branch
 * separately re-adds its own byte-offset prefix/suffix — producing invalid
 * output like `export export function` that fails `verifySyntax` and
 * silently passes through the original untouched. That same branch always
 * re-adds the exact prefix/suffix text this strips (`ctx.code.slice(node.
 * startIndex, child.startIndex)` / `ctx.code.slice(child.endIndex, node.
 * endIndex)`), so nothing is lost there. Guarded by "is the clipped-off
 * text non-whitespace" so plain leading indentation (e.g. a class method)
 * is never touched even when opted in.
 */
function clipRowsToNodeSpan(rawLines: readonly string[], node: SyntaxNode, clip: boolean): string[] {
  if (!clip) return [...rawLines];
  const nodeLines = [...rawLines];
  if (nodeLines.length === 0) return nodeLines;
  const lastIdx = nodeLines.length - 1;
  if (lastIdx === 0) {
    // Single-row node: clip both boundaries against the *same* original
    // (unmodified) line -- computing them independently avoids the second
    // clip's column offset being thrown off by the first.
    const line = rawLines[0];
    const prefix = line.slice(0, node.startPosition.column);
    const suffix = line.slice(node.endPosition.column);
    const start = prefix.trim() !== "" ? node.startPosition.column : 0;
    const end = suffix.trim() !== "" ? node.endPosition.column : line.length;
    nodeLines[0] = line.slice(start, end);
  } else {
    const firstLine = rawLines[0];
    const firstLinePrefix = firstLine.slice(0, node.startPosition.column);
    if (firstLinePrefix.trim() !== "") {
      nodeLines[0] = firstLine.slice(node.startPosition.column);
    }
    const lastLine = rawLines[lastIdx];
    const lastLineSuffix = lastLine.slice(node.endPosition.column);
    if (lastLineSuffix.trim() !== "") {
      nodeLines[lastIdx] = lastLine.slice(0, node.endPosition.column);
    }
  }
  return nodeLines;
}

/** Compress a function/method body. Mirrors `_compress_function_ast`. */
function compressFunctionAst(
  ctx: Ctx,
  node: SyntaxNode,
  opts?: { nameOverride?: string; clipToOwnSpan?: boolean }
): string {
  const startRow = node.startPosition.row;
  const endRow = node.endPosition.row;
  const rawLines = ctx.codeLines.slice(startRow, endRow + 1);
  const nodeLines = clipRowsToNodeSpan(rawLines, node, opts?.clipToOwnSpan ?? false);
  const nodeText = nodeLines.join("\n");

  const funcName = opts?.nameOverride ?? getDefinitionName(node);
  const bodyLimit = getBodyLimit(funcName, ctx.bodyLimits, ctx.config.maxBodyLines);

  if (nodeLines.length <= bodyLimit + 2) return nodeText;

  let bodyNode: SyntaxNode | undefined;
  for (const child of node.children) {
    if (child && ctx.lang.bodyNodeTypes.includes(child.type)) {
      bodyNode = child;
      break;
    }
  }
  if (!bodyNode) return nodeText;

  const nodeStartLine = startRow;
  const bodyStartLine = bodyNode.startPosition.row;
  const bodyEndLine = bodyNode.endPosition.row;
  const sigEnd = bodyStartLine - nodeStartLine; // exclusive
  const bodyEndRel = bodyEndLine - nodeStartLine + 1; // inclusive

  let signatureLines: string[];
  let bodyLines: string[];
  let afterLines: string[];
  let braceInSignature: boolean;

  if (sigEnd === 0 && !ctx.lang.usesColonAfterSignature) {
    signatureLines = [nodeLines[0].replace(/\s+$/, "")];
    bodyLines = nodeLines.slice(1, bodyEndRel);
    afterLines = nodeLines.slice(bodyEndRel);
    braceInSignature = true;
  } else {
    signatureLines = nodeLines.slice(0, sigEnd);
    bodyLines = nodeLines.slice(sigEnd, bodyEndRel);
    afterLines = nodeLines.slice(bodyEndRel);
    braceInSignature = false;
  }

  let openingBraceLine: string | undefined;
  let closingBraceLine: string | undefined;
  if (!ctx.lang.usesColonAfterSignature) {
    if (!braceInSignature && bodyLines.length > 0 && bodyLines[0].trimStart().startsWith("{")) {
      openingBraceLine = bodyLines[0];
      bodyLines = bodyLines.slice(1);
    }
    if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trimEnd().endsWith("}")) {
      closingBraceLine = bodyLines[bodyLines.length - 1];
      bodyLines = bodyLines.slice(0, -1);
    }
  }

  // Python docstring handling via AST.
  let docstringText = "";
  let dsSkipLines = 0;
  if (ctx.language === "python" && bodyNode.childCount > 0) {
    const firstChild = bodyNode.child(0);
    let dsNode: SyntaxNode | undefined;
    if (firstChild) {
      const isDirectString = firstChild.type === "string";
      const isWrappedString =
        firstChild.type === "expression_statement" &&
        firstChild.childCount > 0 &&
        firstChild.child(0)?.type === "string";
      // Both branches set `dsNode` to `firstChild` itself (not the inner
      // `string` node) — mirrors the Rust reference exactly.
      if (isDirectString || isWrappedString) {
        dsNode = firstChild;
      }
    }
    if (dsNode) {
      const dsLinesCount = dsNode.endPosition.row - dsNode.startPosition.row + 1;
      const dsStartRel = dsNode.startPosition.row - bodyNode.startPosition.row;

      if (ctx.config.docstringMode === "full") {
        const endi = Math.min(dsStartRel + dsLinesCount, bodyLines.length);
        if (dsStartRel < bodyLines.length) docstringText = bodyLines.slice(dsStartRel, endi).join("\n");
      } else if (ctx.config.docstringMode === "first_line") {
        if (dsLinesCount === 1) {
          if (dsStartRel < bodyLines.length) docstringText = bodyLines[dsStartRel];
        } else if (dsStartRel < bodyLines.length) {
          docstringText = firstLineDocstring(bodyLines[dsStartRel], bodyLines, dsStartRel);
        }
      }
      // "remove"/"none": nothing.
      dsSkipLines = dsStartRel + dsLinesCount;
    }
  }

  const indent = bodyLines.length > 0 ? detectIndent(bodyLines) : "    ";

  let dsEndRow = -1;
  if (dsSkipLines > 0 && bodyNode.childCount > 0) {
    dsEndRow = bodyNode.startPosition.row + dsSkipLines - 1;
  }

  const bodyStmts: Array<[number, number]> = [];
  for (const child of bodyNode.children) {
    if (!child) continue;
    if (child.startPosition.row <= dsEndRow) continue;
    if (SKIP_BODY_STMT_TYPES.has(child.type)) continue;
    if (!child.isNamed) continue;
    bodyStmts.push([child.startPosition.row, child.endPosition.row]);
  }

  let totalBodyLinesCount = 0;
  for (const [s, e] of bodyStmts) totalBodyLinesCount += e - s + 1;

  const keptLines: string[] = [];
  let keptLineCount = 0;
  for (const [sRow, eRow] of bodyStmts) {
    const stmtLines = ctx.codeLines.slice(sRow, eRow + 1);
    const stmtLineCount = stmtLines.length;
    if (keptLineCount + stmtLineCount > bodyLimit && keptLines.length > 0) break;
    keptLines.push(...stmtLines);
    keptLineCount += stmtLineCount;
  }

  const omittedLines = totalBodyLinesCount - keptLineCount;

  const resultParts: string[] = [];
  if (signatureLines.length > 0) {
    resultParts.push(...signatureLines);
  } else {
    resultParts.push(ctx.code.slice(node.startIndex, bodyNode.startIndex).replace(/\s+$/, ""));
  }
  if (openingBraceLine !== undefined) resultParts.push(openingBraceLine);
  if (
    docstringText !== "" &&
    ctx.config.docstringMode !== "none" &&
    ctx.config.docstringMode !== "remove"
  ) {
    resultParts.push(docstringText);
  }
  if (keptLines.length > 0) resultParts.push(...keptLines);
  if (omittedLines > 0) {
    resultParts.push(makeOmittedComment(funcName, omittedLines, indent, ctx.lang.commentPrefix, ctx.analysis));
    if (ctx.lang.usesColonAfterSignature) resultParts.push(`${indent}pass`);
  }
  if (closingBraceLine !== undefined) {
    resultParts.push(closingBraceLine);
  } else if (afterLines.length > 0) {
    resultParts.push(...afterLines);
  }

  return resultParts.join("\n");
}

/** Compress a class by compressing each method individually. Mirrors `_compress_class_ast`. */
function compressClassAst(ctx: Ctx, node: SyntaxNode, clipToOwnSpan = false): string {
  const startRow = node.startPosition.row;
  const endRow = node.endPosition.row;
  const rawLines = ctx.codeLines.slice(startRow, endRow + 1);
  const nodeLines = clipRowsToNodeSpan(rawLines, node, clipToOwnSpan);
  const nodeText = nodeLines.join("\n");

  let bodyNode: SyntaxNode | undefined;
  for (const child of node.children) {
    if (child && ctx.lang.bodyNodeTypes.includes(child.type)) {
      bodyNode = child;
      break;
    }
  }
  if (!bodyNode) return nodeText;

  const nodeStartLine = startRow;
  const bodyStartLine = bodyNode.startPosition.row;
  const sigEnd = bodyStartLine - nodeStartLine;
  const headerLines = sigEnd > 0 ? nodeLines.slice(0, sigEnd) : [nodeLines[0]];

  const bodyParts: string[] = [];
  for (const child of bodyNode.children) {
    if (!child) continue;
    // Unnamed punctuation (the body's own `{`/`}` delimiters) is never a
    // real member -- for Python's `block` body (no braces) this is already
    // a no-op, but for a brace-delimited body (e.g. JS/TS `class_body`,
    // newly recognized via `bodyNodeTypes` above) skipping it is required:
    // row-based `childText` for an unnamed `{` token grabs its *entire
    // source row*, which is the same row as `headerLines`' own signature
    // line, duplicating it (and likewise for a lone `}` row, duplicating
    // the closing brace added below).
    if (!child.isNamed) continue;
    const ck = child.type;
    const childText = ctx.codeLines
      .slice(child.startPosition.row, child.endPosition.row + 1)
      .join("\n");

    if (ctx.lang.functionNodes.includes(ck)) {
      bodyParts.push(compressFunctionAst(ctx, child));
    } else if (ctx.lang.decoratorNode !== null && ck === ctx.lang.decoratorNode) {
      const decoratorLines: string[] = [];
      let methodCompressed: string | undefined;
      for (const decoChild of child.children) {
        if (!decoChild) continue;
        if (decoChild.type === "decorator") {
          decoratorLines.push(decoChild.text);
        } else if (ctx.lang.functionNodes.includes(decoChild.type)) {
          methodCompressed = compressFunctionAst(ctx, decoChild);
        }
      }
      if (methodCompressed !== undefined && decoratorLines.length > 0) {
        bodyParts.push(`${decoratorLines.join("\n")}\n${methodCompressed}`);
      } else if (methodCompressed !== undefined) {
        bodyParts.push(methodCompressed);
      } else {
        bodyParts.push(childText);
      }
    } else if (ctx.lang.classNodes.includes(ck)) {
      bodyParts.push(compressClassAst(ctx, child));
    } else if (childText.trim() !== "") {
      bodyParts.push(childText);
    }
  }

  const resultParts: string[] = [...headerLines, ...bodyParts];

  const bodyEndLine = bodyNode.endPosition.row;
  const bodyEndRel = bodyEndLine - nodeStartLine + 1;
  const afterLines = nodeLines.slice(bodyEndRel);
  if (afterLines.length > 0) {
    resultParts.push(...afterLines);
  } else if (!ctx.lang.usesColonAfterSignature) {
    const lastBodyLine = nodeLines[nodeLines.length - 1] ?? "";
    if (lastBodyLine.trim() === "}") resultParts.push(lastBodyLine);
  }

  return resultParts.join("\n");
}

/** Assemble compressed code from structure. Mirrors `_assemble_compressed`. */
function assembleCompressed(structure: CodeStructure): string {
  const parts: string[] = [];
  const pushSection = (section: readonly string[]) => {
    if (section.length > 0) {
      parts.push(...section);
      parts.push("");
    }
  };
  pushSection(structure.imports);
  pushSection(structure.typeDefinitions);
  pushSection(structure.classDefinitions);
  pushSection(structure.functionSignatures);
  pushSection(structure.topLevelCode);
  if (structure.other.length > 0) parts.push(...structure.other);

  while (parts.length > 0 && parts[parts.length - 1].trim() === "") parts.pop();
  return parts.join("\n");
}

/** Fallback structure for unparseable/unsupported input. Mirrors `_extract_generic_structure`. */
function extractGenericStructure(code: string): CodeStructure {
  return { ...emptyStructure(), other: code.split("\n") };
}

// ─── Top-level compression pipeline ────────────────────────────────────────

function passthroughResult(
  code: string,
  originalTokens: number,
  language: CodeLanguage,
  confidence: number
): CodeCompressionResult {
  return {
    compressed: code,
    original: code,
    originalTokens,
    compressedTokens: originalTokens,
    compressionRatio: 1.0,
    language,
    languageConfidence: confidence,
    preservedImports: 0,
    preservedSignatures: 0,
    compressedBodies: 0,
    syntaxValid: true,
    cacheKey: null,
    symbolScores: {},
    wasModified: false,
  };
}

async function verifySyntax(code: string, language: CodeLanguage): Promise<boolean> {
  const tree = await parseCode(code, language);
  if (!tree) return false;
  return !hasSyntaxIssues(tree.rootNode);
}

interface AstCompression {
  compressed: string;
  structure: CodeStructure;
  symbolScores: Record<string, number>;
}

/** Parse + analyze + extract + assemble. Mirrors `compress_with_ast`. */
async function compressWithAst(
  code: string,
  language: CodeLanguage,
  context: string,
  config: CodeCompressorConfig
): Promise<AstCompression | null> {
  const tree = await parseCode(code, language);
  if (!tree) return null;
  const root = tree.rootNode;

  const analysis = analyzeSymbolImportance(root, language, context, config);
  const bodyLimits = allocateBodyBudget(analysis, code, config);

  const langConfig = getLangConfig(language);
  let structure: CodeStructure;
  let symbolScores: Record<string, number>;

  if (langConfig) {
    const ctx: Ctx = {
      code,
      codeLines: code.split("\n"),
      language,
      lang: langConfig,
      bodyLimits,
      analysis,
      config,
    };
    structure = extractStructure(ctx, root);

    const dedup = new Map<string, number>();
    for (const [qname, score] of analysis.scores) {
      const short = analysis.bareNames.get(qname) ?? qname;
      const existing = dedup.get(short);
      if (existing === undefined || score > existing) dedup.set(short, score);
    }
    symbolScores = Object.fromEntries(dedup);
  } else {
    structure = extractGenericStructure(code);
    symbolScores = {};
  }

  const compressed = assembleCompressed(structure);
  return { compressed, structure, symbolScores };
}

/**
 * Compresses `code` using AST-preserving structural compression: imports,
 * type/class/function signatures, decorators, and top-level code are kept
 * verbatim; function/method bodies beyond their allocated line budget are
 * elided with a `[N lines omitted; calls: ...]` placeholder. Falls back to
 * a generic line-preserving structure (never throws, never silently drops
 * content) for unparseable or unsupported input.
 *
 * The output is guaranteed syntactically valid: it is re-parsed after
 * compression, and any ERROR/MISSING node causes a passthrough of the
 * original instead (mirrors `_verify_syntax` in both upstream references).
 */
export async function compressCode(
  code: string,
  opts: CompressCodeOptions = {}
): Promise<CodeCompressionResult> {
  const config: CodeCompressorConfig = { ...DEFAULT_CODE_COMPRESSOR_CONFIG, ...opts.config };
  const context = opts.queryContext ?? "";

  if (code.trim() === "") return passthroughResult(code, 0, "unknown", 0);

  const originalTokens = estimateTokens(code);
  if (originalTokens < config.minTokensForCompression) {
    return passthroughResult(code, originalTokens, "unknown", 0);
  }

  let detectedLang: CodeLanguage;
  let confidence: number;
  if (opts.language) {
    detectedLang = normalizeLanguage(opts.language) ?? "unknown";
    confidence = 1.0;
  } else if (config.languageHint) {
    detectedLang = normalizeLanguage(config.languageHint) ?? "unknown";
    confidence = 1.0;
  } else {
    [detectedLang, confidence] = await detectLanguage(code);
  }

  if (detectedLang === "unknown") {
    return { ...passthroughResult(code, originalTokens, "unknown", 0) };
  }

  const astResult = await compressWithAst(code, detectedLang, context, config);
  if (!astResult) {
    return passthroughResult(code, originalTokens, detectedLang, confidence);
  }

  const { compressed, structure, symbolScores } = astResult;
  const compressedTokens = estimateTokens(compressed);

  const syntaxValid = await verifySyntax(compressed, detectedLang);
  if (!syntaxValid) {
    return passthroughResult(code, originalTokens, detectedLang, confidence);
  }

  const ratio = compressedTokens / Math.max(1, originalTokens);
  if (ratio < 0.05) {
    return passthroughResult(code, originalTokens, detectedLang, confidence);
  }

  return {
    compressed,
    original: code,
    originalTokens,
    compressedTokens,
    compressionRatio: ratio,
    language: detectedLang,
    languageConfidence: confidence,
    preservedImports: structure.imports.length,
    preservedSignatures: structure.functionSignatures.length,
    compressedBodies: structure.functionBodies.length,
    syntaxValid,
    cacheKey: null,
    symbolScores,
    wasModified: compressed !== code,
  };
}
