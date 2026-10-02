/**
 * Validates a URL that will later be used as a browser navigation target.
 *
 * This intentionally does not restrict the host: the public API supports
 * multiple SaaS clients. It does restrict the URL to web schemes and rejects
 * embedded credentials, which prevents browser-executable schemes and
 * credential-bearing redirect targets from being stored as OAuth state.
 */
export function validateRedirectUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function isAllowedRedirectUrl(
  requestedUrl: unknown,
  allowedUrls: readonly string[]
): boolean {
  const normalizedRequestedUrl = validateRedirectUrl(requestedUrl);
  if (!normalizedRequestedUrl) {
    return false;
  }

  return allowedUrls.some(
    (allowedUrl) => validateRedirectUrl(allowedUrl) === normalizedRequestedUrl
  );
}
