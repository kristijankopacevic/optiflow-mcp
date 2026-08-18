/**
 * Smart Symbols Tool - Symbol Extraction with Caching
 *
 * Extracts and analyzes TypeScript/JavaScript symbols with intelligent caching:
 * - Identifies all declarations (variables, functions, classes, interfaces, types, enums)
 * - Tracks scope, exports, and documentation
 * - Git-aware cache invalidation
 * - 75-85% token reduction through summarization
 *
 * BABEL PORT (see code-analysis/index.ts's header "THE BLOCKER") -- REAL
 * CAPABILITY LOSS, DOCUMENTED RATHER THAN APPROXIMATED:
 *
 * Declaration enumeration (name/kind/location/scope/exported) is pure
 * syntax and ports faithfully. Two fields the original computed via
 * `ts.createLanguageService(...).getProgram()!.getTypeChecker()` do NOT:
 *
 * - `type` (via `typeChecker.getTypeOfSymbolAtLocation` +
 *   `typeChecker.typeToString`): resolving a declaration's TYPE requires a
 *   type checker. `@babel/parser` produces a syntax tree only. This field
 *   is REMOVED (not approximated from syntax -- e.g. inferring "probably a
 *   string" from a literal initializer would be a real, if crude, syntax
 *   fact; resolving an arbitrary declaration's full inferred/annotated
 *   type is not, and this port does not fabricate one).
 * - `references` (via `languageService.findReferences`, which is
 *   scope-aware -- it does not count an unrelated same-named identifier in
 *   a different scope, or a shadowed variable, as a reference to THIS
 *   declaration): a same-name-text occurrence count would silently
 *   overcount shadowed/unrelated symbols and present a number that LOOKS
 *   like a scope-resolved reference count but isn't. Per this checkpoint's
 *   explicit instruction not to "claim to resolve" what was only
 *   inferred, this field is REMOVED rather than replaced with a misleading
 *   approximation.
 *
 * `documentation` (JSDoc comment text) IS kept: Babel attaches
 * `leadingComments` to the enclosing declaration node as a genuine syntax
 * fact (a comment block immediately preceding a declaration), not
 * something inferred -- the same class of fact as the interface/kind
 * fields already extracted from AST shape.
 *
 * `SMART_SYMBOLS_TOOL_DEFINITION.description` and this class's own JSDoc
 * are updated below to match (no longer promising type/reference
 * information this port cannot honestly produce).
 */

import { CacheEngine } from '../../core/cache-engine.js';
import { MetricsCollector } from '../../core/metrics.js';
import { TokenCounter } from '../../core/token-counter.js';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { parse } from '@babel/parser';
// PATH RECONCILIATION (see src/optimizer/paths.ts's header): vendor's CLI
// default here was `join(homedir(), '.hypercontext', 'cache')` -- replaced
// with optiflow's own `~/.optiflow/optimizer/cache` convention.
import { getOptimizerCacheDbPath } from '../../paths.js';
import { type AnyNode, walk, forEachChild, locOf } from './babel-ast-utils.js';

function parseSource(content: string): AnyNode {
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
  return ast.program as unknown as AnyNode;
}

/**
 * A JSDoc-style leading block comment immediately preceding `node`, as
 * genuine syntax (a comment block is either there or it isn't) rather than
 * the classic API's `symbol.getDocumentationComment(checker)` (which is
 * itself just reading the same source comments, resolved via the symbol
 * table instead of AST position -- same underlying fact, different
 * plumbing to reach it).
 */
function extractDocComment(node: AnyNode): string | undefined {
  const comments = node.leadingComments as
    | Array<{ type: string; value: string }>
    | undefined;
  if (!comments || comments.length === 0) return undefined;
  const last = comments[comments.length - 1];
  if (last.type !== 'CommentBlock') return undefined;
  const text = last.value
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return text.length > 0 ? text : undefined;
}

export interface SmartSymbolsOptions {
  /**
   * File path to analyze
   */
  filePath: string;

  /**
   * Types of symbols to extract (default: all)
   */
  symbolTypes?: Array<
    'variable' | 'function' | 'class' | 'interface' | 'type' | 'enum'
  >;

  /**
   * Include only exported symbols
   */
  includeExported?: boolean;

  /**
   * Include imported symbols
   */
  includeImported?: boolean;

  /**
   * Project root directory
   */
  projectRoot?: string;

  /**
   * Force re-extraction (ignore cache)
   */
  force?: boolean;

  /**
   * Maximum cache age in seconds (default: 300)
   */
  maxCacheAge?: number;
}

export interface SymbolInfo {
  name: string;
  kind:
    | 'variable'
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'method'
    | 'property'
    | 'parameter';
  location: { line: number; column: number };
  scope: 'global' | 'module' | 'block' | 'function' | 'class';
  exported: boolean;
  documentation?: string;
  // `type` (resolved via the classic Compiler API's TypeChecker) and
  // `references` (via the LanguageService's scope-aware findReferences)
  // are DELIBERATELY ABSENT, not approximated -- see this file's
  // top-of-file BABEL PORT comment for exactly why.
}

export interface SmartSymbolsResult {
  /**
   * Summary information
   */
  summary: {
    file: string;
    totalSymbols: number;
    byKind: Record<string, number>;
    exportedCount: number;
    fromCache: boolean;
    duration: number;
  };

  /**
   * Extracted symbols
   */
  symbols: SymbolInfo[];

  /**
   * Import information (if includeImported is true)
   */
  imports?: Array<{
    module: string;
    symbols: string[];
  }>;

  /**
   * Token reduction metrics
   */
  metrics: {
    originalTokens: number;
    compactedTokens: number;
    reductionPercentage: number;
  };
}

export class SmartSymbolsTool {
  private cache: CacheEngine;
  private metrics: MetricsCollector;
  private cacheNamespace = 'smart_symbols';
  private projectRoot: string;
  private readonly defaultProjectRoot: string;

  constructor(
    cache: CacheEngine,
    _tokenCounter: TokenCounter,
    metrics: MetricsCollector,
    projectRoot?: string
  ) {
    this.cache = cache;
    this.metrics = metrics;
    this.defaultProjectRoot = projectRoot || process.cwd();
    this.projectRoot = this.defaultProjectRoot;
  }

  /**
   * Extract symbols from a TypeScript/JavaScript file
   */
  async run(options: SmartSymbolsOptions): Promise<SmartSymbolsResult> {
    // Honor a per-call projectRoot -- see smart-typescript.ts's identical
    // comment; this class's `run()` never read `options.projectRoot` before
    // this fix, silently ignoring the schema's advertised option once the
    // MCP server constructed this tool as a shared singleton.
    this.projectRoot = options.projectRoot || this.defaultProjectRoot;
    const {
      filePath,
      symbolTypes,
      includeExported = false,
      includeImported = false,
      force = false,
      maxCacheAge = 300,
    } = options;

    const startTime = Date.now();
    // An ABSOLUTE filePath must be used as given.
    // join(projectRoot, filePath) on an absolute path produces nonsense --
    // a project root with a drive letter glued onto it -- and the tool then
    // reports "File not found" for a file that is plainly there. Measured
    // live: every call with an absolute path failed exactly this way.
    const absolutePath = isAbsolute(filePath)
      ? filePath
      : join(this.projectRoot, filePath);

    // Validate file exists
    if (!existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    // Generate cache key
    const cacheKey = await this.generateCacheKey(
      absolutePath,
      symbolTypes,
      includeExported,
      includeImported
    );

    // Check cache first (unless force mode)
    if (!force) {
      const cached = this.getCachedResult(cacheKey, maxCacheAge);
      if (cached) {
        this.metrics.record({
          operation: 'smart_symbols',
          duration: Date.now() - startTime,
          success: true,
          cacheHit: true,
          inputTokens: cached.metrics.originalTokens,
          savedTokens:
            cached.metrics.originalTokens - cached.metrics.compactedTokens,
        });

        return cached;
      }
    }

    // Parse file and extract symbols. See this file's top-of-file BABEL
    // PORT comment: unlike ts.createSourceFile, this throws on malformed
    // syntax rather than silently recovering; there is no language
    // service/type checker here at all (see the same comment for exactly
    // which fields that removes: `type` and `references`).
    const program = parseSource(readFileSync(absolutePath, 'utf-8'));

    // Extract symbols
    const symbols = this.extractSymbols(program, symbolTypes, includeExported);

    // Extract imports if requested
    const imports = includeImported
      ? this.extractImports(program)
      : undefined;

    // Build result
    const byKind: Record<string, number> = {};
    symbols.forEach((sym) => {
      byKind[sym.kind] = (byKind[sym.kind] || 0) + 1;
    });

    const exportedCount = symbols.filter((s) => s.exported).length;

    const duration = Date.now() - startTime;

    const result: SmartSymbolsResult = {
      summary: {
        file: relative(this.projectRoot, absolutePath),
        totalSymbols: symbols.length,
        byKind,
        exportedCount,
        fromCache: false,
        duration,
      },
      symbols,
      imports,
      metrics: this.calculateMetrics(symbols, imports),
    };

    // Cache the result
    this.cacheResult(cacheKey, result);

    // Record metrics
    this.metrics.record({
      operation: 'smart_symbols',
      duration,
      success: true,
      cacheHit: false,
      inputTokens: result.metrics.originalTokens,
      savedTokens:
        result.metrics.originalTokens - result.metrics.compactedTokens,
    });

    return result;
  }

  /**
   * Create language service host for reference counting
   */
  /**
   * Extract symbols from source file
   */
  private extractSymbols(
    program: AnyNode,
    symbolTypes?: string[],
    includeExported = false
  ): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const allTypes = new Set(
      symbolTypes || [
        'variable',
        'function',
        'class',
        'interface',
        'type',
        'enum',
      ]
    );

    // `commentSource` is the node leading comments actually attach to --
    // for an exported declaration that's the ExportNamedDeclaration/
    // ExportDefaultDeclaration WRAPPER, not the unwrapped declaration
    // itself (see this file's top-of-file BABEL PORT comment).
    const visit = (
      node: AnyNode,
      scope: SymbolInfo['scope'] = 'module',
      exportedOverride?: boolean,
      commentSource?: AnyNode
    ): void => {
      // Unwrap Babel's export wrapper nodes (the classic API instead put
      // an ExportKeyword modifier directly on the declaration, checked
      // below via `exportedOverride`) and recurse into the real
      // declaration once, carrying the wrapper as the comment source.
      if (
        (node.type === 'ExportNamedDeclaration' ||
          node.type === 'ExportDefaultDeclaration') &&
        node.declaration
      ) {
        visit(node.declaration, scope, true, node);
        return;
      }

      const exported = exportedOverride ?? false;
      const docNode = commentSource ?? node;

      // Variables
      if (allTypes.has('variable') && node.type === 'VariableDeclaration') {
        if (!includeExported || exported) {
          for (const decl of node.declarations) {
            if (decl.id?.type === 'Identifier') {
              symbols.push(
                this.createSymbolInfo(
                  decl.id,
                  'variable',
                  docNode,
                  scope,
                  exported
                )
              );
            }
          }
        }
      }

      // Functions
      if (
        allTypes.has('function') &&
        node.type === 'FunctionDeclaration' &&
        node.id
      ) {
        if (!includeExported || exported) {
          symbols.push(
            this.createSymbolInfo(node.id, 'function', docNode, scope, exported)
          );
        }
      }

      // Classes
      if (allTypes.has('class') && node.type === 'ClassDeclaration' && node.id) {
        if (!includeExported || exported) {
          symbols.push(
            this.createSymbolInfo(node.id, 'class', docNode, scope, exported)
          );

          // Extract class members. Babel splits TS's single
          // `MethodDeclaration`/`PropertyDeclaration` into `ClassMethod`/
          // `ClassProperty` (`ClassProperty` is parsed under the
          // `typescript` plugin as `ClassProperty` for JS-style fields;
          // TS-specific field declarations parse as the same node type).
          for (const member of node.body?.body || []) {
            if (
              (member.type === 'ClassMethod' ||
                member.type === 'ClassProperty') &&
              member.key?.type === 'Identifier'
            ) {
              const kind = member.type === 'ClassMethod' ? 'method' : 'property';
              symbols.push(
                this.createSymbolInfo(member.key, kind, member, 'class', false)
              );
            }
          }
        }
      }

      // Interfaces
      if (allTypes.has('interface') && node.type === 'TSInterfaceDeclaration') {
        if (!includeExported || exported) {
          symbols.push(
            this.createSymbolInfo(node.id, 'interface', docNode, scope, exported)
          );
        }
      }

      // Type Aliases
      if (allTypes.has('type') && node.type === 'TSTypeAliasDeclaration') {
        if (!includeExported || exported) {
          symbols.push(
            this.createSymbolInfo(node.id, 'type', docNode, scope, exported)
          );
        }
      }

      // Enums
      if (allTypes.has('enum') && node.type === 'TSEnumDeclaration') {
        if (!includeExported || exported) {
          symbols.push(
            this.createSymbolInfo(node.id, 'enum', docNode, scope, exported)
          );
        }
      }

      // Update scope for nested nodes. Matches the original's exact
      // coverage: FunctionDeclaration/MethodDeclaration/ArrowFunction only
      // -- plain (non-method) FunctionExpression was never included
      // either, preserved as-is.
      let newScope = scope;
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'ClassMethod' ||
        node.type === 'ObjectMethod' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        newScope = 'function';
      } else if (node.type === 'ClassDeclaration') {
        newScope = 'class';
      } else if (node.type === 'BlockStatement') {
        newScope = 'block';
      }

      forEachChild(node, (child) => visit(child, newScope));
    };

    visit(program);
    return symbols;
  }

  /**
   * Create symbol info from identifier. Does NOT resolve `type` or
   * `references` -- see this file's top-of-file BABEL PORT comment for
   * exactly why those fields are gone rather than approximated.
   */
  private createSymbolInfo(
    identifier: AnyNode,
    kind: SymbolInfo['kind'],
    docNode: AnyNode,
    scope: SymbolInfo['scope'],
    exported: boolean
  ): SymbolInfo {
    return {
      name: identifier.name as string,
      kind,
      location: locOf(identifier),
      scope,
      exported,
      documentation: extractDocComment(docNode),
    };
  }

  /**
   * Extract imports from source file
   */
  private extractImports(
    program: AnyNode
  ): Array<{ module: string; symbols: string[] }> {
    const imports: Array<{ module: string; symbols: string[] }> = [];

    walk(program, (node) => {
      if (node.type !== 'ImportDeclaration') return;
      const moduleSpecifier = node.source;
      if (moduleSpecifier?.type !== 'StringLiteral') return;

      const symbols: string[] = [];
      for (const spec of node.specifiers || []) {
        if (
          spec.type === 'ImportDefaultSpecifier' ||
          spec.type === 'ImportNamespaceSpecifier'
        ) {
          symbols.push(spec.local.name);
        } else if (spec.type === 'ImportSpecifier') {
          symbols.push(spec.local.name);
        }
      }

      imports.push({ module: moduleSpecifier.value as string, symbols });
    });

    return imports;
  }

  /**
   * Calculate token reduction metrics
   */
  private calculateMetrics(
    symbols: SymbolInfo[],
    imports?: Array<{ module: string; symbols: string[] }>
  ): {
    originalTokens: number;
    compactedTokens: number;
    reductionPercentage: number;
  } {
    // Original: Full symbol details with docs (no `type`/`references` --
    // see this file's top-of-file BABEL PORT comment for why those two
    // fields no longer exist to size here).
    let originalSize = 0;
    symbols.forEach((sym) => {
      originalSize += 100; // Base symbol info
      originalSize += sym.documentation?.length || 0;
      originalSize += 20; // Location, scope, etc.
    });

    if (imports) {
      imports.forEach((imp) => {
        originalSize += 50 + imp.symbols.join(', ').length;
      });
    }

    // Compacted: Summary + symbol names only
    const summarySize = 200;
    const symbolListSize = symbols.map((s) => s.name).join(', ').length;
    const compactedSize = summarySize + symbolListSize;

    const originalTokens = Math.ceil(originalSize / 4);
    const compactedTokens = Math.ceil(compactedSize / 4);

    return {
      originalTokens,
      compactedTokens,
      reductionPercentage: Math.round(
        ((originalTokens - compactedTokens) / originalTokens) * 100
      ),
    };
  }

  /**
   * Generate cache key
   */
  private async generateCacheKey(
    filePath: string,
    symbolTypes?: string[],
    includeExported = false,
    includeImported = false
  ): Promise<string> {
    const hash = createHash('sha256');
    hash.update(this.cacheNamespace);
    hash.update(filePath);

    // Hash file content
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      hash.update(content);
    }

    // Hash options
    hash.update(
      JSON.stringify({
        symbolTypes: symbolTypes?.sort(),
        includeExported,
        includeImported,
      })
    );

    return `${this.cacheNamespace}:${hash.digest('hex')}`;
  }

  /**
   * Get cached result if available and fresh
   */
  private getCachedResult(
    key: string,
    maxAge: number
  ): SmartSymbolsResult | null {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    try {
      const result = JSON.parse(cached) as SmartSymbolsResult & {
        cachedAt: number;
      };
      const age = (Date.now() - result.cachedAt) / 1000;

      if (age <= maxAge) {
        result.summary.fromCache = true;
        return result;
      }
    } catch (err) {
      return null;
    }

    return null;
  }

  /**
   * Cache result
   */
  private cacheResult(key: string, result: SmartSymbolsResult): void {
    const toCache = {
      ...result,
      cachedAt: Date.now(),
    };

    const json = JSON.stringify(toCache);
    const originalSize = Buffer.byteLength(json, 'utf-8');
    const compressedSize = Math.ceil(originalSize * 0.3);

    this.cache.set(key, json, originalSize, compressedSize);
  }

  /**
   * Close cache and cleanup
   */
  close(): void {
    this.cache.close();
  }
}

/**
 * Factory function for getting tool instance
 */
export function getSmartSymbolsTool(
  cache: CacheEngine,
  tokenCounter: TokenCounter,
  metrics: MetricsCollector
): SmartSymbolsTool {
  return new SmartSymbolsTool(cache, tokenCounter, metrics);
}

/**
 * Standalone function for symbol extraction
 */
export async function runSmartSymbols(
  options: SmartSymbolsOptions,
  cache?: CacheEngine,
  tokenCounter?: TokenCounter,
  metrics?: MetricsCollector
): Promise<string> {
  // WHOEVER MAKES THE CACHE CLOSES IT.
  //
  // This closed `cacheInstance` in a `finally` regardless of where it came
  // from. As a CLI that is right; as an MCP handler it is fatal, because the
  // server passes its ONE shared CacheEngine to every tool. Proven live: a
  // single smart_symbols call closed that handle and every subsequent
  // tools/call in the process failed with "The database connection is not
  // open" -- twenty tools down from one call, until the server was restarted.
  const ownsCache = !cache;
  const cacheInstance =
    cache || new CacheEngine(getOptimizerCacheDbPath(), 100);
  const tokenCounterInstance = tokenCounter || new TokenCounter();
  const metricsInstance = metrics || new MetricsCollector();

  const tool = getSmartSymbolsTool(
    cacheInstance,
    tokenCounterInstance,
    metricsInstance
  );
  try {
    const result = await tool.run(options);

    let output = `\n🔍 Smart Symbols Analysis ${result.summary.fromCache ? '(cached)' : ''}\n`;
    output += `${'='.repeat(60)}\n\n`;

    // Summary
    output += `File: ${result.summary.file}\n`;
    output += `Total Symbols: ${result.summary.totalSymbols}\n`;
    output += `Exported: ${result.summary.exportedCount}\n`;
    output += `Duration: ${result.summary.duration}ms\n\n`;

    // By kind
    output += `Symbols by Kind:\n`;
    Object.entries(result.summary.byKind).forEach(([kind, count]) => {
      output += `  ${kind}: ${count}\n`;
    });
    output += '\n';

    // Top symbols
    const topSymbols = result.symbols.slice(0, 10);
    if (topSymbols.length > 0) {
      output += `Top Symbols (showing ${topSymbols.length} of ${result.symbols.length}):\n`;
      topSymbols.forEach((sym) => {
        const exportMark = sym.exported ? ' [exported]' : '';
        output += `  ${sym.kind} ${sym.name}${exportMark}\n`;
        output += `    Location: line ${sym.location.line}, scope: ${sym.scope}\n`;
        if (sym.documentation) {
          const doc = sym.documentation.split('\n')[0];
          output += `    Doc: ${doc.slice(0, 60)}${doc.length > 60 ? '...' : ''}\n`;
        }
      });
      output += '\n';
    }

    // Imports
    if (result.imports && result.imports.length > 0) {
      output += `Imports:\n`;
      result.imports.forEach((imp) => {
        output += `  from "${imp.module}": ${imp.symbols.join(', ')}\n`;
      });
      output += '\n';
    }

    // Metrics
    output += `Token Reduction:\n`;
    output += `  Original: ${result.metrics.originalTokens} tokens\n`;
    output += `  Compacted: ${result.metrics.compactedTokens} tokens\n`;
    output += `  Reduction: ${result.metrics.reductionPercentage}%\n`;

    return output;
  } finally {
    // Only a cache this function created is a cache this function may close.
    if (ownsCache) tool.close();
  }
}

// MCP Tool definition
export const SMART_SYMBOLS_TOOL_DEFINITION = {
  name: 'smart_symbols',
  // NOT "type, and reference information" -- see this file's top-of-file
  // BABEL PORT comment: resolving a declaration's type or scope-aware
  // reference count needs a type checker, which this Babel-based port
  // does not have. This tool reports name/kind/location/scope/exported/
  // documentation only.
  description:
    'Extract and analyze TypeScript/JavaScript symbols with scope, export status, and JSDoc documentation (75-85% token reduction). Does NOT resolve types or reference counts (no type checker).',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'File path to analyze (relative to project root)',
      },
      symbolTypes: {
        type: 'array',
        description: 'Types of symbols to extract (default: all)',
        items: {
          type: 'string',
          enum: ['variable', 'function', 'class', 'interface', 'type', 'enum'],
        },
      },
      includeExported: {
        type: 'boolean',
        description: 'Include only exported symbols',
        default: false,
      },
      includeImported: {
        type: 'boolean',
        description: 'Include import information',
        default: false,
      },
      projectRoot: {
        type: 'string',
        description: 'Project root directory',
      },
      force: {
        type: 'boolean',
        description: 'Force re-extraction (ignore cache)',
        default: false,
      },
      maxCacheAge: {
        type: 'number',
        description: 'Maximum cache age in seconds (default: 300)',
        default: 300,
      },
    },
    required: ['filePath'],
  },
};
