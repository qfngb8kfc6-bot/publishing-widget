import { describe, expect, it, vi } from 'vitest';
import { createStructuredLogger, logHeapUsage } from '../src/server/logging';

describe('heap_usage log', () => {
  it('is written in production with memory figures in MB only', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((...parts: unknown[]) => { lines.push(parts.map(String).join(' ')); });
    logHeapUsage(createStructuredLogger('production'), 'snapshot_hydrated', 'sgi-europe');
    spy.mockRestore();
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0].replace('[publisher-widget] ', ''));
    expect(payload).toMatchObject({ message: 'heap_usage', stage: 'snapshot_hydrated', publisherId: 'sgi-europe' });
    for (const field of ['heapUsedMb', 'heapTotalMb', 'rssMb', 'externalMb']) expect(typeof payload[field]).toBe('number');
  });
});
