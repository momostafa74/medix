import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { PdfService } from '../pdf/pdf.service';
import { SettingsService } from '../settings/settings.service';
import { AnalyticsService, Compare } from './analytics.service';
import { Range } from './analytics-logic';

interface Sheet {
  name: string;
  columns: { header: string; key: string; width?: number; money?: boolean; pct?: boolean }[];
  rows: Record<string, unknown>[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const KPI_LABELS: Record<string, string> = {
  bookings: 'الحجوزات والطلبات',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  noShow: 'لم يحضر',
  completionRate: 'نسبة الاكتمال %',
  cancellationRate: 'نسبة الإلغاء %',
  noShowRate: 'نسبة عدم الحضور %',
  activePatients: 'مرضى نشطون',
  newPatients: 'مرضى جدد',
  returningPatients: 'مرضى عائدون',
  repeatRate: 'نسبة العودة %',
  gmv: 'إجمالي المدفوعات (ج.م)',
  onlineShare: 'نسبة الدفع الأونلاين %',
  avgOrderValue: 'متوسط قيمة العملية (ج.م)',
  refunds: 'المستردات (ج.م)',
  discounts: 'خصومات الكوبونات (ج.م)',
  rating: 'متوسط التقييم',
  reviews: 'عدد التقييمات',
  commission: 'العمولة (ج.م)',
  netRevenue: 'صافي الإيراد (ج.م)',
  subscriptions: 'الاشتراكات (ج.م)',
  platformRevenue: 'إيراد المنصة (ج.م)',
  activeProviders: 'مقدمو خدمة نشطون',
  registeredPatients: 'مرضى مسجلون جدد',
  newProviders: 'مقدمو خدمة جدد',
  approvedProviders: 'مقدمو خدمة معتمدون',
};
export const KIND_LABELS: Record<string, string> = { APPOINTMENT: 'كشوفات', LAB_ORDER: 'تحاليل', RADIOLOGY_ORDER: 'أشعة', PHARMACY_ORDER: 'صيدلية' };
const TYPE_LABELS: Record<string, string> = { DOCTOR: 'طبيب', LABORATORY: 'معمل', RADIOLOGY: 'أشعة', PHARMACY: 'صيدلية', HOSPITAL: 'مستشفى', HOME_CARE: 'رعاية منزلية' };

/** Excel workbooks and the printable executive summary for analytics. */
@Injectable()
export class AnalyticsExportService {
  constructor(
    private analytics: AnalyticsService,
    private pdf: PdfService,
    private settings: SettingsService,
  ) {}

  private async workbook(title: string, sheets: Sheet[]) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Medix';
    wb.created = new Date();
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
      ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C5C' } };
      ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      for (const r of s.rows) ws.addRow(r);
      s.columns.forEach((c, i) => {
        if (c.money) ws.getColumn(i + 1).numFmt = '#,##0.00';
        if (c.pct) ws.getColumn(i + 1).numFmt = '0.0"%"';
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    }
    wb.title = title;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async xlsx(r: Range, compare: Compare, scope: string[] | null) {
    const [ov, ts, bd] = await Promise.all([this.analytics.overview(r, compare, scope), this.analytics.timeseries(r, undefined, scope), this.analytics.breakdowns(r, scope)]);
    const sheets: Sheet[] = [
      {
        name: 'المؤشرات',
        columns: [
          { header: 'المؤشر', key: 'label', width: 34 },
          { header: `${r.from} → ${r.to}`, key: 'current', width: 22 },
          { header: ov.compareRange ? `${ov.compareRange.from} → ${ov.compareRange.to}` : 'المقارنة', key: 'previous', width: 22 },
          { header: 'التغير %', key: 'change', width: 12, pct: true },
        ],
        rows: Object.keys(ov.current).map((k) => ({ label: KPI_LABELS[k] ?? k, current: ov.current[k], previous: ov.previous?.[k] ?? '', change: ov.change[k] ?? '' })),
      },
      {
        name: 'زمني',
        columns: [
          { header: 'الفترة', key: 'bucket', width: 14 },
          { header: 'كل الحجوزات', key: 'bookings' },
          { header: 'كشوفات', key: 'appointments' },
          { header: 'تحاليل', key: 'lab' },
          { header: 'أشعة', key: 'radiology' },
          { header: 'صيدلية', key: 'pharmacy' },
          { header: 'ملغاة', key: 'cancelled' },
          { header: 'المدفوعات', key: 'gmv', money: true },
          { header: scope ? 'صافي الإيراد' : 'العمولة', key: scope ? 'net' : 'commission', money: true },
          ...(scope ? [] : [{ header: 'الاشتراكات', key: 'subscriptions', money: true }]),
        ],
        rows: ts.series,
      },
      {
        name: 'حسب الخدمة',
        columns: [
          { header: 'الخدمة', key: 'label', width: 16 },
          { header: 'الحجوزات', key: 'bookings' },
          { header: 'مكتملة', key: 'completed' },
          { header: 'ملغاة', key: 'cancelled' },
          { header: 'قيمة المكتمل', key: 'value', money: true },
        ],
        rows: bd.byKind.map((x: any) => ({ ...x, label: KIND_LABELS[x.key] ?? x.key })),
      },
      {
        name: 'حسب المحافظة',
        columns: [
          { header: 'المحافظة', key: 'key', width: 20 },
          { header: 'الحجوزات', key: 'bookings' },
          { header: 'المرضى', key: 'patients' },
        ],
        rows: bd.byGovernorate,
      },
    ];
    if (bd.bySpecialty.length) {
      sheets.push({
        name: 'حسب التخصص',
        columns: [
          { header: 'التخصص', key: 'key', width: 24 },
          { header: 'الكشوفات', key: 'bookings' },
          { header: 'مكتملة', key: 'completed' },
          { header: 'القيمة', key: 'value', money: true },
        ],
        rows: bd.bySpecialty,
      });
    }
    if (bd.topItems.length) {
      sheets.push({
        name: 'الأكثر طلباً',
        columns: [
          { header: 'الصنف / الخدمة', key: 'name', width: 34 },
          { header: 'الكمية', key: 'qty' },
          { header: 'القيمة', key: 'value', money: true },
        ],
        rows: bd.topItems,
      });
    }
    if (!scope) {
      const lb = await this.analytics.leaderboard(r, { pageSize: 100, sort: 'gmv' });
      sheets.push({
        name: 'مقدمو الخدمة',
        columns: [
          { header: 'الاسم', key: 'nameAr', width: 30 },
          { header: 'النوع', key: 'typeLabel', width: 12 },
          { header: 'الحجوزات', key: 'bookings' },
          { header: 'مكتملة', key: 'completed' },
          { header: 'الاكتمال %', key: 'completionRate', pct: true },
          { header: 'الإلغاء %', key: 'cancellationRate', pct: true },
          { header: 'المرضى', key: 'patients' },
          { header: 'المدفوعات', key: 'gmv', money: true },
          { header: 'العمولة', key: 'commission', money: true },
          { header: 'التقييم', key: 'rating' },
        ],
        rows: lb.items.map((x) => ({ ...x, typeLabel: TYPE_LABELS[x.type] ?? x.type })),
      });
    }
    return { buffer: await this.workbook('Medix analytics', sheets), fileName: `medix-analytics-${r.from}-${r.to}.xlsx` };
  }

  /** One-page A4 executive summary (KPIs with comparison, service mix, top providers). */
  async pdfReport(r: Range, compare: Compare, scope: string[] | null, title: string) {
    const [ov, bd, platform] = await Promise.all([this.analytics.overview(r, compare, scope), this.analytics.breakdowns(r, scope), this.settings.get<string>('platform.name')]);
    const lb = scope ? null : await this.analytics.leaderboard(r, { pageSize: 8, sort: 'gmv' });
    const fmt = (k: string, v: number | undefined) => {
      if (v == null) return '—';
      if (/Rate|Share/.test(k)) return `${v}%`;
      if (['gmv', 'avgOrderValue', 'refunds', 'discounts', 'commission', 'netRevenue', 'subscriptions', 'platformRevenue'].includes(k)) return `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} ج.م`;
      return v.toLocaleString('en-US');
    };
    const keys = scope
      ? ['bookings', 'completed', 'completionRate', 'cancellationRate', 'activePatients', 'newPatients', 'repeatRate', 'gmv', 'netRevenue', 'commission', 'avgOrderValue', 'rating']
      : ['bookings', 'completed', 'completionRate', 'cancellationRate', 'activePatients', 'newPatients', 'repeatRate', 'gmv', 'platformRevenue', 'commission', 'subscriptions', 'activeProviders'];
    // Metrics where going down is good.
    const lowerIsBetter = ['cancellationRate', 'noShowRate', 'refunds'];
    const kpiCards = keys
      .map((k) => {
        const ch = ov.change[k];
        const good = ch == null || ch === 0 ? '' : (ch > 0) !== lowerIsBetter.includes(k) ? 'up' : 'down';
        return `<div class="kpi"><div class="l">${esc(KPI_LABELS[k] ?? k)}</div><div class="v">${esc(fmt(k, ov.current[k]))}</div>${
          ov.previous ? `<div class="c ${good}">${ch == null ? 'جديد' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : '•'} ${Math.abs(ch)}%`} <span>مقابل ${esc(fmt(k, ov.previous[k]))}</span></div>` : ''
        }</div>`;
      })
      .join('');
    const maxKind = Math.max(1, ...bd.byKind.map((x: any) => x.bookings));
    const kinds = bd.byKind
      .map((x: any) => `<tr><td>${esc(KIND_LABELS[x.key] ?? x.key)}</td><td class="bar"><span style="width:${Math.round((x.bookings / maxKind) * 100)}%"></span></td><td>${x.bookings}</td><td>${x.completed}</td></tr>`)
      .join('');
    const govs = bd.byGovernorate.slice(0, 6).map((x: any) => `<tr><td>${esc(x.key)}</td><td>${x.bookings}</td><td>${x.patients}</td></tr>`).join('');
    const top = lb
      ? lb.items.map((x) => `<tr><td>${esc(x.nameAr)}</td><td>${esc(TYPE_LABELS[x.type] ?? x.type)}</td><td>${x.bookings}</td><td>${x.completionRate}%</td><td>${fmt('gmv', x.gmv)}</td></tr>`).join('')
      : bd.topItems.slice(0, 8).map((x: any) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${fmt('gmv', x.value)}</td></tr>`).join('');
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${this.pdf.fonts()}
      body{font-family:'Plex Arabic',sans-serif;color:#13252B;font-size:11px;margin:0}
      h1{margin:0;color:#0F4C5C;font-size:19px} .sub{color:#4A5F66;margin:2px 0 12px}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
      .kpi{border:1px solid #DCE5E4;border-radius:8px;padding:8px} .kpi .l{color:#4A5F66;font-size:10px} .kpi .v{font-size:16px;font-weight:700;margin:2px 0}
      .kpi .c{font-size:9.5px;color:#4A5F66} .kpi .c.up{color:#2E7D5B} .kpi .c.down{color:#B3261E} .kpi .c span{color:#7C8B96}
      h2{font-size:13px;color:#0F4C5C;margin:14px 0 6px} .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      table{width:100%;border-collapse:collapse} th{background:#F1F5F5;text-align:right;padding:5px;font-size:10px;color:#4A5F66} td{padding:5px;border-bottom:1px solid #EEF2F2}
      td.bar{width:40%} td.bar span{display:block;height:8px;background:#0F4C5C;border-radius:4px}
      .f{margin-top:14px;color:#7C8B96;font-size:9px}</style></head><body>
      <h1>${esc(platform)} — ${esc(title)}</h1>
      <div class="sub">الفترة ${esc(r.from)} ← ${esc(r.to)} (${r.days} يوم)${ov.compareRange ? ` • مقارنة بـ ${esc(ov.compareRange.from)} ← ${esc(ov.compareRange.to)}` : ''}</div>
      <div class="kpis">${kpiCards}</div>
      <div class="cols">
        <div><h2>حسب الخدمة</h2><table><tr><th>الخدمة</th><th></th><th>حجوزات</th><th>مكتملة</th></tr>${kinds || '<tr><td colspan="4">لا توجد بيانات</td></tr>'}</table></div>
        <div><h2>حسب المحافظة</h2><table><tr><th>المحافظة</th><th>حجوزات</th><th>مرضى</th></tr>${govs || '<tr><td colspan="3">لا توجد بيانات</td></tr>'}</table></div>
      </div>
      <h2>${lb ? 'أعلى مقدمي الخدمة (بالمدفوعات)' : 'الأكثر طلباً'}</h2>
      <table>${lb ? '<tr><th>الاسم</th><th>النوع</th><th>حجوزات</th><th>الاكتمال</th><th>المدفوعات</th></tr>' : '<tr><th>الصنف / الخدمة</th><th>الكمية</th><th>القيمة</th></tr>'}${top || '<tr><td colspan="5">لا توجد بيانات</td></tr>'}</table>
      <div class="f">تقرير آلي من ${esc(platform)} — ${esc(DateTime.now().setZone('Africa/Cairo').setLocale('ar-EG').toFormat('d LLLL yyyy h:mm a'))}. الأرقام المالية بعد خصم المستردات.</div>
      </body></html>`;
    return { buffer: await this.pdf.render(html, { format: 'A4' }), fileName: `medix-report-${r.from}-${r.to}.pdf` };
  }
}
