import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { FileEntity, FileVisibility, MedicalDocument, ProviderDocument } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage';
// file-type v16 is CommonJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileType = require('file-type');

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCS = [...IMAGES, 'application/pdf'];

export const FILE_PURPOSES: Record<
  string,
  { mimes: string[]; visibility: FileVisibility; maxMb?: number; permission?: string; patientOnly?: boolean }
> = {
  AVATAR: { mimes: IMAGES, visibility: FileVisibility.PUBLIC, maxMb: 3 },
  PROVIDER_LOGO: { mimes: IMAGES, visibility: FileVisibility.PUBLIC, maxMb: 3, permission: P.PROVIDER_MANAGE_OWN },
  SPECIALTY_IMAGE: { mimes: IMAGES, visibility: FileVisibility.PUBLIC, maxMb: 3, permission: P.SPECIALTIES_MANAGE },
  PROVIDER_DOCUMENT: { mimes: DOCS, visibility: FileVisibility.PRIVATE, permission: P.PROVIDER_MANAGE_OWN },
  MEDICAL_DOCUMENT: { mimes: DOCS, visibility: FileVisibility.PRIVATE, patientOnly: true },
  REFERRAL: { mimes: DOCS, visibility: FileVisibility.PRIVATE, patientOnly: true },
  CHAT_ATTACHMENT: { mimes: DOCS, visibility: FileVisibility.PRIVATE, permission: P.CHAT_USE },
  /** Key images / scanned films attached to a radiology exam (DICOM stays in a future PACS). */
  RADIOLOGY_IMAGE: { mimes: DOCS, visibility: FileVisibility.PRIVATE, maxMb: 15, permission: P.RADIOLOGY_REPORTS_WRITE },
  /** Photo / scan of a paper prescription sent with a pharmacy order. */
  PRESCRIPTION_UPLOAD: { mimes: DOCS, visibility: FileVisibility.PRIVATE, maxMb: 10, patientOnly: true },
  /** Transfer receipt for a provider subscription (InstaPay / Vodafone Cash / bank). */
  PAYMENT_PROOF: { mimes: DOCS, visibility: FileVisibility.PRIVATE, maxMb: 8, permission: P.PROVIDER_MANAGE_OWN },
};

@Injectable()
export class FilesService {
  constructor(
    private ds: DataSource,
    private storage: StorageService,
    private config: ConfigService,
    private access: AccessPolicyService,
    private audit: AuditService,
    private moduleRef: ModuleRef,
    @InjectRepository(FileEntity) private files: Repository<FileEntity>,
  ) {}

  async upload(user: AuthUser, file: Express.Multer.File | undefined, purpose: string) {
    const rule = FILE_PURPOSES[purpose];
    if (!rule) throw new BadRequestException('نوع الملف المطلوب رفعه غير معروف');
    if (!file?.buffer?.length) throw new BadRequestException('لم يتم إرفاق ملف');
    if (rule.permission && !user.permissions.has(rule.permission)) throw new ForbiddenException('غير مصرح لك برفع هذا النوع من الملفات');
    if (rule.patientOnly && !user.patientId) throw new ForbiddenException('هذا النوع من الملفات خاص بالمرضى');

    const maxMb = Math.min(rule.maxMb ?? Infinity, this.config.get<number>('storage.maxFileSizeMb')!);
    if (file.size > maxMb * 1024 * 1024) throw new PayloadTooLargeException(`الحد الأقصى لحجم الملف ${maxMb} ميجابايت`);

    // Trust the bytes, not the client-supplied Content-Type or extension.
    const sniffed = await FileType.fromBuffer(file.buffer);
    if (!sniffed || !rule.mimes.includes(sniffed.mime)) {
      throw new BadRequestException('صيغة الملف غير مسموحة (المسموح: صور JPG/PNG/WEBP أو PDF حسب النوع)');
    }

    const key = `${rule.visibility === FileVisibility.PUBLIC ? 'public' : 'private'}/${purpose.toLowerCase()}/${new Date()
      .toISOString()
      .slice(0, 7)}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.driver.put(key, file.buffer, sniffed.mime);

    const saved = await this.files.save(
      this.files.create({
        storageKey: key,
        driver: this.storage.driver.name,
        originalName: (file.originalname || `file.${sniffed.ext}`).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150),
        mimeType: sniffed.mime,
        size: file.size,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        visibility: rule.visibility,
        purpose,
        uploadedById: user.id,
      }),
    );
    return this.toDto(saved);
  }

  toDto(f: FileEntity) {
    return {
      id: f.id,
      originalName: f.originalName,
      mimeType: f.mimeType,
      size: f.size,
      purpose: f.purpose,
      visibility: f.visibility,
      url: `/api/files/${f.id}`,
      createdAt: f.createdAt,
    };
  }

  /** Every private download is authorised against the record that owns the file. */
  async assertCanRead(user: AuthUser | undefined, f: FileEntity) {
    if (f.visibility === FileVisibility.PUBLIC) return;
    if (!user) throw new ForbiddenException('يجب تسجيل الدخول');
    if (f.uploadedById === user.id) return;

    if (f.purpose === 'PROVIDER_DOCUMENT') {
      if (user.permissions.has(P.PROVIDERS_APPROVE) || user.permissions.has(P.PROVIDERS_READ_ANY)) return;
      const doc = await this.ds.getRepository(ProviderDocument).findOneBy({ fileId: f.id });
      if (doc && user.adminProviderIds.includes(doc.providerId)) return;
    }
    if (f.purpose === 'MEDICAL_DOCUMENT' || f.purpose === 'REFERRAL') {
      const doc = await this.ds.getRepository(MedicalDocument).findOneBy({ fileId: f.id });
      if (doc) {
        await this.access.assertCanReadMedicalRecord(user, doc.patientId);
        return;
      }
    }
    if (f.purpose === 'REFERRAL' || f.purpose === 'RADIOLOGY_IMAGE') {
      const { RadiologyOrdersService } = await import('../radiology/radiology-orders.service');
      if (await this.moduleRef.get(RadiologyOrdersService, { strict: false }).canReadFile(user, f.id)) return;
    }
    if (f.purpose === 'RADIOLOGY_REPORT') {
      const { RadiologyReportsService } = await import('../radiology/radiology-reports.service');
      if (await this.moduleRef.get(RadiologyReportsService, { strict: false }).canReadReportFile(user, f.id)) return;
    }
    if (f.purpose === 'PRESCRIPTION_UPLOAD') {
      const { PharmacyOrdersService } = await import('../pharmacy/pharmacy-orders.service');
      if (await this.moduleRef.get(PharmacyOrdersService, { strict: false }).canReadFile(user, f.id)) return;
    }
    if (f.purpose === 'PRESCRIPTION') {
      const { PrescriptionsService } = await import('../prescriptions/prescriptions.service');
      if (await this.moduleRef.get(PrescriptionsService, { strict: false }).canReadFile(user, f.id)) return;
    }
    if (f.purpose === 'PAYMENT_PROOF' && user.permissions.has(P.SUBSCRIPTIONS_MANAGE)) return;
    if (f.purpose === 'CHAT_ATTACHMENT') {
      // Resolved lazily to keep the files module independent of chat.
      const { ChatService } = await import('../chat/chat.service');
      const chat = this.moduleRef.get(ChatService, { strict: false });
      if (await chat.canReadAttachment(user, f.id)) return;
    }
    if (f.purpose === 'LAB_REPORT') {
      const { LabResultsService } = await import('../labs/lab-results.service');
      const labs = this.moduleRef.get(LabResultsService, { strict: false });
      if (await labs.canReadReportFile(user, f.id)) return;
    }
    throw new ForbiddenException('لا تملك صلاحية الوصول لهذا الملف');
  }

  async open(user: AuthUser | undefined, id: string, meta: { ip?: string; userAgent?: string | null }) {
    const f = await this.files.findOneBy({ id });
    if (!f) throw new NotFoundException('الملف غير موجود');
    await this.assertCanRead(user, f);
    if (f.visibility === FileVisibility.PRIVATE && user && f.uploadedById !== user.id) {
      await this.audit.log({ userId: user.id, action: 'PRIVATE_FILE_DOWNLOADED', entity: 'files', entityId: f.id, newValue: { purpose: f.purpose }, ...meta });
    }
    const stream = await this.storage.driver.get(f.storageKey);
    return { file: f, stream };
  }
}
