/** Default longest stretch of synchronous work before yielding, so timers and I/O are never starved for long. */
export const DEFAULT_SLICE_MS = 15;

function clockMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));
}

/**
 * Maps a large array in time-boxed slices, yielding to the event loop between slices. Results and order are
 * exactly those of items.map(map); only the scheduling differs.
 */
export async function mapInSlices<T, R>(items: readonly T[], map: (item: T, index: number) => R, sliceMs = DEFAULT_SLICE_MS): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  while (index < items.length) {
    const sliceStartedAt = clockMs();
    do {
      results[index] = map(items[index], index);
      index += 1;
    } while (index < items.length && clockMs() - sliceStartedAt < sliceMs);
    if (index < items.length) await yieldToEventLoop();
  }
  return results;
}
