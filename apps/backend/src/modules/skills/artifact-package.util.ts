import { createHash } from 'crypto';

export type InlineArtifactFormat = 'zip' | 'legacy_json';

export interface InlineArtifactEntry {
  path: string;
  content: string;
}

export interface BuiltArtifactPackage {
  bytes: Buffer;
  checksum: string;
  packageFormat: InlineArtifactFormat;
  mimeType: string;
  fileExtension: 'zip' | 'json';
  entryCount: number;
}

const CRC32_TABLE = buildCrc32Table();

export function buildArtifactPackage(
  format: InlineArtifactFormat,
  entries: InlineArtifactEntry[]
): BuiltArtifactPackage {
  const normalizedEntries = entries.map((entry) => ({
    path: normalizeArtifactPath(entry.path),
    content: entry.content
  }));

  const bytes =
    format === 'legacy_json'
      ? buildLegacyJsonPackage(normalizedEntries)
      : buildStoredZipPackage(normalizedEntries);

  return {
    bytes,
    checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    packageFormat: format,
    mimeType: format === 'legacy_json' ? 'application/json; charset=utf-8' : 'application/zip',
    fileExtension: format === 'legacy_json' ? 'json' : 'zip',
    entryCount: normalizedEntries.length
  };
}

export function buildInternalArtifactUrl(baseUrl: string, artifactKey: string, fileName: string) {
  return `${trimTrailingSlash(baseUrl)}/artifacts/skill-version-artifacts/${artifactKey}/${encodeURIComponent(fileName)}`;
}

export function resolvePublicApiBaseUrl() {
  const configured =
    process.env.PUBLIC_API_BASE_URL?.trim() ??
    process.env.BACKEND_PUBLIC_BASE_URL?.trim() ??
    '';

  if (configured) {
    return trimTrailingSlash(configured);
  }

  const port = process.env.PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

function buildLegacyJsonPackage(entries: InlineArtifactEntry[]): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: 'prime_skill_package.v1',
      entries
    }),
    'utf8'
  );
}

function buildStoredZipPackage(entries: InlineArtifactEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.path, 'utf8');
    const fileContent = Buffer.from(entry.content, 'utf8');
    const crc32 = computeCrc32(fileContent);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(fileContent.length, 18);
    localHeader.writeUInt32LE(fileContent.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localRecord = Buffer.concat([localHeader, fileName, fileContent]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(fileContent.length, 20);
    centralHeader.writeUInt32LE(fileContent.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    const centralRecord = Buffer.concat([centralHeader, fileName]);
    centralParts.push(centralRecord);
    offset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function normalizeArtifactPath(input: string) {
  const normalized = input.replace(/\\/g, '/').trim();

  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('artifact entry path is empty');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`artifact entry path must be relative: ${input}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`artifact entry path is invalid: ${input}`);
  }

  return normalized;
}

function computeCrc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table: number[] = [];

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}
