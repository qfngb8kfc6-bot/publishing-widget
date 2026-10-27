import { ContentSourceError, fetchText, safeSourceFetch } from './security';
import type { WvcCatalogueSourceConfig, WvcEnrichmentSourceConfig } from './types';

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
  /** Catalogue fields, parsed only for a WVC catalogue source (never for enrichment-only publishers). */
  catalogue?: WvcCatalogueFields;
}

/** What a WVC catalogue row needs besides the text. A story without title or URL is stored but not listed. */
export interface WvcCatalogueFields {
  title?: string;
  url?: string;
  publishedAt?: string;
  /** First one or two sentences of the cleaned STORYTEXT, at most ~300 characters. */
  description?: string;
  /** First <img> in STORYTEXT, only when it is an absolute https URL on an allowed image host. */
  imageUrl?: string;
}

export interface WvcCatalogueParseOptions {
  titleFields: readonly string[];
  /** Hosts a story URL may use. */
  articleHostnames: readonly string[];
  imageHostnames: readonly string[];
}

export const DEFAULT_WVC_TITLE_FIELDS = ['HEADLINE', 'TITLE', 'STORYTITLE', 'STORYHEADLINE', 'HEADING'];
export const WVC_DESCRIPTION_MAX_CHARS = 300;
/** The secret behind a WVC source must be a dedicated WVC key, never another server secret (DATABASE_URL, AI keys). */
export const WVC_SECRET_REF_PATTERN = /^env:[A-Z][A-Z0-9_]{0,60}_WVC_API_KEY$/;

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

/** The first one or two sentences, at most `maxChars` (a single long sentence is cut at a word with "…"). */
export function firstSentences(text: string, maxChars = WVC_DESCRIPTION_MAX_CHARS): string | undefined {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const sentences = clean.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [clean];
  let result = sentences[0];
  if (sentences[1] && `${result} ${sentences[1]}`.length <= maxChars) result = `${result} ${sentences[1]}`;
  if (result.length <= maxChars) return result;
  const cut = result.lastIndexOf(' ', maxChars - 1);
  return `${result.slice(0, cut > maxChars * 0.6 ? cut : maxChars - 1).replace(/[\s,;:–—-]+$/, '')}…`;
}

function hostAllowed(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry.toLowerCase());
}

/** An absolute https URL on one of the allowed hosts, or undefined. */
export function allowedHttpsUrl(value: string | undefined, allowed: readonly string[]): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(decodeEntities(value.trim()));
    return url.protocol === 'https:' && !url.username && !url.password && hostAllowed(url.hostname, allowed) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The first <img src> in the story HTML, only when it is an absolute https URL on an allowed host. */
export function firstStoryImage(html: string, imageHostnames: readonly string[]): string | undefined {
  const tag = html.match(/<img\b[^>]*>/i)?.[0];
  const src = tag?.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return allowedHttpsUrl(src?.[1] ?? src?.[2], imageHostnames);
}

function catalogueFields(story: Record<string, unknown>, html: string, cleaned: string, options: WvcCatalogueParseOptions): WvcCatalogueFields {
  const rawTitle = options.titleFields.map((name) => text(field(story, name.toUpperCase()))).find((value) => value?.trim());
  const title = rawTitle ? decodeEntities(rawTitle.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 300) : undefined;
  const url = allowedHttpsUrl(text(field(story, 'STORYURL')), options.articleHostnames);
  const publishedAt = parseWvcDate(field(story, 'DATEPUBLISHED')) ?? parseWvcDate(field(story, 'LASTMODIFIED'));
  const description = firstSentences(cleaned);
  const imageUrl = firstStoryImage(html, options.imageHostnames);
  return { ...(title ? { title } : {}), ...(url ? { url } : {}), ...(publishedAt ? { publishedAt } : {}), ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}) };
}

/** Parse options for a WVC catalogue source. */
export function wvcCatalogueParseOptions(config: WvcCatalogueSourceConfig): WvcCatalogueParseOptions {
  return { titleFields: config.titleFields?.length ? config.titleFields : DEFAULT_WVC_TITLE_FIELDS, articleHostnames: config.allowedHostnames, imageHostnames: config.imageHostnames?.length ? config.imageHostnames : config.allowedHostnames };
}

/** The fetch settings of a catalogue source: always with STORYTEXT (dataconstraint 4). */
export function wvcCatalogueFetchConfig(config: WvcCatalogueSourceConfig): WvcEnrichmentSourceConfig {
  return { type: 'wvc', baseUrl: config.baseUrl, profileName: config.profileName, pageSize: config.pageSize, dataConstraint: 4, secretRef: config.secretRef, allowedHostnames: config.allowedHostnames, ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}), ...(config.maxBytes ? { maxBytes: config.maxBytes } : {}) };
}

/** Configuration problems of a WVC catalogue source, as safe codes (empty when valid). */
export function wvcCatalogueConfigErrors(config: Partial<WvcCatalogueSourceConfig>): string[] {
  const errors: string[] = [];
  let base: URL | undefined;
  try { base = new URL(String(config.baseUrl)); } catch { errors.push('wvc_base_url_invalid'); }
  const hosts = Array.isArray(config.allowedHostnames) ? config.allowedHostnames.filter((host) => typeof host === 'string' && host.trim()) : [];
  if (!hosts.length) errors.push('wvc_allowed_hostnames_required');
  if (base && (base.protocol !== 'https:' || !hostAllowed(base.hostname, hosts))) errors.push('wvc_base_url_not_allowed');
  if (!config.profileName || typeof config.profileName !== 'string') errors.push('wvc_profile_name_required');
  if (!Number.isFinite(config.pageSize) || Number(config.pageSize) < WVC_MIN_PAGE_SIZE) errors.push('wvc_page_size_too_small');
  if (typeof config.secretRef !== 'string' || !WVC_SECRET_REF_PATTERN.test(config.secretRef)) errors.push('wvc_secret_ref_invalid');
  if (config.rss && (typeof config.rss.feedUrl !== 'string' || !/^https:\/\//.test(config.rss.feedUrl))) errors.push('wvc_rss_feed_url_invalid');
  return errors;
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
export function parseWvcPage(body: unknown, page: number, catalogue?: WvcCatalogueParseOptions): WvcPage {
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
    stories.push({ storyCode, isPrivate, ...(lastModified ? { lastModified } : {}), text: cleaned, ...(catalogue ? { catalogue: catalogueFields(story, body, cleaned, catalogue) } : {}) });
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
  /** Parse catalogue fields too (WVC catalogue sources only). */
  catalogue?: WvcCatalogueParseOptions;
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
  return parseWvcPage(body, page, options.catalogue);
}

/** Diagnostics for one page: counts, dates and lengths only. Never text, URLs or the key. */
export interface WvcPageSummary {
  page: number;
  httpStatus: number;
  errorsFound: boolean;
  errorCode?: string;
  totalPages?: number;
  totalRecords?: number;
  storyCount: number;
  newestDatePublished?: string;
  privateCount: number;
  storyTextLength?: { min: number; median: number; max: number };
  /** Stories whose story code is in the supplied catalogue codes. */
  catalogueMatches?: number;
}

export function summarizeWvcBody(body: unknown, catalogueCodes?: ReadonlySet<string>): Omit<WvcPageSummary, 'page' | 'httpStatus'> {
  const record = asRecord(body);
  if (!record) return { errorsFound: false, errorCode: 'wvc_invalid_response', storyCount: 0, privateCount: 0 };
  const errorsFound = field(record, 'ERRORSFOUND') === true || field(record, 'ERRORSFOUND') === 'true';
  if (errorsFound) {
    try { parseWvcPage(record, 0); } catch (error) { return { errorsFound, errorCode: error instanceof WvcError ? error.code : 'wvc_api_error', storyCount: 0, privateCount: 0 }; }
  }
  const paged = asRecord(field(record, 'PAGEDDATA')) ?? {};
  const stories = (storyArray(record) ?? []).map(asRecord).filter((story): story is Record<string, unknown> => Boolean(story));
  const lengths = stories.map((story) => text(field(story, 'STORYTEXT'))?.length ?? 0).sort((left, right) => left - right);
  const dates = stories.map((story) => parseWvcDate(field(story, 'DATEPUBLISHED'))).filter((date): date is string => Boolean(date)).sort();
  const codes = stories.map((story) => storyCodeFromUrl(text(field(story, 'STORYURL'))) ?? text(field(story, 'STORYCODE'))?.match(/^\d{1,12}$/)?.[0]);
  return {
    errorsFound,
    totalPages: count(field(paged, 'TOTALNUMBEROFPAGES')),
    totalRecords: count(field(paged, 'TOTALNUMBEROFRECORDS')),
    storyCount: stories.length,
    newestDatePublished: dates.at(-1),
    privateCount: stories.filter((story) => String(field(story, 'PRIVATE')).toLowerCase() === 'true').length,
    ...(lengths.length ? { storyTextLength: { min: lengths[0], median: lengths[Math.floor((lengths.length - 1) / 2)], max: lengths[lengths.length - 1] } } : {}),
    ...(catalogueCodes ? { catalogueMatches: codes.filter((code) => code && catalogueCodes.has(code)).length } : {}),
  };
}

async function fetchWvcBody(config: WvcEnrichmentSourceConfig, page: number, options: WvcFetchOptions): Promise<{ httpStatus: number; body?: unknown; errorCode?: string }> {
  const key = options.resolveSecret(config.secretRef)?.trim();
  if (!key) return { httpStatus: 0, errorCode: 'wvc_not_configured' };
  const maxBytes = config.maxBytes ?? DEFAULT_PAGE_MAX_BYTES;
  try {
    const response = await safeSourceFetch(wvcPageUrl(config, page), { method: 'GET', headers: { API_ACCESS_TOKEN: key, Accept: 'application/json' } }, { fetchImpl: options.fetchImpl, allowedHostnames: config.allowedHostnames, maxRedirects: 0, timeoutMs: config.timeoutMs ?? 20_000, maxBytes });
    // Bounded read: stops at maxBytes even without a content-length header.
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let total = 0;
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return { httpStatus: response.status, errorCode: 'wvc_source_response_too_large' }; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    try { return { httpStatus: response.status, body: JSON.parse(raw) }; } catch { return { httpStatus: response.status, errorCode: 'wvc_invalid_response' }; }
  } catch (error) {
    if (error instanceof ContentSourceError) return { httpStatus: error.status ?? 0, errorCode: `wvc_${error.code.replace(/-/g, '_')}` };
    return { httpStatus: 0, errorCode: 'wvc_api_error' };
  }
}

/**
 * Inspects the newest (last) page. A metadata-only probe of page 1 (dataconstraint 0, no STORYTEXT) learns the
 * page count first, since pages come oldest-first. Read-only: nothing is stored.
 */
export async function inspectWvcLastPage(config: WvcEnrichmentSourceConfig, options: WvcFetchOptions & { catalogueCodes?: ReadonlySet<string> }): Promise<{ probe: WvcPageSummary; last?: WvcPageSummary }> {
  const probeResult = await fetchWvcBody({ ...config, dataConstraint: 0 }, 1, options);
  const probe: WvcPageSummary = { page: 1, httpStatus: probeResult.httpStatus, ...(probeResult.body !== undefined ? summarizeWvcBody(probeResult.body) : { errorsFound: false, storyCount: 0, privateCount: 0 }), ...(probeResult.errorCode ? { errorCode: probeResult.errorCode } : {}) };
  if (probe.errorCode || !probe.totalPages) return { probe };
  const lastResult = await fetchWvcBody(config, probe.totalPages, options);
  const last: WvcPageSummary = { page: probe.totalPages, httpStatus: lastResult.httpStatus, ...(lastResult.body !== undefined ? summarizeWvcBody(lastResult.body, options.catalogueCodes) : { errorsFound: false, storyCount: 0, privateCount: 0 }), ...(lastResult.errorCode ? { errorCode: lastResult.errorCode } : {}) };
  return { probe, last };
}

/** Setup "Test" result for a WVC catalogue source: counts, dates, lengths and coverage only (never text or the key). */
export interface WvcCatalogueInspection {
  sourceType: 'wvc';
  reachable: boolean;
  errorCode?: string;
  totalPages?: number;
  totalRecords?: number;
  /** The newest (last) page, read with STORYTEXT. */
  lastPage?: {
    page: number;
    stories: number;
    newestDatePublished?: string;
    privateCount: number;
    textLength?: { min: number; median: number; max: number };
    /** Percent of stories with each catalogue field (a story without title and URL is not listed). */
    coverage: { title: number; url: number; publishedAt: number; description: number; image: number };
    /** API field that supplied the headlines, e.g. HEADLINE; undefined when none of the title fields was present. */
    titleField?: string;
    sampleTitles: string[];
  };
}

/**
 * The setup Test step: a metadata-only probe of page 1 for the page count, then the newest page with STORYTEXT,
 * parsed exactly as the sync would. Read-only; nothing is stored. The key is used only in the request header.
 */
export async function inspectWvcCatalogue(config: WvcCatalogueSourceConfig, options: Omit<WvcFetchOptions, 'catalogue'>): Promise<WvcCatalogueInspection> {
  const errors = wvcCatalogueConfigErrors(config);
  if (errors.length) return { sourceType: 'wvc', reachable: false, errorCode: errors[0] };
  const fetchConfig = wvcCatalogueFetchConfig(config);
  const probe = await fetchWvcBody({ ...fetchConfig, dataConstraint: 0 }, 1, options);
  if (probe.errorCode || probe.body === undefined) return { sourceType: 'wvc', reachable: false, errorCode: probe.errorCode ?? 'wvc_invalid_response' };
  const probeSummary = summarizeWvcBody(probe.body);
  if (probeSummary.errorCode || probeSummary.errorsFound) return { sourceType: 'wvc', reachable: false, errorCode: probeSummary.errorCode ?? 'wvc_api_error' };
  const totalPages = probeSummary.totalPages ?? 0;
  const result: WvcCatalogueInspection = { sourceType: 'wvc', reachable: true, totalPages, totalRecords: probeSummary.totalRecords };
  if (!totalPages) return result;
  const last = await fetchWvcBody(fetchConfig, totalPages, options);
  if (last.errorCode || last.body === undefined) return { ...result, reachable: false, errorCode: last.errorCode ?? 'wvc_invalid_response' };
  const parseOptions = wvcCatalogueParseOptions(config);
  let parsed: WvcPage;
  try { parsed = parseWvcPage(last.body, totalPages, parseOptions); } catch (error) { return { ...result, reachable: false, errorCode: error instanceof WvcError ? error.code : 'wvc_invalid_response' }; }
  const stories = parsed.stories;
  const percent = (count: number) => (stories.length ? Math.round((count / stories.length) * 100) : 0);
  const lengths = stories.map((story) => story.text.length).sort((left, right) => left - right);
  const dates = stories.map((story) => story.catalogue?.publishedAt).filter((date): date is string => Boolean(date)).sort();
  const rawStories = (storyArray(asRecord(last.body) ?? {}) ?? []).map(asRecord).filter((story): story is Record<string, unknown> => Boolean(story));
  const titleField = parseOptions.titleFields.find((name) => rawStories.some((story) => text(field(story, name.toUpperCase()))?.trim()));
  return {
    ...result,
    lastPage: {
      page: totalPages,
      stories: stories.length,
      ...(dates.length ? { newestDatePublished: dates[dates.length - 1] } : {}),
      privateCount: stories.filter((story) => story.isPrivate).length,
      ...(lengths.length ? { textLength: { min: lengths[0], median: lengths[Math.floor((lengths.length - 1) / 2)], max: lengths[lengths.length - 1] } } : {}),
      coverage: {
        title: percent(stories.filter((story) => story.catalogue?.title).length),
        url: percent(stories.filter((story) => story.catalogue?.url).length),
        publishedAt: percent(dates.length),
        description: percent(stories.filter((story) => story.catalogue?.description).length),
        image: percent(stories.filter((story) => story.catalogue?.imageUrl).length),
      },
      ...(titleField ? { titleField } : {}),
      sampleTitles: stories.map((story) => story.catalogue?.title).filter((title): title is string => Boolean(title)).slice(0, 5),
    },
  };
}
