import { isAllowedRedirectUrl, validateRedirectUrl } from './redirect.url';

describe('validateRedirectUrl', () => {
  it.each([
    'https://easy4live.com/integrations/pinterest/callback',
    'http://localhost:3000/oauth/callback?provider=pinterest',
  ])('accepts web URL %s', (value) => {
    expect(validateRedirectUrl(value)).toBe(new URL(value).toString());
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'not a URL',
    'https://user:password@example.com/callback',
  ])('rejects unsafe or malformed URL %s', (value) => {
    expect(validateRedirectUrl(value)).toBeUndefined();
  });

  it('rejects missing values', () => {
    expect(validateRedirectUrl(undefined)).toBeUndefined();
    expect(validateRedirectUrl('')).toBeUndefined();
  });

  it('matches exact normalized URLs only', () => {
    expect(
      isAllowedRedirectUrl('https://client.example.com/oauth/callback', [
        'https://client.example.com/oauth/callback',
        'https://another-client.example/oauth/callback',
      ])
    ).toBe(true);
    expect(
      isAllowedRedirectUrl('https://client.example.com/another-path', [
        'https://client.example.com/oauth/callback',
      ])
    ).toBe(false);
    expect(
      isAllowedRedirectUrl('https://client.example.com.evil.example/callback', [
        'https://client.example.com/callback',
      ])
    ).toBe(false);
  });
});
