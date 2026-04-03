import { Module } from '@nestjs/common';

import { InfraModule } from '../../common/infra.module';
import { RuntimeController } from './runtime.controller';
import { RuntimeService } from './runtime.service';

@Module({
  imports: [InfraModule],
  controllers: [RuntimeController],
  providers: [RuntimeService]
})
export class RuntimeModule {}
