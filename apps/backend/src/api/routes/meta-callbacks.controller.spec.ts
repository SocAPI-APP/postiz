import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { validate } from 'class-validator';
import { MetaSignedRequestDto } from '@gitroom/nestjs-libraries/dtos/integrations/meta-signed-request.dto';
import { MetaCallbacksService } from '@gitroom/nestjs-libraries/integrations/meta-callbacks.service';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { MetaCallbacksController } from './meta-callbacks.controller';

describe('MetaCallbacksController', () => {
  let controller: MetaCallbacksController;
  let service: any;
  const request = {
    rawBody: Buffer.from('signed_request=sig.payload'),
    headers: {},
  } as any;

  beforeEach(() => {
    service = {
      parseSignedRequest: vi.fn().mockReturnValue({
        family: 'facebook',
        payload: { user_id: 'meta-user-1', algorithm: 'HMAC-SHA256' },
      }),
      deauthorize: vi.fn().mockResolvedValue({ channels: 1 }),
      requestDeletion: vi.fn().mockResolvedValue({
        url: 'https://socapi.app/data-deletion?code=ABCDEFGH2345',
        confirmation_code: 'ABCDEFGH2345',
        status: { code: 'ABCDEFGH2345', status: 'completed' },
      }),
      deletionStatus: vi.fn().mockResolvedValue({
        code: 'ABCDEFGH2345',
        status: 'completed',
      }),
    };
    controller = new MetaCallbacksController(service);
  });

  it('deauthorizes only the family proven by that endpoint secret', async () => {
    await expect(
      controller.deauthorize('facebook', request, {
        signed_request: 'sig.payload',
      })
    ).resolves.toEqual({ ok: true, channels: 1 });
    expect(service.parseSignedRequest).toHaveBeenCalledWith(
      'sig.payload',
      'facebook'
    );
    expect(service.deauthorize).toHaveBeenCalledWith('facebook', 'meta-user-1');
  });

  it('returns exactly the response shape required by Meta for deletion', async () => {
    const result = await controller.dataDeletion('facebook', request, {
      signed_request: 'sig.payload',
    });
    expect(result).toEqual({
      url: 'https://socapi.app/data-deletion?code=ABCDEFGH2345',
      confirmation_code: 'ABCDEFGH2345',
    });
    expect(Object.keys(result)).toEqual(['url', 'confirmation_code']);
  });

  it.each(['deauthorize', 'dataDeletion'] as const)(
    '%s rejects a signed_request that does not verify',
    async (method) => {
      service.parseSignedRequest.mockReturnValue(null);
      await expect(
        controller[method]('threads', request, { signed_request: 'bad' })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.deauthorize).not.toHaveBeenCalled();
      expect(service.requestDeletion).not.toHaveBeenCalled();
    }
  );

  it('maps the public Instagram family to Instagram Standalone', async () => {
    await expect(
      controller.deauthorize('instagram', request, {
        signed_request: 'sig.payload',
      })
    ).resolves.toEqual({ ok: true, channels: 1 });
    expect(service.parseSignedRequest).toHaveBeenCalledWith(
      'sig.payload',
      'instagram-standalone'
    );
    expect(service.deauthorize).toHaveBeenCalledWith(
      'instagram-standalone',
      'meta-user-1'
    );
  });

  it('rejects an unknown family', async () => {
    await expect(
      controller.deauthorize('unknown', request, {
        signed_request: 'sig.payload',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an oversized callback body', async () => {
    await expect(
      controller.deauthorize(
        'facebook',
        { rawBody: Buffer.alloc(13 * 1024), headers: {} } as any,
        { signed_request: 'sig.payload' }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.parseSignedRequest).not.toHaveBeenCalled();
  });

  it('exposes minimal confirmation status', async () => {
    await expect(controller.deletionStatus('ABCDEFGH2345')).resolves.toEqual({
      code: 'ABCDEFGH2345',
      status: 'completed',
    });
  });
});

describe('MetaCallbacksController HTTP input', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    parseSignedRequest: vi.fn(),
    deauthorize: vi.fn(),
    requestDeletion: vi.fn(),
    deletionStatus: vi.fn(),
  };

  beforeEach(async () => {
    service.parseSignedRequest.mockReset();
    service.deauthorize.mockReset();
    service.requestDeletion.mockReset();
    service.deletionStatus.mockReset();
    service.parseSignedRequest.mockImplementation((value: unknown) =>
      value
        ? {
            family: 'facebook',
            payload: {
              user_id: 'meta-user-1',
              algorithm: 'HMAC-SHA256',
            },
          }
        : null
    );
    service.deauthorize.mockResolvedValue({ channels: 1 });
    service.requestDeletion.mockResolvedValue({
      url: 'https://socapi.app/data-deletion?code=ABCDEFGH2345',
      confirmation_code: 'ABCDEFGH2345',
    });
    service.deletionStatus.mockResolvedValue({
      code: 'ABCDEFGH2345',
      status: 'completed',
    });

    const module = await Test.createTestingModule({
      controllers: [MetaCallbacksController],
      providers: [
        { provide: MetaCallbacksService, useValue: service },
        {
          provide: ThrottlerRealIpGuard,
          useValue: { canActivate: () => true },
        },
      ],
    })
      .overrideGuard(ThrottlerRealIpGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication({ rawBody: true });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('parses application/x-www-form-urlencoded signed_request bodies', async () => {
    const response = await fetch(
      `${baseUrl}/integrations/meta/facebook/deauthorize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'signed_request=abc.def',
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, channels: 1 });
    expect(service.parseSignedRequest).toHaveBeenCalledWith(
      'abc.def',
      'facebook'
    );
  });

  it.each([
    ['facebook', 'facebook'],
    ['instagram', 'instagram-standalone'],
    ['threads', 'threads'],
  ])(
    'serves the Nginx-stripped /meta/%s callback as family %s',
    async (publicFamily, internalFamily) => {
      const response = await fetch(
        `${baseUrl}/meta/${publicFamily}/deauthorize`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'signed_request=abc.def',
        }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, channels: 1 });
      expect(service.parseSignedRequest).toHaveBeenCalledWith(
        'abc.def',
        internalFamily
      );
      expect(service.deauthorize).toHaveBeenCalledWith(
        internalFamily,
        'meta-user-1'
      );
    }
  );

  it.each([
    ['facebook', 'facebook'],
    ['instagram', 'instagram-standalone'],
    ['threads', 'threads'],
  ])(
    'serves the Nginx-stripped /meta/%s deletion callback as family %s',
    async (publicFamily, internalFamily) => {
      const response = await fetch(
        `${baseUrl}/meta/${publicFamily}/data-deletion`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'signed_request=abc.def',
        }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: 'https://socapi.app/data-deletion?code=ABCDEFGH2345',
        confirmation_code: 'ABCDEFGH2345',
      });
      expect(service.parseSignedRequest).toHaveBeenCalledWith(
        'abc.def',
        internalFamily
      );
      expect(service.requestDeletion).toHaveBeenCalledWith(
        internalFamily,
        'meta-user-1'
      );
    }
  );

  it('serves the Nginx-stripped public deletion status route', async () => {
    const response = await fetch(
      `${baseUrl}/meta/data-deletion/status/ABCDEFGH2345`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 'ABCDEFGH2345',
      status: 'completed',
    });
    expect(service.deletionStatus).toHaveBeenCalledWith('ABCDEFGH2345');
  });

  it('returns the minimal invalid response when signed_request is missing', async () => {
    const response = await fetch(
      `${baseUrl}/integrations/meta/facebook/deauthorize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'unrelated=value',
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: 'invalid signed_request',
    });
    expect(service.deauthorize).not.toHaveBeenCalled();
  });
});

describe('MetaSignedRequestDto', () => {
  it('requires signed_request', async () => {
    const dto = new MetaSignedRequestDto();
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('limits signed_request to 8192 characters', async () => {
    const dto = Object.assign(new MetaSignedRequestDto(), {
      signed_request: 'x'.repeat(8193),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
