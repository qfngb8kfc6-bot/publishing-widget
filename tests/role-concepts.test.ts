import { describe, expect, it } from 'vitest';
import { analyzeRole, buildProfessionalProfile, scoreProfessionalArticle, titleTopics, type NormalizedArticle } from '../src/core';
import { mergeProfessionalProfileEnhancement } from '../src/ai/validation';
import { company } from './ranking-fixtures';

const sustainabilityEnrichment = {
  person: { responsibilities: ['sustainability strategy', 'reporting on emissions across every supplier tier'], decisionAreas: ['sustainable materials', 'circularity'], themes: ['carbon emissions'] },
  professionalInterests: ['recycled materials'],
  searchTerms: ['traceability', 'PFAS'],
};

function article(id: string, title: string, description: string): NormalizedArticle {
  return { id, title, description, url: `https://www.sgieurope.com/${id}.article`, categories: [], tags: [], publisherId: 'sgi-europe', publishedAt: '2026-09-01T00:00:00.000Z' };
}

describe('title topics for generic roles', () => {
  it.each([
    ['Head of Sustainability', ['sustainability']],
    ['Chief Legal Officer', ['legal']],
    ['Head of Legal & Compliance', ['legal', 'compliance']],
    ['VP, Sustainability and Corporate Affairs', ['sustainability', 'corporate affairs']],
    ['Director of ESG', ['esg']],
    ['CEO', []],
    ['Founder', []],
  ])('%s → %j', (title, expected) => {
    expect(titleTopics(title)).toEqual(expected);
  });

  it('marks catch-all roles as generic and keeps dedicated roles unchanged', () => {
    expect(analyzeRole('Head of Retail')).toMatchObject({ function: 'Retail', roleSource: 'dedicated' });
    expect(analyzeRole('Head of Retail').titleTopics).toBeUndefined();
    expect(analyzeRole('Head of Sustainability')).toMatchObject({ function: 'Leadership', roleSource: 'generic', titleTopics: ['sustainability'], directThemes: ['sustainability'] });
    expect(analyzeRole('Head of Sustainability').adjacentThemes).toEqual(expect.arrayContaining(['strategy', 'markets', 'growth']));
    expect(analyzeRole('CEO')).toMatchObject({ function: 'Leadership', roleSource: 'generic' });
    expect(analyzeRole('CEO').directThemes).toEqual(expect.arrayContaining(['strategy', 'markets']));
  });

  it('makes the title topic the direct concept and moves catch-all leadership concepts to adjacent', () => {
    const profile = buildProfessionalProfile(company('puma.com', 'Puma', 'sporting goods', []), 'Head of Sustainability');
    const direct = profile.retrieval.concepts!.filter((concept) => concept.relevanceType === 'direct').map((concept) => concept.concept);
    const adjacent = profile.retrieval.concepts!.filter((concept) => concept.relevanceType === 'adjacent').map((concept) => concept.concept);
    expect(direct).toContain('sustainability');
    expect(direct).not.toEqual(expect.arrayContaining(['markets']));
    expect(direct).not.toContain('growth');
    expect(adjacent).toEqual(expect.arrayContaining(['markets', 'growth']));
  });
});

describe('AI enrichment for generic roles', () => {
  it('promotes short enrichment concepts to direct role concepts, skipping long phrases', () => {
    const base = buildProfessionalProfile(company('puma.com', 'Puma', 'sporting goods', []), 'Head of Sustainability');
    const merged = mergeProfessionalProfileEnhancement(base, sustainabilityEnrichment)!;
    const promoted = merged.retrieval.concepts!.filter((concept) => concept.source === 'role' && concept.weight === 1.1).map((concept) => concept.concept);
    expect(promoted).toEqual(['carbon emissions', 'sustainable materials', 'circularity', 'traceability', 'PFAS', 'recycled materials', 'sustainability strategy']);
    expect(promoted).not.toContain('reporting on emissions across every supplier tier');
    expect(merged.directInterests).toEqual(expect.arrayContaining(['carbon emissions', 'traceability']));
  });

  it('leaves dedicated roles on the existing merge', () => {
    const base = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', []), 'Head of Retail');
    const merged = mergeProfessionalProfileEnhancement(base, sustainabilityEnrichment)!;
    expect(merged.retrieval.concepts!.some((concept) => concept.weight === 1.1)).toBe(false);
    expect(merged.retrieval.concepts!.slice(0, base.retrieval.concepts!.length)).toEqual(base.retrieval.concepts);
  });

  it('ranks on-topic coverage above company financial results for a generic role', () => {
    const profile = mergeProfessionalProfileEnhancement(buildProfessionalProfile(company('puma.com', 'Puma', 'sporting goods', []), 'Head of Sustainability'), sustainabilityEnrichment)!;
    const results = scoreProfessionalArticle(article('results', 'Puma posts flat operating profit as growth stalls', 'Puma said markets were weak and growth slowed.'), profile);
    const onTopic = scoreProfessionalArticle(article('leather', 'Brand commits to traceability for leather', 'Recycled materials and carbon emissions targets for its sustainability programme.'), profile);
    expect(onTopic.relevanceType).toBe('direct');
    expect(results.relevanceType).not.toBe('direct');
    expect(onTopic.score).toBeGreaterThan(results.score);
  });
});

describe('company bonus', () => {
  it('scales with role evidence so a company mention cannot outrank on-topic coverage of another company', () => {
    const profile = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', []), 'Head of Procurement');
    const companyMention = scoreProfessionalArticle(article('mention', 'Nike unveils new campaign with athletes', 'The campaign features athletes. Separately, analysts noted suppliers in the body text.'), profile);
    const onTopic = scoreProfessionalArticle(article('other', 'Brand consolidates suppliers', 'A rival brand cut its suppliers and sourcing partners to reduce cost.'), profile);
    expect(companyMention.scoreComponents!.company).toBeLessThan(8);
    expect(onTopic.score).toBeGreaterThan(companyMention.score);
    const strongMention = scoreProfessionalArticle(article('strong', 'Nike consolidates suppliers', 'Nike cut suppliers and sourcing partners.'), profile);
    expect(strongMention.scoreComponents!.company).toBe(8);
  });
});
