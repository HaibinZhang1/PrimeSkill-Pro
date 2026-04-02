import { createHash } from 'crypto';

import type { EmbeddingProvider } from './provider';

export class MockEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimension = 1024) {}

  async embed(text: string): Promise<number[]> {
    const digest = createHash('sha256').update(text).digest();
    const out = new Array<number>(this.dimension);
    for (let i = 0; i < this.dimension; i += 1) {
      const value = digest[i % digest.length];
      out[i] = Number((((value / 255) * 2) - 1).toFixed(6));
    }
    return out;
  }
}
