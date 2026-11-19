import type { ScenePropertyDef } from '@holotype/ir';

/*
 * Variant placement in the set grid (06 §3.2, 07 §0). Columns and rows are the mixed-radix
 * index of the variant's values on the planner's column and row axes. More columns than
 * `figma.grid.maxColumns` wrap onto extra rows. When the axes do not give every variant its
 * own cell (sparse sets, axes on neither side), variants fill the grid in plan order.
 */

export interface GridCell {
  readonly row: number;
  readonly col: number;
}

export interface SetGrid {
  readonly columnsBy: string[];
  readonly rowsBy: string[];
  /** One cell per variant, in the order given. */
  readonly cells: GridCell[];
}

export interface GridInput {
  readonly properties: readonly ScenePropertyDef[];
  /** `ComponentPlan.layoutGrid`. */
  readonly layoutGrid: { readonly columns: readonly string[]; readonly rows: readonly string[] };
  /** Variant values (VARIANT key → value), in plan order. */
  readonly variants: readonly Readonly<Record<string, string>>[];
  readonly maxColumns: number;
}

type VariantDef = Extract<ScenePropertyDef, { type: 'VARIANT' }>;

function mixedRadix(values: Readonly<Record<string, string>>, axes: readonly VariantDef[]): number {
  return axes.reduce(
    (index, def) => index * def.values.length + Math.max(0, def.values.indexOf(values[def.key] ?? '')),
    0,
  );
}

export function placeVariants(input: GridInput): SetGrid {
  const { properties, layoutGrid, variants, maxColumns } = input;
  const defs = new Map<string, VariantDef>();
  for (const def of properties) if (def.type === 'VARIANT') defs.set(def.key, def);
  const pick = (keys: readonly string[], exclude: ReadonlySet<string>): VariantDef[] =>
    keys.flatMap((key) => {
      const def = defs.get(key);
      return def && !exclude.has(key) ? [def] : [];
    });
  const columnAxes = pick(layoutGrid.columns, new Set());
  const rowAxes = pick(layoutGrid.rows, new Set(columnAxes.map((def) => def.key)));
  const columnCount = columnAxes.reduce((count, def) => count * def.values.length, 1);
  const bands = Math.ceil(columnCount / maxColumns);

  const cells = variants.map((values) => {
    const col = mixedRadix(values, columnAxes);
    const row = mixedRadix(values, rowAxes);
    return bands > 1 ? { row: row * bands + Math.floor(col / maxColumns), col: col % maxColumns } : { row, col };
  });
  const distinct = new Set(cells.map((cell) => `${cell.row}:${cell.col}`));
  if (distinct.size === cells.length) {
    return { columnsBy: columnAxes.map((def) => def.key), rowsBy: rowAxes.map((def) => def.key), cells };
  }
  return {
    columnsBy: [],
    rowsBy: [],
    cells: variants.map((_, i) => ({ row: Math.floor(i / maxColumns), col: i % maxColumns })),
  };
}
