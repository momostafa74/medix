import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** Local disk (development / single server). Files live OUTSIDE any public web root. */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o640 });
  }
  async get(key: string) {
    const p = this.resolve(key);
    await fs.access(p);
    return createReadStream(p);
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/** Any S3-compatible store (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces). Bucket must be private. */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private client: S3Client;
  constructor(private cfg: { endpoint?: string; region?: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string }) {
    if (!cfg.bucket) throw new Error('S3_BUCKET is required when UPLOAD_STORAGE=s3');
    this.client = new S3Client({
      region: cfg.region || 'us-east-1',
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: !!cfg.endpoint,
      credentials: cfg.accessKeyId ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey! } : undefined,
    });
  }
  async put(key: string, data: Buffer, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data, ContentType: mimeType, ServerSideEncryption: 'AES256' }),
    );
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return out.Body as Readable;
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  readonly driver: StorageDriver;

  constructor(config: ConfigService) {
    const s = config.get('storage');
    switch (s.driver) {
      case 's3':
        this.driver = new S3StorageDriver(s.s3);
        break;
      case 'cloudinary':
        // Adapter slot: implement StorageDriver with Cloudinary's authenticated delivery type.
        throw new Error('Cloudinary driver is not enabled in this build; use UPLOAD_STORAGE=s3 or local');
      default:
        this.driver = new LocalStorageDriver(s.localDir);
    }
    this.logger.log(`Using "${this.driver.name}" storage driver`);
  }
}
