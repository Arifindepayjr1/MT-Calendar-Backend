import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuthCode } from './auth-code.entity';
import {
  AuthResponseDto,
  AuthUserDto,
  RequestCodeDto,
  RequestCodeResponseDto,
  SignInDto,
  SignUpDto,
  VerifyCodeDto,
} from './auth.models';
import { User } from './user.entity';

@Injectable()
export class AuthService implements OnModuleInit {
  /** Fixed credentials for the Bruno collection and first Flutter login. */
  static readonly DEMO_EMAIL = 'demo@traderlog.local';
  static readonly DEMO_PASSWORD = 'demo1234';
  static readonly DEMO_ID = '00000000-0000-0000-0000-000000000001';

  /** The emailed/SMS code is valid for ten minutes. */
  static readonly CODE_TTL_SECONDS = 600;
  static readonly MAX_ATTEMPTS = 5;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthCode) private readonly codes: Repository<AuthCode>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.users.findOne({
      where: { email: AuthService.DEMO_EMAIL },
    });
    if (existing) return;

    await this.users.save(
      this.users.create({
        id: AuthService.DEMO_ID,
        email: AuthService.DEMO_EMAIL,
        name: 'Demo Trader',
        passwordHash: await bcrypt.hash(AuthService.DEMO_PASSWORD, 12),
      }),
    );
  }

  async signUp(dto: SignUpDto): Promise<AuthResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException({ error: 'Email is already registered.' });
    }

    const user = this.users.create({
      email,
      name: dto.name.trim(),
      passwordHash: await bcrypt.hash(dto.password, 12),
    });
    await this.users.save(user);
    return this.tokenFor(user);
  }

  async signIn(dto: SignInDto): Promise<AuthResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = :email', { email })
      .getOne();

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({ error: 'Invalid email or password.' });
    }
    return this.tokenFor(user);
  }

  /** Issues a hashed single-use code for the Create Account flow. */
  async requestCode(dto: RequestCodeDto): Promise<RequestCodeResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException({ error: 'Email is already registered.' });
    }

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    await this.codes.delete({ email });
    await this.codes.save(
      this.codes.create({
        email,
        codeHash: await bcrypt.hash(code, 10),
        passwordHash: await bcrypt.hash(dto.password, 12),
        name: dto.name.trim(),
        framework: dto.framework?.trim() || null,
        expiresAt: new Date(Date.now() + AuthService.CODE_TTL_SECONDS * 1000),
        attempts: 0,
      }),
    );

    const response: RequestCodeResponseDto = {
      email,
      expiresInSeconds: AuthService.CODE_TTL_SECONDS,
    };
    // Email/SMS delivery is not configured in this workspace, so development
    // echoes the code to make the OTP screen testable end to end.
    const devCodeEnabled =
      this.config.get<string>('NODE_ENV') !== 'production' &&
      this.config.get<string>('AUTH_DEV_CODE') !== 'false';
    if (devCodeEnabled) response.devCode = code;
    return response;
  }

  /** Verifies the code, creates the user and returns the normal JWT session. */
  async verifyCode(dto: VerifyCodeDto): Promise<AuthResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const record = await this.codes
      .createQueryBuilder('code')
      .addSelect(['code.codeHash', 'code.passwordHash'])
      .where('LOWER(code.email) = :email', { email })
      .orderBy('code.createdAt', 'DESC')
      .getOne();

    if (!record) {
      throw new BadRequestException({
        error: 'Request a verification code first.',
      });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      await this.codes.delete({ id: record.id });
      throw new BadRequestException({
        error: 'Verification code expired. Request a new one.',
      });
    }
    if (record.attempts >= AuthService.MAX_ATTEMPTS) {
      throw new BadRequestException({
        error: 'Too many attempts. Request a new code.',
      });
    }
    if (!(await bcrypt.compare(dto.code, record.codeHash))) {
      record.attempts += 1;
      await this.codes.save(record);
      throw new UnauthorizedException({ error: 'Invalid verification code.' });
    }

    if (await this.users.findOne({ where: { email } })) {
      await this.codes.delete({ id: record.id });
      throw new ConflictException({ error: 'Email is already registered.' });
    }

    const user = this.users.create({
      email,
      name: record.name,
      passwordHash: record.passwordHash,
      framework: record.framework ?? undefined,
    });
    await this.users.save(user);
    await this.codes.delete({ id: record.id });
    return this.tokenFor(user);
  }

  toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      ...(user.framework ? { framework: user.framework } : {}),
    };
  }

  private async tokenFor(user: User): Promise<AuthResponseDto> {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '7d';
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      name: user.name,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: this.toAuthUser(user),
    };
  }
}
