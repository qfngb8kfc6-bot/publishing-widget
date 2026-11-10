/** Browser-safe role-title formatting (no server imports): used by the hosted report, sticky bar, focused reading and loading page. */

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

/** Role acronyms shown in capitals whatever the casing typed ("ceo", "Ceo" → "CEO"). */
export const ROLE_ACRONYMS = new Set(['ceo', 'cfo', 'coo', 'cto', 'cmo', 'cio', 'cso', 'vp', 'svp', 'evp', 'gm', 'md', 'hr', 'it', 'esg', 'ai']);

function titleWord(word: string, index: number): string {
  if (!word) return word;
  // Already-uppercase words ("VP", "CTO", "EMEA") are kept as typed.
  if (/^[A-Z\d-]{2,}$/.test(word)) return word;
  if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
  // Each letter run is checked on its own, so "ceo/founder", "svp," and "vp-sales" keep their acronyms.
  return word.replace(/[A-Za-z]+/g, (run, offset: number) => {
    if (ROLE_ACRONYMS.has(run.toLowerCase())) return run.toUpperCase();
    return offset === 0 || word.charAt(offset - 1) === '/' ? run.charAt(0).toUpperCase() + run.slice(1) : run;
  });
}

/** "ceo" → "CEO"; "head of hr" → "Head of HR"; "svp, global it" → "SVP, Global IT". Uppercase input is kept. */
export function displayRoleTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().split(' ').map(titleWord).join(' ');
}
