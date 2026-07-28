// -----------------------------------------------------------------------------
// Remembers the year the user last viewed on year-aware list pages (Requests,
// Projects). The base list route redirects to the remembered year so users
// land where they left off instead of re-selecting the year every visit.
// -----------------------------------------------------------------------------

const KEY_PREFIX = 'privacyflow.lastYear.';

export function readLastYear(section: 'cases' | 'tasks'): number | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${section}`);
    const y = raw ? Number(raw) : NaN;
    return Number.isInteger(y) && y >= 1990 && y <= 2100 ? y : null;
  } catch {
    return null;
  }
}

export function writeLastYear(section: 'cases' | 'tasks', year: number): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${section}`, String(year));
  } catch {
    /* storage unavailable — preference simply isn't remembered */
  }
}

export function clearLastYear(section: 'cases' | 'tasks'): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}${section}`);
  } catch {
    /* noop */
  }
}