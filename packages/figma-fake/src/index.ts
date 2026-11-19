import type { FigmaPort } from '@holotype/plugin/port';
import { NotImplementedError } from '@holotype/shared';

/** A serializable view of the fake document, for snapshot tests (12 §1.1, L3). */
export interface FakeTree {
  readonly type: 'DOCUMENT';
  readonly children: readonly FakePage[];
  /** Messages passed to `notify()`, in order. */
  readonly notifications: readonly string[];
}

export interface FakePage {
  readonly type: 'PAGE';
  readonly name: string;
  readonly children: readonly unknown[];
}

export type FakeFigma = FigmaPort & { snapshot(): FakeTree };

/** Members the fake implements; everything else throws until the applier needs it. */
type Implemented = 'notify' | 'commitUndo' | 'mixed' | 'skipInvisibleInstanceChildren';

/**
 * Creates an in-memory Figma behind the plugin's `FigmaPort`. Each method must throw
 * exactly where Figma throws; that contract table comes from spikes S-02, S-05 and S-06.
 */
export function createFakeFigma(): FakeFigma {
  const notifications: string[] = [];
  const pages: FakePage[] = [{ type: 'PAGE', name: 'Page 1', children: [] }];

  const implemented: Pick<FigmaPort, Implemented> & { snapshot(): FakeTree } = {
    mixed: Symbol('figma.mixed') as unknown as FigmaPort['mixed'],
    skipInvisibleInstanceChildren: false,
    notify(message) {
      notifications.push(message);
      return { cancel: () => {} };
    },
    commitUndo() {},
    snapshot: () => structuredClone({ type: 'DOCUMENT', children: pages, notifications }),
  };

  return new Proxy(implemented, {
    get(target, key, receiver) {
      if (key in target) return Reflect.get(target, key, receiver);
      if (typeof key === 'symbol' || key === 'then') return undefined;
      return () => {
        throw new NotImplementedError(`figma-fake: FigmaPort.${key}`, 'Phase 1');
      };
    },
  }) as FakeFigma;
}
