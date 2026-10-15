import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, passesRelevanceThreshold, recencyMultiplierForAge, scoreProfessionalArticle, type NormalizedArticle } from '../src/core';
import { demoArticles } from '../src/demo/articles';
import { DemoPublisherAdapter } from '../src/demo/adapter';
import { SafeCompanyContextProvider } from '../src/server/company';
import { profileForTheme } from '../src/reports/themes';

describe('professional recommendation quality', () => {
  function article(id: string, title: string, description: string, publishedAt: string): NormalizedArticle {
    return { id, title, description, url: `https://sgi.example/${id}`, publishedAt, categories: ['Retail'], tags: ['sporting goods'], contentSnippet: description, publisherId: 'sgi-europe' };
  }

  it('keeps direct engineering stories ahead of adjacent or excluded coverage', async () => {
    const company = await new SafeCompanyContextProvider().getContext('ldsystems.uk');
    const profile = buildProfessionalProfile(company, 'Software Engineer', new Date('2026-10-06T00:00:00.000Z'));
    const adapter = new DemoPublisherAdapter();
    const scored = demoArticles.map((raw) => {
      const article = adapter.normalizeArticle(raw);
      const result = scoreProfessionalArticle(article, profile);
      return { id: article.id, score: result.score, type: result.relevanceType, eligible: passesRelevanceThreshold(result), signals: result.relevanceSignals };
    }).sort((a, b) => b.score - a.score);
    expect(scored.find((item) => item.id === 'small-language-models')?.type).toBe('direct');
    expect(scored.find((item) => item.id === 'small-language-models')?.eligible).toBe(true);
    expect(scored.find((item) => item.id === 'robotics-in-the-workshop')?.type).toBe('adjacent');
    expect(scored.find((item) => item.id === 'robotics-in-the-workshop')?.eligible).toBe(true);
    expect(scored.find((item) => item.id === 'open-source-observatories')?.eligible).toBe(false);
    expect(scored.find((item) => item.id === 'small-language-models')!.score).toBeGreaterThan(scored.find((item) => item.id === 'open-source-observatories')!.score);
  });

  it('changes the deterministic evidence by role and company context', async () => {
    const provider = new SafeCompanyContextProvider();
    const adapter = new DemoPublisherAdapter();
    const articles = demoArticles.map((raw) => adapter.normalizeArticle(raw));
    const cases = [
      ['ldsystems.uk', 'Software Engineer'],
      ['jpmorgan.com', 'Finance Director'],
      ['sunseeker.com', 'Marine Engineer'],
    ] as const;
    const topIds = [] as string[];
    const topTypes = [] as string[];
    for (const [domain, title] of cases) {
      const profile = buildProfessionalProfile(await provider.getContext(domain), title);
      const top = articles.map((article) => ({ article, result: scoreProfessionalArticle(article, profile) }))
        .filter((item) => passesRelevanceThreshold(item.result))
        .sort((a, b) => b.result.score - a.result.score)[0];
      expect(top).toBeDefined();
      topIds.push(top!.article.id);
      topTypes.push(top!.result.relevanceType ?? 'none');
    }
    expect(new Set(topIds).size).toBeGreaterThan(1);
    expect(topTypes).toEqual(['direct', 'direct', 'direct']);
  });

  it('reports procurement adjacency evidence without overrating it', async () => {
    const company = await new SafeCompanyContextProvider().getContext('sunseeker.com');
    const profile = buildProfessionalProfile(company, 'Head of Procurement');
    const adapter = new DemoPublisherAdapter();
    const scored = demoArticles.map((raw) => {
      const article = adapter.normalizeArticle(raw);
      const result = scoreProfessionalArticle(article, profile);
      return { id: article.id, score: result.score, type: result.relevanceType, direct: result.directMatches, adjacent: result.adjacentMatches };
    }).sort((a, b) => b.score - a.score);
    expect(profile.directInterests).toEqual(expect.arrayContaining(['procurement', 'vendors', 'supply chains']));
    expect(scored.filter((item) => item.type === 'adjacent').every((item) => item.score <= 59)).toBe(true);
  });

  it('keeps Nike retail evidence differentiated from competitor, generic and older coverage', async () => {
    const profile = buildProfessionalProfile({
      domain: 'nike.com', canonicalUrl: 'https://nike.com/', name: 'Nike', industry: 'sportswear',
      description: 'A sportswear company.', topics: ['retail', 'consumer products', 'innovation'], entities: ['Nike'],
      source: 'demo-fixture', fetchedAt: '2026-10-14T00:00:00.000Z', expiresAt: '2026-11-14T00:00:00.000Z', analysisVersion: 'test',
    }, 'Head of Retail', new Date('2026-10-14T00:00:00.000Z'));
    const direct = scoreProfessionalArticle(article('nike-direct', 'Nike retail operations improve omnichannel store performance', 'Nike expands distribution, merchandising and consumer behavior analysis across its retail strategy.', '2026-10-12T00:00:00.000Z'), profile);
    const competitor = scoreProfessionalArticle(article('lululemon-competitor', 'Lululemon international growth strategy expands stores', 'The sports brand is investing in market expansion and retail channels.', '2026-10-12T00:00:00.000Z'), profile);
    const generic = scoreProfessionalArticle(article('allbirds-generic', 'Allbirds financing strategy and growth plans', 'The company discusses financing, leadership and general business strategy.', '2026-10-12T00:00:00.000Z'), profile);
    const older = scoreProfessionalArticle(article('nike-old', 'Nike retail strategy and international expansion', 'Nike discussed stores and retail growth in an earlier market cycle.', '2013-01-10T00:00:00.000Z'), profile);
    const exceptional = scoreProfessionalArticle(article('nike-exceptional', 'Nike retail operations stores omnichannel distribution merchandising sales performance consumer behavior markets expansion category performance retail strategy', 'Nike retail operations, stores, omnichannel distribution, merchandising, sales performance, consumer behavior, markets, expansion, category performance and retail strategy.', '2026-10-13T00:00:00.000Z'), profile);
    expect(direct.score, JSON.stringify({ direct, competitor, generic, older })).toBeGreaterThan(competitor.score + 5);
    expect(competitor.score).toBeGreaterThan(generic.score);
    expect(direct.score, JSON.stringify({ direct, older, competitor, generic })).toBeGreaterThan(older.score);
    expect(exceptional.score).toBe(100);
    expect([competitor.score, generic.score, older.score].filter((score) => score === 100)).toHaveLength(0);
    expect(direct.scoreComponents?.raw).toBeGreaterThan(direct.score);
    expect(direct.scoreComponents?.company).toBeGreaterThan(competitor.scoreComponents?.company ?? 0);
    expect(direct.scoreComponents?.freshness).toBeGreaterThan(older.scoreComponents?.freshness ?? 0);
  });

  it('prefers recent Nike retail coverage while retaining exceptionally specific old coverage', async () => {
    const profile = buildProfessionalProfile({
      domain: 'nike.com', canonicalUrl: 'https://nike.com/', name: 'Nike', industry: 'sportswear',
      description: 'A sportswear company.', topics: ['retail', 'consumer products', 'innovation'], entities: ['Nike'],
      source: 'demo-fixture', fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), analysisVersion: 'test',
    }, 'Head of Retail');
    const dateDaysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
    const recent = scoreProfessionalArticle(article('nike-2026', 'Nike retail strategy expands stores for omnichannel growth', 'Nike stores, retail operations, distribution, merchandising, sales performance and consumer behavior are changing across its retail strategy.', dateDaysAgo(30)), profile);
    const oldSpecific = scoreProfessionalArticle(article('nike-2006', 'Nike retail operations stores omnichannel distribution merchandising sales performance consumer behavior markets expansion category performance retail strategy', 'Nike retail operations, stores, omnichannel distribution, merchandising, sales performance, consumer behavior, markets, expansion, category performance and retail strategy.', dateDaysAgo(7_300)), profile);
    const old2009 = scoreProfessionalArticle(article('nike-2009', 'Nike retail strategy expands stores for omnichannel growth', 'Nike stores, retail operations, distribution, merchandising, sales performance and consumer behavior are changing across its retail strategy.', dateDaysAgo(6_200)), profile);
    const old2016 = scoreProfessionalArticle(article('nike-2016', 'Nike retail strategy expands stores for omnichannel growth', 'Nike stores, retail operations, distribution, merchandising, sales performance and consumer behavior are changing across its retail strategy.', dateDaysAgo(3_650)), profile);
    const oldBroad = scoreProfessionalArticle(article('retail-2009', 'Retail industry outlook and market expansion', 'Markets and growth across retail companies.', dateDaysAgo(6_200)), profile);
    const themeProfile = profileForTheme(profile, 'stores');
    const themeRecent = scoreProfessionalArticle(recentArticle('theme-recent', 'Nike stores improve omnichannel retail operations', dateDaysAgo(30)), themeProfile);
    const themeOld = scoreProfessionalArticle(recentArticle('theme-old', 'Nike stores and retail expansion history', dateDaysAgo(6_200)), themeProfile);

    expect(recencyMultiplierForAge(30)).toBe(1);
    expect(recencyMultiplierForAge(180)).toBeGreaterThan(recencyMultiplierForAge(540));
    expect(recencyMultiplierForAge(540)).toBeGreaterThan(recencyMultiplierForAge(1_200));
    expect(recencyMultiplierForAge(1_200)).toBeGreaterThan(recencyMultiplierForAge(2_600));
    expect(recencyMultiplierForAge(2_600)).toBeGreaterThan(recencyMultiplierForAge(6_200));
    expect(recent.score).toBeGreaterThan(oldSpecific.score);
    expect(recent.score).toBeGreaterThan(old2009.score);
    expect(recent.score).toBeGreaterThan(old2016.score);
    expect(passesRelevanceThreshold(oldSpecific)).toBe(true);
    expect(oldBroad.score).toBeLessThan(recent.score);
    expect(oldBroad.scoreComponents?.recencyMultiplier).toBeLessThan(0.5);
    expect(recent.scoreComponents).toMatchObject({ articleAgeDays: expect.any(Number), preRecencyScore: expect.any(Number), postRecencyScore: expect.any(Number), recencyMultiplier: 1 });
    expect(recent.scoreComponents?.postRecencyScore).toBe(recent.scoreComponents?.raw);
    expect(recent.scoreComponents?.preRecencyScore).toBeLessThanOrEqual(recent.scoreComponents?.postRecencyScore ?? 0);
    expect(themeRecent.score).toBeGreaterThan(themeOld.score);
    expect(themeRecent.scoreComponents?.recencyMultiplier).toBe(recent.scoreComponents?.recencyMultiplier);
  });
});

function recentArticle(id: string, title: string, publishedAt: string): NormalizedArticle {
  return { id, title, description: 'Nike retail operations, stores and omnichannel strategy.', url: `https://sgi.example/${id}`, publishedAt, categories: ['Retail'], tags: ['sporting goods'], contentSnippet: 'Nike retail operations, stores and omnichannel strategy.', publisherId: 'sgi-europe' };
}
