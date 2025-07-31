let cachedSanitize: ((html: string) => string) | null = null;

export async function sanitizeHTML(html: string): Promise<string> {
  if (!cachedSanitize) {
    if (typeof window === 'undefined') {
      const { sanitizeHTML } = await import('./sanitize.server');
      cachedSanitize = sanitizeHTML;
    } else {
      const { sanitizeHTML } = await import('./security');
      cachedSanitize = sanitizeHTML;
    }
  }
  return cachedSanitize(html);
}