import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, passesRelevanceThreshold, scoreProfessionalArticle } from '../src/core';
import { demoArticles } from '../src/demo/articles';
import { DemoPublisherAdapter } from '../src/demo/adapter';
import { SafeCompanyContextProvider } from '../src/server/company';

describe('professional recommendation quality', () => {
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
});
