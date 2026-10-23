import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfig, getProjectRoot } from './config.js';
import { logger } from './logger.js';

export interface ObjectStorage {
  readonly driver: 's3' | 'local';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  health(): Promise<{ ok: boolean; message: string | null }>;
}

function safeKey(key: string): string {
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) throw new Error('Invalid storage key');
  return key;
}

function createLocalStorage(dir: string): ObjectStorage {
  const root = resolve(getProjectRoot(), dir);
  return {
    driver: 'local',
    async put(key, body) {
      const path = join(root, safeKey(key));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      return readFile(join(root, safeKey(key)));
    },
    async delete(key) {
      await rm(join(root, safeKey(key)), { force: true });
    },
    async health() {
      try {
        await mkdir(root, { recursive: true });
        return { ok: true, message: `Local storage at ${root}` };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
  };
}

function createS3Storage(): ObjectStorage {
  const cfg = getConfig();
  const client = new S3Client({
    region: cfg.S3_REGION,
    endpoint: cfg.S3_ENDPOINT || undefined,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    credentials: cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY ? { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY } : undefined,
  });
  const Bucket = cfg.S3_BUCKET;
  let ensured = false;
  const ensureBucket = async () => {
    if (ensured) return;
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket }));
        logger.info({ bucket: Bucket }, 'created storage bucket');
      } catch (err) {
        // bucket may have been created concurrently
        if ((err as { name?: string }).name !== 'BucketAlreadyOwnedByYou') throw err;
      }
    }
    ensured = true;
  };
  return {
    driver: 's3',
    async put(key, body, contentType) {
      await ensureBucket();
      await client.send(new PutObjectCommand({ Bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
    },
    async get(key) {
      await ensureBucket();
      const res = await client.send(new GetObjectCommand({ Bucket, Key: safeKey(key) }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error('Empty object body');
      return Buffer.from(bytes);
    },
    async delete(key) {
      await ensureBucket();
      await client.send(new DeleteObjectCommand({ Bucket, Key: safeKey(key) }));
    },
    async health() {
      try {
        await ensureBucket();
        return { ok: true, message: `S3 bucket ${Bucket} at ${cfg.S3_ENDPOINT ?? 'aws'}` };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
  };
}

let storage: ObjectStorage | null = null;
export function getStorage(): ObjectStorage {
  if (storage) return storage;
  const cfg = getConfig();
  storage = cfg.STORAGE_DRIVER === 's3' ? createS3Storage() : createLocalStorage(cfg.STORAGE_LOCAL_DIR);
  return storage;
}

export function resetStorageForTests() {
  storage = null;
}
