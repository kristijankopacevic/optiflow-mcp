/**
 * Smart Complexity Analysis Tool
 *
 * Analyzes code complexity metrics with intelligent caching
 * Calculates cyclomatic, cognitive, and Halstead metrics
 * Target: 70-80% token reduction through metric summarization
 *
 * BABEL PORT (see code-analysis/index.ts's header "THE BLOCKER"): this file
 * originally used the classic TypeScript Compiler API
 * (`ts.createSourceFile`/`ts.isIfStatement`/`ts.forEachChild`/etc.), which
 * this repo's `typescript@^7` no longer exposes. Every metric this tool
 * computes (cyclomatic, cognitive, Halstead, maintainability index,
 * LOC/LLOC) is derived purely from AST SHAPE -- decision-point node types,
 * operator tokens, identifier/literal counts -- never from resolved type
 * information, so this is a faithful, no-capability-loss port to
 * `@babel/parser` + a manual `@babel/types`-`VISITOR_KEYS` walk (see
 * ./babel-ast-utils.ts's header for why that walk, not `@babel/traverse`,
 * is used). One real, intentional behavior difference: `ts.createSourceFile`
 * recovers from malformed syntax silently (returns a best-effort AST with
 * error nodes); `@babel/parser`'s `parse()` throws a `SyntaxError` on
 * invalid input instead. A file that used to silently analyze as
 * (likely wrong, since it never really parsed) now surfaces a real error
 * through this tool's caller instead -- a stricter, arguably more honest
 * failure mode, but a real difference from vendor's, not silently patched.
 */

import { parse } from '@babel/parser';
import { existsSync, readFileSync } from 'fs';
import { join, isAbsolute } from 'path';
import { createHash } from 'crypto';
import { CacheEngine } from '../../core/cache-engine.js';
import { MetricsCollector } from '../../core/metrics.js';
import { TokenCounter } from '../../core/token-counter.js';
// PATH RECONCILIATION (see src/optimizer/paths.ts's header): vendor's CLI
// default here was `join(homedir(), '.hypercontext', 'cache')` -- replaced
// with optiflow's own `~/.optiflow/optimizer/cache` convention.
import { getOptimizerCacheDbPath } from '../../paths.js';
import { type AnyNode, walk, forEachChild, locOf, textOf } from './babel-ast-utils.js';

/** Node types this tool treats as "a function", matching the union of
 * `ts.isFunctionDeclaration`/`isMethodDeclaration`/`isArrowFunction`/
 * `isFunctionExpression` -- TS's classic API represents BOTH class methods
 * and object-literal shorthand methods as `MethodDeclaration`; Babel splits
 * those into `ClassMethod` and `ObjectMethod`, so both are included here to
 * match the original's combined coverage. */
const FUNCTION_LIKE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassMethod',
  'ObjectMethod',
]);

/** Decision-point statement types for cyclomatic complexity, matching
 * `ts.isIfStatement`/`isForStatement`/`isForInStatement`/`isForOfStatement`/
 * `isWhileStatement`/`isDoStatement`/`isCatchClause` 1:1 (Babel's
 * `DoWhileStatement` is TS's `DoStatement` under a different name). */
const CYCLOMATIC_STATEMENT_TYPES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
]);

/** Cognitive-complexity nesting-increasing statement types, matching the
 * original's identical list (`ts.isForStatement`/`isForInStatement`/
 * `isForOfStatement`/`isWhileStatement`/`isDoStatement`). */
const COGNITIVE_LOOP_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

export interface SmartComplexityOptions {
  filePath?: string;
  fileContent?: string;
  projectRoot?: string;
  includeHalstead?: boolean;
  includeMaintainability?: boolean;
  threshold?: {
    cyclomatic?: number;
    cognitive?: number;
  };
  force?: boolean;
  maxCacheAge?: number;
}

export interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  halstead?: HalsteadMetrics;
  maintainabilityIndex?: number;
  linesOfCode: number;
  logicalLinesOfCode: number;
}

export interface HalsteadMetrics {
  distinctOperators: number;
  distinctOperands: number;
  totalOperators: number;
  totalOperands: number;
  vocabulary: number;
  length: number;
  calculatedLength: number;
  volume: number;
  difficulty: number;
  effort: number;
  time: number;
  bugs: number;
}

export interface FunctionComplexity {
  name: string;
  location: { line: number; column: number };
  complexity: ComplexityMetrics;
  aboveThreshold: boolean;
}

export interface SmartComplexityResult {
  summary: {
    file: string;
    totalComplexity: ComplexityMetrics;
    averageComplexity: number;
    maxComplexity: number;
    functionsAboveThreshold: number;
    totalFunctions: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    fromCache: boolean;
    duration: number;
  };
  functions: FunctionComplexity[];
  fileMetrics: ComplexityMetrics;
  recommendations: string[];
  metrics: {
    originalTokens: number;
    compactedTokens: number;
    reductionPercentage: number;
  };
}

export class SmartComplexityTool {
  private cache: CacheEngine;
  private metrics: MetricsCollector;
  private tokenCounter: TokenCounter;
  private cacheNamespace = 'smart_complexity';
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

  async run(
    options: SmartComplexityOptions = {}
  ): Promise<SmartComplexityResult> {
    const startTime = Date.now();
    const {
      filePath,
      fileContent,
      projectRoot = this.projectRoot,
      includeHalstead = true,
      includeMaintainability = true,
      threshold = { cyclomatic: 10, cognitive: 15 },
      force = false,
      maxCacheAge = 300,
    } = options;

    if (!filePath && !fileContent) {
      throw new Error('Either filePath or fileContent must be provided');
    }

    // Read file content
    let content: string;
    let absolutePath: string | undefined;

    if (fileContent) {
      content = fileContent;
    } else if (filePath) {
      // An ABSOLUTE filePath must be used as given.
      // join(projectRoot, filePath) on an absolute path produces nonsense --
      // a project root with a drive letter glued onto it -- and the tool then
      // reports "File not found" for a file that is plainly there. Measured
      // live: every call with an absolute path failed exactly this way.
      absolutePath = isAbsolute(filePath)
        ? filePath
        : join(projectRoot, filePath);
      if (!existsSync(absolutePath)) {
        throw new Error(`File not found: ${absolutePath}`);
      }
      content = readFileSync(absolutePath, 'utf-8');
    } else {
      throw new Error('No content provided');
    }

    // Generate cache key
    const cacheKey = await this.generateCacheKey(
      content,
      includeHalstead,
      includeMaintainability
    );

    // Check cache
    if (!force) {
      const cached = this.getCachedResult(cacheKey, maxCacheAge);
      if (cached) {
        this.metrics.record({
          operation: 'smart_complexity',
          duration: Date.now() - startTime,
          cacheHit: true,
          inputTokens: cached.metrics.originalTokens,
          cachedTokens: cached.metrics.compactedTokens,
          success: true,
        });
        return cached;
      }
    }

    // Parse TypeScript/JavaScript. See this file's top-of-file BABEL PORT
    // comment: unlike ts.createSourceFile, this throws on malformed syntax
    // rather than silently recovering.
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    const program = ast.program as unknown as AnyNode;

    // Calculate metrics
    const functions = this.analyzeFunctions(
      program,
      threshold,
      includeHalstead,
      includeMaintainability,
      content
    );
    const fileMetrics = this.calculateFileMetrics(
      program,
      content,
      includeHalstead,
      includeMaintainability
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      functions,
      fileMetrics,
      threshold
    );

    // Calculate summary statistics
    const totalFunctions = functions.length;
    const functionsAboveThreshold = functions.filter(
      (f) => f.aboveThreshold
    ).length;
    const avgComplexity =
      totalFunctions > 0
        ? functions.reduce((sum, f) => sum + f.complexity.cyclomatic, 0) /
          totalFunctions
        : 0;
    const maxComplexity =
      totalFunctions > 0
        ? Math.max(...functions.map((f) => f.complexity.cyclomatic))
        : 0;

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(avgComplexity, maxComplexity);

    // Build result
    const result: SmartComplexityResult = {
      summary: {
        file: filePath || 'anonymous',
        totalComplexity: fileMetrics,
        averageComplexity: avgComplexity,
        maxComplexity,
        functionsAboveThreshold,
        totalFunctions,
        riskLevel,
        fromCache: false,
        duration: Date.now() - startTime,
      },
      functions,
      fileMetrics,
      recommendations,
      metrics: {
        originalTokens: 0,
        compactedTokens: 0,
        reductionPercentage: 0,
      },
    };

    // Calculate token metrics
    const originalText = JSON.stringify(result, null, 2);
    const compactText = this.compactResult(result);
    result.metrics.originalTokens =
      this.tokenCounter.count(originalText).tokens;
    result.metrics.compactedTokens =
      this.tokenCounter.count(compactText).tokens;
    result.metrics.reductionPercentage =
      ((result.metrics.originalTokens - result.metrics.compactedTokens) /
        result.metrics.originalTokens) *
      100;

    // Cache result
    this.cacheResult(cacheKey, result);

    // Record metrics
    this.metrics.record({
      operation: 'smart_complexity',
      duration: Date.now() - startTime,
      cacheHit: false,
      inputTokens: result.metrics.originalTokens,
      cachedTokens: result.metrics.compactedTokens,
      success: true,
    });

    return result;
  }

  private analyzeFunctions(
    program: AnyNode,
    threshold: { cyclomatic?: number; cognitive?: number },
    includeHalstead: boolean,
    includeMaintainability: boolean,
    content: string
  ): FunctionComplexity[] {
    const functions: FunctionComplexity[] = [];

    walk(program, (node) => {
      if (FUNCTION_LIKE_TYPES.has(node.type)) {
        const name = this.getFunctionName(node);
        const pos = locOf(node);
        const complexity = this.calculateComplexity(
          node,
          content,
          includeHalstead,
          includeMaintainability
        );

        const aboveThreshold =
          (threshold.cyclomatic &&
            complexity.cyclomatic > threshold.cyclomatic) ||
          (threshold.cognitive && complexity.cognitive > threshold.cognitive) ||
          false;

        functions.push({
          name,
          location: pos,
          complexity,
          aboveThreshold,
        });
      }
    });

    return functions;
  }

  /** Matches the original's coverage: `ts.isMethodDeclaration` covers BOTH
   * class methods and object-literal shorthand methods in the classic
   * Compiler API; Babel splits those into `ClassMethod`/`ObjectMethod`,
   * both handled the same way here. Arrow functions never had name
   * extraction in the original either (only Function/Method Declarations
   * and named Function Expressions did) -- preserved as-is. */
  private getFunctionName(node: AnyNode): string {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      return node.id.name;
    }
    if (
      (node.type === 'ClassMethod' || node.type === 'ObjectMethod') &&
      node.key?.type === 'Identifier'
    ) {
      return node.key.name;
    }
    if (node.type === 'FunctionExpression' && node.id?.name) {
      return node.id.name;
    }
    return '<anonymous>';
  }

  private calculateComplexity(
    node: AnyNode,
    content: string,
    includeHalstead: boolean,
    includeMaintainability: boolean
  ): ComplexityMetrics {
    const cyclomatic = this.calculateCyclomaticComplexity(node);
    const cognitive = this.calculateCognitiveComplexity(node, 0);
    const { loc, lloc } = this.countLines(node, content);

    const metrics: ComplexityMetrics = {
      cyclomatic,
      cognitive,
      linesOfCode: loc,
      logicalLinesOfCode: lloc,
    };

    if (includeHalstead) {
      metrics.halstead = this.calculateHalsteadMetrics(node);
    }

    if (includeMaintainability && metrics.halstead) {
      metrics.maintainabilityIndex = this.calculateMaintainabilityIndex(
        metrics.halstead,
        cyclomatic,
        lloc
      );
    }

    return metrics;
  }

  private calculateCyclomaticComplexity(node: AnyNode): number {
    let complexity = 1; // Base complexity

    walk(node, (n) => {
      // Decision points that increase complexity. `ts.isCaseClause`
      // explicitly excludes the `default:` clause; Babel's `SwitchCase`
      // covers both `case`/`default`, distinguished by `n.test` being
      // non-null only for real `case` clauses.
      if (
        CYCLOMATIC_STATEMENT_TYPES.has(n.type) ||
        (n.type === 'SwitchCase' && n.test !== null)
      ) {
        complexity++;
      }

      // Logical operators. TS's classic API models &&/||/?? as
      // BinaryExpression; Babel gives them their own LogicalExpression
      // node type instead, so that's what's checked here.
      if (
        n.type === 'LogicalExpression' &&
        (n.operator === '&&' || n.operator === '||' || n.operator === '??')
      ) {
        complexity++;
      }
    });

    return complexity;
  }

  private calculateCognitiveComplexity(
    node: AnyNode,
    nestingLevel: number
  ): number {
    let complexity = 0;

    const visit = (n: AnyNode, level: number): void => {
      // Structures that increase cognitive complexity
      if (n.type === 'IfStatement') {
        complexity += 1 + level;
        forEachChild(n, (child) => visit(child, level + 1));
        return;
      }

      if (n.type === 'ConditionalExpression') {
        complexity += 1 + level;
        forEachChild(n, (child) => visit(child, level + 1));
        return;
      }

      if (COGNITIVE_LOOP_TYPES.has(n.type)) {
        complexity += 1 + level;
        forEachChild(n, (child) => visit(child, level + 1));
        return;
      }

      if (n.type === 'SwitchStatement') {
        complexity += 1 + level;
        forEachChild(n, (child) => visit(child, level + 1));
        return;
      }

      if (n.type === 'CatchClause') {
        complexity += 1 + level;
        forEachChild(n, (child) => visit(child, level + 1));
        return;
      }

      // Logical operators (but not nested ones at the same level) -- only
      // &&/||, matching the original (?? was never included here).
      if (
        n.type === 'LogicalExpression' &&
        (n.operator === '&&' || n.operator === '||')
      ) {
        complexity += 1;
      }

      // Continue with children at the same level
      forEachChild(n, (child) => visit(child, level));
    };

    visit(node, nestingLevel);
    return complexity;
  }

  private calculateHalsteadMetrics(node: AnyNode): HalsteadMetrics {
    const operators = new Set<string>();
    const operands = new Set<string>();
    let totalOperators = 0;
    let totalOperands = 0;

    walk(node, (n) => {
      // Operators. TS's classic API models &&/||/?? as BinaryExpression
      // (hence one shared operatorToken.getText() call there); Babel splits
      // those into LogicalExpression, so both node types are checked here
      // to preserve the original's combined operator-token counting.
      if (n.type === 'BinaryExpression' || n.type === 'LogicalExpression') {
        operators.add(n.operator);
        totalOperators++;
      }

      // UnaryExpression (!x, -x, typeof x, ...) and UpdateExpression
      // (++x/x++/--x/x--) together cover what TS split into
      // isPrefixUnaryExpression/isPostfixUnaryExpression.
      if (n.type === 'UnaryExpression' || n.type === 'UpdateExpression') {
        operators.add(n.operator);
        totalOperators++;
      }

      if (n.type === 'CallExpression' || n.type === 'NewExpression') {
        operators.add('()');
        totalOperators++;
      }

      // Dot access only (`a.b`), matching ts.isPropertyAccessExpression --
      // NOT computed member access (`a[b]`), which TS's classic API
      // represents as a separate ElementAccessExpression the original
      // never checked either.
      if (n.type === 'MemberExpression' && n.computed === false) {
        operators.add('.');
        totalOperators++;
      }

      // Operands
      if (n.type === 'Identifier') {
        operands.add(n.name);
        totalOperands++;
      }

      // StringLiteral: dedupe by unescaped VALUE (ts.StringLiteral.text is
      // quote-independent) so "hi" and 'hi' count as the same operand, as
      // they did under the classic API.
      if (n.type === 'StringLiteral') {
        operands.add(String(n.value));
        totalOperands++;
      }

      // NumericLiteral: dedupe by RAW source text (ts.NumericLiteral.text
      // is the raw text, e.g. "0x10" stays distinct from "16") rather than
      // the parsed numeric value, which would collapse distinct source
      // spellings Babel's own `.value` would otherwise merge.
      if (n.type === 'NumericLiteral') {
        operands.add(String(n.extra?.raw ?? n.value));
        totalOperands++;
      }
    });

    const n1 = operators.size; // Distinct operators
    const n2 = operands.size; // Distinct operands
    const N1 = totalOperators; // Total operators
    const N2 = totalOperands; // Total operands

    const vocabulary = n1 + n2;
    const length = N1 + N2;
    const calculatedLength = n1 * Math.log2(n1) + n2 * Math.log2(n2);
    const volume = length * Math.log2(vocabulary);
    const difficulty = (n1 / 2) * (N2 / n2);
    const effort = difficulty * volume;
    const time = effort / 18; // seconds
    const bugs = volume / 3000;

    return {
      distinctOperators: n1,
      distinctOperands: n2,
      totalOperators: N1,
      totalOperands: N2,
      vocabulary,
      length,
      calculatedLength,
      volume,
      difficulty,
      effort,
      time,
      bugs,
    };
  }

  private calculateMaintainabilityIndex(
    halstead: HalsteadMetrics,
    cyclomatic: number,
    lloc: number
  ): number {
    // Microsoft's Maintainability Index formula
    // MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC)
    // Where V = Halstead Volume, G = Cyclomatic Complexity, LOC = Lines of Code

    const volume = halstead.volume || 1;
    const mi =
      171 -
      5.2 * Math.log(volume) -
      0.23 * cyclomatic -
      16.2 * Math.log(lloc || 1);

    // Normalize to 0-100 scale
    return Math.max(0, Math.min(100, mi));
  }

  private countLines(
    node: AnyNode,
    content: string
  ): { loc: number; lloc: number } {
    const text = textOf(node, content);
    const lines = text.split('\n');
    const loc = lines.length;

    // Count logical lines (non-empty, non-comment lines)
    let lloc = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('/*') &&
        !trimmed.startsWith('*')
      ) {
        lloc++;
      }
    }

    return { loc, lloc };
  }

  private calculateFileMetrics(
    program: AnyNode,
    content: string,
    includeHalstead: boolean,
    includeMaintainability: boolean
  ): ComplexityMetrics {
    return this.calculateComplexity(
      program,
      content,
      includeHalstead,
      includeMaintainability
    );
  }

  private generateRecommendations(
    functions: FunctionComplexity[],
    fileMetrics: ComplexityMetrics,
    threshold: { cyclomatic?: number; cognitive?: number }
  ): string[] {
    const recommendations: string[] = [];

    // Check for high complexity functions
    const highComplexityFunctions = functions.filter(
      (f) => f.complexity.cyclomatic > (threshold.cyclomatic || 10)
    );

    if (highComplexityFunctions.length > 0) {
      recommendations.push(
        `Found ${highComplexityFunctions.length} function(s) with high cyclomatic complexity. Consider breaking down: ${highComplexityFunctions
          .map((f) => f.name)
          .join(', ')}`
      );
    }

    // Check for high cognitive complexity
    const highCognitiveFunctions = functions.filter(
      (f) => f.complexity.cognitive > (threshold.cognitive || 15)
    );

    if (highCognitiveFunctions.length > 0) {
      recommendations.push(
        `Found ${highCognitiveFunctions.length} function(s) with high cognitive complexity. Simplify logic in: ${highCognitiveFunctions
          .map((f) => f.name)
          .join(', ')}`
      );
    }

    // Check maintainability index
    if (
      fileMetrics.maintainabilityIndex !== undefined &&
      fileMetrics.maintainabilityIndex < 20
    ) {
      recommendations.push(
        'File has low maintainability index (<20). Consider refactoring to improve code quality.'
      );
    } else if (
      fileMetrics.maintainabilityIndex !== undefined &&
      fileMetrics.maintainabilityIndex < 50
    ) {
      recommendations.push(
        'File maintainability could be improved. Consider reducing complexity and improving documentation.'
      );
    }

    // Check for very long functions
    const longFunctions = functions.filter(
      (f) => f.complexity.linesOfCode > 50
    );
    if (longFunctions.length > 0) {
      recommendations.push(
        `Found ${longFunctions.length} function(s) with more than 50 lines. Consider splitting: ${longFunctions
          .map((f) => f.name)
          .join(', ')}`
      );
    }

    return recommendations;
  }

  private calculateRiskLevel(
    avgComplexity: number,
    maxComplexity: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (maxComplexity > 30 || avgComplexity > 20) {
      return 'critical';
    }
    if (maxComplexity > 20 || avgComplexity > 15) {
      return 'high';
    }
    if (maxComplexity > 10 || avgComplexity > 10) {
      return 'medium';
    }
    return 'low';
  }

  private compactResult(result: SmartComplexityResult): string {
    // Create a compact summary for token efficiency
    const compact = {
      file: result.summary.file,
      risk: result.summary.riskLevel,
      avg: Math.round(result.summary.averageComplexity * 10) / 10,
      max: result.summary.maxComplexity,
      above: result.summary.functionsAboveThreshold,
      total: result.summary.totalFunctions,
      mi: result.fileMetrics.maintainabilityIndex
        ? Math.round(result.fileMetrics.maintainabilityIndex)
        : undefined,
      high: result.functions
        .filter((f) => f.aboveThreshold)
        .map((f) => ({
          n: f.name,
          c: f.complexity.cyclomatic,
          cog: f.complexity.cognitive,
        })),
      recs: result.recommendations,
    };

    return JSON.stringify(compact);
  }

  private async generateCacheKey(
    content: string,
    includeHalstead: boolean,
    includeMaintainability: boolean
  ): Promise<string> {
    const hash = createHash('sha256');
    hash.update(this.cacheNamespace);
    hash.update(content);
    hash.update(JSON.stringify({ includeHalstead, includeMaintainability }));
    return `${this.cacheNamespace}:${hash.digest('hex')}`;
  }

  private getCachedResult(
    key: string,
    maxAge: number
  ): SmartComplexityResult | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const result = JSON.parse(cached) as SmartComplexityResult & {
      cachedAt: number;
    };
    const age = (Date.now() - result.cachedAt) / 1000;

    if (age <= maxAge) {
      result.summary.fromCache = true;
      return result;
    }

    return null;
  }

  private cacheResult(key: string, output: SmartComplexityResult): void {
    const toCache = { ...output, cachedAt: Date.now() };
    const json = JSON.stringify(toCache);
    const originalSize = Buffer.byteLength(json, 'utf-8');
    const compressedSize = Math.ceil(originalSize * 0.3); // Estimate compression
    this.cache.set(key, json, originalSize, compressedSize);
  }
}

// Factory function for dependency injection
export function getSmartComplexityTool(
  cache: CacheEngine,
  tokenCounter: TokenCounter,
  metrics: MetricsCollector
): SmartComplexityTool {
  return new SmartComplexityTool(cache, tokenCounter, metrics);
}

// Standalone function for CLI usage
export async function runSmartComplexity(
  options: SmartComplexityOptions,
  cache?: CacheEngine,
  tokenCounter?: TokenCounter,
  metrics?: MetricsCollector
): Promise<SmartComplexityResult> {
  const cacheInstance =
    cache || new CacheEngine(getOptimizerCacheDbPath(), 100);
  const tokenCounterInstance = tokenCounter || new TokenCounter();
  const metricsInstance = metrics || new MetricsCollector();

  const tool = getSmartComplexityTool(
    cacheInstance,
    tokenCounterInstance,
    metricsInstance
  );
  return tool.run(options);
}

// MCP tool definition
export const SMART_COMPLEXITY_TOOL_DEFINITION = {
  name: 'smart_complexity',
  description:
    'Analyze code complexity metrics including cyclomatic, cognitive, Halstead, and maintainability index (70-80% token reduction)',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'File path to analyze (relative to project root)',
      },
      fileContent: {
        type: 'string',
        description: 'File content to analyze (alternative to filePath)',
      },
      projectRoot: {
        type: 'string',
        description: 'Project root directory',
      },
      includeHalstead: {
        type: 'boolean',
        description: 'Include Halstead complexity metrics',
        default: true,
      },
      includeMaintainability: {
        type: 'boolean',
        description: 'Include maintainability index calculation',
        default: true,
      },
      threshold: {
        type: 'object',
        description: 'Complexity thresholds for warnings',
        properties: {
          cyclomatic: { type: 'number', default: 10 },
          cognitive: { type: 'number', default: 15 },
        },
      },
      force: {
        type: 'boolean',
        description: 'Force re-analysis (ignore cache)',
        default: false,
      },
      maxCacheAge: {
        type: 'number',
        description: 'Maximum cache age in seconds (default: 300)',
        default: 300,
      },
    },
  },
};
