import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Serves a readable HTML page when a browser opens an unknown API route.
 * Non-browser clients keep receiving Nest's normal JSON 404 response.
 */
@Catch(NotFoundException)
export class NotFoundHtmlFilter implements ExceptionFilter {
  private readonly template = loadTemplate();

  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!acceptsHtml(request)) {
      response.status(404).json(exception.getResponse());
      return;
    }

    const html = this.template
      .replaceAll('{{METHOD}}', escapeHtml(request.method))
      .replaceAll('{{PATH}}', escapeHtml(request.originalUrl ?? request.url));

    response.status(404).type('html').send(html);
  }
}

function acceptsHtml(request: Request): boolean {
  return (request.headers.accept ?? '').includes('text/html');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loadTemplate(): string {
  const path = join(__dirname, '..', 'public', '404.html');
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return [
      '<!doctype html>',
      '<meta charset="utf-8" />',
      '<title>404 · TraderLog API</title>',
      '<h1>404 · Not Found</h1>',
      '<p><strong>{{METHOD}}</strong> {{PATH}}</p>',
      '<p>This API route does not exist. Try <a href="/api/strategies">/api/strategies</a>.</p>',
    ].join('');
  }
}
