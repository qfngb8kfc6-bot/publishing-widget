/** Membership test shared by in-request Sets and cached compact indexes. */
export interface TokenLookup {
  has(value: string): boolean;
}

/** Field text index used by the matchers: normalized text plus token and five-character prefix lookups. */
export interface TextMatchIndex {
  readonly normalized: string;
  readonly tokens: TokenLookup;
  readonly prefixes: TokenLookup;
}

/**
 * Interns token and prefix strings to integer IDs. One dictionary is owned by one cached catalogue
 * version, so every string is stored once however many articles contain it.
 */
export class TokenDictionary {
  private readonly ids = new Map<string, number>();

  intern(value: string): number {
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(value, id);
    }
    return id;
  }

  lookup(value: string): number | undefined {
    return this.ids.get(value);
  }

  get size(): number {
    return this.ids.size;
  }
}

/** A sorted run of interned IDs inside a packed array shared by all of an article's fields. */
class PackedTokenRun implements TokenLookup {
  constructor(private readonly dictionary: TokenDictionary, private readonly packed: Uint32Array, private readonly start: number, private readonly end: number) {}

  has(value: string): boolean {
    const id = this.dictionary.lookup(value);
    if (id === undefined) return false;
    let low = this.start;
    let high = this.end - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const current = this.packed[middle];
      if (current === id) return true;
      if (current < id) low = middle + 1;
      else high = middle - 1;
    }
    return false;
  }
}

class CompactTextIndex implements TextMatchIndex {
  constructor(readonly tokens: TokenLookup, readonly prefixes: TokenLookup, private readonly text: string | (() => string)) {}

  get normalized(): string {
    return typeof this.text === 'string' ? this.text : this.text();
  }
}

export interface CompactFieldSource {
  tokens: Iterable<string>;
  prefixes: Iterable<string>;
  /** Kept when phrase matching needs it, otherwise a function that recomputes it on demand. */
  normalized: string | (() => string);
}

/**
 * Compacts an article's in-request field indexes for caching with a catalogue. Every field's token and prefix
 * IDs share one packed Uint32Array (about four bytes per entry), so per-article overhead stays small.
 */
export function compactFieldIndexes<Field extends string>(dictionary: TokenDictionary, fields: Record<Field, CompactFieldSource>): Record<Field, TextMatchIndex> {
  const names = Object.keys(fields) as Field[];
  const runs: Uint32Array[] = [];
  for (const name of names) {
    for (const values of [fields[name].tokens, fields[name].prefixes]) {
      const ids = new Set<number>();
      for (const value of values) ids.add(dictionary.intern(value));
      runs.push(Uint32Array.from(ids).sort());
    }
  }
  const packed = new Uint32Array(runs.reduce((total, run) => total + run.length, 0));
  const bounds: Array<[number, number]> = [];
  let offset = 0;
  for (const run of runs) {
    packed.set(run, offset);
    bounds.push([offset, offset + run.length]);
    offset += run.length;
  }
  const result = {} as Record<Field, TextMatchIndex>;
  names.forEach((name, index) => {
    const [tokenStart, tokenEnd] = bounds[index * 2];
    const [prefixStart, prefixEnd] = bounds[index * 2 + 1];
    result[name] = new CompactTextIndex(new PackedTokenRun(dictionary, packed, tokenStart, tokenEnd), new PackedTokenRun(dictionary, packed, prefixStart, prefixEnd), fields[name].normalized);
  });
  return result;
}
