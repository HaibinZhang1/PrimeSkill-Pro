import { Global, Module } from '@nestjs/common';

import { DatabaseService } from './database.service';
import { InstallLockService } from './install-lock.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [DatabaseService, RedisService, InstallLockService],
  exports: [DatabaseService, RedisService, InstallLockService]
})
export class InfraModule {}
