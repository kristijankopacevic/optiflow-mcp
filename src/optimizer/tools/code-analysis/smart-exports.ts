/**
 * Smart Exports Tool
 *
 * Analyzes TypeScript/JavaScript export statements with intelligent caching.
 * Provides export tracking, unused export detection, and optimization suggestions.
 *
 * Token Reduction: 75-85% through summarization of export analysis
 *
 * BABEL PORT (see code-analysis/index.ts's header "THE BLOCKER"): export
 * statements are a pure syntax-level concept, so this is a faithful,
 * no-capability-loss port to `@babel/parser` + the manual
 * `@babel/types`-`VISITOR_KEYS` walk in ./babel-ast-utils.ts. Same
 * malformed-syntax difference as the other ported files in this directory
 * (throws instead of `ts.createSourceFile`'s silent recovery).
 *
 * Real AST-SHAPE difference worth documenting precisely (see advisor trap
 * #4/#5 from this checkpoint's own review): the classic Compiler API
 * represents an exported declaration (`export function f() {}`) as the
 * SAME node kind as a non-exported one, with an `ExportKeyword` (and,
 * for defaults, also a `DefaultKeyword`) MODIFIER attached directly to
 * it -- `export default function foo() {}` keeps its own
 * `FunctionDeclaration` kind, name and all. Babel/ESTree instead wraps
 * exported declarations in a separate `ExportNamedDeclaration` /
 * `ExportDefaultDeclaration` PARENT node holding the real declaration in
 * `.declaration`. Because of this, the classic API's `export default
 * expr;` (e.g. `export default 42;`) and TypeScript's CommonJS-style
 * `export = expr;` are BOTH represented as one node kind
 * (`ts.isExportAssignment`, distinguished only by an `isExportEquals`
 * flag the original code never actually checked -- it reported both
 * identically as `{ type: 'default', name: 'default', kind:
 * 'expression' }`). Babel gives these two constructs genuinely different
 * node types (`TSExportAssignment` vs. `ExportDefaultDeclaration` with a
 * non-declaration `.declaration`). This port keeps the ORIGINAL's
 * observable output for both (same `{ type: 'default', name: 'default',
 * kind: 'expression' }` shape) even though two different Babel node types
 * feed into it now -- preserving behavior, not the original's (arguably
 * accidental) AST-shape conflation.
 *
 * Also preserved as-is (not silently "fixed"): the original silently
 * DROPPED anonymous default exports of functions/classes (`export default
 * function () {}` / `export default class {}`) because its `if (name)`
 * gate at the end of that branch never fires when there's no `.name`.
 * Same drop happens here for the same reason (`declaration.id` is `null`
 * for those Babel nodes too).
 */

import { parse } from '@babel/parser';
import { createHash } from 'crypto';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { CacheEngine } from '../../core/cache-engine.js';
import { MetricsCollector } from '../../core/metrics.js';
import { TokenCounter } from '../../core/token-counter.js';
// PATH RECONCILIATION (see src/optimizer/paths.ts's header): vendor's CLI
// default here was `join(homedir(), '.hypercontext', 'cache')` -- replaced
// with optiflow's own `~/.optiflow/optimizer/cache` convention.
import { getOptimizerCacheDbPath } from '../../paths.js';
import { type AnyNode, walk, locOf } from './babel-ast-utils.js';

function parseSource(content: string): AnyNode {
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
  return ast.program as unknown as AnyNode;
}

/**
 * Export statement information
 */
export interface ExportInfo {
  /** Type of export: named, default, namespace, reexport */
  type: 'named' | 'default' | 'namespace' | 'reexport';
  /** Name of the exported symbol */
  name: string;
  /** Original name if aliased */
  originalName?: string;
  /** Module being re-exported from (for re-exports) */
  fromModule?: string;
  /** Location in source file */
  location: {
    line: number;
    column: number;
  };
  /** Symbol kind (variable, function, class, etc.) */
  kind?: string;
  /** Whether export is used (imported elsewhere) */
  used?: boolean;
  /** TypeScript type information */
  typeInfo?: string;
}

/**
 * Export optimization suggestion
 */
export interface ExportOptimization {
  /** Type of optimization */
  type:
    | 'remove-unused'
    | 'consolidate-exports'
    | 'barrel-file'
    | 'export-organization';
  /** Severity level */
  severity: 'info' | 'warning' | 'error';
  /** Human-readable message */
  message: string;
  /** Specific suggestion */
  suggestion: string;
  /** Location in source file */
  location?: {
    line: number;
    column: number;
  };
  /** Code example */
  codeExample?: {
    before: string;
    after: string;
  };
  /** Impact analysis */
  impact?: {
    readability?: 'low' | 'medium' | 'high';
    maintainability?: 'low' | 'medium' | 'high';
    treeShaking?: 'low' | 'medium' | 'high';
  };
}

/**
 * Export dependency information
 */
export interface ExportDependency {
  /** File that imports this export */
  importingFile: string;
  /** Exported symbol being imported */
  symbol: string;
  /** How it's imported (named, default, namespace) */
  importType: 'named' | 'default' | 'namespace';
}

/**
 * Smart exports analysis result
 */
export interface SmartExportsResult {
  /** All exports found */
  exports: ExportInfo[];
  /** Unused exports detected */
  unusedExports: ExportInfo[];
  /** Export dependencies (what imports these exports) */
  dependencies: ExportDependency[];
  /** Optimization suggestions */
  optimizations: ExportOptimization[];
  /** Summary statistics */
  summary: {
    totalExports: number;
    namedExports: number;
    defaultExports: number;
    reexports: number;
    unusedCount: number;
    dependencyCount: number;
  };
  /** Cache metadata */
  cached: boolean;
  cacheAge?: number;
}

/**
 * Options for smart exports analysis
 */
export interface SmartExportsOptions {
  /** File path to analyze */
  filePath?: string;
  /** File content (if not reading from disk) */
  fileContent?: string;
  /** Project root directory */
  projectRoot?: string;
  /** Force analysis even if cached */
  force?: boolean;
  /** Maximum cache age in seconds */
  maxCacheAge?: number;
  /** Check usage across project */
  checkUsage?: boolean;
  /** Scan depth for checking usage (number of directories) */
  scanDepth?: number;
}

/**
 * Smart Exports Tool
 * Analyzes export statements with caching
 */
export class SmartExportsTool {
  private cache: CacheEngine;
  private metrics: MetricsCollector;
  private tokenCounter: TokenCounter;
  private cacheNamespace = 'smart_exports';
  private projectRoot: string;

  constructor(
    cache: CacheEngine,
    tokenCounter: TokenCounter,
    metrics: MetricsCollector,
    projectRoot?: string
  ) {
    this.cache = cache;
    this.tokenCounter = tokenCounter;
    this.metrics = metrics;
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Run smart exports analysis
   */
  async run(options: SmartExportsOptions = {}): Promise<SmartExportsResult> {
    const startTime = Date.now();
    const {
      filePath,
      fileContent,
      projectRoot = this.projectRoot,
      force = false,
      maxCacheAge = 300,
      checkUsage = false,
      scanDepth = 3,
    } = options;

    // Get file content
    let content: string;
    let fileName: string;

    if (fileContent) {
      content = fileContent;
      fileName = 'inline.ts';
    } else if (filePath) {
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      content = readFileSync(filePath, 'utf-8');
      fileName = filePath;
    } else {
      throw new Error('Either filePath or fileContent must be provided');
    }

    // Generate cache key
    const cacheKey = await this.generateCacheKey(content, {
      checkUsage,
      scanDepth,
      projectRoot,
    });

    // Check cache
    if (!force) {
      const cached = this.getCachedResult(cacheKey, maxCacheAge);
      if (cached) {
        const duration = Date.now() - startTime;
        this.metrics.record({
          operation: 'smart_exports',
          duration,
          cacheHit: true,
          savedTokens: cached.originalTokens || 0,
          success: true,
        });
        return {
          ...cached.result,
          cached: true,
          cacheAge: Date.now() - cached.timestamp,
        };
      }
    }

    // Parse file. See this file's top-of-file BABEL PORT comment: unlike
    // ts.createSourceFile, this throws on malformed syntax rather than
    // silently recovering.
    const program = parseSource(content);
    void fileName; // no longer needed for parsing; kept for branch parity

    // Analyze exports
    const exports = this.extractExports(program);
    const dependencies =
      checkUsage && filePath
        ? this.findExportDependencies(filePath, exports, projectRoot, scanDepth)
        : [];
    const unusedExports = checkUsage
      ? this.detectUnusedExports(exports, dependencies)
      : [];
    const optimizations = this.generateOptimizations(exports);

    // Build result
    const result: SmartExportsResult = {
      exports,
      unusedExports,
      dependencies,
      optimizations,
      summary: {
        totalExports: exports.length,
        namedExports: exports.filter((e) => e.type === 'named').length,
        defaultExports: exports.filter((e) => e.type === 'default').length,
        reexports: exports.filter((e) => e.type === 'reexport').length,
        unusedCount: unusedExports.length,
        dependencyCount: dependencies.length,
      },
      cached: false,
    };

    // Calculate token metrics
    const fullOutput = JSON.stringify(result, null, 2);
    const compactOutput = this.compactResult(result);
    const originalTokens = this.tokenCounter.count(fullOutput).tokens;
    const compactedTokens = this.tokenCounter.count(compactOutput).tokens;

    // Cache result
    this.cacheResult(cacheKey, result, originalTokens, compactedTokens);

    // Record metrics
    const duration = Date.now() - startTime;
    this.metrics.record({
      operation: 'smart_exports',
      duration,
      cacheHit: false,
      inputTokens: originalTokens,
      cachedTokens: compactedTokens,
      savedTokens: originalTokens - compactedTokens,
      success: true,
    });

    return result;
  }

  /**
   * Extract export statements from source file
   */
  private extractExports(program: AnyNode): ExportInfo[] {
    const exports: ExportInfo[] = [];

    walk(program, (node) => {
      // `export = something` (TS CommonJS-style export assignment). See
      // this file's top-of-file BABEL PORT comment for why this and
      // `export default <non-declaration expr>` deliberately produce the
      // SAME output shape below, matching the classic API's original
      // (accidental) conflation of the two.
      if (node.type === 'TSExportAssignment') {
        exports.push({
          type: 'default',
          name: 'default',
          location: locOf(node),
          kind: 'expression',
        });
        return;
      }

      // `export default ...`
      if (node.type === 'ExportDefaultDeclaration') {
        const decl = node.declaration;
        const pos = locOf(node);

        if (decl?.type === 'FunctionDeclaration' || decl?.type === 'ClassDeclaration') {
          const name = decl.id?.name;
          // Anonymous default function/class exports are silently dropped
          // here, matching the original's `if (name)` gate -- see this
          // file's top-of-file BABEL PORT comment.
          if (name) {
            exports.push({
              type: 'default',
              name,
              location: pos,
              kind: decl.type === 'FunctionDeclaration' ? 'function' : 'class',
            });
          }
        } else {
          // `export default <expr>` -- same bucket as `export = expr`.
          exports.push({
            type: 'default',
            name: 'default',
            location: pos,
            kind: 'expression',
          });
        }
        return;
      }

      // `export const/function/class/interface/type/enum ...` (non-default
      // -- Babel never wraps a default export in ExportNamedDeclaration).
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        const decl = node.declaration;
        const pos = locOf(node);

        if (decl.type === 'VariableDeclaration') {
          for (const varDecl of decl.declarations) {
            if (varDecl.id?.type === 'Identifier') {
              exports.push({
                type: 'named',
                name: varDecl.id.name,
                location: pos,
                kind: 'variable',
              });
            }
          }
          return;
        }

        const KIND_BY_TYPE: Record<string, string> = {
          FunctionDeclaration: 'function',
          ClassDeclaration: 'class',
          TSInterfaceDeclaration: 'interface',
          TSTypeAliasDeclaration: 'type',
          TSEnumDeclaration: 'enum',
        };
        const kind = KIND_BY_TYPE[decl.type];
        const name = decl.id?.name;
        if (kind && name) {
          exports.push({
            type: 'named',
            name,
            location: pos,
            kind,
          });
        }
        return;
      }

      // `export { a, b as c } [from 'module']` / `export * as ns from
      // 'module'` -- Babel represents both as ExportNamedDeclaration
      // WITHOUT a `.declaration`, distinguished by specifier node type.
      if (node.type === 'ExportNamedDeclaration' && !node.declaration) {
        const pos = locOf(node);
        const fromModule =
          node.source?.type === 'StringLiteral' ? node.source.value : undefined;

        for (const spec of node.specifiers || []) {
          if (spec.type === 'ExportSpecifier') {
            // Babel's `.exported` is the PUBLIC name (ts's element.name);
            // `.local` is the original/local name (ts's element.propertyName,
            // only reported when it differs from the exported name).
            const name =
              spec.exported?.type === 'Identifier'
                ? spec.exported.name
                : spec.exported?.value;
            const localName = spec.local?.name;
            exports.push({
              type: fromModule ? 'reexport' : 'named',
              name,
              originalName:
                localName && localName !== name ? localName : undefined,
              fromModule,
              location: pos,
              kind: fromModule ? 'reexport' : 'named',
            });
          } else if (spec.type === 'ExportNamespaceSpecifier' && fromModule) {
            exports.push({
              type: 'namespace',
              name: spec.exported?.name,
              fromModule,
              location: pos,
              kind: 'reexport',
            });
          }
        }
        return;
      }

      // `export * from 'module'` (bare, no `as`)
      if (node.type === 'ExportAllDeclaration') {
        const pos = locOf(node);
        if (node.source?.type === 'StringLiteral') {
          exports.push({
            type: 'namespace',
            name: '*',
            fromModule: node.source.value,
            location: pos,
            kind: 'reexport',
          });
        }
      }
    });

    return exports;
  }

  /**
   * Find files that import these exports
   */
  private findExportDependencies(
    filePath: string,
    exports: ExportInfo[],
    projectRoot: string,
    scanDepth: number
  ): ExportDependency[] {
    const dependencies: ExportDependency[] = [];

    // Scan project files
    const filesToScan = this.scanProjectFiles(projectRoot, scanDepth);

    for (const file of filesToScan) {
      if (file === filePath) continue;

      try {
        const content = readFileSync(file, 'utf-8');
        const program = parseSource(content);

        // Find imports from our file
        const imports = this.extractImportsFromFile(program, file, filePath);

        for (const imp of imports) {
          // Check if imported symbol matches our exports
          for (const exportInfo of exports) {
            if (imp.symbols.includes(exportInfo.name)) {
              dependencies.push({
                importingFile: file,
                symbol: exportInfo.name,
                importType: imp.type,
              });
            }
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return dependencies;
  }

  /**
   * Scan project files up to specified depth
   */
  private scanProjectFiles(
    dir: string,
    depth: number,
    currentDepth = 0
  ): string[] {
    if (currentDepth >= depth) {
      return [];
    }

    const files: string[] = [];

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        // Skip node_modules, .git, etc.
        if (
          entry === 'node_modules' ||
          entry === '.git' ||
          entry.startsWith('.')
        ) {
          continue;
        }

        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(
            ...this.scanProjectFiles(fullPath, depth, currentDepth + 1)
          );
        } else if (stat.isFile()) {
          // Only TypeScript/JavaScript files
          if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return files;
  }

  /**
   * Extract imports from a file that might import from our target file
   */
  private extractImportsFromFile(
    program: AnyNode,
    importingFile: string,
    targetFilePath: string
  ): Array<{ type: 'named' | 'default' | 'namespace'; symbols: string[] }> {
    const imports: Array<{
      type: 'named' | 'default' | 'namespace';
      symbols: string[];
    }> = [];

    walk(program, (node) => {
      if (node.type !== 'ImportDeclaration') return;
      const moduleSpecifier = node.source;
      if (moduleSpecifier?.type !== 'StringLiteral') return;

      const importPath = moduleSpecifier.value as string;

      // Check if this import is from our target file
      const resolved = this.resolveImportPath(
        importingFile,
        importPath,
        targetFilePath
      );

      if (!resolved) return;

      const symbols: string[] = [];
      let type: 'named' | 'default' | 'namespace' = 'named';

      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportDefaultSpecifier') {
          symbols.push(spec.local.name);
          type = 'default';
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          symbols.push(spec.local.name);
          type = 'namespace';
        } else if (spec.type === 'ImportSpecifier') {
          // The ORIGINAL exported name (ts's `propertyName?.text ||
          // name.text` -- propertyName only set when aliased, else falls
          // back to the local name, which is the same as the original
          // when there's no alias). Babel's `imported` is always populated
          // with exactly that value already.
          symbols.push(
            spec.imported?.type === 'Identifier'
              ? spec.imported.name
              : spec.imported?.value
          );
          type = 'named';
        }
      }

      if (symbols.length > 0) {
        imports.push({ type, symbols });
      }
    });

    return imports;
  }

  /**
   * Resolve import path to check if it matches target file
   */
  private resolveImportPath(
    importingFile: string,
    importPath: string,
    targetFilePath: string
  ): boolean {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const importingDir = importingFile.substring(
        0,
        importingFile.lastIndexOf('/') || importingFile.lastIndexOf('\\')
      );
      let resolved = join(importingDir, importPath);

      // Try different extensions
      const extensions = [
        '',
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '/index.ts',
        '/index.tsx',
        '/index.js',
        '/index.jsx',
      ];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (
          withExt === targetFilePath ||
          withExt.replace(/\\/g, '/') === targetFilePath.replace(/\\/g, '/')
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detect unused exports
   */
  private detectUnusedExports(
    exports: ExportInfo[],
    dependencies: ExportDependency[]
  ): ExportInfo[] {
    const unused: ExportInfo[] = [];
    const usedSymbols = new Set(dependencies.map((d) => d.symbol));

    for (const exp of exports) {
      if (!usedSymbols.has(exp.name) && exp.name !== 'default') {
        exp.used = false;
        unused.push(exp);
      } else {
        exp.used = true;
      }
    }

    return unused;
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizations(exports: ExportInfo[]): ExportOptimization[] {
    const optimizations: ExportOptimization[] = [];

    // Suggest barrel file for many exports
    if (exports.length > 10) {
      const namedExports = exports.filter((e) => e.type === 'named');
      if (namedExports.length > 7) {
        optimizations.push({
          type: 'barrel-file',
          severity: 'info',
          message: `File has ${namedExports.length} named exports. Consider using a barrel file (index.ts) to organize exports.`,
          suggestion:
            'Create an index.ts file that re-exports public API, keeping implementation details private.',
          codeExample: {
            before:
              'export const a = ...\nexport const b = ...\nexport const c = ...',
            after:
              "// In module.ts:\nconst a = ...\nconst b = ...\nexport { a, b };\n\n// In index.ts:\nexport { a, b } from './module.js';",
          },
          impact: {
            readability: 'high',
            maintainability: 'high',
            treeShaking: 'medium',
          },
        });
      }
    }

    // Check for mixed export styles
    const hasDefault = exports.some((e) => e.type === 'default');
    const hasNamed = exports.some((e) => e.type === 'named');

    if (hasDefault && hasNamed) {
      optimizations.push({
        type: 'export-organization',
        severity: 'info',
        message:
          'File uses both default and named exports. Consider using consistent export style.',
        suggestion:
          'Prefer named exports for better tree-shaking and explicit imports. Use default exports sparingly for main module exports.',
        impact: {
          readability: 'medium',
          treeShaking: 'medium',
        },
      });
    }

    // Consolidate scattered exports
    const exportLocations = exports.map((e) => e.location.line);
    const spread = Math.max(...exportLocations) - Math.min(...exportLocations);

    if (spread > 50 && exports.length > 5) {
      optimizations.push({
        type: 'consolidate-exports',
        severity: 'info',
        message:
          'Exports are scattered across file. Consider consolidating exports at the end.',
        suggestion:
          'Move all export statements to the bottom of the file for better visibility.',
        codeExample: {
          before:
            '// Scattered throughout file\nexport const a = ...\n// ... 50 lines ...\nexport const b = ...',
          after:
            '// At bottom of file\nconst a = ...;\nconst b = ...;\n\nexport { a, b };',
        },
        impact: {
          readability: 'high',
          maintainability: 'medium',
        },
      });
    }

    return optimizations;
  }

  /**
   * Generate cache key
   */
  private async generateCacheKey(
    content: string,
    options: {
      checkUsage?: boolean;
      scanDepth?: number;
      projectRoot?: string;
    }
  ): Promise<string> {
    const hash = createHash('sha256');
    hash.update(this.cacheNamespace);
    hash.update(content);
    hash.update(JSON.stringify(options));
    return `${this.cacheNamespace}:${hash.digest('hex')}`;
  }

  /**
   * Get cached result
   */
  private getCachedResult(
    cacheKey: string,
    maxAge: number
  ): {
    result: SmartExportsResult;
    timestamp: number;
    originalTokens?: number;
  } | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const data = JSON.parse(cached) as {
      result: SmartExportsResult;
      timestamp: number;
      originalTokens?: number;
    };

    const age = (Date.now() - data.timestamp) / 1000;
    if (age <= maxAge) {
      return data;
    }

    return null;
  }

  /**
   * Cache result
   */
  private cacheResult(
    cacheKey: string,
    result: SmartExportsResult,
    originalTokens?: number,
    compactedTokens?: number
  ): void {
    const toCache = {
      result,
      timestamp: Date.now(),
      originalTokens,
      compactedTokens,
    };
    const buffer = JSON.stringify(toCache);
    const tokensSaved =
      originalTokens && compactedTokens ? originalTokens - compactedTokens : 0;
    this.cache.set(cacheKey, buffer, 300, tokensSaved);
  }

  /**
   * Compact result for token efficiency
   */
  private compactResult(result: SmartExportsResult): string {
    const compact = {
      exp: result.exports.map((e) => ({
        t: e.type[0], // First letter: n/d/r
        n: e.name,
        k: e.kind,
        l: e.location.line,
        u: e.used,
      })),
      unu: result.unusedExports.map((e) => ({
        n: e.name,
        k: e.kind,
      })),
      dep: result.dependencies.map((d) => ({
        f: d.importingFile.split('/').pop(), // Just filename
        s: d.symbol,
      })),
      opt: result.optimizations.map((o) => ({
        t: o.type,
        m: o.message,
      })),
      sum: result.summary,
    };

    return JSON.stringify(compact);
  }
}

/**
 * Factory function for dependency injection
 */
export function getSmartExportsTool(
  cache: CacheEngine,
  tokenCounter: TokenCounter,
  metrics: MetricsCollector,
  projectRoot?: string
): SmartExportsTool {
  return new SmartExportsTool(cache, tokenCounter, metrics, projectRoot);
}

/**
 * Standalone function for CLI usage
 */
export async function runSmartExports(
  options: SmartExportsOptions
): Promise<SmartExportsResult> {
  const cache = new CacheEngine(getOptimizerCacheDbPath());
  const tokenCounter = new TokenCounter();
  const metrics = new MetricsCollector();
  const tool = getSmartExportsTool(
    cache,
    tokenCounter,
    metrics,
    options.projectRoot
  );
  return tool.run(options);
}

/**
 * MCP Tool Definition
 */
export const SMART_EXPORTS_TOOL_DEFINITION = {
  name: 'smart_exports',
  description:
    'Analyze TypeScript/JavaScript export statements with intelligent caching. Tracks exports, detects unused exports, and provides optimization suggestions. Achieves 75-85% token reduction through export analysis summarization.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the TypeScript/JavaScript file to analyze',
      },
      fileContent: {
        type: 'string',
        description: 'File content (alternative to filePath)',
      },
      projectRoot: {
        type: 'string',
        description:
          'Project root directory (default: current working directory)',
      },
      force: {
        type: 'boolean',
        description:
          'Force analysis even if cached result exists (default: false)',
        default: false,
      },
      maxCacheAge: {
        type: 'number',
        description: 'Maximum cache age in seconds (default: 300)',
        default: 300,
      },
      checkUsage: {
        type: 'boolean',
        description:
          'Check if exports are used across project (default: false)',
        default: false,
      },
      scanDepth: {
        type: 'number',
        description: 'Directory depth to scan when checking usage (default: 3)',
        default: 3,
      },
    },
  },
};
