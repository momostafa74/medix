import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Appointment, AppointmentStatus, Favorite, Provider, Review, ReviewStatus, VerificationStatus } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ReviewsService {
  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  /** Denormalised rating on providers, recomputed from PUBLISHED reviews only. */
  async recompute(m: EntityManager, providerId: string) {
    await m.query(
      `UPDATE providers p SET
          rating_avg = COALESCE((SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE provider_id = $1 AND status = 'PUBLISHED'), 0),
          rating_count = (SELECT count(*) FROM reviews WHERE provider_id = $1 AND status = 'PUBLISHED')
        WHERE p.id = $1`,
      [providerId],
    );
  }

  /** Only after a COMPLETED appointment that belongs to the reviewer, once per appointment. */
  async create(user: AuthUser, appointmentId: string, rating: number, comment?: string) {
    if (!user.patientId) throw new ForbiddenException('التقييم متاح للمرضى فقط');
    const review = await this.ds.transaction(async (m) => {
      const a = await m.findOneBy(Appointment, { id: appointmentId, patientId: user.patientId! });
      if (!a) throw new NotFoundException('الموعد غير موجود');
      if (a.status !== AppointmentStatus.COMPLETED) throw new BadRequestException('يمكنك التقييم بعد إتمام الكشف فقط');
      if (await m.exists(Review, { where: { appointmentId } })) throw new ConflictException('تم تقييم هذا الموعد من قبل');
      const r = await m.save(
        m.create(Review, {
          patientId: user.patientId!,
          providerId: a.providerId,
          appointmentId,
          entityType: 'APPOINTMENT',
          entityId: appointmentId,
          rating,
          comment: comment ?? null,
          status: ReviewStatus.PUBLISHED,
        }),
      );
      await this.recompute(m, a.providerId);
      return r;
    });
    const p = await this.ds.getRepository(Provider).findOneBy({ id: review.providerId });
    if (p) {
      await this.notifications.notify(p.ownerUserId, {
        type: 'REVIEW_RECEIVED',
        category: 'SYSTEM',
        title: 'تقييم جديد',
        body: `حصلت على تقييم ${rating} من 5`,
        data: { reviewId: review.id },
      });
    }
    return review;
  }

  async publicList(providerId: string, page: number, pageSize: number) {
    const [items, total] = await this.ds.getRepository(Review).findAndCount({
      where: { providerId, status: ReviewStatus.PUBLISHED },
      relations: { patient: { user: true } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return paginate(
      items.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        patientName: (r.patient?.user?.fullName || '').split(' ')[0] || 'مريض',
      })),
      total,
      { page, pageSize },
    );
  }

  async forProvider(user: AuthUser, page: number, pageSize: number) {
    if (!user.providerIds.length) throw new ForbiddenException('غير مصرح');
    const qb = this.ds
      .getRepository(Review)
      .createQueryBuilder('r')
      .leftJoin('r.patient', 'p')
      .leftJoin('p.user', 'u')
      .addSelect(['p.id', 'u.fullName'])
      .where('r.providerId IN (:...ids)', { ids: user.providerIds })
      .orderBy('r.createdAt', 'DESC');
    const [items, total] = await qb.skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    const [summary] = await this.ds.query(
      `SELECT round(avg(rating)::numeric, 2)::float AS avg, count(*)::int AS count,
              count(*) FILTER (WHERE rating = 5)::int AS r5, count(*) FILTER (WHERE rating = 4)::int AS r4,
              count(*) FILTER (WHERE rating = 3)::int AS r3, count(*) FILTER (WHERE rating = 2)::int AS r2,
              count(*) FILTER (WHERE rating = 1)::int AS r1
         FROM reviews WHERE provider_id = ANY($1::uuid[]) AND status = 'PUBLISHED'`,
      [user.providerIds],
    );
    return { ...paginate(items, total, { page, pageSize }), summary };
  }

  async adminList(q: { page: number; pageSize: number; status?: ReviewStatus }) {
    const qb = this.ds
      .getRepository(Review)
      .createQueryBuilder('r')
      .leftJoin('r.provider', 'pr')
      .addSelect(['pr.id', 'pr.nameAr', 'pr.type'])
      .leftJoin('r.patient', 'p')
      .leftJoin('p.user', 'u')
      .addSelect(['p.id', 'u.fullName'])
      .orderBy('r.createdAt', 'DESC');
    if (q.status) qb.where('r.status = :s', { s: q.status });
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(items, total, q);
  }

  async moderate(admin: AuthUser, id: string, status: ReviewStatus) {
    return this.ds.transaction(async (m) => {
      const r = await m.findOneBy(Review, { id });
      if (!r) throw new NotFoundException('التقييم غير موجود');
      await m.update(Review, { id }, { status });
      await this.recompute(m, r.providerId);
      await this.audit.log({ userId: admin.id, action: 'REVIEW_MODERATED', entity: 'reviews', entityId: id, oldValue: { status: r.status }, newValue: { status } }, m);
      return m.findOneBy(Review, { id });
    });
  }

  // ─────────────── Favorites ───────────────

  async favorites(user: AuthUser) {
    if (!user.patientId) throw new ForbiddenException('المفضلة متاحة للمرضى فقط');
    const rows = await this.ds.getRepository(Favorite).find({
      where: { patientId: user.patientId },
      relations: { provider: { doctor: { user: true } } },
      order: { createdAt: 'DESC' },
    });
    return rows
      .filter((f) => f.provider?.verificationStatus === VerificationStatus.APPROVED)
      .map((f) => ({
        providerId: f.providerId,
        createdAt: f.createdAt,
        type: f.provider!.type,
        name: f.provider!.nameAr,
        slug: f.provider!.slug,
        ratingAvg: f.provider!.ratingAvg,
        ratingCount: f.provider!.ratingCount,
        doctorId: f.provider!.doctor?.id ?? null,
        avatarFileId: f.provider!.doctor?.user?.avatarFileId ?? f.provider!.logoFileId,
      }));
  }

  async addFavorite(user: AuthUser, providerId: string) {
    if (!user.patientId) throw new ForbiddenException('المفضلة متاحة للمرضى فقط');
    const p = await this.ds.getRepository(Provider).findOneBy({ id: providerId, verificationStatus: VerificationStatus.APPROVED });
    if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
    await this.ds.getRepository(Favorite).upsert({ patientId: user.patientId, providerId }, ['patientId', 'providerId']);
    return { favorite: true };
  }

  async removeFavorite(user: AuthUser, providerId: string) {
    if (!user.patientId) throw new ForbiddenException('المفضلة متاحة للمرضى فقط');
    await this.ds.getRepository(Favorite).delete({ patientId: user.patientId, providerId });
    return { favorite: false };
  }

  async favoriteIds(user: AuthUser) {
    if (!user.patientId) return [];
    const rows = await this.ds.getRepository(Favorite).find({ where: { patientId: user.patientId }, select: { providerId: true } });
    return rows.map((r) => r.providerId);
  }
}
