import { Module } from '@nestjs/common';

import { InfraModule } from '../../common/infra.module';
import { InstallAuthorizationService } from './install-authorization.service';
import { InstallController } from './install.controller';
import { InstallService } from './install.service';

@Module({
  imports: [InfraModule],
  controllers: [InstallController],
  providers: [InstallService, InstallAuthorizationService],
  exports: [InstallService]
})
export class InstallModule {}
