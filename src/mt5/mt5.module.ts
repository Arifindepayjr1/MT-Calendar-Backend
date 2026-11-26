import { Module } from '@nestjs/common';
import { Mt5Controller } from './mt5.controller';
import { Mt5Service } from './mt5.service';

@Module({
  controllers: [Mt5Controller],
  providers: [Mt5Service],
  exports: [Mt5Service],
})
export class Mt5Module {}
