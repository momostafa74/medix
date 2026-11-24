import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, In } from 'typeorm';
import {
  Doctor,
  DoctorSchedule,
  DoctorSpecialty,
  ProviderBranch,
  Review,
  ReviewStatus,
  Specialty,
  VerificationStatus,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../schedules/availability.service';
import { minutesToHHmm, luxonToDow } from '../schedules/slot-engine';
import { SearchDoctorsQuery, UpdateDoctorProfileDto } from './doctors.dto';

@Injectable()
export class DoctorsService {
  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private availability: AvailabilityService,
  ) {}

  /** Patient-facing doctor search. Only approved, active doctors with active accounts are ever returned. */
  async search(q: SearchDoctorsQuery) {
    const qb = this.ds
      .getRepository(Doctor)
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.provider', 'p')
      .innerJoin('d.user', 'u')
      .addSelect(['u.id', 'u.fullName', 'u.avatarFileId'])
      .where("p.verificationStatus = 'APPROVED' AND p.isActive = true AND p.subscriptionActive = true AND u.status = 'ACTIVE'");

    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      qb.andWhere(
        `(u.fullName ILIKE :s OR p.nameAr ILIKE :s OR p.nameEn ILIKE :s OR EXISTS (
            SELECT 1 FROM doctor_specialties xs JOIN specialties sp ON sp.id = xs.specialty_id
             WHERE xs.doctor_id = d.id AND (sp.name_ar ILIKE :s OR sp.name_en ILIKE :s)))`,
        { s },
      );
    }
    let specialtyId = q.specialtyId;
    if (!specialtyId && q.specialtySlug) {
      const sp = await this.ds.getRepository(Specialty).findOneBy({ slug: q.specialtySlug });
      specialtyId = sp?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    if (specialtyId) {
      // Matches the specialty itself or any of its sub-specialties.
      qb.andWhere(
        `EXISTS (SELECT 1 FROM doctor_specialties xs JOIN specialties sp ON sp.id = xs.specialty_id
                  WHERE xs.doctor_id = d.id AND (sp.id = :spec OR sp.parent_id = :spec))`,
        { spec: specialtyId },
      );
    }
    if (q.areaId || q.cityId || q.governorateId) {
      const cond = q.areaId ? 'xb.area_id = :areaId' : q.cityId ? 'xb.city_id = :cityId' : 'xc.governorate_id = :govId';
      qb.andWhere(
        `EXISTS (SELECT 1 FROM provider_branches xb LEFT JOIN cities xc ON xc.id = xb.city_id
                  WHERE xb.provider_id = p.id AND xb.is_active AND ${cond})`,
        { areaId: q.areaId, cityId: q.cityId, govId: q.governorateId },
      );
    }
    if (q.minPrice != null) qb.andWhere('d.consultationPrice >= :minP', { minP: q.minPrice });
    if (q.maxPrice != null) qb.andWhere('d.consultationPrice <= :maxP', { maxP: q.maxPrice });
    if (q.minRating) qb.andWhere('p.ratingAvg >= :mr', { mr: q.minRating });
    if (q.gender) qb.andWhere('d.gender = :g', { g: q.gender });
    if (q.online) qb.andWhere('d.onlineAvailable = true');
    if (q.homeVisit) qb.andWhere('d.homeVisitAvailable = true');
    if (q.language) qb.andWhere(':lang = ANY(d.languages)', { lang: q.language });
    if (q.availableOn) {
      const day = DateTime.fromISO(q.availableOn, { zone: this.availability.tz });
      if (!day.isValid) throw new BadRequestException('تاريخ غير صحيح');
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM doctor_schedule_exceptions xe
                      WHERE xe.doctor_id = d.id AND xe.type IN ('HOLIDAY','VACATION')
                        AND xe.start_date <= :od AND xe.end_date >= :od)
         AND (EXISTS (SELECT 1 FROM doctor_schedules xs2 WHERE xs2.doctor_id = d.id AND xs2.is_active AND xs2.day_of_week = :dow)
              OR EXISTS (SELECT 1 FROM doctor_schedule_exceptions xe2 WHERE xe2.doctor_id = d.id AND xe2.type = 'CUSTOM_HOURS'
                           AND xe2.start_date <= :od AND xe2.end_date >= :od))`,
        { od: q.availableOn, dow: luxonToDow(day.weekday) },
      );
    }
    switch (q.sort) {
      case 'price_asc':
        qb.orderBy('d.consultationPrice', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('d.consultationPrice', 'DESC');
        break;
      case 'experience':
        qb.orderBy('d.experienceYears', 'DESC');
        break;
      case 'rating':
        qb.orderBy('p.ratingAvg', 'DESC').addOrderBy('p.ratingCount', 'DESC');
        break;
      default:
        // "recommended": rating weighted by volume, then experience
        qb.addSelect('p.rating_avg * LEAST(p.rating_count, 20)', 'score')
          .orderBy('score', 'DESC')
          .addOrderBy('d.experienceYears', 'DESC');
    }
    qb.addOrderBy('d.id', 'ASC');

    const { skip, take } = skipTake(q);
    // Joins are 1:1, so plain OFFSET/LIMIT is safe (and avoids TypeORM's DISTINCT sub-query).
    const [doctors, total] = await qb.offset(skip).limit(take).getManyAndCount();
    const items = await this.decorate(doctors);
    return paginate(items, total, q);
  }

  /** Adds specialties + branches for a page of doctors in two batched queries. */
  private async decorate(doctors: Doctor[]) {
    if (!doctors.length) return [];
    const ids = doctors.map((d) => d.id);
    const [specs, branches] = await Promise.all([
      this.ds.getRepository(DoctorSpecialty).find({ where: { doctorId: In(ids) }, relations: { specialty: true } }),
      this.ds.getRepository(ProviderBranch).find({
        where: { providerId: In(doctors.map((d) => d.providerId)), isActive: true },
        relations: { city: true, area: true },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return doctors.map((d) => this.card(d, specs.filter((s) => s.doctorId === d.id), branches.filter((b) => b.providerId === d.providerId)));
  }

  private card(d: Doctor, specs: DoctorSpecialty[], branches: ProviderBranch[]) {
    const primary = specs.find((s) => s.isPrimary) ?? specs[0];
    return {
      id: d.id,
      providerId: d.providerId,
      slug: d.provider?.slug,
      fullName: d.user?.fullName,
      displayName: d.provider?.nameAr,
      title: d.title,
      gender: d.gender,
      avatarFileId: d.user?.avatarFileId ?? null,
      logoFileId: d.provider?.logoFileId ?? null,
      primarySpecialty: primary?.specialty ? { id: primary.specialty.id, nameAr: primary.specialty.nameAr, nameEn: primary.specialty.nameEn, slug: primary.specialty.slug } : null,
      specialties: specs.map((s) => ({ id: s.specialtyId, nameAr: s.specialty?.nameAr, nameEn: s.specialty?.nameEn, isPrimary: s.isPrimary })),
      consultationPrice: d.consultationPrice,
      onlinePrice: d.onlinePrice,
      homeVisitPrice: d.homeVisitPrice,
      onlineAvailable: d.onlineAvailable,
      homeVisitAvailable: d.homeVisitAvailable,
      experienceYears: d.experienceYears,
      languages: d.languages,
      ratingAvg: d.provider?.ratingAvg ?? 0,
      ratingCount: d.provider?.ratingCount ?? 0,
      whatsappNumber: d.provider?.whatsappNumber ?? null,
      verified: d.provider?.verificationStatus === VerificationStatus.APPROVED,
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        phone: b.phone,
        city: b.city ? { id: b.city.id, nameAr: b.city.nameAr } : null,
        area: b.area ? { id: b.area.id, nameAr: b.area.nameAr } : null,
        latitude: b.latitude,
        longitude: b.longitude,
      })),
    };
  }

  async getPublicProfile(idOrSlug: string, viewer?: AuthUser) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const qb = this.ds
      .getRepository(Doctor)
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.provider', 'p')
      .innerJoin('d.user', 'u')
      .addSelect(['u.id', 'u.fullName', 'u.avatarFileId', 'u.status']);
    if (isUuid) qb.where('d.id = :k OR p.id = :k', { k: idOrSlug });
    else qb.where('p.slug = :k', { k: idOrSlug });
    const d = await qb.getOne();
    if (!d) throw new NotFoundException('الطبيب غير موجود');
    const isOwnerOrAdmin = viewer && (viewer.doctorId === d.id || viewer.permissions.has(P.PROVIDERS_READ_ANY));
    if (!this.availability.isBookable({ ...d, provider: { ...d.provider, owner: { status: d.user?.status } } } as any) && !isOwnerOrAdmin) {
      throw new NotFoundException('الطبيب غير موجود');
    }

    const [card] = await this.decorate([d]);
    const [schedules, services, reviews, nextSlot] = await Promise.all([
      this.ds.getRepository(DoctorSchedule).find({
        where: { doctorId: d.id, isActive: true },
        relations: { branch: true },
        order: { dayOfWeek: 'ASC', startMinute: 'ASC' },
      }),
      this.ds.query(`SELECT id, name, description, price, duration_minutes AS "durationMinutes" FROM provider_services WHERE provider_id = $1 AND is_active ORDER BY name`, [d.providerId]),
      this.ds.getRepository(Review).find({
        where: { providerId: d.providerId, status: ReviewStatus.PUBLISHED },
        relations: { patient: { user: true } },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.availability.nextAvailable(d.id).catch(() => null),
    ]);
    return {
      ...card,
      bio: d.bio,
      qualifications: d.qualifications,
      licenseVerified: d.provider!.verificationStatus === VerificationStatus.APPROVED,
      verificationStatus: d.provider!.verificationStatus,
      cancellationWindowHours: d.cancellationWindowHours,
      bookingHorizonDays: d.bookingHorizonDays,
      workingHours: schedules.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        start: minutesToHHmm(s.startMinute),
        end: minutesToHHmm(s.endMinute),
        slotDuration: s.slotDuration,
        type: s.appointmentType,
        branchId: s.branchId,
        branchName: s.branch?.name ?? null,
      })),
      services,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        // Patients are shown by first name only.
        patientName: (r.patient?.user?.fullName || '').split(' ')[0] || 'مريض',
      })),
      nextAvailable: nextSlot,
    };
  }

  // ─────────────── Own profile ───────────────

  private ownDoctorId(user: AuthUser) {
    if (!user.doctorId) throw new ForbiddenException('هذا الحساب ليس حساب طبيب');
    return user.doctorId;
  }

  async getOwnProfile(user: AuthUser) {
    const id = this.ownDoctorId(user);
    const d = await this.ds.getRepository(Doctor).findOne({
      where: { id },
      relations: { provider: true, user: true, specialties: { specialty: true } },
    });
    return d;
  }

  async updateOwnProfile(user: AuthUser, dto: UpdateDoctorProfileDto) {
    const id = this.ownDoctorId(user);
    const old = await this.ds.getRepository(Doctor).findOneOrFail({ where: { id }, relations: { provider: true } });
    const { primarySpecialtyId, subSpecialtyIds, ...fields } = dto;

    if (
      old.provider!.verificationStatus === VerificationStatus.APPROVED &&
      ((fields.licenseNumber && fields.licenseNumber !== old.licenseNumber) ||
        (fields.licenseAuthority && fields.licenseAuthority !== old.licenseAuthority))
    ) {
      throw new BadRequestException('لا يمكن تعديل بيانات الترخيص بعد الاعتماد، تواصل مع الإدارة');
    }

    await this.ds.transaction(async (m) => {
      if (Object.keys(fields).length) await m.update(Doctor, { id }, fields as any);
      if (fields.title || fields.bio !== undefined) {
        const u = await m.findOneByOrFail(Doctor, { id });
        const name = (await m.query(`SELECT full_name FROM users WHERE id = $1`, [u.userId]))[0].full_name;
        await m.update('providers', { id: old.providerId }, {
          ...(fields.title ? { nameAr: `${fields.title} ${name}` } : {}),
          ...(fields.bio !== undefined ? { description: fields.bio } : {}),
        });
      }
      if (primarySpecialtyId || subSpecialtyIds) {
        const current = await m.find(DoctorSpecialty, { where: { doctorId: id } });
        const primary = primarySpecialtyId ?? current.find((c) => c.isPrimary)?.specialtyId;
        if (!primary) throw new BadRequestException('اختر التخصص الرئيسي');
        const subs = subSpecialtyIds ?? current.filter((c) => !c.isPrimary).map((c) => c.specialtyId);
        const all = [...new Set([primary, ...subs])];
        const found = await m.count(Specialty, { where: { id: In(all), isActive: true } });
        if (found !== all.length) throw new BadRequestException('أحد التخصصات غير متاح');
        await m.delete(DoctorSpecialty, { doctorId: id });
        await m.save(all.map((sid) => m.create(DoctorSpecialty, { doctorId: id, specialtyId: sid, isPrimary: sid === primary })));
      }
      await this.audit.log({ userId: user.id, action: 'DOCTOR_PROFILE_UPDATED', entity: 'doctors', entityId: id, oldValue: old, newValue: dto }, m);
    });
    return this.getOwnProfile(user);
  }
}
