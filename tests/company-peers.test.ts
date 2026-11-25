import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile } from '../src/core';
import { PROFILE_ENRICHMENT_INSTRUCTION } from '../src/ai/providers/openai-compatible';
import { validCompanyNames, validateProfessionalProfileEnhancement, withCompanyPeers } from '../src/ai/validation';
import { isOwnCompanyStory, orderMarketContext } from '../src/reports/relationship';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';
import { EXEC_FIXTURE_STORIES } from './exec-market-fixtures';
import { company } from './ranking-fixtures';

const nike = () => buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', ['footwear']), 'Head of Retail');
const ceo = () => buildProfessionalProfile(company('decathlon.com', 'Decathlon', 'sporting goods retail', ['retail', 'sporting goods']), 'CEO');

describe('peer and sub-brand validation', () => {
  it('keeps short distinct names, at most 8, and drops sentences, URLs and duplicates', () => {
    expect(validCompanyNames(['Adidas', 'adidas', 'Puma', 'https://x.com', 'the company that makes running shoes for everyone', 'On', 42, 'New Balance', 'Asics', 'Under Armour', 'Skechers', 'Anta', 'Li Ning', 'Mizuno'])).toEqual(['Adidas', 'Puma', 'New Balance', 'Asics', 'Under Armour', 'Skechers', 'Anta', 'Li Ning']);
    expect(validCompanyNames('Adidas')).toEqual([]);
  });

  it('never keeps the reader\'s own company in peers, nor a name that is both a peer and a sub-brand', () => {
    const profile = withCompanyPeers(nike(), ['Nike', 'Nike Inc', 'Adidas', 'Converse', 'Puma'], ['Jordan', 'Converse', 'Nike']);
    expect(profile.peers).toEqual(['Adidas', 'Puma']);
    expect(profile.subBrands).toEqual(['Jordan', 'Converse']);
    expect(profile.entities).toEqual(expect.arrayContaining(['Adidas', 'Puma']));
  });

  it('reads competitors and subBrands from the enrichment response and asks for them in the same call', () => {
    expect(PROFILE_ENRICHMENT_INSTRUCTION).toMatch(/competitors \(max 8/);
    expect(PROFILE_ENRICHMENT_INSTRUCTION).toMatch(/subBrands \(max 8/);
    expect(validateProfessionalProfileEnhancement({ competitors: ['Adidas'], subBrands: ['Jordan'] })).toMatchObject({ competitors: ['Adidas'], subBrands: ['Jordan'] });
  });

  it('adds peers as direct market concepts for executives only', () => {
    const exec = withCompanyPeers(ceo(), ['Intersport'], []);
    expect(exec.retrieval.concepts.find((concept) => concept.concept === 'Intersport')).toMatchObject({ relevanceType: 'direct', source: 'market' });
    expect(withCompanyPeers(nike(), ['Adidas'], []).retrieval.concepts.some((concept) => concept.concept === 'Adidas')).toBe(false);
  });
});

describe('sub-brands in own-company detection, peers first in market picks', () => {
  it('a Jordan or Converse headline is a Nike story once the sub-brands are known', () => {
    const story = { title: 'Jordan Brand opens flagship in Chicago', description: 'The brand opened a new store.' };
    expect(isOwnCompanyStory(story, nike())).toBe(false);
    expect(isOwnCompanyStory(story, withCompanyPeers(nike(), [], ['Jordan', 'Converse']))).toBe(true);
    expect(isOwnCompanyStory({ title: 'Converse sales slow in China' }, withCompanyPeers(nike(), [], ['Converse']))).toBe(true);
  });

  it('orders market candidates naming a validated peer before other known companies', () => {
    const profile = withCompanyPeers({ ...ceo(), entities: ['Decathlon', 'Puma'] }, ['Intersport'], []);
    const ordered = orderMarketContext([
      { article: { title: 'Puma names new CEO' }, finalScore: 40 },
      { article: { title: 'Intersport posts record revenue' }, finalScore: 20 },
    ], profile);
    expect(ordered.map((item) => item.article.title)).toEqual(['Intersport posts record revenue', 'Puma names new CEO']);
  });
});

describe('peers and sub-brands through the report', () => {
  const stories = [...EXEC_FIXTURE_STORIES, ['retail', 'Jordan Brand opens flagship store in Chicago', 'Jordan Brand opened a flagship store as part of its retail and direct to consumer strategy.'] as [string, string, string]];
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${stories.map(([section, title, description], i) => `<item><title>${title}</title><link>https://www.sgieurope.com/${section}/s-${i}/18000${i}.article</link><guid>https://www.sgieurope.com/${section}/s-${i}/18000${i}.article</guid><description>${description}</description><pubDate>Mon, 0${(i % 9) + 1} Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
  const contexts: Record<string, [string, string, string[]]> = { 'decathlon.com': ['Decathlon', 'sporting goods retail', ['retail', 'sporting goods']], 'nike.com': ['Nike', 'sporting goods', ['footwear', 'apparel']] };
  const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';

  function app(enrichment: () => unknown) {
    return createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-peers-key', AI_MODEL: 'test-model', AI_ENDPOINT },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input, init) => {
        if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const ref = JSON.parse(JSON.parse(String(init?.body)).messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
        if (ref.operation !== 'professional-profile-enrichment') return new Response('unavailable', { status: 503 });
        const content = enrichment();
        return content ? Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }) : new Response('unavailable', { status: 503 });
      },
      companyContextProvider: { getContext: async (d: string) => ({ domain: d, canonicalUrl: `https://${d}/`, name: contexts[d][0], industry: contexts[d][1], topics: contexts[d][2], entities: [contexts[d][0]], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: () => undefined, error: () => undefined },
    });
  }
  async function generate(server: ReturnType<typeof app>, domain: string, jobTitle: string) {
    const response = await server.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: domain, jobTitle }) }));
    expect(response.status).toBe(201);
    const { reportId } = await response.json() as { reportId: string };
    return (await server.reportStore.get(reportId, 'sgi-europe'))!;
  }

  it('stores validated peers and sub-brands on the profile; failed enrichment behaves as before', async () => {
    const withPeers = await generate(app(() => ({ competitors: ['Intersport', 'JD Sports', 'Decathlon'], subBrands: ['Quechua', 'Kipsta'] })), 'decathlon.com', 'CEO');
    expect(withPeers.professionalProfile).toMatchObject({ peers: ['Intersport', 'JD Sports'], subBrands: ['Quechua', 'Kipsta'] });
    const failed = await generate(app(() => undefined), 'decathlon.com', 'CEO');
    expect(failed.professionalProfile.peers).toBeUndefined();
    expect(failed.professionalProfile.subBrands).toBeUndefined();
  });

  it('caches them per company: another role at the same company gets them when its enrichment fails', async () => {
    let calls = 0;
    const server = app(() => (calls++ === 0 ? { competitors: ['Adidas', 'Puma'], subBrands: ['Jordan', 'Converse'] } : undefined));
    await generate(server, 'nike.com', 'Head of Retail');
    const second = await generate(server, 'nike.com', 'Head of Procurement');
    expect(second.professionalProfile).toMatchObject({ peers: ['Adidas', 'Puma'], subBrands: ['Jordan', 'Converse'] });
  });
});
