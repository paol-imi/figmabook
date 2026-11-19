import { describe, expect, it } from 'vitest';
import { collectors } from '../src/page/collectors/index';
import { parseCornerRadius } from '../src/page/collectors/paint/radius';
import { createsStackingContext, paintLayer, parseZIndex } from '../src/page/collectors/paint-order';
import { isPx, px, sides, unionRects } from '../src/page/css';

/** A computed style with defaults for the properties the paint-order collector reads. */
function style(overrides: Partial<Record<string, string>> = {}): CSSStyleDeclaration {
  return {
    position: 'static',
    zIndex: 'auto',
    opacity: '1',
    transform: 'none',
    translate: 'none',
    rotate: 'none',
    scale: 'none',
    filter: 'none',
    backdropFilter: 'none',
    clipPath: 'none',
    maskImage: 'none',
    isolation: 'auto',
    mixBlendMode: 'normal',
    contain: 'none',
    willChange: 'auto',
    float: 'none',
    display: 'block',
    ...overrides,
  } as unknown as CSSStyleDeclaration;
}

describe('collector registry', () => {
  it('lists the v0 collectors in order, geometry first', () => {
    expect(collectors.map((collector) => collector.name)).toEqual([
      'geometry',
      'box',
      'background',
      'border',
      'radius',
      'opacity',
      'effects',
      'paint-order',
      'text',
      'unsupported',
    ]);
    expect(new Set(collectors.map((collector) => collector.name)).size).toBe(collectors.length);
  });
});

describe('parseCornerRadius', () => {
  it('reads px, elliptical pairs and percentages of the border box', () => {
    expect(parseCornerRadius('8px', 100, 40)).toEqual([8, 8]);
    expect(parseCornerRadius('8px 4px', 100, 40)).toEqual([8, 4]);
    expect(parseCornerRadius('50%', 100, 40)).toEqual([50, 20]);
    expect(parseCornerRadius('10% 4px', 100, 40)).toEqual([10, 4]);
    expect(parseCornerRadius('0px', 100, 40)).toEqual([0, 0]);
    expect(parseCornerRadius('0', 100, 40)).toEqual([0, 0]);
  });

  it('returns null for values it cannot resolve', () => {
    expect(parseCornerRadius('calc(50% + 2px)', 100, 40)).toBeNull();
    expect(parseCornerRadius('1em', 100, 40)).toBeNull();
    expect(parseCornerRadius('1px 2px 3px', 100, 40)).toBeNull();
  });
});

describe('paint order (05 §8)', () => {
  it('parses z-index', () => {
    expect(parseZIndex('auto')).toBe('auto');
    expect(parseZIndex('3')).toBe(3);
    expect(parseZIndex('-1')).toBe(-1);
  });

  it('detects stacking contexts', () => {
    expect(createsStackingContext(style(), 'block')).toBe(false);
    expect(createsStackingContext(style({ opacity: '0.5' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ position: 'relative', zIndex: '1' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ position: 'relative' }), 'block')).toBe(false);
    // z-index on a static box applies only to flex and grid items.
    expect(createsStackingContext(style({ zIndex: '2' }), 'block')).toBe(false);
    expect(createsStackingContext(style({ zIndex: '2' }), 'flex')).toBe(true);
    expect(createsStackingContext(style({ position: 'sticky' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ transform: 'matrix(1, 0, 0, 1, 2, 0)' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ isolation: 'isolate' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ contain: 'paint' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ willChange: 'transform' }), 'block')).toBe(true);
    expect(createsStackingContext(style({ willChange: 'contents' }), 'block')).toBe(false);
  });

  it('assigns the Appendix E layer', () => {
    expect(paintLayer(style(), 'block')).toBe('block');
    expect(paintLayer(style({ display: 'inline-flex' }), 'block')).toBe('inline');
    expect(paintLayer(style({ float: 'left' }), 'block')).toBe('float');
    expect(paintLayer(style({ position: 'absolute' }), 'block')).toBe('positioned');
    expect(paintLayer(style({ position: 'absolute', zIndex: '0' }), 'block')).toBe('positioned');
    expect(paintLayer(style({ position: 'absolute', zIndex: '-1' }), 'block')).toBe('negative');
    expect(paintLayer(style({ zIndex: '5' }), 'grid')).toBe('positive');
    expect(paintLayer(style({ zIndex: '5' }), 'block')).toBe('block');
  });
});

describe('css helpers', () => {
  it('reads px values', () => {
    expect(px('12.5px')).toBe(12.5);
    expect(px('auto')).toBe(0);
    expect(px('normal', -1)).toBe(-1);
    expect(isPx('12px')).toBe(true);
    expect(isPx('-0.5px')).toBe(true);
    expect(isPx('auto')).toBe(false);
    expect(isPx('50%')).toBe(false);
  });

  it('reads sides in CSS order', () => {
    expect(sides((side) => side)).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('unions rects', () => {
    expect(
      unionRects([
        { x: 0, y: 2, w: 10, h: 4 },
        { x: 5, y: 0, w: 10, h: 3 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 15, h: 6 });
    expect(unionRects([])).toBeNull();
  });
});
