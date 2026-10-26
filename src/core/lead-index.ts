import { normalizeToken } from './intent';

/** Function words left out of lead indexes: they are never concepts and would make up a third of the entries. */
const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'in', 'into', 'is', 'its', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'which', 'who', 'will', 'with', 'would']);

function hash(kind: number, value: string): number {
  let hash = 0x811c9dc5 ^ kind;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // 24 bits: with ~350 entries per article a false hit costs ~2e-5 per check, and a hit only reinforces evidence
  // the article already has, so three bytes per entry are enough.
  return (hash ^ (hash >>> 24)) & 0xffffff;
}

/**
 * Lead indexes are views into shared 1 MB slabs rather than one small buffer each, which saves the per-buffer
 * overhead (~150 bytes per article). A replaced index leaves a small hole; slabs are freed once unreferenced.
 */
const SLAB_BYTES = 1024 * 1024;
let slab = new Uint8Array(SLAB_BYTES);
let slabOffset = 0;

function allocate(bytes: number): Uint8Array {
  if (bytes > SLAB_BYTES / 4) return new Uint8Array(bytes);
  if (slabOffset + bytes > SLAB_BYTES) { slab = new Uint8Array(SLAB_BYTES); slabOffset = 0; }
  const view = slab.subarray(slabOffset, slabOffset + bytes);
  slabOffset += bytes;
  return view;
}

const TOKEN = 1;
const PREFIX = 2;
const BIGRAM = 3;

function contentWords(normalized: string): string[] {
  return normalized ? normalized.split(' ').filter((word) => !STOPWORDS.has(word)) : [];
}

/** Probe hashes per concept, shared by every article's index: a profile has ~30 concepts, an archive ~11.5k leads. */
const PROBE_CACHE_LIMIT = 4_096;
const probeCache = new Map<string, readonly number[]>();

/** The hashes a concept needs: its token or prefix, or for a phrase every adjacent content-word pair. */
function conceptProbes(normalizedConcept: string): readonly number[] {
  if (!normalizedConcept) return [];
  const cached = probeCache.get(normalizedConcept);
  if (cached) return cached;
  let probes: number[];
  const single = (word: string) => (word.length >= 6 ? hash(PREFIX, word.slice(0, 5)) : hash(TOKEN, word));
  if (!normalizedConcept.includes(' ')) probes = [single(normalizedConcept)];
  else {
    const words = contentWords(normalizedConcept);
    probes = words.length === 0 ? [] : words.length === 1 ? [single(words[0])] : words.slice(1).map((word, index) => hash(BIGRAM, `${words[index]} ${word}`));
  }
  if (probeCache.size >= PROBE_CACHE_LIMIT) probeCache.clear();
  probeCache.set(normalizedConcept, probes);
  return probes;
}

/**
 * Compact match index for an article's lead excerpt (the opening of its full text, held in Postgres). Only
 * 24-bit hashes are kept, in one sorted typed array: tokens shorter than six characters, five-character prefixes
 * of longer tokens, and adjacent content-word pairs for phrase concepts. The excerpt text itself is not retained.
 * Matching mirrors the professional scorer's rules: a single concept matches a token or a shared prefix; a phrase
 * matches when each adjacent pair of its content words occurs adjacently (function words between them ignored).
 */
export class LeadMatchIndex {
  /** Sorted 24-bit hashes, three bytes each (big-endian). */
  private readonly hashes: Uint8Array;

  constructor(text: string) {
    const words = contentWords(normalizeToken(text));
    const values = new Set<number>();
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      // A concept of six or more characters matches through the prefix alone (an equal token shares it), so a
      // token needs only one entry: itself when shorter than six characters, otherwise its prefix.
      values.add(word.length >= 6 ? hash(PREFIX, word.slice(0, 5)) : hash(TOKEN, word));
      if (index > 0) values.add(hash(BIGRAM, `${words[index - 1]} ${word}`));
    }
    const sorted = Uint32Array.from(values).sort();
    this.hashes = allocate(sorted.length * 3);
    sorted.forEach((value, index) => { this.hashes[index * 3] = value >>> 16; this.hashes[index * 3 + 1] = (value >>> 8) & 0xff; this.hashes[index * 3 + 2] = value & 0xff; });
  }

  get size(): number { return this.hashes.length / 3; }

  private has(value: number): boolean {
    const hashes = this.hashes;
    let low = 0;
    let high = hashes.length / 3 - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const offset = middle * 3;
      const current = (hashes[offset] << 16) | (hashes[offset + 1] << 8) | hashes[offset + 2];
      if (current === value) return true;
      if (current < value) low = middle + 1; else high = middle - 1;
    }
    return false;
  }

  /** `normalizedConcept` is already normalized with normalizeToken. */
  matches(normalizedConcept: string): boolean {
    const required = conceptProbes(normalizedConcept);
    if (required.length === 0) return false;
    for (const value of required) if (!this.has(value)) return false;
    return true;
  }
}
