import { Inject, Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database.service';
import { buildPermissionPrefilter, type PermissionScope } from './permission-prefilter';
import { demoSkillCatalog, type DemoSkillCatalogItem } from './demo-skill-catalog';
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
  summary: string;
  category: string;
  tags: string[];
  whyMatched: string;
  supportedTools: string[];
  visibilityReason: string;
  recommendedInstallMode: 'global' | 'project';
  installCount: number;
  confidenceScore: number;
}

export interface SearchResponse {
  degraded: boolean;
  degradedReason?: string;
  mode: 'featured' | 'search';
  source: 'database' | 'demo_catalog';
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

interface DatabaseCatalogAvailabilityRow {
  ready: boolean;
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
    const normalizedReq = {
      ...req,
      query: req.query.trim()
    };

    const hasDatabaseCatalog = await this.hasDatabaseCatalog();

    if (!normalizedReq.query) {
      return hasDatabaseCatalog ? this.featuredFromDatabase(normalizedReq, scope) : this.featuredFromDemoCatalog(normalizedReq);
    }

    if (!hasDatabaseCatalog) {
      return this.searchFromDemoCatalog(normalizedReq);
    }

    const stage1Rows = await this.stage1Recall(normalizedReq, scope);
    const reranked = this.ruleRerank(stage1Rows, normalizedReq);
    try {
      const llmRanked = await this.llmPostRank.postRank(normalizedReq.query, reranked);
      return {
        degraded: false,
        mode: 'search',
        source: 'database',
        items: llmRanked.slice(0, normalizedReq.pageSize)
      };
    } catch {
      return {
        degraded: true,
        degradedReason: 'llm_unavailable',
        mode: 'search',
        source: 'database',
        items: reranked.slice(0, normalizedReq.pageSize)
      };
    }
  }

  private async stage1Recall(req: SearchRequest, scope: PermissionScope): Promise<Stage1Row[]> {
    const prefilter = this.buildStage1Query(scope);
    const offset = (req.page - 1) * req.pageSize;
    const candidateLimit = Math.min(100, req.pageSize * 4);
    const queryPattern = `%${req.query}%`;

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
        JOIN skill_version sv ON sv.id = s.current_version_id
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

    const rows = await this.db.query<Stage1Row>(sql, [...prefilter.params, queryPattern, candidateLimit, offset]);
    return rows.rows;
  }

  private ruleRerank(rows: Stage1Row[], req: SearchRequest): SearchResultItem[] {
    const tools = new Set((req.toolContext ?? []).map((tool) => tool.toLowerCase()));
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
          summary: row.summary ?? 'No summary available yet.',
          category: matchedTools.length > 0 ? 'Tool-aligned' : 'General',
          tags: row.supported_tools_json,
          whyMatched:
            matchedTools.length > 0
              ? `Matched your keywords and tool context: ${matchedTools.join(', ')}`
              : 'Matched your keywords and marketplace profile.',
          supportedTools: row.supported_tools_json,
          visibilityReason: row.visibility_type === 'public' ? 'public_visible' : 'policy_allowed',
          recommendedInstallMode,
          installCount: 0,
          confidenceScore
        } satisfies SearchResultItem;
      })
      .sort((left, right) => right.confidenceScore - left.confidenceScore);
  }

  private async hasDatabaseCatalog(): Promise<boolean> {
    const result = await this.db.query<DatabaseCatalogAvailabilityRow>(`
      SELECT EXISTS(
        SELECT 1
        FROM skill s
        JOIN skill_version sv ON sv.id = s.current_version_id
        LIMIT 1
      ) AS ready
    `);

    return result.rows[0]?.ready ?? false;
  }

  private async featuredFromDatabase(req: SearchRequest, scope: PermissionScope): Promise<SearchResponse> {
    const prefilter = this.buildStage1Query(scope);
    const candidateLimit = Math.min(24, req.pageSize * 3);
    const tools = new Set((req.toolContext ?? []).map((tool) => tool.toLowerCase()));
    const recommendedInstallMode: 'global' | 'project' = req.workspaceContext?.workspaceRegistryId ? 'project' : 'global';

    const rows = await this.db.query<Stage1Row>(
      `
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
          JOIN skill_version sv ON sv.id = s.current_version_id
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
          0.5 AS recall_score
        FROM prefiltered
        ORDER BY skill_id ASC
        LIMIT $4
      `,
      [...prefilter.params, candidateLimit]
    );

    const items = rows.rows
      .map((row) => {
        const matchedTools = row.supported_tools_json.filter((tool) => tools.has(tool.toLowerCase()));
        return {
          skillId: row.skill_id,
          skillVersionId: row.skill_version_id,
          name: row.name,
          summary: row.summary ?? 'Marketplace recommendation',
          category: matchedTools.length > 0 ? 'Recommended for your tools' : 'Featured',
          tags: row.supported_tools_json,
          whyMatched:
            matchedTools.length > 0
              ? `Recommended because it fits your local tools: ${matchedTools.join(', ')}`
              : 'Featured to help you start with the marketplace.',
          supportedTools: row.supported_tools_json,
          visibilityReason: row.visibility_type === 'public' ? 'public_visible' : 'policy_allowed',
          recommendedInstallMode,
          installCount: 0,
          confidenceScore: matchedTools.length > 0 ? 0.78 : 0.68
        } satisfies SearchResultItem;
      })
      .sort((left, right) => right.confidenceScore - left.confidenceScore)
      .slice(0, req.pageSize);

    return {
      degraded: false,
      mode: 'featured',
      source: 'database',
      items
    };
  }

  private featuredFromDemoCatalog(req: SearchRequest): SearchResponse {
    return {
      degraded: false,
      mode: 'featured',
      source: 'demo_catalog',
      items: this.rankDemoCatalog('', req).slice(0, req.pageSize)
    };
  }

  private searchFromDemoCatalog(req: SearchRequest): SearchResponse {
    return {
      degraded: true,
      degradedReason: 'demo_catalog_fallback',
      mode: 'search',
      source: 'demo_catalog',
      items: this.rankDemoCatalog(req.query, req).slice(0, req.pageSize)
    };
  }

  private rankDemoCatalog(query: string, req: SearchRequest): SearchResultItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    const tools = new Set((req.toolContext ?? []).map((tool) => tool.toLowerCase()));
    const recommendedInstallMode: 'global' | 'project' = req.workspaceContext?.workspaceRegistryId ? 'project' : 'global';

    return demoSkillCatalog
      .map((item) => {
        const searchable = [item.name, item.summary, item.category, ...item.tags, ...item.supportedTools].join(' ').toLowerCase();
        const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
        const matchedTools = item.supportedTools.filter((tool) => tools.has(tool.toLowerCase()));
        const score =
          (matchesQuery ? 0.62 : 0) +
          (matchedTools.length > 0 ? 0.18 : 0) +
          Math.min(0.16, item.installCount / 2000);

        return {
          skillId: item.skillId,
          skillVersionId: item.skillVersionId,
          name: item.name,
          summary: item.summary,
          category: item.category,
          tags: item.tags,
          whyMatched: this.buildDemoWhyMatched(item, normalizedQuery, matchedTools),
          supportedTools: item.supportedTools,
          visibilityReason: 'demo_catalog',
          recommendedInstallMode: recommendedInstallMode === 'project' ? 'project' : item.recommendedInstallMode,
          installCount: item.installCount,
          confidenceScore: Number(Math.min(0.97, score).toFixed(3))
        } satisfies SearchResultItem;
      })
      .filter((item) => !normalizedQuery || item.confidenceScore >= 0.62)
      .sort((left, right) => {
        if (right.confidenceScore !== left.confidenceScore) {
          return right.confidenceScore - left.confidenceScore;
        }
        return right.installCount - left.installCount;
      });
  }

  private buildDemoWhyMatched(item: DemoSkillCatalogItem, normalizedQuery: string, matchedTools: string[]): string {
    if (!normalizedQuery) {
      return matchedTools.length > 0
        ? `Featured for your current setup: ${matchedTools.join(', ')}`
        : 'Featured as a starter skill for marketplace demos.';
    }

    if (matchedTools.length > 0) {
      return `Matched "${normalizedQuery}" and aligns with ${matchedTools.join(', ')}.`;
    }

    return `Matched "${normalizedQuery}" in the curated marketplace demo catalog.`;
  }
}
