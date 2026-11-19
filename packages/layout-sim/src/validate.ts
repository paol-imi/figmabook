import { type Axis, inFlow, isStack, primaryAxis, sizingOf, stackSizing } from './axis';
import { issue, type SimIssue } from './issues';
import type { SimNode, SimulateOptions, StackSpec } from './types';

const AXES: readonly Axis[] = ['h', 'v'];
const AXIS_NAME = { h: 'horizontal', v: 'vertical' } as const;
const AXIS_TITLE = { h: 'Horizontal', v: 'Vertical' } as const;
const DIMENSION = { h: 'w', v: 'h' } as const;

/** Every reason the tree cannot be simulated, in tree order. Hidden subtrees are only checked for keys. */
export function validateTree(root: SimNode, options: SimulateOptions): SimIssue[] {
  const issues: SimIssue[] = [];
  const seen = new Set<string>();
  checkKeys(root, seen, issues);
  checkNode(root, undefined, issues);
  for (const axis of AXES) {
    const outer = options.outer?.[DIMENSION[axis]];
    if (outer !== undefined && !(Number.isFinite(outer) && outer >= 0)) {
      issues.push(issue('invalid-number', root.key, `options.outer.${DIMENSION[axis]} = ${outer} is not a size.`));
    }
    if (sizingOf(root, axis) === 'FILL' && options.outer?.[DIMENSION[axis]] === undefined) {
      issues.push(
        issue(
          'fill-without-stack-parent',
          root.key,
          `The root fills ${AXIS_NAME[axis]}ly but has no parent: pass options.outer.${DIMENSION[axis]} or use FIXED or HUG.`,
        ),
      );
    }
  }
  return issues;
}

function checkKeys(node: SimNode, seen: Set<string>, issues: SimIssue[]): void {
  if (seen.has(node.key)) {
    issues.push(issue('duplicate-key', node.key, `Two nodes use the key "${node.key}"; every key must be unique.`));
  }
  seen.add(node.key);
  for (const child of node.children ?? []) checkKeys(child, seen, issues);
}

function checkNode(node: SimNode, parent: SimNode | undefined, issues: SimIssue[]): void {
  // The root is simulated whatever its visibility; hidden children take no part.
  if (parent !== undefined && node.visible === false) return;
  checkNumbers(node, issues);
  if (parent !== undefined) checkAsChild(node, parent, issues);
  const { layout } = node;
  if (layout?.mode === 'GRID') {
    // Grid children are placed by tracks, which v0 does not model: nothing below is checked.
    issues.push(issue('unsupported-grid', node.key, 'Grid auto layout is not simulated yet.'));
    return;
  }
  if (layout !== undefined) checkStack(node, layout, issues);
  for (const child of node.children ?? []) checkNode(child, node, issues);
}

function checkStack(node: SimNode, spec: StackSpec, issues: SimIssue[]): void {
  const { key } = node;
  if (spec.wrap === true) issues.push(issue('unsupported-wrap', key, 'Wrapping auto layout is not simulated yet.'));
  if (spec.counterAxisAlignItems === 'BASELINE' && spec.mode === 'VERTICAL') {
    issues.push(issue('baseline-vertical', key, 'BASELINE alignment is only valid on HORIZONTAL auto layout.'));
  }
  for (const axis of AXES) {
    const explicit = axis === 'h' ? node.sizingH : node.sizingV;
    const own = stackSizing(spec, axis);
    if (explicit !== undefined && (explicit === 'HUG') !== (own === 'HUG')) {
      const mode = axis === primaryAxis(spec) ? 'primaryAxisSizingMode' : 'counterAxisSizingMode';
      const value = own === 'HUG' ? 'AUTO' : 'FIXED';
      issues.push(
        issue(
          'sizing-mode-conflict',
          key,
          `${AXIS_TITLE[axis]} sizing is ${explicit} but ${mode} is ${value}; HUG goes with AUTO, FIXED and FILL with FIXED.`,
        ),
      );
    }
    if (own !== 'HUG') continue;
    for (const child of node.children ?? []) {
      if (inFlow(child) && sizingOf(child, axis) === 'FILL') {
        issues.push(
          issue(
            'fill-in-hug-parent',
            child.key,
            `"${child.key}" fills ${AXIS_NAME[axis]}ly inside "${key}", which hugs that axis; Figma makes such a parent FIXED.`,
          ),
        );
      }
    }
  }
}

function checkAsChild(node: SimNode, parent: SimNode, issues: SimIssue[]): void {
  const { key } = node;
  const absolute = node.positioning === 'ABSOLUTE';
  const inStackFlow = isStack(parent.layout) && !absolute;
  if (!inStackFlow) {
    for (const axis of AXES) {
      if (sizingOf(node, axis) === 'FILL') {
        const where = absolute ? 'an ABSOLUTE child' : 'a child of a frame without auto layout';
        issues.push(
          issue('fill-without-stack-parent', key, `"${key}" fills ${AXIS_NAME[axis]}ly but is ${where}; use FIXED.`),
        );
      }
    }
    if (node.xy === undefined) {
      const why = absolute ? 'is ABSOLUTE' : 'is in a frame without auto layout';
      issues.push(issue('missing-xy', key, `"${key}" ${why} but has no xy position.`));
    }
  } else if (node.transformed === true) {
    issues.push(
      issue('unsupported-transform', key, `"${key}" is rotated, skewed or scaled inside auto layout; not simulated.`),
    );
  }
}

function checkNumbers(node: SimNode, issues: SimIssue[]): void {
  const bad: string[] = [];
  const nonNegative = (label: string, value: number | undefined) => {
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) bad.push(`${label} = ${value}`);
  };
  const finite = (label: string, value: number | undefined) => {
    if (value !== undefined && !Number.isFinite(value)) bad.push(`${label} = ${value}`);
  };
  nonNegative('size.w', node.size.w);
  nonNegative('size.h', node.size.h);
  nonNegative('min.w', node.min?.w);
  nonNegative('min.h', node.min?.h);
  nonNegative('max.w', node.max?.w);
  nonNegative('max.h', node.max?.h);
  finite('xy.x', node.xy?.x);
  finite('xy.y', node.xy?.y);
  finite('baseline', node.baseline);
  const weight = node.stroke?.weight;
  if (weight !== undefined)
    for (const side of ['t', 'r', 'b', 'l'] as const) nonNegative(`stroke.${side}`, weight[side]);
  const { layout } = node;
  if (isStack(layout)) {
    for (const side of ['t', 'r', 'b', 'l'] as const) nonNegative(`padding.${side}`, layout.padding[side]);
    finite('itemSpacing', layout.itemSpacing);
  }
  if (bad.length > 0) {
    issues.push(issue('invalid-number', node.key, `"${node.key}" has invalid numbers: ${bad.join(', ')}.`));
  }
  for (const axis of AXES) {
    const dim = DIMENSION[axis];
    const lo = node.min?.[dim];
    const hi = node.max?.[dim];
    if (lo !== undefined && hi !== undefined && lo > hi) {
      issues.push(
        issue('invalid-bounds', node.key, `"${node.key}" has min.${dim} ${lo} greater than max.${dim} ${hi}.`),
      );
    }
  }
}
