import { createEvent } from '../core';
import { MemoryAnalyticsStore } from './store';
import type { StoredAnalyticsEvent } from './types';

const demoArticles = [
  ['quiet-revolution-electric-ferries', 'The quiet revolution of electric ferries', 'Sustainability', '2025-06-12'],
  ['european-yards-hybrid-propulsion', 'European yards accelerate hybrid propulsion', 'Making', '2026-08-02'],
  ['repair-economy', 'The repair economy finds a new audience', 'Business', '2025-01-18'],
  ['small-language-models', 'Why small models are useful tools', 'Technology', '2026-07-14'],
] as const;
const realArticles = [
  ['rp-001', 'The infrastructure of a cooler city', 'Climate', '2026-09-12'],
  ['rp-002', 'Why small models are useful tools', 'Technology', '2026-09-05'],
  ['rp-003', 'The repair economy finds a new audience', 'Business', '2025-02-18'],
] as const;

function seededEvent(name: Parameters<typeof createEvent>[0], publisherId: string, sessionId: string, timestamp: string, metadata?: Record<string, string | number | boolean>): StoredAnalyticsEvent {
  const event = createEvent(name, publisherId, sessionId, metadata, '1');
  return { ...event, eventId: `${publisherId}-${sessionId}-${name}-${timestamp}`, schemaVersion: event.schemaVersion ?? '1.0', timestamp, receivedAt: timestamp };
}

export async function createSeedAnalyticsStore(): Promise<MemoryAnalyticsStore> {
  const store = new MemoryAnalyticsStore();
  const events: StoredAnalyticsEvent[] = [];
  const publishers = [{ id: 'demo', articles: demoArticles }, { id: 'real-publisher', articles: realArticles }];
  for (let day = 0; day < 28; day += 1) {
    for (const publisher of publishers) {
      const sessions = publisher.id === 'demo' ? 4 : 2;
      for (let index = 0; index < sessions; index += 1) {
        const session = `${publisher.id}-seed-${day}-${index}`;
        const date = new Date(Date.UTC(2026, 8, 1 + day, 9 + index, 15));
        const timestamp = (offset: number) => new Date(date.getTime() + offset * 1000).toISOString();
        const industry = index % 3 === 0 ? 'marine' : index % 3 === 1 ? 'technology' : 'finance';
        const roleFunction = index % 2 === 0 ? 'operations' : 'leadership';
        const mode = index % 3 === 0 ? 'hybrid' : 'deterministic';
        const article = publisher.articles[(day + index) % publisher.articles.length];
        events.push(seededEvent('widget_impression', publisher.id, session, timestamp(0)));
        if (index !== 3 || day % 4 !== 0) events.push(seededEvent('widget_opened', publisher.id, session, timestamp(4)));
        events.push(seededEvent('intro_viewed', publisher.id, session, timestamp(5)));
        events.push(seededEvent('company_entered', publisher.id, session, timestamp(9), { industry }));
        events.push(seededEvent('role_entered', publisher.id, session, timestamp(13), { roleFunction }));
        events.push(seededEvent('report_requested', publisher.id, session, timestamp(14)));
        events.push(seededEvent('generation_started', publisher.id, session, timestamp(15)));
        events.push(seededEvent('company_analysis_started', publisher.id, session, timestamp(16)));
        events.push(seededEvent('company_analysis_completed', publisher.id, session, timestamp(17), { industry }));
        events.push(seededEvent('profile_generated', publisher.id, session, timestamp(18), { industry, roleFunction, aiProfileUsed: false }));
        events.push(seededEvent('retrieval_started', publisher.id, session, timestamp(19)));
        events.push(seededEvent('retrieval_completed', publisher.id, session, timestamp(20), { resultCount: 7 }));
        events.push(seededEvent('ranking_completed', publisher.id, session, timestamp(21), { resultCount: 7, rankingMode: mode, aiRerankUsed: mode === 'hybrid' }));
        const resultCount = industry === 'finance' && publisher.id === 'real-publisher' ? 3 : 7;
        events.push(seededEvent('report_generated', publisher.id, session, timestamp(22), { resultCount, rankingMode: mode, aiProfileUsed: false, aiRerankUsed: mode === 'hybrid', aiExplanationUsed: false }));
        for (let position = 1; position <= Math.min(resultCount, 4); position += 1) {
          const candidate = publisher.articles[(day + index + position - 1) % publisher.articles.length];
          events.push(seededEvent('story_impression', publisher.id, session, timestamp(22 + position), { articleId: candidate[0], articleTitle: candidate[1], articleCategory: candidate[2], articlePublishedAt: candidate[3], articlePosition: position, rankingMode: mode }));
        }
        if ((day + index) % 3 !== 0) events.push(seededEvent('story_clicked', publisher.id, session, timestamp(30), { articleId: article[0], articleTitle: article[1], articleCategory: article[2], articlePublishedAt: article[3], articlePosition: (day + index) % 4 + 1, rankingMode: mode }));
        events.push(seededEvent('report_viewed', publisher.id, session, timestamp(34), { reportId: `${publisher.id}-${session}` }));
      }
    }
  }
  await store.append(events);
  return store;
}
