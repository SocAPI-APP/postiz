import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    scan: vi.fn(async () => ['0', []] as [string, string[]]),
  };
});

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redis,
}));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import {
  META_DELETION_STATUS_TTL_SECONDS,
  MetaCallbacksService,
  metaDeletionStatusKey,
} from './meta-callbacks.service';

const encodeBase64Url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url');

const sign = (secret: string, payload: Record<string, unknown>) => {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();
  return `${encodeBase64Url(signature)}.${encodedPayload}`;
};

const integration = (overrides: Record<string, unknown> = {}) => ({
  id: 'integration-1',
  organizationId: 'organization-1',
  name: 'Meta channel',
  picture: null,
  providerIdentifier: 'facebook',
  internalId: 'page-1',
  rootInternalId: 'meta-user-1',
  ...overrides,
});

describe('MetaCallbacksService', () => {
  let service: MetaCallbacksService;
  let prisma: any;
  let transaction: any;
  let integrationRepository: any;
  let integrationService: any;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    redis.store.clear();
    redis.get.mockClear();
    redis.set.mockClear();
    redis.del.mockClear();
    redis.scan.mockReset();
    redis.scan.mockResolvedValue(['0', []]);
    process.env.FACEBOOK_APP_SECRET = 'facebook-secret';
    process.env.INSTAGRAM_APP_SECRET = 'instagram-secret';
    process.env.THREADS_APP_SECRET = 'threads-secret';
    process.env.FRONTEND_URL = 'https://socapi.example/';
    delete process.env.META_DATA_DELETION_URL;

    transaction = {
      plugs: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      exisingPlugData: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      integrationsWebhooks: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      errors: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      post: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      integration: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      post: {
        findMany: vi.fn().mockResolvedValue([{ id: 'post-1' }]),
      },
      $transaction: vi.fn(async (callback: (client: any) => unknown) =>
        callback(transaction)
      ),
    };
    integrationRepository = {
      findByMetaUser: vi.fn().mockResolvedValue([]),
    };
    integrationService = {
      disconnectChannel: vi.fn().mockResolvedValue(undefined),
    };
    service = new MetaCallbacksService(
      prisma,
      integrationRepository,
      integrationService
    );
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  describe('signed_request verification', () => {
    it.each([
      ['facebook-secret', 'facebook'],
      ['instagram-secret', 'instagram-standalone'],
      ['threads-secret', 'threads'],
    ] as const)('accepts a valid %s request', (secret, family) => {
      const parsed = service.parseSignedRequest(
        sign(secret, {
          user_id: 123456,
          algorithm: 'HMAC-SHA256',
          issued_at: 1700000000,
        }),
        family
      );

      expect(parsed).toMatchObject({
        family,
        payload: { user_id: '123456', issued_at: 1700000000 },
      });
    });

    it('accepts the algorithm case-insensitively', () => {
      expect(
        service.parseSignedRequest(
          sign('facebook-secret', {
            user_id: '1',
            algorithm: 'hmac-sha256',
          }),
          'facebook'
        )
      ).not.toBeNull();
    });

    it.each([
      [
        'invalid signature',
        sign('wrong-secret', {
          user_id: '1',
          algorithm: 'HMAC-SHA256',
        }),
      ],
      [
        'invalid payload Base64URL',
        `${encodeBase64Url(Buffer.alloc(32))}.%%%%`,
      ],
      [
        'invalid JSON',
        `${encodeBase64Url(Buffer.alloc(32))}.${encodeBase64Url('{')}`,
      ],
      [
        'wrong algorithm',
        sign('facebook-secret', {
          user_id: '1',
          algorithm: 'HMAC-SHA1',
        }),
      ],
      [
        'missing user_id',
        sign('facebook-secret', { algorithm: 'HMAC-SHA256' }),
      ],
      ['malformed request', 'not-a-signed-request'],
    ])('rejects %s', (_label, signedRequest) => {
      expect(service.parseSignedRequest(signedRequest, 'facebook')).toBeNull();
    });

    it('rejects a missing signed_request', () => {
      expect(service.parseSignedRequest(undefined, 'facebook')).toBeNull();
    });

    it('rejects a Threads request on the Instagram endpoint', () => {
      const signedRequest = sign('threads-secret', {
        user_id: '1',
        algorithm: 'HMAC-SHA256',
      });
      expect(
        service.parseSignedRequest(signedRequest, 'instagram-standalone')
      ).toBeNull();
    });

    it('rejects a family whose app secret is not configured', () => {
      delete process.env.INSTAGRAM_APP_SECRET;
      expect(
        service.parseSignedRequest(
          sign('instagram-secret', {
            user_id: '1',
            algorithm: 'HMAC-SHA256',
          }),
          'instagram-standalone'
        )
      ).toBeNull();
    });
  });

  describe('deauthorize', () => {
    it('marks all matching Facebook-family channels as reconnect-required', async () => {
      integrationRepository.findByMetaUser.mockResolvedValue([
        integration(),
        integration({
          id: 'integration-2',
          organizationId: 'organization-2',
          providerIdentifier: 'instagram',
        }),
      ]);

      await expect(
        service.deauthorize('facebook', 'meta-user-1')
      ).resolves.toEqual({ channels: 2 });
      expect(integrationRepository.findByMetaUser).toHaveBeenCalledWith(
        ['facebook', 'instagram'],
        'meta-user-1'
      );
      expect(integrationService.disconnectChannel).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns success with zero channels for an unknown Meta user', async () => {
      await expect(
        service.deauthorize('threads', 'unknown-user')
      ).resolves.toEqual({ channels: 0 });
      expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
    });
  });

  describe('data deletion', () => {
    it('purges Meta-derived data, credentials and provider metadata atomically', async () => {
      integrationRepository.findByMetaUser.mockResolvedValue([integration()]);
      redis.scan.mockResolvedValue([
        '0',
        [
          'integration:organization-1:integration-1:1700000000',
          'integration:organization-1:post-1:1700000000',
          'integration:organization-1:unrelated-post:1700000000',
        ],
      ]);

      const result = await service.requestDeletion('facebook', 'meta-user-1');

      expect(result.confirmation_code).toMatch(
        /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/
      );
      expect(result.url).toBe(
        `https://socapi.example/data-deletion?code=${result.confirmation_code}`
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'organization-1',
          integrationId: 'integration-1',
        },
        select: { id: true },
      });
      expect(transaction.plugs.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'organization-1',
          integrationId: 'integration-1',
        },
      });
      expect(transaction.exisingPlugData.deleteMany).toHaveBeenCalledWith({
        where: { integrationId: 'integration-1' },
      });
      expect(transaction.integrationsWebhooks.deleteMany).toHaveBeenCalledWith({
        where: { integrationId: 'integration-1' },
      });
      expect(transaction.errors.deleteMany).toHaveBeenCalledWith({
        where: {
          post: {
            organizationId: 'organization-1',
            integrationId: 'integration-1',
          },
        },
      });
      expect(transaction.post.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'organization-1',
          integrationId: 'integration-1',
        },
        data: {
          deletedAt: expect.any(Date),
          releaseId: null,
          releaseURL: null,
          settings: null,
          error: null,
        },
      });
      expect(transaction.integration.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'integration-1',
          organizationId: 'organization-1',
          providerIdentifier: { in: ['facebook', 'instagram'] },
        },
        data: expect.objectContaining({
          internalId: 'deleted_meta_integration-1',
          rootInternalId: null,
          token: '',
          refreshToken: null,
          tokenExpiration: null,
          picture: null,
          profile: null,
          customInstanceDetails: null,
          additionalSettings: '[]',
          refreshNeeded: true,
          disabled: true,
          deletedAt: expect.any(Date),
        }),
      });
      expect(redis.del).toHaveBeenCalledWith(
        'integration:organization-1:integration-1:1700000000'
      );
      expect(redis.del).toHaveBeenCalledWith(
        'integration:organization-1:post-1:1700000000'
      );
      expect(redis.del).not.toHaveBeenCalledWith(
        'integration:organization-1:unrelated-post:1700000000'
      );
      expect(redis.set).toHaveBeenCalledWith(
        metaDeletionStatusKey(result.confirmation_code),
        expect.any(String),
        'EX',
        META_DELETION_STATUS_TTL_SECONDS
      );
      expect(result.status).toMatchObject({
        status: 'completed',
        channels: 1,
      });
    });

    it('does not affect providers outside the verified Meta family', async () => {
      await service.requestDeletion('instagram-standalone', 'meta-user-1');
      expect(integrationRepository.findByMetaUser).toHaveBeenCalledWith(
        ['instagram-standalone'],
        'meta-user-1'
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is idempotent when Meta retries after the channel was deleted', async () => {
      integrationRepository.findByMetaUser
        .mockResolvedValueOnce([integration()])
        .mockResolvedValueOnce([]);

      const first = await service.requestDeletion('facebook', 'meta-user-1');
      const second = await service.requestDeletion('facebook', 'meta-user-1');

      expect(first.status.channels).toBe(1);
      expect(second.status.channels).toBe(0);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmation status', () => {
    it('returns completed status without leaking stored extra fields', async () => {
      redis.store.set(
        metaDeletionStatusKey('ABCDEFGH2345'),
        JSON.stringify({
          code: 'ABCDEFGH2345',
          status: 'completed',
          requestedAt: '2026-09-29T00:00:00.000Z',
          completedAt: '2026-09-29T00:00:01.000Z',
          channels: 1,
          userId: 'private',
          token: 'private',
          organizationId: 'private',
        })
      );

      const status = await service.deletionStatus('abcdefgh2345');
      expect(status).toEqual({
        code: 'ABCDEFGH2345',
        status: 'completed',
        requestedAt: '2026-09-29T00:00:00.000Z',
        completedAt: '2026-09-29T00:00:01.000Z',
        channels: 1,
      });
      expect(status).not.toHaveProperty('userId');
      expect(status).not.toHaveProperty('token');
      expect(status).not.toHaveProperty('organizationId');
    });

    it.each(['ZZZZZZZZ2345', '../invalid', ''])(
      'returns unknown for %s',
      async (code) => {
        await expect(service.deletionStatus(code)).resolves.toMatchObject({
          status: 'unknown',
        });
      }
    );
  });
});

describe('IntegrationRepository.findByMetaUser', () => {
  it('matches only active providers in the verified family by root or channel id', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new IntegrationRepository(
      { model: { integration: { findMany } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repository.findByMetaUser(['facebook', 'instagram'], 'meta-user-1');
    expect(findMany).toHaveBeenCalledWith({
      where: {
        providerIdentifier: { in: ['facebook', 'instagram'] },
        deletedAt: null,
        OR: [{ rootInternalId: 'meta-user-1' }, { internalId: 'meta-user-1' }],
      },
    });
  });
});
