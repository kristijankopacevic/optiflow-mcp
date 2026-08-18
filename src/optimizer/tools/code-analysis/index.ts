/**
 * Code Analysis Tools - AST-Based Complexity, Dependency, Import/Export,
 * Refactoring, Security, Symbol, and TypeScript Analysis
 *
 * *** 8 OF 9 REAL TOOLS ARE NOW WIRED/EXPORTED HERE *** (smart_ast_grep,
 * smart_security, smart_dependencies, smart_complexity, smart_refactor,
 * smart_imports, smart_exports, smart_symbols). Only smart_typescript
 * remains deferred -- see its own file's header for exactly why (its
 * entire output IS type-check diagnostics from the classic Compiler API's
 * real type checker; there is no honest syntax-only substitute for that,
 * unlike the other five, whose original TS-Compiler-API usage never
 * touched a type checker at all).
 *
 * THE BLOCKER THAT MADE THIS A MULTI-CHECKPOINT PORT: the six files this
 * comment used to describe as "copied but not wired" all `import * as ts
 * from 'typescript'` and used the CLASSIC TypeScript Compiler API
 * (`ts.createSourceFile`, `ts.ScriptTarget`, `ts.isFunctionDeclaration`,
 * `ts.SyntaxKind`, `ts.forEachChild`, etc.) for real AST parsing/
 * traversal. This repo's `typescript` devDependency is pinned to
 * `^7.0.2` -- TypeScript 7, the native/Go-rewritten compiler, whose npm
 * package's `package.json` `exports` map no longer exposes the classic JS
 * Compiler API at the `"."` entry point at all (`"." ->
 * "./lib/version.cjs"`, which only exports a version string);
 * `node_modules/typescript/lib/` contains only `tsc.js`/`getExePath.js`/
 * `version.cjs` -- thin wrappers around a native binary, not the classic
 * AST module. A real subset of node-type utilities DOES exist under the
 * new `typescript/unstable/ast` / `unstable/ast/is` / `unstable/ast/
 * factory` export paths (`isFunctionDeclaration`, `SyntaxKind`,
 * `ScriptTarget`, etc. are all present there) -- but there is NO
 * `createSourceFile` (or any other full source-text-to-AST parse entry
 * point) anywhere in that new surface; `unstable/ast` only exposes
 * `createScanner` (a tokenizer, not a parser). Real parsing in TS7 happens
 * in the native Go binary, reached via the `unstable/sync`/`unstable/
 * async`/`unstable/proto` request/response surface -- a genuinely
 * different integration shape, not a drop-in import rename.
 *
 * THE RESOLUTION (this checkpoint): port each file's AST layer to
 * `@babel/parser` (already a real dependency from checkpoint 5, used by
 * `smart-dependencies.ts`) with the `typescript` parser plugin, walked via
 * a hand-written `@babel/types`-`VISITOR_KEYS` traversal
 * (./babel-ast-utils.ts) rather than `@babel/traverse` -- `@babel/traverse`
 * was tried first (per this checkpoint's own task instructions) and
 * rejected because it requires a `scope`+`parentPath` for any traversal
 * root that isn't a `Program`/`File` (verified live: throws "You must pass
 * a scope and parentPath..."), which every one of these files' original
 * recursive-descent helpers violates by design (they call
 * `ts.forEachChild` starting from an already-extracted function/class
 * subtree, not the file root). `@babel/traverse` was removed from
 * package.json as an unused dependency once that was confirmed.
 *
 * Five of the six ported faithfully with NO capability loss: import/
 * export/complexity/refactor/dependency analysis are all syntax-level
 * concepts (decision-point node types, operator tokens, declaration
 * shapes) the classic Compiler API never resolved via its type checker
 * either. The sixth, `smart_symbols`, ported with ONE deliberate,
 * documented capability loss (see its own file's header): `type` and
 * `references` are REMOVED (not approximated) because they came from
 * `ts.createLanguageService(...).getTypeChecker()`/`.findReferences()` --
 * genuine type-checker output Babel cannot produce, and a same-name-text
 * occurrence count would misrepresent itself as that scope-aware
 * reference count. `smart_typescript` (see its own file's header) is the
 * one tool left deferred outright: its entire output IS type-check
 * diagnostics, with no honest syntax-only substitute.
 *
 * WHY THE ORIGINAL 3 SURVIVED EARLIER: verified directly that none of
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
 * VENDOR DISPATCH SHAPE (all 9, including the still-deferred
 * smart_typescript): unlike build-systems/api-database (every tool
 * dispatched via a shared instance's own `.run(options)`), vendor's real
 * dispatch for 7 of these 9 tools instead calls a standalone
 * `runSmartXxx(args)` CLI helper that constructs its OWN throwaway
 * `CacheEngine`/`TokenCounter`/`MetricsCollector` per call (ignoring the
 * server's shared instances entirely for 5 of those 7;
 * `smart_complexity`/`smart_symbols` at least accept and forward the
 * shared instances as extra args). Two further real defects found in that
 * free-function layer, not replicated here:
 *   - `runSmartSymbols`/`runSmartTypescript` are typed `Promise<string>` (a
 *     human-formatted report), yet vendor's dispatch does
 *     `JSON.stringify(result, null, 2)` on that string -- producing a
 *     quoted, escape-mangled string as the tool call's actual text content
 *     instead of the real result object. A vendor bug, not a shape to
 *     replicate; this merge dispatches `smart_symbols` via its shared
 *     instance's own `.run(args)` instead (a real object, not a
 *     pre-formatted report string).
 *   - Per this merge's mandated "shared instance construction in
 *     createOptimizerRuntime()" pattern (matching every other wired
 *     category), all 8 wired tools below are dispatched via one shared
 *     `get*Tool(cache, tokenCounter, metrics[, projectRoot])` instance's
 *     own method instead -- `smart_ast_grep` -> `.grep(pattern, options)`
 *     (the one positional-arg case, matching file-operations' `smart_grep`
 *     style); the other 7 -> whole-args-object `.run(args)`
 *     (`SmartDependenciesTool.run()` is a plain alias for `.analyze()`).
 *     Verified against vendor's real `src/server/index.ts` case-by-case:
 *     `smart_complexity`/`smart_exports`/`smart_imports`/`smart_refactor`/
 *     `smart_symbols` are ALL whole-args-object dispatch there too
 *     (`args as any` passed straight through), matching this file's
 *     convention exactly, not just by coincidence.
 *
 * PROJECTROOT STALENESS BUG (same class checkpoint 4 found/fixed in
 * smart_install/smart_docker/smart_logs): `SmartTypeScript` and
 * `SmartSymbolsTool` each advertise a `projectRoot` option in their schema
 * AND accept a constructor `projectRoot?` param, but their `run()` methods
 * never destructured `options.projectRoot` at all -- fixed anyway (with
 * the same `defaultProjectRoot` field + `this.projectRoot =
 * options.projectRoot || this.defaultProjectRoot` at the top of `run()`)
 * in an earlier checkpoint, before either was wired. `SmartComplexityTool`,
 * `SmartRefactorTool`, `SmartImportsTool`, `SmartExportsTool` do NOT have
 * this bug -- verified by reading each `run()` body: all four destructure
 * `projectRoot = this.projectRoot` as a per-call-overridable local, and use
 * that local consistently afterward, including `SmartRefactorTool`
 * correctly threading its own per-call `projectRoot` through to its
 * nested `this.complexityTool.run({ fileContent, projectRoot, ... })`
 * call. Among the tools wired earlier, `SmartSecurity` had the identical
 * bug (schema advertises `projectRoot`, constructor takes it, `run()`
 * never re-read it) and was fixed live at that time.
 *
 * DEPENDENCY RECONCILIATION: `@babel/parser` (already imported by
 * `smart-dependencies.ts`) is a real dependency, added to
 * package.json/node_modules in an earlier checkpoint. This checkpoint adds
 * `@babel/types` as a direct dependency too (previously only pulled in
 * transitively via `@babel/parser`) for ./babel-ast-utils.ts's
 * `VISITOR_KEYS`-based walk. `@typescript-eslint/typescript-estree`
 * (vendor's original `.ts`/`.tsx` parser choice for `smart-dependencies.ts`
 * specifically) was deliberately NOT added: its own `peerDependencies` pin
 * `typescript` to `>=4.8.4 <6.1.0`, which this repo's `typescript@^7.0.2`
 * cannot satisfy -- a real, unresolvable `npm install` ERESOLVE conflict,
 * not a cosmetic warning. Every one of the six files this checkpoint
 * touched now routes its `.ts`/`.tsx`/`.js`/`.jsx` parsing through
 * `@babel/parser` with the `typescript` (+ `jsx`) plugin enabled, matching
 * `smart-dependencies.ts`'s already-established convention. `glob`/other
 * unrelated deps are unaffected.
 *
 * A REAL, INTENTIONAL BEHAVIOR DIFFERENCE ACROSS ALL SIX PORTED FILES:
 * `ts.createSourceFile` recovers from malformed syntax silently (returns a
 * best-effort AST with error nodes); `@babel/parser`'s `parse()` throws a
 * `SyntaxError` on invalid input instead. A file that used to silently
 * analyze as (likely wrong, since it never really parsed) now surfaces a
 * real error through the tool's caller instead -- a stricter, arguably
 * more honest failure mode, but a real difference from vendor's, not
 * silently patched.
 *
 * TYPE-NAME COLLISION (now live, resolved): `CircularDependency` is
 * exported by both `smart-imports.ts` and `smart-dependencies.ts` with
 * different shapes. Resolved below with an aliased re-export
 * (`ImportCircularDependency`), matching vendor's own category `index.ts`
 * naming for exactly this collision.
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

export {
  SmartComplexityTool,
  getSmartComplexityTool,
  runSmartComplexity,
  SMART_COMPLEXITY_TOOL_DEFINITION,
  type SmartComplexityOptions,
  type SmartComplexityResult,
  type ComplexityMetrics,
  type HalsteadMetrics,
  type FunctionComplexity,
} from './smart-complexity.js';

export {
  SmartRefactorTool,
  getSmartRefactorTool,
  runSmartRefactor,
  SMART_REFACTOR_TOOL_DEFINITION,
  type SmartRefactorOptions,
  type SmartRefactorResult,
  type RefactorSuggestion,
} from './smart-refactor.js';

export {
  SmartImportsTool,
  getSmartImportsTool,
  runSmartImports,
  SMART_IMPORTS_TOOL_DEFINITION,
  type SmartImportsOptions,
  type SmartImportsResult,
  type ImportInfo,
  type ImportOptimization,
  // Aliased per vendor's own category index.ts: this shape differs from
  // smart-dependencies.ts's own `CircularDependency` (already exported
  // above under its own name).
  type CircularDependency as ImportCircularDependency,
  type MissingImport,
} from './smart-imports.js';

export {
  SmartExportsTool,
  getSmartExportsTool,
  runSmartExports,
  SMART_EXPORTS_TOOL_DEFINITION,
  type SmartExportsOptions,
  type SmartExportsResult,
  type ExportInfo,
  type ExportOptimization,
  type ExportDependency,
} from './smart-exports.js';

export {
  SmartSymbolsTool,
  getSmartSymbolsTool,
  runSmartSymbols,
  SMART_SYMBOLS_TOOL_DEFINITION,
  type SmartSymbolsOptions,
  type SmartSymbolsResult,
  type SymbolInfo,
} from './smart-symbols.js';

// STILL DEFERRED (see smart-typescript.ts's own header): its output IS
// type-check diagnostics from the classic Compiler API's real type
// checker (`ts.createProgram` + `getSemanticDiagnostics` +
// `getTypeChecker`), which `@babel/parser` -- a syntax-only parser -- has
// no honest substitute for. File remains on disk, path-reconciled and with
// the same projectRoot-staleness fix already applied, but not exported
// here, not wired into server.ts, and still excluded from tsconfig.json's
// compile graph.
