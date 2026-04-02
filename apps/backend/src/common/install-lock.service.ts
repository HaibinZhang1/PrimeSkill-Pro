import { randomUUID, createHash } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import type { InstallLockScope } from '../../../../packages/shared-types/src/install';
import { AppException } from './app.exception';
import { RedisService } from './redis.service';

@Injectable()
export class InstallLockService {
  private static readonly LOCK_TTL_MS = 120_000;

  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  buildLockKey(scope: InstallLockScope): string {
    const raw = `${scope.clientDeviceId}:${scope.resolvedTargetPath}`;
    const digest = createHash('sha256').update(raw).digest('hex');
    return `install_lock:${digest}`;
  }

  private buildAdvisoryKey(lockKey: string): [number, number] {
    const digest = createHash('sha256').update(lockKey).digest();
    const hi = digest.readInt32BE(0);
    const lo = digest.readInt32BE(4);
    return [hi, lo];
  }

  async withDualLock<T>(
    scope: InstallLockScope,
    txClient: PoolClient,
    runner: () => Promise<T>
  ): Promise<T> {
    const redis = await this.redisService.getClient();
    const key = this.buildLockKey(scope);
    const ownerToken = randomUUID();
    const acquired = await redis.set(key, ownerToken, 'PX', InstallLockService.LOCK_TTL_MS, 'NX');

    if (acquired !== 'OK') {
      throw new AppException('INSTALL_CONFLICT', 409, 'lock key occupied');
    }

    const [k1, k2] = this.buildAdvisoryKey(key);
    const advisory = await txClient.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::int4, $2::int4) AS ok',
      [k1, k2]
    );

    if (!advisory.rows[0]?.ok) {
      await this.safeRelease(redis, key, ownerToken);
      throw new AppException('INSTALL_CONFLICT', 409, 'advisory lock conflict');
    }

    const renewTimer = setInterval(async () => {
      const currentToken = await redis.get(key);
      if (currentToken === ownerToken) {
        await redis.pexpire(key, InstallLockService.LOCK_TTL_MS);
      }
    }, 30_000);
    renewTimer.unref();

    try {
      return await runner();
    } finally {
      clearInterval(renewTimer);
      await this.safeRelease(redis, key, ownerToken);
    }
  }

  private async safeRelease(redis: Awaited<ReturnType<RedisService['getClient']>>, key: string, token: string) {
    const releaseScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;
    await redis.eval(releaseScript, 1, key, token);
  }
}
