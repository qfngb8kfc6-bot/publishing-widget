import type { AnalyticsDateRange, StoredAnalyticsEvent } from './types';

export interface CountMetric { label: string; count: number; percentage: number; }
export interface ArticleMetric { articleId: string; title: string; category: string; publishedAt?: string; impressions: number; clicks: number; ctr: number; }
export interface PositionMetric { position: number; impressions: number; clicks: number; ctr: number; }
export interface RankingMetric { mode: string; searches: number; clicks: number; ctr: number; }
export interface DailyMetric { date: string; impressions: number; opens: number; searches: number; clicks: number; }

export interface AnalyticsReport {
  publisherId: string;
  range?: AnalyticsDateRange;
  overview: { widgetImpressions: number; widgetOpens: number; searchesCompleted: number; articleClicks: number; searchToClickRate: number; openToSearchRate: number; averageRecommendationsShown: number; };
  funnel: Array<{ stage: string; count: number; percentage: number }>;
  topInterests: CountMetric[];
  topPersonas: CountMetric[];
  topRecommendedArticles: ArticleMetric[];
  topClickedArticles: ArticleMetric[];
  positionPerformance: PositionMetric[];
  rankingModes: RankingMetric[];
  daily: DailyMetric[];
  contentGaps: Array<{ interest: string; searchShare: number; averageResults: number; clickRate: number; statement: string }>;
  archiveInsights: ArticleMetric[];
  sessions: { total: number; resultsViewed: number; articlesClicked: number; answersChanged: number; restarted: number };
}

export interface InternalAnalyticsAggregate { publisherCount: number; totalSearches: number; totalClicks: number; averageCtr: number; }

function percent(value: number, denominator: number): number { return denominator > 0 ? Math.round((value / denominator) * 1000) / 10 : 0; }
function dateOf(timestamp: string): string { return timestamp.slice(0, 10); }
function metadata(event: StoredAnalyticsEvent, key: string): string { const value = event.metadata?.[key]; return typeof value === 'string' ? value : ''; }
function numberMetadata(event: StoredAnalyticsEvent, key: string): number { const value = event.metadata?.[key]; return typeof value === 'number' ? value : Number(value) || 0; }
function uniqueSessions(events: StoredAnalyticsEvent[], name: StoredAnalyticsEvent['name']): Set<string> { return new Set(events.filter((event) => event.name === name).map((event) => event.sessionId)); }
function rank<T extends { count: number }>(items: T[], limit = 8): T[] { return items.sort((a, b) => b.count - a.count).slice(0, limit); }

function dimension(events: StoredAnalyticsEvent[], questionKind: string): CountMetric[] {
  const counts = new Map<string, number>();
  const total = new Set(events.filter((event) => event.name === 'question_answered' && metadata(event, 'questionKind') === questionKind).map((event) => event.sessionId)).size;
  events.filter((event) => event.name === 'question_answered' && metadata(event, 'questionKind') === questionKind).forEach((event) => {
    const values = (metadata(event, 'answerOptionIds') || metadata(event, 'answerOptionId')).split(',').map((value) => value.trim()).filter(Boolean);
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  });
  return rank([...counts.entries()].map(([label, count]) => ({ label, count, percentage: percent(count, total) })));
}

function articleMetrics(events: StoredAnalyticsEvent[]): ArticleMetric[] {
  const byArticle = new Map<string, ArticleMetric>();
  events.filter((event) => event.name === 'result_impression' || event.name === 'article_clicked').forEach((event) => {
    const articleId = metadata(event, 'articleId');
    if (!articleId) return;
    const current = byArticle.get(articleId) ?? { articleId, title: metadata(event, 'articleTitle') || articleId, category: metadata(event, 'articleCategory') || 'Story', publishedAt: metadata(event, 'articlePublishedAt') || undefined, impressions: 0, clicks: 0, ctr: 0 };
    if (event.name === 'result_impression') current.impressions += 1;
    else current.clicks += 1;
    current.title = current.title === articleId ? metadata(event, 'articleTitle') || current.title : current.title;
    current.category = current.category === 'Story' ? metadata(event, 'articleCategory') || current.category : current.category;
    current.publishedAt ||= metadata(event, 'articlePublishedAt') || undefined;
    current.ctr = percent(current.clicks, current.impressions);
    byArticle.set(articleId, current);
  });
  return [...byArticle.values()].map((item) => ({ ...item, ctr: percent(item.clicks, item.impressions) })).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
}

export function buildAnalyticsReport(events: StoredAnalyticsEvent[], publisherId: string, range?: AnalyticsDateRange): AnalyticsReport {
  const scoped = events.filter((event) => event.publisherId === publisherId && (!range || (Date.parse(event.timestamp) >= Date.parse(range.from) && Date.parse(event.timestamp) <= Date.parse(range.to))));
  const impressions = uniqueSessions(scoped, 'widget_impression').size;
  const opens = uniqueSessions(scoped, 'widget_opened').size;
  const searches = uniqueSessions(scoped, 'search_completed').size;
  const clicks = scoped.filter((event) => event.name === 'article_clicked').length;
  const searchEvents = scoped.filter((event) => event.name === 'search_completed');
  const averageRecommendationsShown = searchEvents.length ? Math.round((searchEvents.reduce((sum, event) => sum + numberMetadata(event, 'resultCount'), 0) / searchEvents.length) * 10) / 10 : 0;
  const funnelCounts = [impressions, opens, searches, new Set(scoped.filter((event) => event.name === 'article_clicked').map((event) => event.sessionId)).size];
  const funnelNames = ['Widget seen', 'Widget opened', 'Results shown', 'Article clicked'];
  const articles = articleMetrics(scoped);
  const positions = new Map<number, PositionMetric>();
  scoped.filter((event) => event.name === 'result_impression' || event.name === 'article_clicked').forEach((event) => {
    const position = numberMetadata(event, 'articlePosition');
    if (!position) return;
    const metric = positions.get(position) ?? { position, impressions: 0, clicks: 0, ctr: 0 };
    if (event.name === 'result_impression') metric.impressions += 1; else metric.clicks += 1;
    metric.ctr = percent(metric.clicks, metric.impressions);
    positions.set(position, metric);
  });
  const ranking = new Map<string, RankingMetric>();
  scoped.filter((event) => event.name === 'search_completed').forEach((event) => {
    const mode = metadata(event, 'rankingMode') || 'deterministic';
    const metric = ranking.get(mode) ?? { mode, searches: 0, clicks: 0, ctr: 0 };
    metric.searches += 1;
    const sessionClicks = scoped.filter((candidate) => candidate.name === 'article_clicked' && candidate.sessionId === event.sessionId).length;
    metric.clicks += sessionClicks;
    metric.ctr = percent(metric.clicks, metric.searches);
    ranking.set(mode, metric);
  });
  const dailyMap = new Map<string, DailyMetric>();
  scoped.forEach((event) => {
    const date = dateOf(event.timestamp);
    const day = dailyMap.get(date) ?? { date, impressions: 0, opens: 0, searches: 0, clicks: 0 };
    if (event.name === 'widget_impression') day.impressions += 1;
    if (event.name === 'widget_opened') day.opens += 1;
    if (event.name === 'search_completed') day.searches += 1;
    if (event.name === 'article_clicked') day.clicks += 1;
    dailyMap.set(date, day);
  });
  const interestSearches = new Map<string, { sessions: Set<string>; results: number; clicks: number }>();
  const sessionInterest = new Map<string, string>();
  scoped.filter((event) => event.name === 'question_answered' && metadata(event, 'questionKind') === 'interest').forEach((event) => {
    const interest = metadata(event, 'answerOptionId') || metadata(event, 'answerOptionIds');
    if (interest) sessionInterest.set(event.sessionId, interest.split(',')[0]);
  });
  scoped.filter((event) => event.name === 'search_completed').forEach((event) => {
    const interest = sessionInterest.get(event.sessionId);
    if (!interest) return;
    const current = interestSearches.get(interest) ?? { sessions: new Set<string>(), results: 0, clicks: 0 };
    current.sessions.add(event.sessionId); current.results += numberMetadata(event, 'resultCount');
    current.clicks += scoped.filter((candidate) => candidate.name === 'article_clicked' && candidate.sessionId === event.sessionId).length;
    interestSearches.set(interest, current);
  });
  const totalInterestSearches = [...interestSearches.values()].reduce((sum, item) => sum + item.sessions.size, 0);
  const contentGaps = [...interestSearches.entries()].map(([interest, item]) => {
    const averageResults = item.sessions.size ? Math.round((item.results / item.sessions.size) * 10) / 10 : 0;
    const clickRate = percent(item.clicks, item.sessions.size);
    const searchShare = percent(item.sessions.size, totalInterestSearches);
    return { interest, searchShare, averageResults, clickRate, statement: `${interest} appeared in ${searchShare}% of searches, with ${averageResults} recommendations on average.` };
  }).filter((item) => item.searchShare >= 10 && (item.averageResults < 5 || item.clickRate < 15)).sort((a, b) => b.searchShare - a.searchShare);
  const archiveInsights = articles.filter((article) => article.publishedAt && Date.now() - Date.parse(article.publishedAt) > 1000 * 60 * 60 * 24 * 180 && article.clicks > 0).slice(0, 5);
  const sessionIds = new Set(scoped.map((event) => event.sessionId));
  return {
    publisherId,
    range,
    overview: { widgetImpressions: impressions, widgetOpens: opens, searchesCompleted: searches, articleClicks: clicks, searchToClickRate: percent(clicks, searches), openToSearchRate: percent(searches, opens), averageRecommendationsShown },
    funnel: funnelNames.map((stage, index) => ({ stage, count: funnelCounts[index], percentage: percent(funnelCounts[index], funnelCounts[0]) })),
    topInterests: dimension(scoped, 'interest'),
    topPersonas: dimension(scoped, 'persona'),
    topRecommendedArticles: articles.slice(0, 8),
    topClickedArticles: [...articles].sort((a, b) => b.clicks - a.clicks || b.ctr - a.ctr).slice(0, 8),
    positionPerformance: [...positions.values()].sort((a, b) => a.position - b.position),
    rankingModes: [...ranking.values()].sort((a, b) => a.mode.localeCompare(b.mode)),
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    contentGaps,
    archiveInsights,
    sessions: { total: sessionIds.size, resultsViewed: new Set(scoped.filter((event) => event.name === 'result_impression').map((event) => event.sessionId)).size, articlesClicked: new Set(scoped.filter((event) => event.name === 'article_clicked').map((event) => event.sessionId)).size, answersChanged: new Set(scoped.filter((event) => event.name === 'change_answers').map((event) => event.sessionId)).size, restarted: new Set(scoped.filter((event) => event.name === 'restart_clicked').map((event) => event.sessionId)).size },
  };
}

export function dateRangeForPreset(preset: 'today' | '7d' | '30d', now = new Date()): AnalyticsDateRange {
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  if (preset === '7d') start.setUTCDate(start.getUTCDate() - 6);
  if (preset === '30d') start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function buildInternalAnalyticsAggregate(reports: AnalyticsReport[]): InternalAnalyticsAggregate {
  const totalSearches = reports.reduce((sum, report) => sum + report.overview.searchesCompleted, 0);
  const totalClicks = reports.reduce((sum, report) => sum + report.overview.articleClicks, 0);
  return { publisherCount: reports.length, totalSearches, totalClicks, averageCtr: percent(totalClicks, totalSearches) };
}
