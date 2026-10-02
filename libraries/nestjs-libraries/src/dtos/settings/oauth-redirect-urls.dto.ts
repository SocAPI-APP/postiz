import { IsArray, IsString } from 'class-validator';

export class OAuthRedirectUrlsDto {
  @IsArray()
  @IsString({ each: true })
  urls: string[];
}
