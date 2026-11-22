import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Matches the /api/candles path used by the Flutter web client.
  app.setGlobalPrefix('api');
  app.enableCors();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`TraderLog backend ready at http://localhost:${port}/api`);
}

bootstrap();
