import { IsDefined, IsString, MaxLength } from 'class-validator';

/** Body sent by Meta to deauthorize and data-deletion callbacks. */
export class MetaSignedRequestDto {
  @IsDefined()
  @IsString()
  @MaxLength(8192)
  signed_request: string;
}
