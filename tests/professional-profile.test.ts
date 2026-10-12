import { describe, expect, it } from 'vitest';
import { analyzeRole, buildProfessionalProfile } from '../src/core';
import { mergeProfessionalProfileEnhancement } from '../src/ai/validation';
import { normalizeCompanyUrl, SafeCompanyContextProvider } from '../src/server/company';

describe('professional context', () => {
  it('canonicalizes accepted company URL forms and blocks unsafe hosts', () => {
    for (const input of ['ldsystems.uk', 'www.ldsystems.uk', 'https://ldsystems.uk', 'https://www.ldsystems.uk/', 'bbc.co.uk']) {
      expect(normalizeCompanyUrl(input).canonicalUrl).toMatch(/^https:\/\//);
    }
    expect(normalizeCompanyUrl('https://www.LDSystems.uk/about')).toEqual({ domain: 'ldsystems.uk', canonicalUrl: 'https://ldsystems.uk/' });
    expect(normalizeCompanyUrl('www.ldsystems.uk', { preserveWww: true }).canonicalUrl).toBe('https://www.ldsystems.uk/');
    expect(normalizeCompanyUrl('ldsystems.uk').domain).toBe('ldsystems.uk');
    for (const input of ['hello', 'not a url', 'javascript:alert(1)', 'ftp://example.com']) {
      expect(() => normalizeCompanyUrl(input)).toThrow();
    }
    expect(() => normalizeCompanyUrl('http://127.0.0.1:8080')).toThrow('unsafe_company_url');
    expect(() => normalizeCompanyUrl('file:///etc/passwd')).toThrow('unsafe_company_url');
  });

  it('combines deterministic company and role signals into one reusable profile', async () => {
    const company = await new SafeCompanyContextProvider().getContext('ldsystems.uk');
    const profile = buildProfessionalProfile(company, 'Software Engineer', new Date('2026-10-06T00:00:00.000Z'));
    expect(analyzeRole('Software Engineer').function).toBe('Engineering');
    expect(profile.companyDomain).toBe('ldsystems.uk');
    expect(profile.professionalInterests).toEqual(expect.arrayContaining(['technology', 'AI', 'automation']));
    expect(profile.directInterests).toContain('language models');
    expect(profile.adjacentInterests).toContain('robotics');
    expect(profile.retrieval.concepts.some((concept) => concept.concept === 'language models' && concept.relevanceType === 'direct' && concept.weight > 1)).toBe(true);
    expect(profile.excludedConcepts).toContain('astronomy');
    expect(profile.retrieval.semanticQueries).toHaveLength(2);
    expect(profile.generatedAt).toBe('2026-10-06T00:00:00.000Z');
  });

  it('falls back to the submitted domain when company enrichment is unavailable', async () => {
    const provider = new SafeCompanyContextProvider(async () => new Response('upstream unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
    await expect(provider.getContext('unavailable.example')).resolves.toMatchObject({ domain: 'unavailable.example', name: 'unavailable', source: 'submitted-domain', topics: [], entities: [] });
  });

  it('keeps the deterministic role foundation stable across repeated and sparse company inputs', async () => {
    const provider = new SafeCompanyContextProvider();
    const known = await provider.getContext('ldsystems.uk');
    const sparse = await new SafeCompanyContextProvider(async () => new Response('blocked', { status: 503, headers: { 'Content-Type': 'text/plain' } })).getContext('unknown-company.example');
    const first = buildProfessionalProfile(known, 'Software Engineer', new Date('2026-10-06T00:00:00.000Z'));
    const second = buildProfessionalProfile(known, 'Software Engineer', new Date('2026-10-06T00:00:00.000Z'));
    const sparseProfile = buildProfessionalProfile(sparse, 'Software Engineer', new Date('2026-10-06T00:00:00.000Z'));
    expect(second.directInterests).toEqual(first.directInterests);
    expect(second.retrieval.concepts).toEqual(first.retrieval.concepts);
    expect(sparseProfile.directInterests).toEqual(expect.arrayContaining(['software engineering', 'APIs', 'infrastructure']));
    const merged = mergeProfessionalProfileEnhancement(first, { professionalInterests: ['decision support', 'professional practice', 'software'], person: { themes: ['AI'] } });
    expect(merged?.directInterests).toEqual(expect.arrayContaining(['software engineering', 'APIs', 'infrastructure']));
    expect(merged?.directInterests).not.toContain('decision support');
    expect(merged?.professionalInterests.slice(0, 3)).toEqual(['software engineering', 'developer technology', 'APIs']);
  });
});
