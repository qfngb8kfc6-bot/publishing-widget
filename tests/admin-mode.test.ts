import { describe, expect, it } from 'vitest';
import { capabilitiesFrom, modeLabel } from '../src/admin-mode';

describe('admin runtime mode presentation', () => {
  it('does not render the static read-only mode for a writable production registry', () => {
    const capabilities = capabilitiesFrom({ persistence: 'publisher-store', capabilities: { persistenceMode: 'postgres', writable: true, databaseBacked: true, createAllowed: true, editAllowed: true } });
    expect(modeLabel(capabilities)).toBe('Production registry · writable');
    expect(modeLabel(capabilities)).not.toContain('Static configuration');
  });

  it('keeps the static fallback read-only when no store is available', () => {
    const capabilities = capabilitiesFrom({ persistence: 'static' });
    expect(capabilities).toMatchObject({ persistenceMode: 'static', writable: false, createAllowed: false, editAllowed: false });
    expect(modeLabel(capabilities)).toBe('Static configuration · read-only');
  });
});
