# Meta lifecycle callbacks

SocAPI supports Meta's app-level Deauthorize Callback and Data Deletion
Request Callback for the Facebook, Instagram Login and Threads app families.
The implementation was behaviorally adapted from `postmill-ai/postmill-app`
commit `f33a9c32bf2cab72611693d1571ea7e66bb4832e`. Both repositories are licensed
under AGPL-3.0; the SocAPI implementation uses this repository's namespaces,
schema and services.

## Meta dashboard URLs

Configure these exact public HTTPS URLs:

| Meta app             | Callback                           | URL                                                   |
| -------------------- | ---------------------------------- | ----------------------------------------------------- |
| Facebook             | Deauthorize Callback URL           | `https://socapi.app/api/meta/facebook/deauthorize`    |
| Facebook             | Data Deletion Request URL          | `https://socapi.app/api/meta/facebook/data-deletion`  |
| Instagram Standalone | Deauthorize Callback URL           | `https://socapi.app/api/meta/instagram/deauthorize`   |
| Instagram Standalone | Data Deletion Request URL          | `https://socapi.app/api/meta/instagram/data-deletion` |
| Threads              | Uninstall/Deauthorize Callback URL | `https://socapi.app/api/meta/threads/deauthorize`     |
| Threads              | Delete/Data Deletion Callback URL  | `https://socapi.app/api/meta/threads/data-deletion`   |

The standard Docker Nginx configuration sends `/api/*` directly to the backend
and removes the `/api` prefix. The backend therefore accepts these direct
routes used in production:

- `POST /meta/facebook/deauthorize`
- `POST /meta/facebook/data-deletion`
- `POST /meta/instagram/deauthorize`
- `POST /meta/instagram/data-deletion`
- `POST /meta/threads/deauthorize`
- `POST /meta/threads/data-deletion`
- `GET /meta/data-deletion/status/:code`

For deployments that route `/api/meta/*` through Next.js, the public handlers
forward the body unchanged to these equivalent backend routes:

- `POST /integrations/meta/facebook/deauthorize`
- `POST /integrations/meta/facebook/data-deletion`
- `POST /integrations/meta/instagram-standalone/deauthorize`
- `POST /integrations/meta/instagram-standalone/data-deletion`
- `POST /integrations/meta/threads/deauthorize`
- `POST /integrations/meta/threads/data-deletion`
- `GET /integrations/meta/data-deletion/:code`

The public status proxy is
`GET /api/meta/data-deletion/status/:code`. The human-readable public page is
`https://socapi.app/data-deletion?code=<confirmation-code>` and does not
require authentication.

Both backend route families use the same controller and service. The public
backend alias `instagram` is normalized to `instagram-standalone` before the
secret is selected or any channel lookup occurs.

## App family and provider mapping

| Family               | Secret                 | SocAPI providers        |
| -------------------- | ---------------------- | ----------------------- |
| Facebook             | `FACEBOOK_APP_SECRET`  | `facebook`, `instagram` |
| Instagram Standalone | `INSTAGRAM_APP_SECRET` | `instagram-standalone`  |
| Threads              | `THREADS_APP_SECRET`   | `threads`               |

The public `/api/meta/instagram/...` URL intentionally maps to the internal
`instagram-standalone` family. Each endpoint verifies only its own family
secret, so a Threads request cannot be replayed against the Instagram or
Facebook endpoints.

## signed_request verification

Meta sends `signed_request` in an `application/x-www-form-urlencoded` body.
JSON bodies are also accepted by NestJS. The field is required and limited to
8192 characters.

The backend:

1. splits the value into exactly two Base64URL segments;
2. strictly decodes the signature and payload;
3. parses the payload JSON and requires `user_id`;
4. accepts only `algorithm = HMAC-SHA256` (case-insensitive);
5. calculates HMAC-SHA256 over the original encoded payload segment with the
   family-specific app secret;
6. compares the 32-byte signatures with `crypto.timingSafeEqual()`.

Invalid input returns HTTP 400 with `invalid signed_request`. Secrets,
signatures, complete signed requests and tokens are never logged. Callback
POSTs are rate limited to 120 requests per 60 seconds per forwarded client IP;
status lookups are limited to 60 requests per 60 seconds.

## Finding affected channels

Meta callbacks contain no SocAPI organization id. SocAPI looks across active
integrations, constrained to the verified family providers, and matches:

- `rootInternalId` for Facebook Pages and Instagram through Facebook Login;
- `internalId` as a compatibility fallback and for Instagram Standalone and
  Threads.

The existing two-step Facebook/Instagram connect flow creates the initial
integration with the Meta user id, then replaces `internalId` with the selected
Page/account id while preserving that user id in `rootInternalId`. No provider
or OAuth logic is changed by this feature.

## Deauthorize behavior

For every matching active channel, SocAPI calls the existing disconnect path.
That path marks `refreshNeeded = true` and creates the existing reconnect
notification. It does not delete channel data. Meta revokes the remote access
as part of deauthorization; SocAPI preserves the local token fields because
the established disconnect path does not currently erase them.

An unknown `user_id` is a successful no-op and returns
`{ "ok": true, "channels": 0 }`. Repeated callbacks are safe.

## Data deletion behavior

All database changes for the matched channels run in one Prisma transaction.
SocAPI hard-deletes the following channel-linked, Meta-derived operational
data that exists in the current schema:

- `Plugs` automation records;
- `ExisingPlugData` provider automation state;
- `IntegrationsWebhooks` links (the shared webhook definitions remain);
- `Errors` rows attached to posts for the channel.

SocAPI then:

- soft-deletes posts for the channel so queued workflows cannot publish;
- preserves user-authored post content, title, description and media;
- clears post `releaseId`, `releaseURL`, provider settings and provider error;
- soft-deletes and disables the integration;
- clears access token, refresh token and token expiration;
- clears Meta ids (`rootInternalId`) and replaces `internalId` with a local
  tombstone id;
- clears profile name, avatar reference, profile handle, additional settings
  and custom instance details;
- marks the channel `refreshNeeded` and not in-between connect steps;
- removes owned copies of the profile image from local/R2 storage when the
  image URL points at configured SocAPI storage;
- removes Redis channel analytics and post analytics cache keys for that
  integration, without removing cache entries for other channels.

Storage and Redis cleanup run before the database transaction because they
cannot join it. A failure aborts the callback while the integration still
retains its Meta ids, allowing Meta's retry to locate the channel again. File
deletion and cache deletion are idempotent. The database purge then commits all
matched channels atomically.

The current SocAPI/Postiz schema has no persisted synced-comments, analytics
snapshots, analytics anomalies or analytics alert-rule models, so there are no
such database rows to delete. Internal `Comments` are user-created comments on
SocAPI post records, not comments synced from Meta, and are retained.
Organizations, users, customers, orders, order items, shared webhook
definitions and user-uploaded media are not deleted.

## Confirmation status

The response returned to Meta contains exactly:

```json
{
  "url": "https://socapi.app/data-deletion?code=XXXXXXXXXXXX",
  "confirmation_code": "XXXXXXXXXXXX"
}
```

The 12-character code uses cryptographically uniform `crypto.randomInt()`
selection from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Minimal completion status is
stored in Redis under `meta:deletion:<code>` for 180 days (15,552,000 seconds).
It contains only the code, status, timestamps and number of affected channels.
It never contains a Meta user id, integration id, organization id, email,
token, secret or signed request.

Set `META_DATA_DELETION_URL=https://socapi.app/data-deletion` in production.
Set `SUPPORT_EMAIL` to the existing SocAPI support address if an email link
should appear on the public page. If it is unset, the page uses
`NEXT_PUBLIC_DISCORD_SUPPORT` when configured and otherwise directs users to
support from their SocAPI account.
