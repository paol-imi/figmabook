import { describe, expect, it } from 'vitest';
import { type AutoLayoutSpec, measureHug, simulateAutoLayout, simulateGrid } from '../src';

const row: AutoLayoutSpec = {
  layoutMode: 'HORIZONTAL',
  paddingTop: 8,
  paddingRight: 16,
  paddingBottom: 8,
  paddingLeft: 16,
  itemSpacing: 4,
  primaryAxisAlignItems: 'MIN',
  counterAxisAlignItems: 'CENTER',
};
const icon = { width: 16, height: 16 };
const label = { width: 40, height: 20 };

describe('simulateAutoLayout', () => {
  it('hugs a button-like row: padding + children + gaps', () => {
    expect(measureHug(row, [icon, label])).toEqual({ width: 16 + 16 + 4 + 40 + 16, height: 8 + 20 + 8 });
    expect(simulateAutoLayout(row, [icon, label])).toEqual({
      width: 92,
      height: 36,
      children: [
        { x: 16, y: 10, w: 16, h: 16 },
        { x: 36, y: 8, w: 40, h: 20 },
      ],
    });
  });

  it('distributes free space with SPACE_BETWEEN in a FIXED container', () => {
    const { children } = simulateAutoLayout({ ...row, width: 200, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [
      icon,
      label,
    ]);
    expect(children.map((c) => c.x)).toEqual([16, 200 - 16 - 40]);
  });

  it('stacks vertically and aligns on the counter axis', () => {
    const column: AutoLayoutSpec = { ...row, layoutMode: 'VERTICAL', counterAxisAlignItems: 'MAX', width: 100 };
    const { children, height } = simulateAutoLayout(column, [icon, label]);
    expect(height).toBe(8 + 16 + 4 + 20 + 8);
    expect(children).toEqual([
      { x: 100 - 16 - 16, y: 8, w: 16, h: 16 },
      { x: 100 - 16 - 40, y: 28, w: 40, h: 20 },
    ]);
  });

  it('leaves the grid model to spike S-10', () => {
    expect(() => simulateGrid({ columns: 2, rows: 1 }, [icon])).toThrow(/S-10/);
  });
});
