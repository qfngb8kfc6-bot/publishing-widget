/** Visitor-facing messages for generation errors. Browser-safe: shared by the widget and the hosted report. */

/** "Adids Group" → "adidsgroup.com": shows the website format using what the visitor typed. */
function websiteExample(company: string): string {
  if (/\.[a-z]{2,}$/i.test(company)) return company.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${slug || 'company'}.com`;
}

/**
 * The message for an error the generation endpoint returns before a job exists. These stay in the widget so the
 * visitor can correct their input; anything else shows the generic error state.
 */
export function generationInputMessage(code: string | undefined, company: string): string | undefined {
  const shown = company.length > 60 ? `${company.slice(0, 57)}…` : company;
  switch (code) {
    case 'company_resolution_failed': return `We couldn't find '${shown}'. Check the spelling or enter the website (${websiteExample(company)}).`;
    case 'company_resolution_timeout': return `We couldn't look up '${shown}' in time. Try again, or enter the website (${websiteExample(company)}).`;
    case 'invalid_company_url':
    case 'unsafe_company_url':
    case 'company_url_credentials_not_allowed': return 'Enter a company name or its public website, for example nike.com.';
    case 'company_url_required': return 'Enter your company name or website to continue.';
    case 'job_title_required': return 'Enter your job role to continue.';
    case 'invalid_generation_input': return 'Enter your company and job role to continue.';
    case 'rate_limited': return 'You have started several briefings in a short time. Please wait a minute and try again.';
    default: return undefined;
  }
}
