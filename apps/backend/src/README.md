# Backend (NestJS)

## Start

```bash
pnpm --filter @prime/backend start
```

Required env:
- `DATABASE_URL` (default: `postgresql://primeskill:primeskill@127.0.0.1:5432/primeskill`)
- `REDIS_URL` (default: `redis://127.0.0.1:6379`)
- `PORT` (default: `3000`)

## Auth Header (current dev format)

`Authorization: Bearer <base64url-json>`

Payload example:

```json
{
  "userId": 1,
  "clientDeviceId": 10,
  "departmentIds": [1],
  "roleCodes": ["normal_user"]
}
```

Native routes also require:
- `X-Device-Token: <client_device.device_fingerprint>`

## Integration Tests

```bash
pnpm --filter @prime/backend test:integration
```

Tests require running PostgreSQL + Redis.
