import { ContentSourceError, fetchText } from './security';
import type { WvcEnrichmentSourceConfig } from './types';

/** The API rejects smaller pages. */
export const WVC_MIN_PAGE_SIZE = 50;
const WVC_MAX_PAGE_SIZE = 200;
/** Stored plain text is capped here; matching and AI only ever read a short lead of it. */
export const ARTICLE_TEXT_MAX_CHARS = 20_000;
const DEFAULT_PAGE_MAX_BYTES = 12 * 1024 * 1024;

export type WvcErrorCode = 'wvc_not_configured' | 'wvc_auth_invalid' | 'wvc_api_error' | 'wvc_invalid_response' | `wvc_${string}`;

/** Carries a safe code only: upstream messages are never kept, so a key echoed back cannot reach logs or the database. */
export class WvcError extends Error {
  constructor(readonly code: WvcErrorCode) {
    super(code);
    this.name = 'WvcError';
  }
}

export interface WvcStory {
  storyCode: string;
  isPrivate: boolean;
  /** ISO timestamp, when the API gives a parseable LASTMODIFIED. */
  lastModified?: string;
  /** Cleaned plain text, at most ARTICLE_TEXT_MAX_CHARS. */
  text: string;
}

export interface WvcPage {
  page: number;
  totalPages: number;
  totalRecords: number;
  stories: WvcStory[];
}

/** The numeric story code: the id before ".article" in an SGI-style article URL. */
export function storyCodeFromUrl(url: string | undefined): string | undefined {
  return url?.match(/\/(\d{1,12})\.article(?:[?#/]|$)/)?.[1];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', euro: '€', pound: '£', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
  ccedil: 'ç', oacute: 'ó', iacute: 'í', uacute: 'ú', ntilde: 'ñ', deg: '°', bull: '•', middot: '·',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : lower.startsWith('#') ? Number.parseInt(lower.slice(1), 10) : Number.NaN;
    if (Number.isFinite(code)) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/** HTML body → plain text: tags and scripts removed, entities decoded, whitespace collapsed, capped on a word boundary. */
export function cleanStoryText(html: string, maxChars = ARTICLE_TEXT_MAX_CHARS): string {
  const text = decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\u0000-\u001f\u007f ​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(' ', maxChars);
  return text.slice(0, cut > maxChars * 0.8 ? cut : maxChars);
}

function field(record: Record<string, unknown>, name: string): unknown {
  if (name in record) return record[name];
  const key = Object.keys(record).find((candidate) => candidate.toUpperCase() === name);
  return key ? record[key] : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/** LASTMODIFIED as ISO: plain date strings, or the .NET "/Date(ms)/" form. */
export function parseWvcDate(value: unknown): string | undefined {
  const raw = text(value)?.trim();
  if (!raw) return undefined;
  const dotNet = raw.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  const time = dotNet ? Number(dotNet[1]) : Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined);
const isStory = (value: unknown): boolean => Boolean(asRecord(value)) && field(value as Record<string, unknown>, 'STORYCODE') !== undefined;

/**
 * The confirmed shape is Data.seq.STORY, where STORY is an array, or a single object when a page has one story.
 * A present Data.seq without STORY is an empty page. Other shapes fall back to searching Data, PagedData and the
 * top level for a list of objects with STORYCODE.
 */
function storyArray(body: Record<string, unknown>): unknown[] | undefined {
  const data = asRecord(field(body, 'DATA'));
  const seq = data ? asRecord(field(data, 'SEQ')) : undefined;
  if (seq) {
    const stories = field(seq, 'STORY');
    if (Array.isArray(stories)) return stories;
    if (isStory(stories)) return [stories];
    if (stories === undefined || stories === null) return [];
  }
  const isStoryList = (value: unknown): value is unknown[] => Array.isArray(value) && (value.length === 0 || isStory(value[0]));
  const containers = [seq, data, asRecord(field(body, 'PAGEDDATA')), body].filter((value): value is Record<string, unknown> => Boolean(value));
  for (const container of containers) {
    for (const value of Object.values(container)) if (isStoryList(value) && value.length > 0) return value;
  }
  for (const container of containers) {
    for (const value of Object.values(container)) if (isStoryList(value)) return value;
  }
  return undefined;
}

function count(value: unknown): number | undefined {
  const number = Number(text(value));
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

/** Parses one story-list response. Exported for tests; HTTP-200 error payloads become a WvcError code. */
export function parseWvcPage(body: unknown, page: number): WvcPage {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WvcError('wvc_invalid_response');
  const record = body as Record<string, unknown>;
  const errorsFound = field(record, 'ERRORSFOUND');
  if (errorsFound === true || errorsFound === 'true') {
    const messages = field(record, 'MESSAGES');
    const joined = Array.isArray(messages) ? messages.map((message) => (typeof message === 'string' ? message : JSON.stringify(message))).join(' ') : '';
    throw new WvcError(/key|profile|token|auth/i.test(joined) ? 'wvc_auth_invalid' : 'wvc_api_error');
  }
  const paged = field(record, 'PAGEDDATA');
  const pagedRecord = paged && typeof paged === 'object' && !Array.isArray(paged) ? paged as Record<string, unknown> : {};
  const items = storyArray(record);
  const totalPages = count(field(pagedRecord, 'TOTALNUMBEROFPAGES')) ?? count(field(record, 'TOTALNUMBEROFPAGES'));
  if (!items || totalPages === undefined) throw new WvcError('wvc_invalid_response');
  const stories: WvcStory[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const story = item as Record<string, unknown>;
    const storyCode = storyCodeFromUrl(text(field(story, 'STORYURL'))) ?? text(field(story, 'STORYCODE'))?.match(/^\d{1,12}$/)?.[0];
    const body = text(field(story, 'STORYTEXT'));
    if (!storyCode || !body) continue;
    const cleaned = cleanStoryText(body);
    if (!cleaned) continue;
    const isPrivate = String(field(story, 'PRIVATE')).toLowerCase() === 'true';
    const lastModified = parseWvcDate(field(story, 'LASTMODIFIED')) ?? parseWvcDate(field(story, 'DATEPUBLISHED'));
    stories.push({ storyCode, isPrivate, ...(lastModified ? { lastModified } : {}), text: cleaned });
  }
  return { page, totalPages, totalRecords: count(field(pagedRecord, 'TOTALNUMBEROFRECORDS')) ?? count(field(record, 'TOTALNUMBEROFRECORDS')) ?? 0, stories };
}

export function wvcPageUrl(config: WvcEnrichmentSourceConfig, page: number): string {
  const pageSize = Math.min(WVC_MAX_PAGE_SIZE, Math.max(WVC_MIN_PAGE_SIZE, Math.floor(config.pageSize)));
  const dataConstraint = Math.min(4, Math.max(0, Math.floor(config.dataConstraint)));
  // Built by hand so the profile's space is sent as %20 (the API rejects other spellings of the profile name).
  const query = [`profilename=${encodeURIComponent(config.profileName)}`, `pagesize=${pageSize}`, `dataconstraint=${dataConstraint}`, `pagenumber=${Math.max(1, Math.floor(page))}`].join('&');
  const url = new URL(config.baseUrl);
  url.search = '';
  url.hash = '';
  return `${url.toString()}?${query}`;
}

export interface WvcFetchOptions {
  fetchImpl?: typeof fetch;
  resolveSecret: (reference: string) => string | undefined;
}

/** Fetches one page (GET, key in the API_ACCESS_TOKEN header, allowlisted host, no redirects, size-capped). */
export async function fetchWvcPage(config: WvcEnrichmentSourceConfig, page: number, options: WvcFetchOptions): Promise<WvcPage> {
  const key = options.resolveSecret(config.secretRef)?.trim();
  if (!key) throw new WvcError('wvc_not_configured');
  let raw: string;
  try {
    raw = await fetchText(wvcPageUrl(config, page), { method: 'GET', headers: { API_ACCESS_TOKEN: key, Accept: 'application/json' } }, {
      fetchImpl: options.fetchImpl,
      allowedHostnames: config.allowedHostnames,
      maxRedirects: 0,
      timeoutMs: config.timeoutMs ?? 20_000,
      maxBytes: config.maxBytes ?? DEFAULT_PAGE_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof ContentSourceError) throw new WvcError(`wvc_${error.code.replace(/-/g, '_')}`);
    throw new WvcError('wvc_api_error');
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new WvcError('wvc_invalid_response'); }
  return parseWvcPage(body, page);
}
