/** What the registry needs to know about an instance. */
export interface RegisteredInstance<T> {
  readonly mainComponent: T | null;
  readonly removed: boolean;
}

/**
 * Instances by the main component they mirror: top-level instances and swapped nested
 * instances (`components/instances.ts`). Generic so that `state.ts` can name it without an
 * import cycle.
 */
export class InstanceRegistry<T extends RegisteredInstance<T>> {
  readonly #byMain = new Map<T, Set<T>>();

  add(instance: T): void {
    const main = instance.mainComponent;
    if (!main) return;
    const set = this.#byMain.get(main) ?? new Set<T>();
    set.add(instance);
    this.#byMain.set(main, set);
  }

  delete(instance: T): void {
    const main = instance.mainComponent;
    if (main) this.#byMain.get(main)?.delete(instance);
  }

  /** Live instances of `main`, in creation order. */
  of(main: T): T[] {
    return [...(this.#byMain.get(main) ?? [])].filter((instance) => !instance.removed);
  }
}
