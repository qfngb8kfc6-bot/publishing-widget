import { describe, expect, it } from 'vitest';
import { acceptTitleCorrection, analyzeRole, buildProfessionalProfile, displayCompanyName } from '../src/core';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { company } from './ranking-fixtures';

describe('job title corrections', () => {
  it('accepts plain spelling fixes and keeps the user wording otherwise', () => {
    expect(acceptTitleCorrection('Softere Enginer', 'Software Engineer')).toBe('Software Engineer');
    expect(acceptTitleCorrection('Haed of Retial', 'Head of Retail')).toBe('Head of Retail');
    expect(acceptTitleCorrection('software engineer', 'Software Engineer')).toBe('Software Engineer');
    expect(acceptTitleCorrection('Head of IT', 'Head of Information Technology')).toBeUndefined();
    expect(acceptTitleCorrection('Dev', 'Developer')).toBeUndefined();
    expect(acceptTitleCorrection('Buyer', 'Merchandiser')).toBeUndefined();
    expect(acceptTitleCorrection('Head of Retail', 'Head of Retail')).toBeUndefined();
    expect(acceptTitleCorrection('Head of Retail', undefined)).toBeUndefined();
  });

  it('title-cases an all-lowercase company name only', () => {
    expect(displayCompanyName('nike')).toBe('Nike');
    expect(displayCompanyName('jd sports')).toBe('Jd Sports');
    expect(displayCompanyName('adidas')).toBe('Adidas');
    expect(displayCompanyName('JD Sports')).toBe('JD Sports');
    expect(displayCompanyName('lululemon athletica')).toBe('Lululemon Athletica');
    expect(buildProfessionalProfile(company('nike.com', 'nike', 'sporting goods', []), 'Software Engineer').companyName).toBe('Nike');
  });

  it('the misspelt title alone does not reach the engineering role', () => {
    expect(analyzeRole('Softere Enginer').function).not.toBe('Engineering');
    expect(analyzeRole('Software Engineer').function).toBe('Engineering');
  });
});

describe('report with a misspelt role', () => {
  it('uses the corrected title for the role, report and loading page, and keeps the submitted wording', async () => {
    const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    const titles = ['Nike relaunches its app as an e-commerce platform', 'Strava acquires running app Runna', 'Whoop raises funding for its wearable'];
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${titles.map((title, index) => `<item><title>${title}</title><link>https://www.sgieurope.com/business/t-${index}/1800${index}.article</link><guid>https://www.sgieurope.com/business/t-${index}/1800${index}.article</guid><description>${title}: software, apps and digital products.</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const instance = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-title-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '200' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input, init) => {
        if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const operation = JSON.parse(JSON.parse(String(init?.body)).messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).operation as string;
        const content = operation === 'professional-profile-enrichment' ? { correctedJobTitle: 'Software Engineer', professionalInterests: ['digital products'] } : operation === 'subject-vocabulary' ? { terms: ['mobile apps', 'e-commerce platforms'] } : {};
        return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const started = await (await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Softere Enginer' }) }))).json() as { generationId: string };
    let status: { status: string; reportId?: string; details: Record<string, unknown> } | undefined;
    for (let attempt = 0; attempt < 200 && status?.status !== 'complete'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = await (await instance.handle(new Request(`https://discovery.ldsystems.uk/api/generations/${started.generationId}/status?publisherId=sgi-europe`))).json() as typeof status;
    }
    const report = (await instance.reportStore.get(status!.reportId!, 'sgi-europe'))!;
    expect(report.jobTitle).toBe('Software Engineer');
    expect(report.companyName).toBe('Nike');
    expect(report.professionalProfile.role.function).toBe('Engineering');
    expect(report.professionalProfile.submittedJobTitle).toBe('Softere Enginer');
    expect(status!.details).toMatchObject({ jobTitle: 'Software Engineer', companyName: 'Nike' });
    expect(JSON.stringify(report.recommendations.map((item) => item.explanation))).not.toMatch(/softere|enginer/i);
  });
});
