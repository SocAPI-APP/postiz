import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  MetaCallbacksService,
  MetaFamily,
} from '@gitroom/nestjs-libraries/integrations/meta-callbacks.service';
import { MetaSignedRequestDto } from '@gitroom/nestjs-libraries/dtos/integrations/meta-signed-request.dto';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

const META_FAMILIES: Record<string, MetaFamily> = {
  facebook: 'facebook',
  instagram: 'instagram-standalone',
  'instagram-standalone': 'instagram-standalone',
  threads: 'threads',
};
const MAX_CALLBACK_BODY_BYTES = 12 * 1024;

@ApiTags('Meta Callbacks')
@Controller(['/integrations/meta', '/meta'])
@UseGuards(ThrottlerRealIpGuard)
export class MetaCallbacksController {
  private readonly _logger = new Logger(MetaCallbacksController.name);

  constructor(
    @Inject(MetaCallbacksService)
    private _metaCallbacksService: MetaCallbacksService
  ) {}

  @Post('/:family/deauthorize')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      exceptionFactory: () =>
        new BadRequestException({ message: 'invalid signed_request' }),
    })
  )
  async deauthorize(
    @Param('family') familyValue: string,
    @Req() request: Request,
    @Body() body: MetaSignedRequestDto
  ) {
    const family = this.metaFamily(familyValue);
    const requestSize = this.requestSize(request);
    if (requestSize > MAX_CALLBACK_BODY_BYTES) {
      throw new BadRequestException({ message: 'invalid signed_request' });
    }
    this._logger.log(
      `meta deauthorize received family=${family} bytes=${requestSize}`
    );
    const parsed = this._metaCallbacksService.parseSignedRequest(
      body?.signed_request,
      family
    );
    if (!parsed) {
      throw new BadRequestException({ message: 'invalid signed_request' });
    }

    const result = await this._metaCallbacksService.deauthorize(
      family,
      parsed.payload.user_id
    );
    return { ok: true, channels: result.channels };
  }

  @Post('/:family/data-deletion')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      exceptionFactory: () =>
        new BadRequestException({ message: 'invalid signed_request' }),
    })
  )
  async dataDeletion(
    @Param('family') familyValue: string,
    @Req() request: Request,
    @Body() body: MetaSignedRequestDto
  ) {
    const family = this.metaFamily(familyValue);
    const requestSize = this.requestSize(request);
    if (requestSize > MAX_CALLBACK_BODY_BYTES) {
      throw new BadRequestException({ message: 'invalid signed_request' });
    }
    this._logger.log(
      `meta data-deletion received family=${family} bytes=${requestSize}`
    );
    const parsed = this._metaCallbacksService.parseSignedRequest(
      body?.signed_request,
      family
    );
    if (!parsed) {
      throw new BadRequestException({ message: 'invalid signed_request' });
    }

    const result = await this._metaCallbacksService.requestDeletion(
      family,
      parsed.payload.user_id
    );
    return {
      url: result.url,
      confirmation_code: result.confirmation_code,
    };
  }

  @Get(['/data-deletion/:code', '/data-deletion/status/:code'])
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  deletionStatus(@Param('code') code: string) {
    return this._metaCallbacksService.deletionStatus(code);
  }

  private metaFamily(value: string): MetaFamily {
    const family = META_FAMILIES[value];
    if (!family) {
      throw new BadRequestException({ message: 'invalid Meta family' });
    }
    return family;
  }

  private requestSize(request: Request): number {
    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
    return rawBody?.length ?? Number(request.headers['content-length'] || 0);
  }
}
