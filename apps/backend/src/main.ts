import 'reflect-metadata';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/app-exception.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';

function loadLocalEnvFiles() {
  const processWithEnvLoader = process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  };
  const packageRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(packageRoot, '..', '..');
  const envFiles = [
    path.join(workspaceRoot, '.env'),
    path.join(workspaceRoot, '.env.local'),
    path.join(packageRoot, '.env'),
    path.join(packageRoot, '.env.local')
  ];

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue;
    }

    processWithEnvLoader.loadEnvFile?.(envFile);
  }
}

export async function createApp() {
  loadLocalEnvFiles();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log']
  });

  app.enableCors({ origin: true });
  app.use(RequestContextMiddleware.attachContext);
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true
    })
  );

  return app;
}

export async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  return app;
}

if (require.main === module) {
  bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('backend bootstrap failed', error);
    process.exit(1);
  });
}
