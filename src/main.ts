import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NotFoundHtmlFilter } from './common/not-found.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Matches the /api/mt5, /api/auth and /api/strategies paths used by the client.
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalFilters(new NotFoundHtmlFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`TraderLog backend ready at http://localhost:${port}/api`);
}

bootstrap();
