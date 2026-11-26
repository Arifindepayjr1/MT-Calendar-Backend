import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Playbook } from '../strategies/entities/playbook.entity';
import { StrategyDraft } from '../strategies/entities/strategy-draft.entity';
import { WorkbookExportService } from './workbook-export.service';
import { WorkbookReportController } from './workbook-report.controller';
import { WorkbookReportService } from './workbook-report.service';

@Module({
  imports: [TypeOrmModule.forFeature([StrategyDraft, Playbook])],
  controllers: [WorkbookReportController],
  providers: [WorkbookReportService, WorkbookExportService],
  exports: [WorkbookReportService, WorkbookExportService],
})
export class WorkbookReportModule {}
