import { Module } from '@nestjs/common';

import { InfraModule } from '../../common/infra.module';
import { SearchLlmPostRankService } from './search-llm-post-rank.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [InfraModule],
  controllers: [SearchController],
  providers: [SearchService, SearchLlmPostRankService],
  exports: [SearchService]
})
export class SearchModule {}
