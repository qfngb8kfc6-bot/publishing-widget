/**
 * Finds the <script> that loaded the widget. `currentScript` must be captured while widget.js is executing;
 * if it is unavailable, fall back to the script tag whose src path ends in /widget.js.
 */
export function findWidgetScript(doc: Document, current: Element | null): HTMLScriptElement | null {
  if (current instanceof HTMLScriptElement && current.src) return current;
  return Array.from(doc.querySelectorAll<HTMLScriptElement>('script[src]')).find((script) => {
    try {
      return new URL(script.src, doc.baseURI).pathname.endsWith('/widget.js');
    } catch {
      return false;
    }
  }) ?? null;
}

/**
 * The platform origin that served widget.js. On a publisher page this keeps generation, analytics and the
 * report redirect on the platform host instead of the publisher's own host.
 */
export function widgetApiBase(script: HTMLScriptElement | null, doc: Document): string | undefined {
  if (!script?.src) return undefined;
  try {
    const url = new URL(script.src, doc.baseURI);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function apiUrl(apiBase: string | undefined, path: string): string {
  return apiBase ? `${apiBase}${path}` : path;
}
