/**
 * Code Analysis Tools - AST-Based Complexity, Dependency, Import/Export,
 * Refactoring, Security, Symbol, and TypeScript Analysis
 *
 * *** ONLY 3 OF 9 REAL TOOLS ARE WIRED/EXPORTED HERE RIGHT NOW ***
 * (smart_ast_grep, smart_security, smart_dependencies). The other 6
 * (smart_typescript, smart_symbols, smart_complexity, smart_refactor,
 * smart_imports, smart_exports) are copied onto disk, path-reconciled, and
 * (3 of them) projectRoot-bug-fixed -- but NOT exported here and NOT wired
 * into src/optimizer/server.ts, because of a blocker discovered mid-checkpoint
 * that is a repo-wide dependency decision, not something fixable inside this
 * category alone. Their files are DELIBERATELY left out of tsconfig.json's
 * `exclude` reachability (see that file's own `exclude` array) so
 * `npx tsc --noEmit` stays green; un-excluding them requires resolving the
 * blocker below first.
 *
 * THE BLOCKER: those 6 files call `import * as ts from 'typescript'` and use
 * the CLASSIC TypeScript Compiler API (`ts.createSourceFile`,
 * `ts.ScriptTarget`, `ts.isFunctionDeclaration`, `ts.SyntaxKind`,
 * `ts.forEachChild`, etc.) for real AST parsing/traversal. This repo's
 * `typescript` devDependency is already pinned to `^7.0.2` (predating this
 * checkpoint, used elsewhere for `tsc`/build-systems' spawned CLI) -- and
 * TypeScript 7 is the native/Go-rewritten compiler. Its npm package's
 * `package.json` `exports` map no longer exposes the classic JS Compiler API
 * at the `"."` entry point at all (`"." -> "./lib/version.cjs"`, which only
 * exports a version string); `node_modules/typescript/lib/` contains only
 * `tsc.js`/`getExePath.js`/`version.cjs` -- thin wrappers around a native
 * binary, not the classic AST module. A real subset of node-type utilities
 * DOES exist under the new `typescript/unstable/ast` / `unstable/ast/is` /
 * `unstable/ast/factory` export paths (verified directly: `isFunctionDeclaration`,
 * `isMethodDeclaration`, `isArrowFunction`, `SyntaxKind`, `ScriptTarget`, etc.
 * are all present there) -- but there is NO `createSourceFile` (or any other
 * full source-text-to-AST parse entry point) anywhere in that new surface;
 * `unstable/ast` only exposes `createScanner` (a tokenizer, not a parser).
 * Real parsing in TS7 happens in the native Go binary, reached via the
 * `unstable/sync`/`unstable/async`/`unstable/proto` request/response
 * surface -- a genuinely different integration shape, not a drop-in import
 * rename. Porting these 6 tools is therefore a real engineering task (or:
 * add a second, older `typescript` package under an npm alias solely for
 * this category), either of which is a coordinator-level dependency/scope
 * decision, not something this bounded checkpoint should decide unilaterally.
 *
 * WHY THE OTHER 3 SURVIVE: verified directly that none of
 * `smart-ast-grep.ts`, `smart-security.ts`, `smart-dependencies.ts` import
 * `typescript` at all -- ast-grep uses its own pattern-index + `ast-grep`
 * CLI invocation (`execFileSafeSync`), security is pure regex pattern
 * matching (`SECURITY_PATTERNS`), and dependencies was already re-pointed at
 * `@babel/parser` for every extension (see that file's own top-of-file
 * comment) rather than `@typescript-eslint/typescript-estree` (dropped for
 * an unrelated, also-real peer-dependency conflict against this same TS 7).
 *
 * `smart-ambiance.ts` (vendor's 10th file) is a separate, unrelated
 * exclusion: a single-line, comment-only file with no exports at all. Both
 * signals agree here (unlike checkpoint 4's build-systems, where they
 * disagreed): vendor's own category `index.ts` marks it "Implementation
 * pending" with its exports "temporarily removed", AND vendor's real
 * `src/server/index.ts` has no `case 'smart_ambiance':` dispatch. Not
 * copied at all.
 *
 * VENDOR DISPATCH SHAPE (for all 9, including the 6 deferred): unlike
 * build-systems/api-database (every tool dispatched via a shared instance's
 * own `.run(options)`), vendor's real dispatch for 7 of these 9 tools
 * instead calls a standalone `runSmartXxx(args)` CLI helper that constructs
 * its OWN throwaway `CacheEngine`/`TokenCounter`/`MetricsCollector` per call
 * (ignoring the server's shared instances entirely for 5 of those 7;
 * `smart_complexity`/`smart_symbols` at least accept and forward the shared
 * instances as extra args). Two further real defects found in that
 * free-function layer, not replicated here or if/when the deferred 6 land:
 *   - `runSmartSymbols`/`runSmartTypescript` are typed `Promise<string>` (a
 *     human-formatted report), yet vendor's dispatch does
 *     `JSON.stringify(result, null, 2)` on that string -- producing a
 *     quoted, escape-mangled string as the tool call's actual text content
 *     instead of the real result object. A vendor bug, not a shape to
 *     replicate.
 *   - Per this merge's mandated "shared instance construction in
 *     createOptimizerRuntime()" pattern (matching every other wired
 *     category), the 3 tools below are dispatched via one shared
 *     `get*Tool(cache, tokenCounter, metrics)` instance's own method
 *     instead -- `smart_ast_grep` -> `.grep(pattern, options)` (the one
 *     positional-arg case, matching file-operations' `smart_grep` style);
 *     `smart_security`/`smart_dependencies` -> whole-args-object `.run(args)`
 *     (`SmartDependenciesTool.run()` is a plain alias for `.analyze()`).
 *
 * PROJECTROOT STALENESS BUG (same class checkpoint 4 found/fixed in
 * smart_install/smart_docker/smart_logs): among the 6 DEFERRED tools,
 * `SmartTypeScript` and `SmartSymbolsTool` each advertise a `projectRoot`
 * option in their schema AND accept a constructor `projectRoot?` param, but
 * their `run()` methods never destructured `options.projectRoot` at all --
 * fixed anyway (with the same `defaultProjectRoot` field +
 * `this.projectRoot = options.projectRoot || this.defaultProjectRoot` at the
 * top of `run()`) even though they're not currently wired, so the fix is
 * already done whenever they're un-deferred. `SmartComplexityTool`,
 * `SmartRefactorTool`, `SmartImportsTool`, `SmartExportsTool` (also
 * deferred) do NOT have this bug -- verified by reading each `run()` body:
 * all four destructure `projectRoot = this.projectRoot` as a per-call-
 * overridable local, and use that local consistently afterward, including
 * `SmartRefactorTool` correctly threading its own per-call `projectRoot`
 * through to its nested `this.complexityTool.run({ fileContent, projectRoot,
 * ... })` call. Among the 3 WIRED tools, `SmartSecurity` had the identical
 * bug (schema advertises `projectRoot`, constructor takes it, `run()` never
 * re-read it) and IS fixed here, live. `SmartDependenciesTool` and
 * `SmartAstGrepTool` don't have a `projectRoot` concept at all (dependencies
 * reads `options.cwd` fresh every call instead; ast-grep's pattern index is
 * scoped by explicit file paths, not a project directory).
 *
 * DEPENDENCY RECONCILIATION: `@babel/parser` (already imported by
 * `smart-dependencies.ts`) is a new real dependency, added to
 * package.json/node_modules via `npm install` (clean, no peer conflicts).
 * `@typescript-eslint/typescript-estree` (vendor's original `.ts`/`.tsx`
 * parser choice for that same file) was deliberately NOT added: its own
 * `peerDependencies` pin `typescript` to `>=4.8.4 <6.1.0`, which this repo's
 * `typescript@^7.0.2` cannot satisfy -- a real, unresolvable `npm install`
 * ERESOLVE conflict, not a cosmetic warning. `extractImports`/
 * `extractExports` in that file only read plain ESTree-shaped node fields
 * that Babel's own TypeScript-aware parse produces identically, so every
 * extension there now routes through `@babel/parser` with the `typescript`
 * plugin enabled. `glob` (also imported by that file) was already an
 * optiflow dependency from an earlier checkpoint.
 * The six DEFERRED files' CLI-standalone `CacheEngine` construction was
 * still reconciled to `~/.optiflow/optimizer/cache` via `paths.ts`'s
 * `getOptimizerCacheDbPath()` (replacing vendor's
 * `join(homedir(), '.hypercontext', 'cache')`) even though they're not
 * wired, so that work doesn't need repeating later.
 *
 * TYPE-NAME COLLISION: `CircularDependency` is exported by both
 * `smart-imports.ts` (deferred) and `smart-dependencies.ts` (wired) with
 * different shapes. Not currently a live collision since only
 * `smart-dependencies.ts`'s version is exported below -- noted for whoever
 * un-defers `smart-imports.ts`: vendor's own category `index.ts` already
 * resolves this with an aliased re-export (`ImportCircularDependency`);
 * reuse that alias rather than re-discovering the collision.
 */

export {
  SmartAstGrepTool,
  getSmartAstGrepTool,
  runSmartAstGrep,
  SMART_AST_GREP_TOOL_DEFINITION,
  type SmartAstGrepOptions,
  type SmartAstGrepResult,
  type AstMatch,
} from './smart-ast-grep.js';

export {
  SmartSecurity,
  getSmartSecurityTool,
  runSmartSecurity,
  SMART_SECURITY_TOOL_DEFINITION,
  type SmartSecurityOptions,
  type SmartSecurityOutput,
} from './smart-security.js';

export {
  SmartDependenciesTool,
  getSmartDependenciesTool,
  runSmartDependencies,
  SMART_DEPENDENCIES_TOOL_DEFINITION,
  type SmartDependenciesOptions,
  type SmartDependenciesResult,
  type DependencyNode as DependencyGraphNode,
  type DependencyImport,
  type DependencyExport,
  type CircularDependency,
  type UnusedDependency,
  type DependencyImpact,
} from './smart-dependencies.js';

// DEFERRED (see this file's header "THE BLOCKER" section): smart-typescript.ts,
// smart-symbols.ts, smart-complexity.ts, smart-refactor.ts, smart-imports.ts,
// smart-exports.ts all `import * as ts from 'typescript'` for the classic
// Compiler API, which this repo's typescript@^7.0.2 no longer ships under
// its public package exports. Files remain on disk with path reconciliation
// (and, for smart-typescript.ts/smart-symbols.ts, the projectRoot fix)
// already applied; not exported here, not wired into server.ts, and
// excluded from tsconfig.json's compile graph until the TS-version question
// is resolved.
