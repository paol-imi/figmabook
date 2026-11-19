/**
 * Component affinity for the worker pool (05 §1.1): every variant of a component goes to one
 * worker, so its warm page stays on the same story; components spread across workers. A key
 * keeps its slot for the scheduler's lifetime. A new key takes the least loaded slot (lowest
 * index on ties), where load counts the jobs queued or running there.
 */
export class AffinityScheduler<K> {
  private readonly slotOf = new Map<K, number>();
  private readonly loads: number[];

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`The pool needs at least one worker, got ${size}.`);
    this.loads = Array.from({ length: size }, () => 0);
  }

  /** The slot for `key`, counted as one more job there until {@link release}. */
  acquire(key: K): number {
    let slot = this.slotOf.get(key);
    if (slot === undefined) {
      slot = this.leastLoaded();
      this.slotOf.set(key, slot);
    }
    this.loads[slot] = (this.loads[slot] ?? 0) + 1;
    return slot;
  }

  /** Marks one job of `slot` as done. */
  release(slot: number): void {
    const load = this.loads[slot];
    if (load === undefined || load === 0) throw new RangeError(`Slot ${slot} has no job to release.`);
    this.loads[slot] = load - 1;
  }

  /** Jobs queued or running per slot. */
  load(): readonly number[] {
    return [...this.loads];
  }

  private leastLoaded(): number {
    let best = 0;
    for (let slot = 1; slot < this.size; slot++) {
      if ((this.loads[slot] ?? 0) < (this.loads[best] ?? 0)) best = slot;
    }
    return best;
  }
}

/** Runs tasks one at a time, in the order they were added. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves once every task added so far has settled. */
  async drain(): Promise<void> {
    await this.tail;
  }
}
