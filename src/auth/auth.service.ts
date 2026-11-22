import {
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
import {
  AuthResponseDto,
  AuthUserDto,
  SignInDto,
  SignUpDto,
} from './auth.models';
import { User } from './user.entity';

@Injectable()
export class AuthService implements OnModuleInit {
  /** Fixed credentials for the Bruno collection and first Flutter login. */
  static readonly DEMO_EMAIL = 'demo@traderlog.local';
  static readonly DEMO_PASSWORD = 'demo1234';
  static readonly DEMO_ID = '00000000-0000-0000-0000-000000000001';

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
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

  toAuthUser(user: User): AuthUserDto {
    return { id: user.id, email: user.email, name: user.name };
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
