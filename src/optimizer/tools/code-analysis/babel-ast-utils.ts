/**
 * Small AST-walking utility shared by the code-analysis tools ported from
 * the classic TypeScript Compiler API to @babel/parser (see this
 * directory's index.ts header for the full "THE BLOCKER" explanation of
 * why the port happened at all).
 *
 * WHY NOT `@babel/traverse`: it was installed and tried first (matching
 * this checkpoint's task instructions to check for/add it), but it
 * requires a `scope` + `parentPath` for any traversal root that isn't a
 * `Program`/`File` -- verified live: `traverse(someFunctionNode, visitor)`
 * throws "You must pass a scope and parentPath unless traversing a
 * Program/File". Every one of these tools' original recursive-descent
 * helpers (`calculateCyclomaticComplexity(node)`,
 * `detectCircularDependencies`'s per-import walk, etc.) calls
 * `ts.forEachChild` starting from an arbitrary already-extracted
 * function/class/statement subtree, not the file root -- exactly the case
 * `@babel/traverse` rejects without extra ceremony this port has no need
 * for (no scope-aware renaming/binding resolution happens anywhere in
 * these files). `@babel/traverse` was removed from package.json as an
 * unused dependency once this was confirmed; see the checkpoint's own
 * report for the measured error.
 *
 * `walk` below reproduces the EXACT contract every ported file's original
 * `const visit = (n: ts.Node) => { ...; ts.forEachChild(n, visit); };
 * visit(root);` closure had: `visit` receives `root` itself first (so a
 * decision-point check against the root node still runs, even though in
 * practice none of these roots are ever themselves an if/for/while/etc.),
 * then descends into every child, recursively, with no function-boundary
 * stop (nested function bodies ARE walked into -- matching the original's
 * lack of any such stop, which is why, e.g., smart-complexity's per-function
 * cyclomatic count double-counts an inner function's decision points into
 * its outer function's total; that double-count is vendor's original
 * behavior, preserved here rather than silently "fixed").
 *
 * Walking `@babel/types`'s own `VISITOR_KEYS` table needs no scope/parent
 * setup and is a precise, verified match for `ts.forEachChild`'s semantics
 * (visit each immediate child; arrays and single-node fields both handled).
 */
import * as t from '@babel/types';

/** Loosely-typed AST node -- every ported file already treats Babel nodes
 * as `any` at the point where TS-specific fields (`.declaration`,
 * `.specifiers`, etc.) get read, matching smart-dependencies.ts's own
 * existing `ast: any` convention rather than fighting @babel/types' full
 * discriminated union for every node shape these files touch. */
export type AnyNode = { type: string } & Record<string, any>;

const VISITOR_KEYS = t.VISITOR_KEYS as unknown as Record<string, string[]>;

/**
 * Mirrors `ts.forEachChild(node, visit)`: invokes `visit` once per
 * immediate child of `node` (array-valued fields are flattened one level),
 * never on `node` itself.
 */
export function forEachChild(
  node: AnyNode | null | undefined,
  visit: (child: AnyNode) => void
): void {
  if (!node || typeof node.type !== 'string') return;
  const keys = VISITOR_KEYS[node.type];
  if (!keys) return;
  for (const key of keys) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') visit(child as AnyNode);
      }
    } else if (value && typeof value.type === 'string') {
      visit(value as AnyNode);
    }
  }
}

/**
 * Mirrors the `const visit = (n) => { ...; ts.forEachChild(n, visit); };
 * visit(root);` closure pattern used throughout the ported files: `onNode`
 * runs against `root` first, then against every descendant, recursively,
 * with no function/class-boundary stop.
 */
export function walk(
  root: AnyNode | null | undefined,
  onNode: (node: AnyNode) => void
): void {
  if (!root || typeof root.type !== 'string') return;
  onNode(root);
  forEachChild(root, (child) => walk(child, onNode));
}

/**
 * `node.getStart()` + `sourceFile.getLineAndCharacterOfPosition(...)` ->
 * `{ line: pos.line + 1, column: pos.character }` (0-based line, hence the
 * `+1`) was the pattern every ported file used to build a `{ line, column }`
 * location. Babel's own `node.loc.start` is ALREADY `{ line: <1-based>,
 * column: <0-based> }` -- verified directly (parse a 3-line fixture, check
 * `loc.start.line` against a known statement). Re-applying TS's `+1` here
 * would silently shift every reported line number by one; this helper
 * exists so that mistake can't be made file-by-file.
 */
export function locOf(node: AnyNode): { line: number; column: number } {
  const start = node?.loc?.start;
  return { line: start?.line ?? 0, column: start?.column ?? 0 };
}

/** `node.getText(sourceFile)` has no Babel equivalent -- Babel nodes carry
 * `.start`/`.end` character offsets into the original source string
 * instead, so `getText` becomes `content.slice(node.start, node.end)`. */
export function textOf(node: AnyNode, content: string): string {
  if (typeof node.start !== 'number' || typeof node.end !== 'number')
    return '';
  return content.slice(node.start, node.end);
}
