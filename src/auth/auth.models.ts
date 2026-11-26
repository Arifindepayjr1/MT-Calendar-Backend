import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

/** Step 2 of Create Account: issue a 6-digit verification code. */
export class RequestCodeDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  framework?: string;
}

/** Step 3 of Create Account: exchange the code for a JWT session. */
export class VerifyCodeDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/)
  code: string;
}

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  framework?: string;
}

export interface AuthResponseDto {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthUserDto;
}

export interface RequestCodeResponseDto {
  email: string;
  expiresInSeconds: number;
  /** `email` once Gmail is configured, `dev` when the code is echoed locally. */
  delivery: 'email' | 'dev';
  /** Only present for the local fallback — never when an email was sent. */
  devCode?: string;
}
