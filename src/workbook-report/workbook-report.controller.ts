import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';

import { WorkbookExportService } from './workbook-export.service';
import { WorkbookReportService } from './workbook-report.service';

@Controller('workbook')
export class WorkbookReportController {
  constructor(
    private readonly service: WorkbookReportService,
    private readonly exportService: WorkbookExportService,
  ) {}

  /**
   * Exports trades imported from an MT5 HTML report into a Trading Journal
   * workbook. The workbook contains input cells plus Excel formulas, so Excel
   * recalculates every derived column when the file is opened.
   */
  @Post('export')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header('Content-Disposition', 'attachment; filename="TraderLog_Export.xlsx"')
  async export(@Body() payload: any): Promise<StreamableFile> {
    const buffer = await this.exportService.export(payload ?? {});
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="TraderLog_Export.xlsx"',
    });
  }

  /**
   * Legacy: upload a Trading Journal Workbook (.xlsx). Nest parses input cells,
   * recomputes every formula and returns the self-contained HTML report plus
   * trades for the Flutter app's local store.
   */
  @Post('report')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        const isXlsx =
          file.originalname.toLowerCase().endsWith('.xlsx') ||
          file.mimetype ===
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        callback(null, isXlsx);
      },
    }),
  )
  report(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'Upload a .xlsx workbook in the "file" multipart field.',
      );
    }
    return this.service.render(file);
  }
}
