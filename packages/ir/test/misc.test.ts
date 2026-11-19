import { describe, expect, it } from 'vitest';
import {
  captureNumKind,
  checkSceneInvariants,
  invariantDiagnostics,
  type SceneComponent,
  sceneNumKind,
  sourceLocKey,
} from '../src';
import { validDoc } from './corpus';

describe('number kinds (06 §5)', () => {
  it.each([
    [['variants', 0, 'root', 'fills', 0, 'color', 'r'], 'ratio'],
    [['variants', 0, 'root', 'opacity'], 'ratio'],
    [['fills', 0, 'gradientStops', 1, 'position'], 'ratio'],
    [['root', 'layout', 'padding', 'r'], 'px'],
    [['root', 'strokes', 'weight', 'b'], 'px'],
    [['root', 'relativeTransform', 0, 2], 'matrix'],
    [['fills', 0, 'gradientTransform', 1, 0], 'matrix'],
    [['root', 'size', 'w'], 'px'],
  ] as const)('scene %j is %s', (path, kind) => {
    expect(sceneNumKind(path)).toBe(kind);
  });

  it.each([
    [['root', 'computed', 'background', 'layers', 0, 'image', 'angleDeg'], 'angle'],
    [['root', 'computed', 'background', 'layers', 0, 'image', 'stops', 0, 'offset'], 'ratio'],
    [['root', 'computed', 'outline', 'offset'], 'px'],
    [['root', 'transform', 1, 2], 'matrix'],
    [['root', 'computed', 'color', 'a'], 'ratio'],
    [['root', 'computed', 'padding', 1], 'px'],
  ] as const)('capture %j is %s', (path, kind) => {
    expect(captureNumKind(path)).toBe(kind);
  });
});

describe('invariantDiagnostics', () => {
  it('turns violations into PLAN_INVARIANT_VIOLATION errors for the component', () => {
    const scene = structuredClone(validDoc('scene', 'button.json')) as SceneComponent;
    scene.dependencies = [];
    const [diagnostic, ...rest] = invariantDiagnostics(scene.sid, checkSceneInvariants(scene));
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({
      code: 'PLAN_INVARIANT_VIOLATION',
      severity: 'error',
      sid: 'components-button',
      message: expect.stringContaining('dependencies at /dependencies'),
      data: { invariant: 'dependencies', path: '/dependencies' },
    });
  });
});

describe('pipeline helpers', () => {
  it('sourceLocKey joins a stylesheet id and a 0-based range start', () => {
    expect(sourceLocKey('style-sheet-12-1', 13, 2)).toBe('style-sheet-12-1:13:2');
  });
});
