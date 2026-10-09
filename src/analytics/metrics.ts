import type { AnalyticsDateRange, StoredAnalyticsEvent } from './types';

export interface CountMetric { label: string; count: number; percentage: number; }
export interface ArticleMetric { articleId: string; title: string; category: string; publishedAt?: string; impressions: number; clicks: number; ctr: number; reportCount: number; }
export interface PositionMetric { position: number; impressions: number; clicks: number; ctr: number; }
export interface RankingMetric { mode: string; searches: number; clicks: number; ctr: number; }
export interface DailyMetric { date: string; impressions: number; opens: number; searches: number; clicks: number; }
export interface FunnelMetric { stage: string; count: number; percentage: number; conversionFromPrevious: number | null; conversionFromFirst: number | null; }
export interface RecentActivity { name: StoredAnalyticsEvent['name']; timestamp: string; context: string; }

export interface AnalyticsReport {
  publisherId: string;
  publisherName?: string;
  range?: AnalyticsDateRange;
  overview: {
    widgetImpressions: number; widgetOpens: number; briefingsRequested: number; reportsGenerated: number; reportsViewed: number; storyClicks: number; reportShares: number; profileEdits: number;
    searchesCompleted: number; articleClicks: number; searchToClickRate: number; openToSearchRate: number; averageRecommendationsShown: number;
  };
  funnel: FunnelMetric[];
  audience: { industries: CountMetric[]; roleFunctions: CountMetric[]; companiesAvailable: false; rolesAvailable: false; };
  content: { topStories: ArticleMetric[]; topClickedStories: ArticleMetric[]; positionPerformance: PositionMetric[]; rankingModes: RankingMetric[] };
  reportPerformance: { generated: number; viewed: number; viewRate: number; shared: number; edited: number; averageStoryClicksPerViewedReport: number | null; averageStoryImpressionsPerViewedReport: number | null; };
  generationHealth: { generationStarted: number; generationSucceeded: number; generationSuccessRate: number; generationFailures: number | null; aiProfileUsageRate: number | null; deterministicProfileRate: number | null; aiRerankUsageRate: number | null; deterministicRankingRate: number | null; aiExplanationUsageRate: number | null; deterministicExplanationRate: number | null; timingAvailable: false; };
  recentActivity: RecentActivity[];

  // Kept for historical exports and compatibility with older API consumers.
  topInterests: CountMetric[]; topPersonas: CountMetric[]; topRecommendedArticles: ArticleMetric[]; topClickedArticles: ArticleMetric[]; positionPerformance: PositionMetric[]; rankingModes: RankingMetric[]; daily: DailyMetric[];
  contentGaps: Array<{ interest: string; searchShare: number; averageResults: number; clickRate: number; statement: string }>;
  archiveInsights: ArticleMetric[];
  sessions: { total: number; resultsViewed: number; articlesClicked: number; answersChanged: number; restarted: number };
}

export interface InternalAnalyticsAggregate { publisherCount: number; totalSearches: number; totalClicks: number; averageCtr: number; }

function percent(value: number, denominator: number): number { return denominator > 0 ? Math.round((value / denominator) * 1000) / 10 : 0; }
function dateOf(timestamp: string): string { return timestamp.slice(0, 10); }
function metadata(event: StoredAnalyticsEvent, key: string): string { const value = event.metadata?.[key]; return typeof value === 'string' ? value : ''; }
function numberMetadata(event: StoredAnalyticsEvent, key: string): number { const value = event.metadata?.[key]; return typeof value === 'number' ? value : Number(value) || 0; }
function booleanMetadata(event: StoredAnalyticsEvent, key: string): boolean | undefined { const value = event.metadata?.[key]; return typeof value === 'boolean' ? value : undefined; }
function uniqueSessions(events: StoredAnalyticsEvent[], name: StoredAnalyticsEvent['name']): Set<string> { return new Set(events.filter((event) => event.name === name).map((event) => event.sessionId)); }
function rank<T extends { count: number; label: string }>(items: T[], limit = 8): T[] { return items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit); }
function distinctEventKeys(events: StoredAnalyticsEvent[], name: StoredAnalyticsEvent['name']): Set<string> { return new Set(events.filter((event) => event.name === name).map((event) => metadata(event, 'reportId') || event.eventId || event.sessionId)); }
function countExplicitBoolean(events: StoredAnalyticsEvent[], name: StoredAnalyticsEvent['name'], key: string): { enabled: number; disabled: number; total: number } {
  const relevant = events.filter((event) => event.name === name && booleanMetadata(event, key) !== undefined);
  return { enabled: relevant.filter((event) => booleanMetadata(event, key) === true).length, disabled: relevant.filter((event) => booleanMetadata(event, key) === false).length, total: relevant.length };
}
function optionalRate(value: number, denominator: number): number | null { return denominator > 0 ? percent(value, denominator) : null; }

const clickEvents = new Set<StoredAnalyticsEvent['name']>(['article_clicked', 'story_clicked']);
const impressionEvents = new Set<StoredAnalyticsEvent['name']>(['result_impression', 'story_impression']);
function isClick(event: StoredAnalyticsEvent): boolean { return clickEvents.has(event.name); }
function isImpression(event: StoredAnalyticsEvent): boolean { return impressionEvents.has(event.name); }
function completionEvents(events: StoredAnalyticsEvent[]): StoredAnalyticsEvent[] {
  return [...new Map(events.filter((event) => event.name === 'search_completed' || event.name === 'report_generated').map((event) => [event.sessionId, event])).values()];
}

function dimension(events: StoredAnalyticsEvent[], questionKind: string): CountMetric[] {
  const counts = new Map<string, number>();
  const total = new Set(events.filter((event) => event.name === 'question_answered' && metadata(event, 'questionKind') === questionKind).map((event) => event.sessionId)).size;
  events.filter((event) => event.name === 'question_answered' && metadata(event, 'questionKind') === questionKind).forEach((event) => {
    const values = (metadata(event, 'answerOptionIds') || metadata(event, 'answerOptionId')).split(',').map((value) => value.trim()).filter(Boolean);
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  });
  return rank([...counts.entries()].map(([label, count]) => ({ label, count, percentage: percent(count, total) })));
}

function categoricalDimension(events: StoredAnalyticsEvent[], names: StoredAnalyticsEvent['name'][], key: string): CountMetric[] {
  const pairs = new Set<string>();
  const labels = new Map<string, Set<string>>();
  events.filter((event) => names.includes(event.name)).forEach((event) => {
    const label = metadata(event, key).trim().toLowerCase();
    if (!label) return;
    const pair = `${event.sessionId}\u0000${label}`;
    if (pairs.has(pair)) return;
    pairs.add(pair);
    const sessions = labels.get(label) ?? new Set<string>();
    sessions.add(event.sessionId);
    labels.set(label, sessions);
  });
  const total = new Set([...pairs].map((pair) => pair.split('\u0000', 1)[0])).size;
  return rank([...labels.entries()].map(([label, sessions]) => ({ label, count: sessions.size, percentage: percent(sessions.size, total) })));
}

function articleMetrics(events: StoredAnalyticsEvent[]): ArticleMetric[] {
  const byArticle = new Map<string, ArticleMetric>();
  events.filter((event) => isImpression(event) || isClick(event)).forEach((event) => {
    const articleId = metadata(event, 'articleId');
    if (!articleId) return;
    const current = byArticle.get(articleId) ?? { articleId, title: metadata(event, 'articleTitle') || articleId, category: metadata(event, 'articleCategory') || 'Story', publishedAt: metadata(event, 'articlePublishedAt') || undefined, impressions: 0, clicks: 0, ctr: 0, reportCount: 0 };
    if (isImpression(event)) current.impressions += 1; else current.clicks += 1;
    current.title = current.title === articleId ? metadata(event, 'articleTitle') || current.title : current.title;
    current.category = current.category === 'Story' ? metadata(event, 'articleCategory') || current.category : current.category;
    current.publishedAt ||= metadata(event, 'articlePublishedAt') || undefined;
    byArticle.set(articleId, current);
  });
  for (const article of byArticle.values()) {
    article.reportCount = new Set(events.filter((event) => (isImpression(event) || isClick(event)) && metadata(event, 'articleId') === article.articleId).map((event) => metadata(event, 'reportId') || event.sessionId)).size;
    article.ctr = percent(article.clicks, article.impressions);
  }
  return [...byArticle.values()].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
}

function funnel(events: StoredAnalyticsEvent[]): FunnelMetric[] {
  const stages: Array<[string, StoredAnalyticsEvent['name']]> = [['Widget impression', 'widget_impression'], ['Report requested', 'report_requested'], ['Generation started', 'generation_started'], ['Report generated', 'report_generated'], ['Report viewed', 'report_viewed'], ['Story clicked', 'story_clicked']];
  const counts = stages.map(([, name]) => uniqueSessions(events, name).size);
  const first = counts[0] ?? 0;
  return stages.map(([stage], index) => ({ stage, count: counts[index] ?? 0, percentage: percent(counts[index] ?? 0, first), conversionFromPrevious: index === 0 ? null : percent(counts[index] ?? 0, counts[index - 1] ?? 0), conversionFromFirst: percent(counts[index] ?? 0, first) }));
}

function recentActivity(events: StoredAnalyticsEvent[]): RecentActivity[] {
  const labels: Partial<Record<StoredAnalyticsEvent['name'], string>> = { report_generated: 'Report generated', report_viewed: 'Report viewed', story_clicked: 'Story clicked', report_shared: 'Report shared', profile_edit_clicked: 'Profile edited' };
  return events.filter((event) => labels[event.name]).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 12).map((event) => {
    const title = metadata(event, 'articleTitle');
    const articleId = metadata(event, 'articleId');
    const context = title ? `${labels[event.name]} · ${title}` : articleId ? `${labels[event.name]} · ${articleId}` : labels[event.name]!;
    return { name: event.name, timestamp: event.timestamp, context };
  });
}

export function buildAnalyticsReport(events: StoredAnalyticsEvent[], publisherId: string, range?: AnalyticsDateRange): AnalyticsReport {
  const scoped = events.filter((event) => event.publisherId === publisherId && (!range || (Date.parse(event.timestamp) >= Date.parse(range.from) && Date.parse(event.timestamp) <= Date.parse(range.to))));
  const impressions = uniqueSessions(scoped, 'widget_impression').size;
  const opens = uniqueSessions(scoped, 'widget_opened').size;
  const requested = uniqueSessions(scoped, 'report_requested').size;
  const generationStarted = uniqueSessions(scoped, 'generation_started').size;
  const reportsGenerated = distinctEventKeys(scoped, 'report_generated').size;
  const reportsViewed = distinctEventKeys(scoped, 'report_viewed').size;
  const reportShares = scoped.filter((event) => event.name === 'report_shared').length;
  const profileEdits = scoped.filter((event) => event.name === 'profile_edit_clicked').length;
  const searchEvents = completionEvents(scoped);
  const clicks = scoped.filter(isClick).length;
  const averageRecommendationsShown = searchEvents.length ? Math.round((searchEvents.reduce((sum, event) => sum + numberMetadata(event, 'resultCount'), 0) / searchEvents.length) * 10) / 10 : 0;
  const articles = articleMetrics(scoped);
  const positions = new Map<number, PositionMetric>();
  scoped.filter((event) => isImpression(event) || isClick(event)).forEach((event) => {
    const position = numberMetadata(event, 'articlePosition');
    if (!position) return;
    const metric = positions.get(position) ?? { position, impressions: 0, clicks: 0, ctr: 0 };
    if (isImpression(event)) metric.impressions += 1; else metric.clicks += 1;
    metric.ctr = percent(metric.clicks, metric.impressions);
    positions.set(position, metric);
  });
  const ranking = new Map<string, RankingMetric>();
  searchEvents.forEach((event) => {
    const mode = metadata(event, 'rankingMode') || 'deterministic';
    const metric = ranking.get(mode) ?? { mode, searches: 0, clicks: 0, ctr: 0 };
    metric.searches += 1;
    metric.clicks += scoped.filter((candidate) => candidate.sessionId === event.sessionId && isClick(candidate)).length;
    metric.ctr = percent(metric.clicks, metric.searches);
    ranking.set(mode, metric);
  });
  const dailyMap = new Map<string, DailyMetric>();
  scoped.forEach((event) => {
    const date = dateOf(event.timestamp);
    const day = dailyMap.get(date) ?? { date, impressions: 0, opens: 0, searches: 0, clicks: 0 };
    if (event.name === 'widget_impression') day.impressions += 1;
    if (event.name === 'widget_opened') day.opens += 1;
    if (event.name === 'search_completed' || event.name === 'report_generated') day.searches += 1;
    if (isClick(event)) day.clicks += 1;
    dailyMap.set(date, day);
  });
  const interestSearches = new Map<string, { sessions: Set<string>; results: number; clicks: number }>();
  const sessionInterest = new Map<string, string>();
  scoped.filter((event) => event.name === 'question_answered' && metadata(event, 'questionKind') === 'interest').forEach((event) => {
    const interest = metadata(event, 'answerOptionId') || metadata(event, 'answerOptionIds');
    if (interest) sessionInterest.set(event.sessionId, interest.split(',')[0]);
  });
  searchEvents.forEach((event) => {
    const interest = sessionInterest.get(event.sessionId);
    if (!interest) return;
    const current = interestSearches.get(interest) ?? { sessions: new Set<string>(), results: 0, clicks: 0 };
    current.sessions.add(event.sessionId); current.results += numberMetadata(event, 'resultCount');
    current.clicks += scoped.filter((candidate) => candidate.sessionId === event.sessionId && isClick(candidate)).length;
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
  const viewedReportKeys = distinctEventKeys(scoped, 'report_viewed');
  const viewedReportSessions = new Set(scoped.filter((event) => event.name === 'report_viewed').map((event) => event.sessionId));
  const storyEventsForViewedReports = scoped.filter((event) => (isImpression(event) || isClick(event)) && (metadata(event, 'reportId') ? viewedReportKeys.has(metadata(event, 'reportId')) : viewedReportSessions.has(event.sessionId)));
  const viewedReportStoryClicks = storyEventsForViewedReports.filter(isClick).length;
  const viewedReportStoryImpressions = storyEventsForViewedReports.filter(isImpression).length;
  const profileAI = countExplicitBoolean(scoped, 'profile_generated', 'aiProfileUsed');
  const rankAI = countExplicitBoolean(scoped, 'ranking_completed', 'aiRerankUsed');
  const explanationAI = countExplicitBoolean(scoped, 'report_generated', 'aiExplanationUsed');
  const generationSucceeded = new Set(scoped.filter((event) => event.name === 'report_generated').map((event) => event.sessionId)).size;
  const sessionIds = new Set(scoped.map((event) => event.sessionId));
  return {
    publisherId,
    range,
    overview: { widgetImpressions: impressions, widgetOpens: opens, briefingsRequested: requested, reportsGenerated, reportsViewed, storyClicks: clicks, reportShares, profileEdits, searchesCompleted: searchEvents.length, articleClicks: clicks, searchToClickRate: percent(clicks, searchEvents.length), openToSearchRate: percent(requested, opens), averageRecommendationsShown },
    funnel: funnel(scoped),
    audience: { industries: categoricalDimension(scoped, ['company_analysis_completed', 'profile_generated'], 'industry'), roleFunctions: categoricalDimension(scoped, ['role_analysis_completed', 'profile_generated'], 'roleFunction'), companiesAvailable: false, rolesAvailable: false },
    content: { topStories: articles.slice(0, 8), topClickedStories: [...articles].sort((a, b) => b.clicks - a.clicks || b.ctr - a.ctr).slice(0, 8), positionPerformance: [...positions.values()].sort((a, b) => a.position - b.position), rankingModes: [...ranking.values()].sort((a, b) => a.mode.localeCompare(b.mode)) },
    reportPerformance: { generated: reportsGenerated, viewed: reportsViewed, viewRate: percent(reportsViewed, reportsGenerated), shared: reportShares, edited: profileEdits, averageStoryClicksPerViewedReport: viewedReportKeys.size ? Math.round((viewedReportStoryClicks / viewedReportKeys.size) * 10) / 10 : null, averageStoryImpressionsPerViewedReport: viewedReportKeys.size ? Math.round((viewedReportStoryImpressions / viewedReportKeys.size) * 10) / 10 : null },
    generationHealth: { generationStarted, generationSucceeded, generationSuccessRate: percent(generationSucceeded, generationStarted), generationFailures: null, aiProfileUsageRate: optionalRate(profileAI.enabled, profileAI.total), deterministicProfileRate: optionalRate(profileAI.disabled, profileAI.total), aiRerankUsageRate: optionalRate(rankAI.enabled, rankAI.total), deterministicRankingRate: optionalRate(rankAI.disabled, rankAI.total), aiExplanationUsageRate: optionalRate(explanationAI.enabled, explanationAI.total), deterministicExplanationRate: optionalRate(explanationAI.disabled, explanationAI.total), timingAvailable: false },
    recentActivity: recentActivity(scoped),
    topInterests: dimension(scoped, 'interest'), topPersonas: dimension(scoped, 'persona'), topRecommendedArticles: articles.slice(0, 8), topClickedArticles: [...articles].sort((a, b) => b.clicks - a.clicks || b.ctr - a.ctr).slice(0, 8), positionPerformance: [...positions.values()].sort((a, b) => a.position - b.position), rankingModes: [...ranking.values()].sort((a, b) => a.mode.localeCompare(b.mode)), daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)), contentGaps, archiveInsights,
    sessions: { total: sessionIds.size, resultsViewed: new Set(scoped.filter(isImpression).map((event) => event.sessionId)).size, articlesClicked: new Set(scoped.filter(isClick).map((event) => event.sessionId)).size, answersChanged: new Set(scoped.filter((event) => event.name === 'change_answers').map((event) => event.sessionId)).size, restarted: new Set(scoped.filter((event) => event.name === 'restart_clicked').map((event) => event.sessionId)).size },
  };
}

export function dateRangeForPreset(preset: 'today' | '7d' | '30d' | '90d', now = new Date()): AnalyticsDateRange {
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  if (preset === '7d') start.setUTCDate(start.getUTCDate() - 6);
  if (preset === '30d') start.setUTCDate(start.getUTCDate() - 29);
  if (preset === '90d') start.setUTCDate(start.getUTCDate() - 89);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function buildInternalAnalyticsAggregate(reports: AnalyticsReport[]): InternalAnalyticsAggregate {
  const totalSearches = reports.reduce((sum, report) => sum + report.overview.reportsGenerated, 0);
  const totalClicks = reports.reduce((sum, report) => sum + report.overview.storyClicks, 0);
  return { publisherCount: reports.length, totalSearches, totalClicks, averageCtr: percent(totalClicks, totalSearches) };
}
