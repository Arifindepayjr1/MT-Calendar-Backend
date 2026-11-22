import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthResponseDto, AuthUserDto, SignInDto, SignUpDto } from './auth.models';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  signUp(@Body() dto: SignUpDto): Promise<AuthResponseDto> {
    return this.auth.signUp(dto);
  }

  @Post('login')
  @Post('signin')
  @HttpCode(200)
  signIn(@Body() dto: SignInDto): Promise<AuthResponseDto> {
    return this.auth.signIn(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUserDto): AuthUserDto {
    return user;
  }
}
