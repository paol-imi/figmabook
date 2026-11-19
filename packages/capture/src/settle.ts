/// <reference lib="dom" />
/*
 * The capture settle step (05 §1.1 "Animations"), run in the page after the driver's render
 * settle. Playwright serializes the function with `Function.prototype.toString`, so it is
 * self-contained.
 */

export interface AnimationSettle {
  /** Finite Web Animations jumped to their end. */
  readonly finished: number;
  /** Infinite animations paused at t = 0 (`CAP_ANIMATION_FROZEN`). */
  readonly frozen: number;
}

/**
 * Finishes finite Web Animations (`mode: 'finish'`), freezes infinite ones at t = 0, then
 * waits for two animation frames so the result is painted.
 */
export async function settleAnimations(mode: 'finish' | 'pause-only'): Promise<AnimationSettle> {
  let finished = 0;
  let frozen = 0;
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming();
    const infinite = timing?.iterations === Number.POSITIVE_INFINITY || timing?.endTime === Number.POSITIVE_INFINITY;
    if (infinite) {
      animation.pause();
      animation.currentTime = 0;
      frozen += 1;
      continue;
    }
    if (animation.playState === 'finished') continue;
    if (mode === 'finish') {
      animation.finish();
      finished += 1;
    } else {
      animation.pause();
    }
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { finished, frozen };
}
