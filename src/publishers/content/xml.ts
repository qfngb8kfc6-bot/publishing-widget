function decodeXml(value: string): string {
  const entities: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : lower.startsWith('#') ? Number.parseInt(lower.slice(1), 10) : undefined;
    if (code !== undefined && Number.isFinite(code)) return String.fromCodePoint(Math.min(code, 0x10ffff));
    return entities[lower] ?? match;
  });
}

export function xmlText(value: string): string {
  return decodeXml(value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function xmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeXml(match[1]) : undefined;
}

export function xmlBlocks(xml: string, name: string): string[] {
  const escaped = name.replace(':', '\\:');
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi'))].map((match) => match[1]);
}

export function xmlFirstText(xml: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name.replace(':', '\\:')}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name.replace(':', '\\:')}>`, 'i'));
    if (match) return xmlText(match[1]);
  }
  return undefined;
}

