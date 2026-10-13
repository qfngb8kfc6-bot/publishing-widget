import type { PublisherManifest } from './manifest';

export interface PublisherRecord {
  manifest: PublisherManifest;
  createdAt: string;
  updatedAt: string;
}

export interface PublisherStore {
  /** Identifies the persistence boundary for admin capability reporting. */
  readonly mode?: 'memory' | 'postgres';
  list(): Promise<PublisherRecord[]>;
  get(publisherId: string): Promise<PublisherRecord | null>;
  create(manifest: PublisherManifest): Promise<PublisherRecord>;
  update(manifest: PublisherManifest): Promise<PublisherRecord>;
}

export class PublisherStoreError extends Error {
  readonly code: 'not_found' | 'already_exists' | 'invalid_record' | 'unavailable';
  constructor(code: PublisherStoreError['code'], message: string) {
    super(message);
    this.name = 'PublisherStoreError';
    this.code = code;
  }
}

const sensitiveHeader = /authorization|api[-_]?key|token|secret|password|cookie|set-cookie/i;

function assertNoSecretValues(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:^|[-_])(api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|credential|cookie)(?:$|[-_])/i.test(key) && !/^secretRef$|^secretConfigured$/i.test(key)) {
      throw new PublisherStoreError('invalid_record', 'Publisher configuration must use secretRef instead of raw credentials.');
    }
    assertNoSecretValues(child);
  }
}

function storageManifest(manifest: PublisherManifest): PublisherManifest {
  const copy = cloneManifest(manifest) as PublisherManifest & { contentSource?: Record<string, unknown> };
  assertNoSecretValues(copy);
  const source = copy.contentSource as Record<string, unknown> | undefined;
  if (!source) return copy;
  const headers = source.headers;
  if (headers && typeof headers === 'object' && Object.keys(headers as object).some((name) => sensitiveHeader.test(name))) throw new PublisherStoreError('invalid_record', 'Publisher source headers must not contain credentials.');
  const authentication = source.authentication;
  if (authentication && typeof authentication === 'object' && 'secret' in authentication) throw new PublisherStoreError('invalid_record', 'Publisher source credentials must use secretRef.');
  return copy;
}

function cloneManifest(manifest: PublisherManifest): PublisherManifest {
  return structuredClone(manifest);
}

function cloneRecord(record: PublisherRecord): PublisherRecord {
  return { ...record, manifest: cloneManifest(record.manifest) };
}

/** Development/test persistence with the same contract as Postgres. */
export class MemoryPublisherStore implements PublisherStore {
  readonly mode = 'memory' as const;
  private readonly records = new Map<string, PublisherRecord>();

  constructor(manifests: PublisherManifest[] = []) {
    for (const manifest of manifests) {
      const now = new Date().toISOString();
      this.records.set(manifest.publisherId, { manifest: storageManifest(manifest), createdAt: now, updatedAt: now });
    }
  }

  async list(): Promise<PublisherRecord[]> {
    return [...this.records.values()].map(cloneRecord);
  }

  async get(publisherId: string): Promise<PublisherRecord | null> {
    const record = this.records.get(publisherId);
    return record ? cloneRecord(record) : null;
  }

  async create(manifest: PublisherManifest): Promise<PublisherRecord> {
    if (this.records.has(manifest.publisherId)) throw new PublisherStoreError('already_exists', 'Publisher already exists.');
    const now = new Date().toISOString();
    const record = { manifest: storageManifest(manifest), createdAt: now, updatedAt: now };
    this.records.set(manifest.publisherId, record);
    return cloneRecord(record);
  }

  async update(manifest: PublisherManifest): Promise<PublisherRecord> {
    const existing = this.records.get(manifest.publisherId);
    if (!existing) throw new PublisherStoreError('not_found', 'Publisher was not found.');
    const record = { ...existing, manifest: storageManifest(manifest), updatedAt: new Date().toISOString() };
    this.records.set(manifest.publisherId, record);
    return cloneRecord(record);
  }
}

export interface PublisherSqlClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

/** Postgres persistence. Only the public manifest and secret references are stored. */
export class PostgresPublisherStore implements PublisherStore {
  readonly mode = 'postgres' as const;
  constructor(private readonly client: PublisherSqlClient) {}

  async list(): Promise<PublisherRecord[]> {
    const result = await this.client.query<PublisherRow>('SELECT publisher_id, manifest_json, created_at, updated_at FROM publishers ORDER BY publisher_id ASC');
    return result.rows.map(toRecord);
  }

  async get(publisherId: string): Promise<PublisherRecord | null> {
    const result = await this.client.query<PublisherRow>('SELECT publisher_id, manifest_json, created_at, updated_at FROM publishers WHERE publisher_id = $1 LIMIT 1', [publisherId]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async create(manifest: PublisherManifest): Promise<PublisherRecord> {
    if (await this.get(manifest.publisherId)) throw new PublisherStoreError('already_exists', 'Publisher already exists.');
    const safeManifest = storageManifest(manifest);
    const result = await this.client.query<PublisherRow>(
      `INSERT INTO publishers (publisher_id, manifest_json) VALUES ($1, $2::jsonb) RETURNING publisher_id, manifest_json, created_at, updated_at`,
      [safeManifest.publisherId, JSON.stringify(safeManifest)],
    );
    return toRecord(result.rows[0]);
  }

  async update(manifest: PublisherManifest): Promise<PublisherRecord> {
    const safeManifest = storageManifest(manifest);
    const result = await this.client.query<PublisherRow>(
      `UPDATE publishers SET manifest_json = $2::jsonb, updated_at = NOW() WHERE publisher_id = $1 RETURNING publisher_id, manifest_json, created_at, updated_at`,
      [safeManifest.publisherId, JSON.stringify(safeManifest)],
    );
    if (!result.rows[0]) throw new PublisherStoreError('not_found', 'Publisher was not found.');
    return toRecord(result.rows[0]);
  }
}

interface PublisherRow {
  publisher_id: string;
  manifest_json: PublisherManifest | string;
  created_at: string | Date;
  updated_at: string | Date;
}

function toRecord(row: PublisherRow): PublisherRecord {
  const parsed = typeof row.manifest_json === 'string' ? JSON.parse(row.manifest_json) as PublisherManifest : row.manifest_json;
  if (!parsed || typeof parsed !== 'object' || parsed.publisherId !== row.publisher_id) throw new PublisherStoreError('invalid_record', 'Publisher store returned an invalid manifest.');
  return { manifest: cloneManifest(parsed), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
