import { describe, expect, it } from 'vitest';
import { allocateEditorialSections, articleIdentityKeys, type EditorialSectionId } from '../src/reports/sections';
import type { ReportRecommendation } from '../src/reports';

function recommendation(id: string, title: string, description = '', categories: string[] = []): ReportRecommendation {
  return {
    articleId: id,
    rank: Number(id.replace(/\D/g, '') || 1),
    rawScore: 70,
    displayScore: 70,
    explanation: 'Relevant to the requested professional context.',
    article: { id, title, description, url: `https://sgi.example/${id}.article`, categories, tags: [], publisherId: 'sgi-europe' },
    rankingMetadata: { relevanceSignals: ['direct match'], rankingMode: 'deterministic', rankingVersion: 'test' },
  };
}

const configured: EditorialSectionId[] = ['top-developments', 'companies-to-watch', 'market-moves', 'sustainability-developments', 'more-relevant-stories'];

describe('report editorial allocation', () => {
  it('allocates each article to at most one meaningful section and preserves featured content', () => {
    const result = allocateEditorialSections([
      recommendation('1', 'AI agents can now shop JD Sports like a person would', 'A new AI shopping platform changes digital retail.'),
      recommendation('2', 'CASE STUDY: Inside Anta’s AI365 strategy', 'A company strategy case study.'),
      recommendation('3', 'Hyrox moves into gym apps through ABC Fitness deal', 'A partnership and market move.'),
      recommendation('4', 'Textile recycling is scaling across the industry', 'Sustainability and circular materials are developing.'),
      recommendation('5', 'A remaining relevant industry briefing'),
    ], configured);

    expect(result.featured?.article.id).toBe('1');
    const sectionIds = result.sections.flatMap((section) => section.recommendations.map((item) => item.article.id));
    expect(sectionIds).toHaveLength(new Set(sectionIds).size);
    expect(sectionIds).not.toContain('1');
    expect(result.sections.find((section) => section.id === 'companies-to-watch')?.recommendations.map((item) => item.article.id)).toEqual(['2']);
    expect(result.sections.find((section) => section.id === 'market-moves')?.recommendations.map((item) => item.article.id)).toEqual(['3']);
    expect(result.sections.find((section) => section.id === 'sustainability-developments')?.recommendations.map((item) => item.article.id)).toEqual(['4']);
    expect(result.sections.find((section) => section.id === 'more-relevant-stories')?.recommendations.map((item) => item.article.id)).toEqual(['5']);
  });

  it('deduplicates by article ID or canonical URL and omits empty sections', () => {
    const duplicate = recommendation('duplicate-id', 'Same story', 'A story');
    const sameUrl = { ...recommendation('different-id', 'Same story copy', 'A story'), article: { ...duplicate.article, id: 'different-id' } };
    const result = allocateEditorialSections([recommendation('featured', 'Featured'), duplicate, sameUrl], ['companies-to-watch']);
    expect(result.recommendations).toHaveLength(2);
    expect(result.sections).toEqual([]);
    expect(result.additional).toHaveLength(1);
    expect(articleIdentityKeys(duplicate.article)).toContain('url:https://sgi.example/duplicate-id.article');
  });
});
