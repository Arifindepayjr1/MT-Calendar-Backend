import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUserDto } from '../auth/auth.models';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StrategiesService } from './strategies.service';
import {
  CreateStrategyDto,
  CreatedStrategyDto,
  StrategyDetailDto,
  StrategyDraftDto,
  StrategyOverviewDto,
} from './strategy.models';

@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  overview(): Promise<StrategyOverviewDto> {
    return this.strategiesService.overview();
  }

  @Get('drafts')
  @UseGuards(JwtAuthGuard)
  drafts(@CurrentUser('id') userId: string): Promise<StrategyDraftDto[]> {
    return this.strategiesService.draftsForUser(userId);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<StrategyDetailDto> {
    return this.strategiesService.detail(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  createDraft(
    @CurrentUser() user: AuthUserDto,
    @Body() dto: CreateStrategyDto,
  ): Promise<CreatedStrategyDto> {
    return this.strategiesService.createDraft(user.id, dto);
  }
}
