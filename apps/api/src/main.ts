import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS — accept comma-separated list of origins.
  // Set WEB_ORIGIN to e.g. "https://perpet.vercel.app,https://*.vercel.app"
  const originsEnv = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const origins = originsEnv.split(',').map((s) => s.trim());
  app.enableCors({
    origin: (incoming, cb) => {
      if (!incoming) return cb(null, true);
      const allowed = origins.some((pattern) => {
        if (pattern === '*') return true;
        if (pattern.includes('*')) {
          const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
          return re.test(incoming);
        }
        return pattern === incoming;
      });
      cb(allowed ? null : new Error(`CORS: ${incoming} not allowed`), allowed);
    },
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Perpet ERP API')
    .setDescription('REST API for Perpet Pilipinas Corp. ERP')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);

  Logger.log(`Perpet ERP API listening on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}
bootstrap();
