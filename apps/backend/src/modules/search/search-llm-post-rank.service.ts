import { Injectable } from '@nestjs/common';

import type { SearchResultItem } from './search.service';

interface LlmPostRankResponse {
  orderedSkillVersionIds?: number[];
  reasons?: Record<string, string>;
}

@Injectable()
export class SearchLlmPostRankService {
  private readonly endpoint = process.env.SEARCH_LLM_ENDPOINT?.trim();
  private readonly timeoutMs = Number(process.env.SEARCH_LLM_TIMEOUT_MS ?? 1500);
  private readonly failureThreshold = Number(process.env.SEARCH_LLM_FAILURE_THRESHOLD ?? 3);
  private readonly coolDownMs = Number(process.env.SEARCH_LLM_COOLDOWN_MS ?? 30_000);
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  async postRank(query: string, candidates: SearchResultItem[]): Promise<SearchResultItem[]> {
    if (!this.endpoint) {
      throw new Error('llm_endpoint_not_configured');
    }
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error('llm_circuit_open');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();

    try {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          candidates: candidates.map((item) => ({
            skillVersionId: item.skillVersionId,
            name: item.name,
            whyMatched: item.whyMatched,
            confidenceScore: item.confidenceScore
          }))
        }),
        signal: controller.signal
      });

      if (!resp.ok) {
        throw new Error(`llm_http_${resp.status}`);
      }

      const payload = (await resp.json()) as LlmPostRankResponse;
      const ranked = this.applyOrder(candidates, payload);
      this.consecutiveFailures = 0;
      this.circuitOpenUntil = 0;
      return ranked;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.circuitOpenUntil = Date.now() + this.coolDownMs;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private applyOrder(candidates: SearchResultItem[], payload: LlmPostRankResponse): SearchResultItem[] {
    const byVersion = new Map(candidates.map((item) => [item.skillVersionId, item]));
    const used = new Set<number>();
    const ordered: SearchResultItem[] = [];

    for (const id of payload.orderedSkillVersionIds ?? []) {
      if (used.has(id)) {
        continue;
      }
      const found = byVersion.get(id);
      if (!found) {
        continue;
      }
      used.add(id);
      ordered.push({
        ...found,
        whyMatched: payload.reasons?.[String(id)] ?? found.whyMatched
      });
    }

    for (const item of candidates) {
      if (!used.has(item.skillVersionId)) {
        ordered.push(item);
      }
    }

    return ordered;
  }
}
