import {
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CandleQuery, CandlesService } from './candles.service';

@Controller('candles')
export class CandlesController {
  constructor(private readonly candlesService: CandlesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getCandles(
    @Query() query: CandleQuery,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.candlesService.getCandles(query);
    response
      .status(result.status)
      .setHeader('Content-Type', result.contentType)
      .setHeader('Cache-Control', result.cacheControl)
      .send(result.body);
  }

  @Post()
  rejectPost(): never {
    return this.methodNotAllowed();
  }

  @Put()
  rejectPut(): never {
    return this.methodNotAllowed();
  }

  @Patch()
  rejectPatch(): never {
    return this.methodNotAllowed();
  }

  @Delete()
  rejectDelete(): never {
    return this.methodNotAllowed();
  }

  private methodNotAllowed(): never {
    throw new HttpException(
      { error: 'Only GET is supported.' },
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }
}
