/**
 * The privacy notice shown under the briefing form and in the report footer, and the default privacy page. Browser
 * safe (no server imports). Retention comes from the server (REPORT_RETENTION_DAYS, default 365 days); the notice
 * starts from the default and is updated from GET /api/publishers/:id/privacy.
 */
export const DEFAULT_REPORT_RETENTION_DAYS = 365;
/** Most characters of a publisher's own privacy page text (edited in admin). */
export const MAX_PRIVACY_POLICY_LENGTH = 20_000;

/** Whole months for display (365 days -> 12 months); at least 1. */
export function retentionMonths(days: number): number {
  return Math.max(1, Math.round(days / 30.4));
}

export function retentionLabel(days: number): string {
  const months = retentionMonths(days);
  return months % 12 === 0 && months >= 12 ? `${months / 12} ${months === 12 ? 'year' : 'years'}` : `${months} ${months === 1 ? 'month' : 'months'}`;
}

/** One short line: what is stored, why, and for how long. The privacy link is added by the caller. */
export function privacyNoticeText(days = DEFAULT_REPORT_RETENTION_DAYS): string {
  return `We store the company and role you enter and the briefing we generate, so we can build it and show it at its link. We delete them after ${retentionLabel(days)}.`;
}

export function privacyPagePath(publisherId: string): string {
  return `/p/${encodeURIComponent(publisherId)}/privacy`;
}

/** The privacy page when the publisher has not written its own in admin. Plain text; blank lines separate paragraphs. */
export function defaultPrivacyPolicy(publisherName: string, days = DEFAULT_REPORT_RETENTION_DAYS): string {
  const period = retentionLabel(days);
  return [
    `How your briefing data is used`,
    `${publisherName} briefings are built from the company and job role you enter. Nothing else about you is asked for, and you do not need an account.`,
    `What we store: the company (name or website) and job role you enter, and the briefing generated from them (the stories selected for you, the summary and explanations). If you rate a briefing or a story, we store the rating with the briefing and story it refers to, and nothing about you. Usage statistics (for example that a briefing was opened or a story clicked) use a random session identifier, not your name or contact details.`,
    `Why: to build your briefing, to show it again at its link (for example when you share it), and to improve which stories are chosen.`,
    `How long: briefings and their ratings are deleted ${period} after they were created. The progress record of a briefing being built is deleted after one day.`,
    `To understand what your company does, its public website may be read when the briefing is built.`,
  ].join('\n\n');
}
