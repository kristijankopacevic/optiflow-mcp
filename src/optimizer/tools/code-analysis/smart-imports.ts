/**
 * Smart Imports Tool
 *
 * Analyzes TypeScript/JavaScript import statements with intelligent caching.
 * Provides import optimization suggestions, unused import detection, and circular dependency analysis.
 *
 * Token Reduction: 75-85% through summarization of import analysis
 *
 * BABEL PORT (see code-analysis/index.ts's header "THE BLOCKER"): import/
 * require/dynamic-import statements are a pure syntax-level concept, so
 * this is a faithful, no-capability-loss port to `@babel/parser` + the
 * manual `@babel/types`-`VISITOR_KEYS` walk in ./babel-ast-utils.ts. Two
 * real, documented differences from the classic-API version:
 *
 * 1. `@babel/parser` throws on malformed syntax instead of
 *    `ts.createSourceFile`'s silent recovery (same difference already
 *    documented in smart-complexity.ts/smart-refactor.ts).
 * 2. `collectUsedSymbols`'s original filter (`ts.isImportSpecifier(parent)
 *    || ts.isImportClause(parent) || ts.isNamespaceImport(parent)`) relies
 *    on `node.parent`, which `ts.createSourceFile(..., true)` attaches
 *    automatically but `@babel/parser` never does. This port gets the same
 *    result WITHOUT parent pointers by collecting the exact import-binding
 *    Identifier node objects up front (`collectImportBindingIdentifiers`)
 *    and skipping those specific node references during the used-symbol
 *    walk -- same filtered set, verified by identity rather than by
 *    walking upward through a parent chain that doesn't exist here.
 */

import { parse } from '@babel/parser';
import { createHash } from 'crypto';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
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
 * Import statement information
 */
export interface ImportInfo {
  /** Type of import: import, require, dynamic */
  type: 'import' | 'require' | 'dynamic';
  /** Module being imported */
  module: string;
  /** Imported symbols and their aliases */
  imports: Array<{
    name: string;
    alias?: string;
    isDefault?: boolean;
    isNamespace?: boolean;
  }>;
  /** Location in source file */
  location: {
    line: number;
    column: number;
  };
  /** Whether import is used in the file */
  used: boolean;
  /** Specific imports that are unused */
  unusedImports?: string[];
}

/**
 * Import optimization suggestion
 */
export interface ImportOptimization {
  /** Type of optimization */
  type:
    | 'remove-unused'
    | 'combine-imports'
    | 'reorder-imports'
    | 'convert-require'
    | 'add-missing';
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
    bundleSize?: 'low' | 'medium' | 'high';
  };
}

/**
 * Circular dependency information
 */
export interface CircularDependency {
  /** Files involved in the cycle */
  cycle: string[];
  /** Severity level */
  severity: 'warning' | 'error';
  /** Human-readable message */
  message: string;
}

/**
 * Missing import suggestion
 */
export interface MissingImport {
  /** Symbol that appears to be missing */
  symbol: string;
  /** Suggested modules where it might be found */
  suggestedModules: string[];
  /** Location where it's used */
  location: {
    line: number;
    column: number;
  };
}

/**
 * Smart imports analysis result
 */
export interface SmartImportsResult {
  /** All import statements found */
  imports: ImportInfo[];
  /** Unused imports detected */
  unusedImports: ImportInfo[];
  /** Missing imports detected */
  missingImports: MissingImport[];
  /** Optimization suggestions */
  optimizations: ImportOptimization[];
  /** Circular dependencies detected */
  circularDependencies: CircularDependency[];
  /** Summary statistics */
  summary: {
    totalImports: number;
    unusedCount: number;
    missingCount: number;
    optimizationCount: number;
    circularCount: number;
  };
  /** Cache metadata */
  cached: boolean;
  cacheAge?: number;
}

/**
 * Options for smart imports analysis
 */
export interface SmartImportsOptions {
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
  /** Check for circular dependencies */
  checkCircular?: boolean;
  /** Suggest missing imports */
  suggestMissing?: boolean;
}

/**
 * Smart Imports Tool
 * Analyzes import statements with caching
 */
export class SmartImportsTool {
  private cache: CacheEngine;
  private metrics: MetricsCollector;
  private tokenCounter: TokenCounter;
  private cacheNamespace = 'smart_imports';
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
   * Run smart imports analysis
   */
  async run(options: SmartImportsOptions = {}): Promise<SmartImportsResult> {
    const startTime = Date.now();
    const {
      filePath,
      fileContent,
      projectRoot = this.projectRoot,
      force = false,
      maxCacheAge = 300,
      checkCircular = true,
      suggestMissing = true,
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
      checkCircular,
      suggestMissing,
      projectRoot,
    });

    // Check cache
    if (!force) {
      const cached = this.getCachedResult(cacheKey, maxCacheAge);
      if (cached) {
        const duration = Date.now() - startTime;
        this.metrics.record({
          operation: 'smart_imports',
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
    void fileName; // no longer needed for parsing; kept for cache-key parity

    // Analyze imports
    const imports = this.extractImports(program);
    const unusedImports = this.detectUnusedImports(imports, program);
    const missingImports = suggestMissing
      ? this.detectMissingImports(program, imports)
      : [];
    const optimizations = this.generateOptimizations(imports);
    const circularDependencies =
      checkCircular && filePath
        ? this.detectCircularDependencies(filePath, imports)
        : [];

    // Build result
    const result: SmartImportsResult = {
      imports,
      unusedImports,
      missingImports,
      optimizations,
      circularDependencies,
      summary: {
        totalImports: imports.length,
        unusedCount: unusedImports.length,
        missingCount: missingImports.length,
        optimizationCount: optimizations.length,
        circularCount: circularDependencies.length,
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
      operation: 'smart_imports',
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
   * Extract import statements from source file
   */
  private extractImports(program: AnyNode): ImportInfo[] {
    const imports: ImportInfo[] = [];

    walk(program, (node) => {
      // ES6 import statements
      if (node.type === 'ImportDeclaration') {
        const moduleSpecifier = node.source;
        if (moduleSpecifier?.type !== 'StringLiteral') return;

        const module = moduleSpecifier.value as string;
        const importList: ImportInfo['imports'] = [];

        for (const spec of node.specifiers || []) {
          if (spec.type === 'ImportDefaultSpecifier') {
            // Default import
            importList.push({ name: spec.local.name, isDefault: true });
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            // import * as name
            importList.push({ name: spec.local.name, isNamespace: true });
          } else if (spec.type === 'ImportSpecifier') {
            // import { a, b as c }. Babel's `imported` is ALWAYS present
            // (equal to `local` when there's no alias); ts's `propertyName`
            // is only present when the source actually wrote `as`, hence
            // the name-comparison rather than a plain presence check.
            const importedName =
              spec.imported?.type === 'Identifier'
                ? spec.imported.name
                : spec.imported?.value;
            importList.push({
              name: spec.local.name,
              alias:
                importedName && importedName !== spec.local.name
                  ? importedName
                  : undefined,
            });
          }
        }

        imports.push({
          type: 'import',
          module,
          imports: importList,
          location: locOf(node),
          used: false,
        });
      }

      // CommonJS require
      if (node.type === 'VariableDeclaration') {
        for (const decl of node.declarations) {
          const init = decl.init;
          if (
            init?.type === 'CallExpression' &&
            init.callee?.type === 'Identifier' &&
            init.callee.name === 'require'
          ) {
            const arg = init.arguments[0];
            if (arg?.type === 'StringLiteral') {
              const module = arg.value as string;
              const importList: ImportInfo['imports'] = [];

              if (decl.id.type === 'Identifier') {
                importList.push({ name: decl.id.name, isDefault: true });
              } else if (decl.id.type === 'ObjectPattern') {
                for (const prop of decl.id.properties) {
                  if (
                    prop.type === 'ObjectProperty' &&
                    !prop.computed &&
                    prop.value?.type === 'Identifier' &&
                    prop.key?.type === 'Identifier'
                  ) {
                    importList.push({
                      name: prop.value.name,
                      alias:
                        prop.key.name !== prop.value.name
                          ? prop.key.name
                          : undefined,
                    });
                  }
                }
              }

              imports.push({
                type: 'require',
                module,
                imports: importList,
                location: locOf(node),
                used: false,
              });
            }
          }
        }
      }

      // Dynamic imports
      if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
        const arg = node.arguments[0];
        if (arg?.type === 'StringLiteral') {
          imports.push({
            type: 'dynamic',
            module: arg.value as string,
            imports: [],
            location: locOf(node),
            used: true, // Dynamic imports are always considered used
          });
        }
      }
    });

    return imports;
  }

  /**
   * Detect unused imports
   */
  private detectUnusedImports(
    imports: ImportInfo[],
    program: AnyNode
  ): ImportInfo[] {
    const unused: ImportInfo[] = [];
    const usedSymbols = this.collectUsedSymbols(program);

    for (const imp of imports) {
      if (imp.type === 'dynamic') {
        continue; // Skip dynamic imports
      }

      const unusedImportList: string[] = [];
      let hasUsedImport = false;

      for (const importItem of imp.imports) {
        const symbolName = importItem.name;
        if (!usedSymbols.has(symbolName)) {
          unusedImportList.push(symbolName);
        } else {
          hasUsedImport = true;
        }
      }

      // Mark import as used/unused
      imp.used = hasUsedImport || imp.imports.length === 0;
      imp.unusedImports = unusedImportList;

      // If entire import is unused
      if (!imp.used && imp.imports.length > 0) {
        unused.push(imp);
      }
    }

    return unused;
  }

  /** Every import-binding Identifier node (default/namespace/named local
   * AND, for aliased named imports, the original `imported` name too) --
   * see this file's top-of-file BABEL PORT note #2 for why this replaces
   * the original's `node.parent`-based filter. */
  private collectImportBindingIdentifiers(program: AnyNode): Set<AnyNode> {
    const skip = new Set<AnyNode>();
    walk(program, (node) => {
      if (node.type !== 'ImportDeclaration') return;
      for (const spec of node.specifiers || []) {
        if (
          spec.type === 'ImportDefaultSpecifier' ||
          spec.type === 'ImportNamespaceSpecifier'
        ) {
          if (spec.local) skip.add(spec.local);
        } else if (spec.type === 'ImportSpecifier') {
          if (spec.local) skip.add(spec.local);
          if (spec.imported?.type === 'Identifier') skip.add(spec.imported);
        }
      }
    });
    return skip;
  }

  /**
   * Collect all symbols used in the file
   */
  private collectUsedSymbols(program: AnyNode): Set<string> {
    const used = new Set<string>();
    const importBindings = this.collectImportBindingIdentifiers(program);

    walk(program, (node) => {
      if (node.type === 'Identifier') {
        // Skip if it's part of an import declaration
        if (importBindings.has(node)) return;
        used.add(node.name as string);
      }
    });

    return used;
  }

  /**
   * Detect missing imports
   */
  private detectMissingImports(
    program: AnyNode,
    existingImports: ImportInfo[]
  ): MissingImport[] {
    const missing: MissingImport[] = [];
    const usedSymbols = this.collectUsedSymbols(program);
    const importedSymbols = new Set<string>();

    // Collect all imported symbols
    for (const imp of existingImports) {
      for (const item of imp.imports) {
        importedSymbols.add(item.name);
      }
    }

    // Common symbols that might be missing imports
    const commonSymbols = new Map<string, string[]>([
      ['React', ['react']],
      ['useState', ['react']],
      ['useEffect', ['react']],
      ['Component', ['react']],
      ['express', ['express']],
      ['Router', ['express']],
      ['Request', ['express']],
      ['Response', ['express']],
      ['prisma', ['@prisma/client']],
      ['z', ['zod']],
      ['describe', ['jest', '@jest/globals']],
      ['it', ['jest', '@jest/globals']],
      ['expect', ['jest', '@jest/globals']],
      ['test', ['jest', '@jest/globals']],
    ]);

    // Check for potential missing imports
    for (const symbol of usedSymbols) {
      if (!importedSymbols.has(symbol) && commonSymbols.has(symbol)) {
        const pos = this.findSymbolLocation(program, symbol);
        if (pos) {
          missing.push({
            symbol,
            suggestedModules: commonSymbols.get(symbol)!,
            location: pos,
          });
        }
      }
    }

    return missing;
  }

  /**
   * Find location of a symbol in source file
   */
  private findSymbolLocation(
    program: AnyNode,
    symbolName: string
  ): { line: number; column: number } | null {
    let result: { line: number; column: number } | null = null;

    walk(program, (node) => {
      if (result) return;
      if (node.type === 'Identifier' && node.name === symbolName) {
        result = locOf(node);
      }
    });

    return result;
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizations(imports: ImportInfo[]): ImportOptimization[] {
    const optimizations: ImportOptimization[] = [];

    // Remove unused imports
    for (const imp of imports) {
      if (imp.unusedImports && imp.unusedImports.length > 0) {
        const allUnused = imp.unusedImports.length === imp.imports.length;
        optimizations.push({
          type: 'remove-unused',
          severity: allUnused ? 'warning' : 'info',
          message: allUnused
            ? `Entire import from '${imp.module}' is unused`
            : `${imp.unusedImports.length} unused import(s) from '${imp.module}': ${imp.unusedImports.join(', ')}`,
          suggestion: allUnused
            ? `Remove the entire import statement`
            : `Remove unused imports: ${imp.unusedImports.join(', ')}`,
          location: imp.location,
          impact: {
            readability: 'medium',
            maintainability: 'medium',
            bundleSize: 'low',
          },
        });
      }
    }

    // Combine imports from same module
    const moduleGroups = new Map<string, ImportInfo[]>();
    for (const imp of imports) {
      if (imp.type === 'import') {
        if (!moduleGroups.has(imp.module)) {
          moduleGroups.set(imp.module, []);
        }
        moduleGroups.get(imp.module)!.push(imp);
      }
    }

    for (const [module, imps] of moduleGroups) {
      if (imps.length > 1) {
        optimizations.push({
          type: 'combine-imports',
          severity: 'info',
          message: `Multiple import statements from '${module}' can be combined`,
          suggestion: `Combine ${imps.length} import statements into one`,
          location: imps[0].location,
          codeExample: {
            before: imps
              .map(
                (i) =>
                  `import { ${i.imports.map((x) => x.name).join(', ')} } from '${module}';`
              )
              .join('\n'),
            after: `import { ${imps.flatMap((i) => i.imports.map((x) => x.name)).join(', ')} } from '${module}';`,
          },
          impact: {
            readability: 'medium',
            maintainability: 'low',
          },
        });
      }
    }

    // Convert require to import
    for (const imp of imports) {
      if (imp.type === 'require') {
        optimizations.push({
          type: 'convert-require',
          severity: 'info',
          message: `CommonJS require can be converted to ES6 import`,
          suggestion: `Use ES6 import syntax instead of require()`,
          location: imp.location,
          codeExample: {
            before: `const ${imp.imports[0]?.name || 'module'} = require('${imp.module}');`,
            after: `import ${imp.imports[0]?.name || 'module'} from '${imp.module}';`,
          },
          impact: {
            readability: 'low',
            maintainability: 'low',
          },
        });
      }
    }

    // Suggest reordering (external before internal)
    const needsReorder = this.checkImportOrder(imports);
    if (needsReorder) {
      optimizations.push({
        type: 'reorder-imports',
        severity: 'info',
        message:
          'Imports should be ordered: external modules first, then internal modules',
        suggestion:
          'Reorder imports to follow convention: external → internal → relative',
        impact: {
          readability: 'medium',
          maintainability: 'low',
        },
      });
    }

    return optimizations;
  }

  /**
   * Check if imports need reordering
   */
  private checkImportOrder(imports: ImportInfo[]): boolean {
    let lastType: 'external' | 'internal' | 'relative' | null = null;

    for (const imp of imports) {
      const type = this.getImportType(imp.module);

      if (lastType) {
        // External should come before internal and relative
        if (lastType === 'internal' && type === 'external') return true;
        if (
          lastType === 'relative' &&
          (type === 'external' || type === 'internal')
        )
          return true;
      }

      lastType = type;
    }

    return false;
  }

  /**
   * Get import type (external, internal, relative)
   */
  private getImportType(module: string): 'external' | 'internal' | 'relative' {
    if (module.startsWith('.')) return 'relative';
    if (module.startsWith('@/') || module.startsWith('~/')) return 'internal';
    return 'external';
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(
    filePath: string,
    imports: ImportInfo[]
  ): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (currentFile: string, path: string[]): void => {
      if (recursionStack.has(currentFile)) {
        // Found cycle
        const cycleStart = path.indexOf(currentFile);
        const cycle = path.slice(cycleStart).concat(currentFile);
        cycles.push({
          cycle,
          severity: 'warning',
          message: `Circular dependency detected: ${cycle.join(' → ')}`,
        });
        return;
      }

      if (visited.has(currentFile)) {
        return;
      }

      visited.add(currentFile);
      recursionStack.add(currentFile);

      // Get imports for current file
      const fileImports =
        currentFile === filePath
          ? imports
          : this.getImportsForFile(currentFile);

      for (const imp of fileImports) {
        if (imp.module.startsWith('.')) {
          const resolvedPath = this.resolveImportPath(currentFile, imp.module);
          if (resolvedPath) {
            detectCycle(resolvedPath, [...path, currentFile]);
          }
        }
      }

      recursionStack.delete(currentFile);
    };

    detectCycle(filePath, []);
    return cycles;
  }

  /**
   * Get imports for a file
   */
  private getImportsForFile(filePath: string): ImportInfo[] {
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return this.extractImports(parseSource(content));
    } catch {
      return [];
    }
  }

  /**
   * Resolve import path to absolute file path
   */
  private resolveImportPath(
    currentFile: string,
    importPath: string
  ): string | null {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const dir = currentFile.substring(0, currentFile.lastIndexOf('/'));
      let resolved = join(dir, importPath);

      // Try different extensions
      const extensions = [
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
        if (existsSync(withExt)) {
          return withExt;
        }
      }
    }

    return null;
  }

  /**
   * Generate cache key
   */
  private async generateCacheKey(
    content: string,
    options: {
      checkCircular?: boolean;
      suggestMissing?: boolean;
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
    result: SmartImportsResult;
    timestamp: number;
    originalTokens?: number;
  } | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const data = JSON.parse(cached) as {
      result: SmartImportsResult;
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
    result: SmartImportsResult,
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
  private compactResult(result: SmartImportsResult): string {
    const compact = {
      imp: result.imports.map((i) => ({
        t: i.type[0], // First letter: i/r/d
        m: i.module,
        i: i.imports.map((x) => x.name),
        u: i.used,
        l: i.location.line,
      })),
      unu: result.unusedImports.map((i) => ({
        m: i.module,
        i: i.unusedImports,
      })),
      mis: result.missingImports.map((m) => ({
        s: m.symbol,
        l: m.location.line,
      })),
      opt: result.optimizations.map((o) => ({
        t: o.type,
        m: o.message,
      })),
      circ: result.circularDependencies.map((c) => ({
        c: c.cycle,
      })),
      sum: result.summary,
    };

    return JSON.stringify(compact);
  }
}

/**
 * Factory function for dependency injection
 */
export function getSmartImportsTool(
  cache: CacheEngine,
  tokenCounter: TokenCounter,
  metrics: MetricsCollector,
  projectRoot?: string
): SmartImportsTool {
  return new SmartImportsTool(cache, tokenCounter, metrics, projectRoot);
}

/**
 * Standalone function for CLI usage
 */
export async function runSmartImports(
  options: SmartImportsOptions
): Promise<SmartImportsResult> {
  const cache = new CacheEngine(getOptimizerCacheDbPath());
  const tokenCounter = new TokenCounter();
  const metrics = new MetricsCollector();
  const tool = getSmartImportsTool(
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
export const SMART_IMPORTS_TOOL_DEFINITION = {
  name: 'smart_imports',
  description:
    'Analyze TypeScript/JavaScript import statements with intelligent caching. Detects unused imports, missing imports, and provides optimization suggestions. Achieves 75-85% token reduction through import analysis summarization.',
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
      checkCircular: {
        type: 'boolean',
        description: 'Check for circular dependencies (default: true)',
        default: true,
      },
      suggestMissing: {
        type: 'boolean',
        description: 'Suggest missing imports (default: true)',
        default: true,
      },
    },
  },
};
