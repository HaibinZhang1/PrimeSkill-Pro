export function encodeAuthToken(payload: {
  userId: number;
  clientDeviceId: number;
  departmentIds?: number[];
  roleCodes?: string[];
}) {
  return Buffer.from(
    JSON.stringify({
      userId: payload.userId,
      clientDeviceId: payload.clientDeviceId,
      departmentIds: payload.departmentIds ?? [],
      roleCodes: payload.roleCodes ?? []
    })
  ).toString('base64url');
}
