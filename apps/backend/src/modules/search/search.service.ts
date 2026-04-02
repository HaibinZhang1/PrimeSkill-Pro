import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import { buildPermissionPrefilter, type PermissionScope } from './permission-prefilter';
import { SearchLlmPostRankService } from './search-llm-post-rank.service';

export interface SearchRequest {
  query: string;
  page: number;
  pageSize: number;
  toolContext?: string[];
  workspaceContext?: {
    workspaceRegistryId?: number;
  };
}

export interface SearchResultItem {
  skillId: number;
  skillVersionId: number;
  name: string;
  whyMatched: string;
  supportedTools: string[];
  visibilityReason: string;
  recommendedInstallMode: 'global' | 'project';
  confidenceScore: number;
}

export interface SearchResponse {
  degraded: boolean;
  degradedReason?: string;
  items: SearchResultItem[];
}

interface Stage1Row {
  skill_id: number;
  skill_version_id: number;
  name: string;
  summary: string | null;
  visibility_type: 'public' | 'department' | 'private';
  keyword_document: string;
  supported_tools_json: string[];
  recall_score: number;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SearchLlmPostRankService) private readonly llmPostRank: SearchLlmPostRankService
  ) {}

  buildStage1Query(scope: PermissionScope): { whereSql: string; params: unknown[] } {
    return buildPermissionPrefilter(scope);
  }

  async search(req: SearchRequest, scope: PermissionScope): Promise<SearchResponse> {
    if (!req.query.trim()) {
      throw new AppException('SEARCH_QUERY_INVALID', 400, 'query is required');
    }

    const stage1Rows = await this.stage1Recall(req, scope);
    const reranked = this.ruleRerank(stage1Rows, req);
    try {
      const llmRanked = await this.llmPostRank.postRank(req.query.trim(), reranked);
      return {
        degraded: false,
        items: llmRanked.slice(0, req.pageSize)
      };
    } catch {
      return {
        degraded: true,
        degradedReason: 'llm_unavailable',
        items: reranked.slice(0, req.pageSize)
      };
    }
  }

  private async stage1Recall(req: SearchRequest, scope: PermissionScope): Promise<Stage1Row[]> {
    const prefilter = this.buildStage1Query(scope);
    const offset = (req.page - 1) * req.pageSize;
    const candidateLimit = Math.min(100, req.pageSize * 4);
    const queryPattern = `%${req.query.trim()}%`;

    const sql = `
      WITH prefiltered AS (
        SELECT
          s.id AS skill_id,
          sv.id AS skill_version_id,
          s.name,
          s.summary,
          s.visibility_type,
          COALESCE(ssp.keyword_document, '') AS keyword_document,
          COALESCE(ssp.supported_tools_json, '[]'::jsonb) AS supported_tools_json
        FROM skill s
        JOIN skill_version sv ON sv.skill_id = s.id
        LEFT JOIN skill_search_profile ssp ON ssp.skill_version_id = sv.id
        WHERE ${prefilter.whereSql}
      )
      SELECT
        skill_id,
        skill_version_id,
        name,
        summary,
        visibility_type,
        keyword_document,
        ARRAY(
          SELECT jsonb_array_elements_text(supported_tools_json)
        ) AS supported_tools_json,
        (
          CASE WHEN name ILIKE $4 THEN 0.8 ELSE 0 END
          + CASE WHEN COALESCE(summary, '') ILIKE $4 THEN 0.6 ELSE 0 END
          + CASE WHEN keyword_document ILIKE $4 THEN 0.4 ELSE 0 END
        ) AS recall_score
      FROM prefiltered
      WHERE name ILIKE $4
         OR COALESCE(summary, '') ILIKE $4
         OR keyword_document ILIKE $4
      ORDER BY recall_score DESC, skill_id ASC
      LIMIT $5 OFFSET $6
    `;

    const rows = await this.db.query<Stage1Row>(sql, [
      ...prefilter.params,
      queryPattern,
      candidateLimit,
      offset
    ]);
    return rows.rows;
  }

  private ruleRerank(rows: Stage1Row[], req: SearchRequest): SearchResultItem[] {
    const tools = new Set((req.toolContext ?? []).map((t) => t.toLowerCase()));
    const recommendedInstallMode: 'global' | 'project' = req.workspaceContext?.workspaceRegistryId
      ? 'project'
      : 'global';

    return rows
      .map((row) => {
        const matchedTools = row.supported_tools_json.filter((tool) => tools.has(tool.toLowerCase()));
        const toolBonus = matchedTools.length > 0 ? 0.15 : 0;
        const recallScore = Number(row.recall_score);
        const confidenceScore = Math.min(0.99, Number((recallScore + toolBonus).toFixed(3)));

        return {
          skillId: row.skill_id,
          skillVersionId: row.skill_version_id,
          name: row.name,
          whyMatched:
            matchedTools.length > 0
              ? `命中关键词，并与工具上下文匹配: ${matchedTools.join(', ')}`
              : '命中关键词与技能摘要',
          supportedTools: row.supported_tools_json,
          visibilityReason: row.visibility_type === 'public' ? 'public_visible' : 'policy_allowed',
          recommendedInstallMode,
          confidenceScore
        } satisfies SearchResultItem;
      })
      .sort((a, b) => b.confidenceScore - a.confidenceScore);
  }
}
