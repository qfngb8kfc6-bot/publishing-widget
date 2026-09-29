import type { AnalyticsReport } from './metrics';

function csv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export type AnalyticsExportKind = 'daily' | 'interests' | 'recommended' | 'clicked';

export function reportToCsv(report: AnalyticsReport, kind: AnalyticsExportKind): string {
  if (kind === 'daily') return [['date', 'impressions', 'opens', 'searches', 'clicks'], ...report.daily.map((row) => [row.date, row.impressions, row.opens, row.searches, row.clicks])].map((row) => row.map(csv).join(',')).join('\n');
  if (kind === 'interests') return [['interest', 'count', 'percentage'], ...report.topInterests.map((row) => [row.label, row.count, row.percentage])].map((row) => row.map(csv).join(',')).join('\n');
  const rows = kind === 'recommended' ? report.topRecommendedArticles : report.topClickedArticles;
  return [['article_id', 'title', 'category', 'impressions', 'clicks', 'ctr'], ...rows.map((row) => [row.articleId, row.title, row.category, row.impressions, row.clicks, row.ctr])].map((row) => row.map(csv).join(',')).join('\n');
}

export function downloadReportCsv(report: AnalyticsReport, kind: AnalyticsExportKind, documentRef: Document = document): void {
  const link = documentRef.createElement('a');
  link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(reportToCsv(report, kind))}`;
  link.download = `${report.publisherId}-${kind}.csv`;
  link.click();
}
