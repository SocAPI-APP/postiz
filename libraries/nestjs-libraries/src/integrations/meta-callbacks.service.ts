import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';

export type MetaFamily = 'facebook' | 'instagram-standalone' | 'threads';

export type MetaSignedPayload = {
  user_id: string;
  algorithm: string;
  issued_at?: number;
  [key: string]: unknown;
};

export type MetaDeletionStatus = {
  code: string;
  status: 'completed' | 'unknown';
  requestedAt?: string;
  completedAt?: string;
  channels?: number;
};

export const META_FAMILY_PROVIDERS: Record<MetaFamily, string[]> = {
  facebook: ['facebook', 'instagram'],
  'instagram-standalone': ['instagram-standalone'],
  threads: ['threads'],
};

export const META_DELETION_STATUS_TTL_SECONDS = 180 * 24 * 60 * 60;
export const metaDeletionStatusKey = (code: string) => `meta:deletion:${code}`;

const META_FAMILY_SECRET: Record<MetaFamily, string> = {
  facebook: 'FACEBOOK_APP_SECRET',
  'instagram-standalone': 'INSTAGRAM_APP_SECRET',
  threads: 'THREADS_APP_SECRET',
};
const CONFIRMATION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CONFIRMATION_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

const decodeBase64Url = (value: string): Buffer | null => {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
};

@Injectable()
export class MetaCallbacksService {
  private readonly _logger = new Logger(MetaCallbacksService.name);

  constructor(
    private _prisma: PrismaService,
    private _integrationRepository: IntegrationRepository,
    private _integrationService: IntegrationService
  ) {}

  parseSignedRequest(
    signedRequest: unknown,
    family: MetaFamily
  ): { family: MetaFamily; payload: MetaSignedPayload } | null {
    if (typeof signedRequest !== 'string' || signedRequest.length > 8192) {
      return null;
    }

    const segments = signedRequest.split('.');
    if (segments.length !== 2) {
      return null;
    }

    const [encodedSignature, encodedPayload] = segments;
    const signature = decodeBase64Url(encodedSignature);
    const payloadBuffer = decodeBase64Url(encodedPayload);
    if (!signature || signature.length !== 32 || !payloadBuffer) {
      return null;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadBuffer.toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    if (
      typeof payload.algorithm !== 'string' ||
      payload.algorithm.toUpperCase() !== 'HMAC-SHA256'
    ) {
      return null;
    }

    const userId =
      typeof payload.user_id === 'string'
        ? payload.user_id.trim()
        : typeof payload.user_id === 'number' &&
          Number.isSafeInteger(payload.user_id)
        ? String(payload.user_id)
        : '';
    if (!userId) {
      return null;
    }

    const secret = process.env[META_FAMILY_SECRET[family]];
    if (!secret) {
      return null;
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest();
    if (!timingSafeEqual(expectedSignature, signature)) {
      return null;
    }

    return {
      family,
      payload: {
        ...payload,
        algorithm: payload.algorithm,
        user_id: userId,
      },
    };
  }

  findIntegrations(family: MetaFamily, userId: string) {
    return this._integrationRepository.findByMetaUser(
      META_FAMILY_PROVIDERS[family],
      userId
    );
  }

  async deauthorize(
    family: MetaFamily,
    userId: string
  ): Promise<{ channels: number }> {
    const integrations = await this.findIntegrations(family, userId);

    for (const integration of integrations) {
      await this._integrationService.disconnectChannel(
        integration.organizationId,
        integration
      );
    }

    this._logger.log(
      `integration.deauthorized-by-provider family=${family} channels=${integrations.length}`
    );
    return { channels: integrations.length };
  }

  async requestDeletion(
    family: MetaFamily,
    userId: string
  ): Promise<{
    url: string;
    confirmation_code: string;
    status: MetaDeletionStatus;
  }> {
    const confirmationCode = await this.createConfirmationCode();
    const requestedAt = new Date().toISOString();
    const integrations = await this.findIntegrations(family, userId);

    if (integrations.length) {
      // Storage and Redis cannot participate in the Prisma transaction. Run
      // their idempotent cleanup first so a failure leaves the database
      // matchable for Meta's retry instead of orphaning external data.
      await Promise.all(
        integrations.map(async (integration) => {
          const postIds = await this._prisma.post.findMany({
            where: {
              organizationId: integration.organizationId,
              integrationId: integration.id,
            },
            select: { id: true },
          });
          await Promise.all([
            this.removeOwnedProfilePicture(integration.picture),
            this.clearAnalyticsCache(integration.organizationId, [
              integration.id,
              ...postIds.map(({ id }) => id),
            ]),
          ]);
        })
      );

      await this._prisma.$transaction(async (transaction) => {
        for (const integration of integrations) {
          await this.purgeChannelData(transaction, integration, family);
        }
      });
    }

    const status: MetaDeletionStatus = {
      code: confirmationCode,
      status: 'completed',
      requestedAt,
      completedAt: new Date().toISOString(),
      channels: integrations.length,
    };
    await ioRedis.set(
      metaDeletionStatusKey(confirmationCode),
      JSON.stringify(status),
      'EX',
      META_DELETION_STATUS_TTL_SECONDS
    );

    this._logger.log(
      `integration.deleted-by-provider family=${family} channels=${integrations.length}`
    );

    const publicStatusUrl = (
      process.env.META_DATA_DELETION_URL ||
      `${(process.env.FRONTEND_URL || 'https://socapi.app').replace(
        /\/+$/,
        ''
      )}/data-deletion`
    ).replace(/\/+$/, '');

    return {
      url: `${publicStatusUrl}?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
      status,
    };
  }

  async deletionStatus(code: string): Promise<MetaDeletionStatus> {
    const normalized = String(code || '')
      .trim()
      .toUpperCase();
    if (!CONFIRMATION_CODE_PATTERN.test(normalized)) {
      return { code: normalized, status: 'unknown' };
    }

    const raw = await ioRedis.get(metaDeletionStatusKey(normalized));
    if (!raw) {
      return { code: normalized, status: 'unknown' };
    }

    try {
      const status = JSON.parse(raw) as MetaDeletionStatus;
      return {
        code: normalized,
        status: status.status === 'completed' ? 'completed' : 'unknown',
        ...(status.requestedAt ? { requestedAt: status.requestedAt } : {}),
        ...(status.completedAt ? { completedAt: status.completedAt } : {}),
        ...(typeof status.channels === 'number'
          ? { channels: status.channels }
          : {}),
      };
    } catch {
      return { code: normalized, status: 'unknown' };
    }
  }

  private async purgeChannelData(
    transaction: Prisma.TransactionClient,
    integration: {
      id: string;
      organizationId: string;
      providerIdentifier: string;
    },
    family: MetaFamily
  ) {
    const integrationWhere = {
      organizationId: integration.organizationId,
      integrationId: integration.id,
    };
    const deletedAt = new Date();

    await transaction.plugs.deleteMany({ where: integrationWhere });
    await transaction.exisingPlugData.deleteMany({
      where: { integrationId: integration.id },
    });
    await transaction.integrationsWebhooks.deleteMany({
      where: { integrationId: integration.id },
    });
    await transaction.errors.deleteMany({
      where: {
        post: {
          organizationId: integration.organizationId,
          integrationId: integration.id,
        },
      },
    });

    // Preserve user-authored post content, but stop publication and remove
    // provider-returned identifiers, URLs, settings and error details.
    await transaction.post.updateMany({
      where: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
      },
      data: {
        deletedAt,
        releaseId: null,
        releaseURL: null,
        settings: null,
        error: null,
      },
    });

    await transaction.integration.updateMany({
      where: {
        id: integration.id,
        organizationId: integration.organizationId,
        providerIdentifier: { in: META_FAMILY_PROVIDERS[family] },
      },
      data: {
        internalId: `deleted_meta_${integration.id}`,
        rootInternalId: null,
        name: 'Removed (Meta data deletion)',
        picture: null,
        profile: null,
        token: '',
        refreshToken: null,
        tokenExpiration: null,
        customInstanceDetails: null,
        additionalSettings: '[]',
        inBetweenSteps: false,
        refreshNeeded: true,
        disabled: true,
        deletedAt,
      },
    });
  }

  private async createConfirmationCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (let index = 0; index < 12; index++) {
        code += CONFIRMATION_ALPHABET[randomInt(CONFIRMATION_ALPHABET.length)];
      }
      if (!(await ioRedis.get(metaDeletionStatusKey(code)))) {
        return code;
      }
    }

    throw new Error('Could not allocate a Meta deletion confirmation code');
  }

  private async clearAnalyticsCache(
    organizationId: string,
    entityIds: string[]
  ) {
    const redis = ioRedis as typeof ioRedis & {
      scan?: (
        cursor: string,
        match: 'MATCH',
        pattern: string,
        count: 'COUNT',
        size: number
      ) => Promise<[string, string[]]>;
    };
    if (typeof redis.scan !== 'function') {
      return;
    }

    const pattern = `integration:${organizationId}:*`;
    const ownedPrefixes = entityIds.map(
      (id) => `integration:${organizationId}:${id}:`
    );
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      for (const key of keys.filter((candidate) =>
        ownedPrefixes.some((prefix) => candidate.startsWith(prefix))
      )) {
        await redis.del(key);
      }
    } while (cursor !== '0');
  }

  private async removeOwnedProfilePicture(picture: string | null) {
    if (!picture) {
      return;
    }

    const ownedPrefixes = [
      process.env.CLOUDFLARE_BUCKET_URL
        ? `${process.env.CLOUDFLARE_BUCKET_URL.replace(/\/+$/, '')}/`
        : undefined,
      process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL.replace(/\/+$/, '')}/uploads/`
        : undefined,
    ].filter((value): value is string => !!value);

    if (!ownedPrefixes.some((prefix) => picture.startsWith(prefix))) {
      return;
    }

    try {
      await UploadFactory.createStorage().removeFile(picture);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      this._logger.error(
        'Could not remove a Meta profile picture from storage'
      );
      throw error;
    }
  }
}
