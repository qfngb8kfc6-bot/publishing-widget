/**
 * "Did you mean Nike?" under the company field of the profile forms (widget, hosted edit sheet, loading-page
 * edit form). A hint only: it is fetched while the visitor types and never delays or blocks generation.
 */

export const SUGGESTION_DEBOUNCE_MS = 350;

/** Only typed names are checked: a website (anything with a dot or a scheme) is taken as entered. */
export function wantsCompanySuggestion(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 60 && !trimmed.includes('.') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
}

export function companySuggestionUrl(base: string | URL, publisherId: string, company: string): string {
  const url = new URL(`/api/publishers/${encodeURIComponent(publisherId)}/company-suggestion`, base);
  url.searchParams.set('company', company.trim());
  return url.href;
}

/** The suggested name, or undefined (no suggestion, a network error or an aborted request). */
export async function fetchCompanySuggestion(url: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal });
    if (!response.ok) return undefined;
    const body = await response.json() as { suggestion?: unknown };
    return typeof body.suggestion === 'string' && body.suggestion.length <= 80 ? body.suggestion : undefined;
  } catch {
    return undefined;
  }
}

/** Debounced lookups for one field: only the latest typed value's answer is delivered. */
export class CompanySuggestionLookup {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;

  constructor(private readonly urlFor: (company: string) => string | undefined, private readonly onResult: (company: string, suggestion: string | undefined) => void, private readonly delayMs = SUGGESTION_DEBOUNCE_MS) {}

  update(value: string): void {
    this.cancel();
    const company = value.trim();
    if (!wantsCompanySuggestion(company)) {
      this.onResult(company, undefined);
      return;
    }
    this.timer = setTimeout(() => { void this.run(company); }, this.delayMs);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }

  private async run(company: string): Promise<void> {
    const url = this.urlFor(company);
    if (!url) return;
    const controller = new AbortController();
    this.controller = controller;
    const suggestion = await fetchCompanySuggestion(url, controller.signal);
    if (controller.signal.aborted) return;
    this.controller = undefined;
    this.onResult(company, suggestion);
  }
}

export function suggestionMarkup(suggestion: string, escapeHtml: (value: string) => string): string {
  return `Did you mean <button type="button" class="company-suggestion-button" data-use-company-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>?`;
}

/**
 * Wires a plain form field: the hint element shows "Did you mean X?"; clicking X fills the field. The form's own
 * submit is untouched, so the typed value is generated as entered when the hint is ignored.
 */
export function bindCompanySuggestion(input: HTMLInputElement, hint: HTMLElement, urlFor: (company: string) => string | undefined, escapeHtml: (value: string) => string, delayMs = SUGGESTION_DEBOUNCE_MS): CompanySuggestionLookup {
  const show = (company: string, suggestion: string | undefined) => {
    if (input.value.trim() !== company) return;
    hint.innerHTML = suggestion ? suggestionMarkup(suggestion, escapeHtml) : '';
    hint.hidden = !suggestion;
  };
  const lookup = new CompanySuggestionLookup(urlFor, show, delayMs);
  hint.hidden = true;
  input.addEventListener('input', () => { hint.innerHTML = ''; hint.hidden = true; lookup.update(input.value); });
  hint.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-use-company-suggestion]');
    if (!button) return;
    input.value = button.dataset.useCompanySuggestion ?? input.value;
    hint.innerHTML = '';
    hint.hidden = true;
    lookup.cancel();
    input.focus();
  });
  if (input.value) lookup.update(input.value);
  return lookup;
}
