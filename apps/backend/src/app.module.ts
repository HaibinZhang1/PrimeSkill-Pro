import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { AuthMiddleware } from './common/auth.middleware';
import { InfraModule } from './common/infra.module';
import { HealthController } from './health.controller';
import { InstallModule } from './modules/install/install.module';
import { SearchModule } from './modules/search/search.module';
import { SkillModule } from './modules/skills/skill.module';
import { TemplateModule } from './modules/templates/template.module';

@Module({
  imports: [InfraModule, InstallModule, SearchModule, SkillModule, TemplateModule],
  controllers: [HealthController],
  providers: [AuthMiddleware]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
