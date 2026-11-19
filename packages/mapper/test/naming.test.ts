import type { CNode, ScenePropertyDef } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { classFilter, hasHashSuffix } from '../src/naming/classes';
import { assignKeys, kebab, keySegment, pathSignature } from '../src/naming/keys';
import { assignNames, humanize, layerName } from '../src/naming/names';
import { DEFAULT_MAPPER_SETTINGS } from '../src/settings';
import { variantName } from '../src/stages/naming';
import { liftNode } from '../src/state';
import { loadCapture } from './support';

const keepClass = classFilter(DEFAULT_MAPPER_SETTINGS.naming.stripClassPatterns);
const template = loadCapture('card').root;

/** A bare element capture node with the given source fields. */
function node(source: Partial<CNode['source']>, children: CNode[] = []): CNode {
  return { ...template, id: source.path ?? 'x', source: { tag: 'div', path: 'p', ...source }, children };
}

describe('class filtering', () => {
  it('skips utility, CSS-module and CSS-in-JS classes, and configured patterns', () => {
    for (const utility of [
      'px-2',
      'flex-col',
      'css-1x2y3z',
      'sc-abc',
      'emotion-0',
      'md:flex',
      'Button_primary__x7a3B',
    ]) {
      expect(keepClass(utility)).toBe(false);
    }
    for (const semantic of ['card', 'card__header', 'btn--primary', '_btn_x7a3', 'flex'])
      expect(keepClass(semantic)).toBe(true);
    expect(classFilter(['plain', '/^js-/g'])('plain')).toBe(false);
    const withGlobal = classFilter(['/^js-/g']);
    // A global pattern must not keep state between calls.
    expect([withGlobal('js-a'), withGlobal('js-a')]).toEqual([false, false]);
  });

  it('recognizes hash suffixes only when they contain a digit', () => {
    expect(hasHashSuffix('_btn_1f9c2')).toBe(true);
    expect(hasHashSuffix('card__header')).toBe(false);
  });
});

describe('node keys (10 §4)', () => {
  const context = { boundaries: new Map([['boundary', 'StarIcon']]), keepClass };

  it('kebab-cases anchors', () => {
    expect(kebab('StarIcon')).toBe('star-icon');
    expect(kebab('btn_label 2')).toBe('btn-label-2');
    expect(kebab('日本')).toBe('');
  });

  it('takes the first anchor: key, test id, boundary, role, ARIA label', () => {
    expect(keySegment(node({ figmaKey: 'Leading', testId: 't' }), context)).toBe('leading');
    expect(keySegment(node({ testId: 'btnLabel', role: 'img' }), context)).toBe('btn-label');
    expect(keySegment({ ...node({ role: 'img' }), id: 'boundary' }, context)).toBe('star-icon');
    expect(keySegment(node({ role: 'img', ariaLabel: 'Star' }), context)).toBe('img');
    expect(keySegment(node({ ariaLabel: 'Close dialog' }), context)).toBe('close-dialog');
    expect(keySegment(node({ figmaKey: '日本', tag: 'span' }), context)).toBe('span');
  });

  it('falls back to the path signature `<tag>.<first semantic class>`', () => {
    expect(pathSignature(node({ tag: 'div', classes: ['px-2', 'card__body'] }), keepClass)).toBe('div.card__body');
    expect(pathSignature(node({ tag: '::before', pseudo: 'before' }), keepClass)).toBe('before');
    expect(pathSignature(node({ tag: '#text' }), keepClass)).toBe('text');
  });

  it('numbers repeated segments among siblings with #k', () => {
    const root = liftNode(
      node({ tag: 'ul' }, [node({ tag: 'li' }), node({ tag: 'li' }), node({ tag: 'li', testId: 'last' })]),
    );
    assignKeys(root, context);
    expect(root.children.map((child) => child.nk)).toEqual(['root/li', 'root/li#2', 'root/last']);
  });
});

describe('layer names (07 §12)', () => {
  const context = { layers: DEFAULT_MAPPER_SETTINGS.naming.layers, boundaries: new Map<string, string>(), keepClass };

  it('humanizes identifiers', () => {
    expect(humanize('btn-label')).toBe('Btn label');
    expect(humanize('primaryAction')).toBe('Primary action');
  });

  it('follows the naming.layers order, then text, then kind', () => {
    expect(layerName(liftNode(node({ figmaName: 'Hero', testId: 'x' })), context)).toBe('Hero');
    expect(layerName(liftNode(node({ role: 'button' })), context)).toBe('Button');
    expect(layerName(liftNode(node({ tag: 'nav' })), context)).toBe('Navigation');
    expect(layerName(liftNode(node({ classes: ['menu__item--active'] })), context)).toBe('Item');
    expect(layerName(liftNode(node({ classes: ['badge--large'] })), context)).toBe('Badge');
    expect(layerName(liftNode(node({ tag: 'div' })), context)).toBe('Frame');
    expect(layerName(liftNode(node({ tag: '::after', pseudo: 'after' })), context)).toBe('After');
    const onlyClass = { ...context, layers: ['class'] };
    expect(layerName(liftNode(node({ figmaName: 'Ignored', classes: ['card'] })), onlyClass)).toBe('Card');
  });

  it('names text nodes by their first 40 characters, whitespace collapsed', () => {
    const runs = loadCapture('texts').root.children[0];
    if (!runs?.text) throw new Error('fixture text missing');
    const long: CNode = {
      ...runs,
      source: { tag: 'span', path: 'p' },
      text: { ...runs.text, characters: `  ${'word '.repeat(12)}` },
    };
    expect(layerName(liftNode(long), context)).toBe('word word word word word word word word');
  });

  it('makes sibling names unique in child order', () => {
    const root = liftNode(node({}, [node({ tag: 'li' }), node({ tag: 'li' }), node({ figmaName: 'Item 2' })]));
    assignNames(root, 'List', context);
    expect([root.name, ...root.children.map((child) => child.name)]).toEqual(['List', 'Item', 'Item 2', 'Item 2 2']);
  });

  it('builds Figma variant names in property order', () => {
    const source = { kind: 'arg', classification: 'VARIANT', evidence: 'declared' } as const;
    const properties: ScenePropertyDef[] = [
      { type: 'VARIANT', key: 'arg:size', name: 'Size', values: ['Large'], defaultValue: 'Large', source },
      { type: 'VARIANT', key: 'state', name: 'State', values: ['Hover'], defaultValue: 'Hover', source },
    ];
    expect(variantName(properties, { state: 'Hover', 'arg:size': 'Large' })).toBe('Size=Large, State=Hover');
    expect(variantName([], {})).toBe('');
  });
});
