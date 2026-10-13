export interface AdminCapabilities {
  persistenceMode: 'postgres' | 'memory' | 'static';
  writable: boolean;
  databaseBacked: boolean;
  createAllowed: boolean;
  editAllowed: boolean;
}

export function capabilitiesFrom(value: { capabilities?: Partial<AdminCapabilities>; persistence?: string }): AdminCapabilities {
  const raw = value.capabilities ?? {};
  const databaseBacked = raw.databaseBacked ?? (value.persistence === 'publisher-store' || raw.persistenceMode === 'postgres');
  const writable = raw.writable ?? databaseBacked;
  const persistenceMode = raw.persistenceMode ?? (databaseBacked ? 'postgres' : value.persistence === 'memory' ? 'memory' : 'static');
  return { persistenceMode, writable, databaseBacked, createAllowed: raw.createAllowed ?? writable, editAllowed: raw.editAllowed ?? writable };
}

export function modeLabel(capabilities: AdminCapabilities): string {
  if (capabilities.databaseBacked) return 'Production registry · writable';
  if (capabilities.writable) return 'Development registry · in memory';
  return 'Static configuration · read-only';
}

export function modeCopy(capabilities: AdminCapabilities): string {
  if (capabilities.databaseBacked) return 'Changes are saved to the production publisher registry and applied to the runtime immediately.';
  if (capabilities.writable) return 'Changes are available for this development session and are held in the in-memory publisher registry.';
  return 'The registry is source-controlled. Use validation and export to prepare a safe code change.';
}
