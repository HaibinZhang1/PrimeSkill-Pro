import { Module } from '@nestjs/common';

import { InfraModule } from '../../common/infra.module';
import { SkillController } from './skill.controller';
import { SkillIndexQueueService } from './skill-index-queue.service';
import { SkillService } from './skill.service';

@Module({
  imports: [InfraModule],
  controllers: [SkillController],
  providers: [SkillService, SkillIndexQueueService],
  exports: [SkillService]
})
export class SkillModule {}
