import { esc } from '../pdf/pdf.service';

export interface RadReportData {
  fontCss: string;
  draft: boolean;
  platformName: string;
  center: { name: string; nameEn?: string | null; accreditation?: string | null; phone?: string | null; address?: string | null; logoDataUrl?: string | null };
  patient: { name: string; gender?: string | null; age?: number | null };
  order: { code: string; service: string; modality: string; examDate?: string | null; approvedAt?: string | null; printedAt: string; accession?: string | null; referringDoctor?: string | null; indication?: string | null };
  report: { technique?: string | null; comparison?: string | null; findings: string; impression: string; recommendations?: string | null; critical: boolean };
  images: { dataUrl: string; caption?: string | null }[];
  signatures: { reportedBy?: string | null; approvedBy?: string | null };
  qrDataUrl?: string | null;
  verificationCode?: string | null;
}

const C = { petrol: '#0F4C5C', ink: '#13252B', mint: '#E7F3EF', paper: '#F6F8F8', saffron: '#E9A23B', signal: '#C8432B', line: '#D9E2E2', muted: '#5B6B70' };

/** Paragraph text: escaped, line breaks kept, mixed Arabic/English handled per paragraph. */
const para = (t?: string | null) =>
  (t || '')
    .split(/\n{2,}/)
    .map((p) => `<p dir="auto">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

/** Self-contained A4 radiology report (RTL Arabic, embedded fonts, no external assets). */
export function radiologyReportHtml(d: RadReportData): string {
  const info = (label: string, value: unknown, ltr = false) =>
    value ? `<div class="kv"><span>${esc(label)}</span><b${ltr ? ' dir="ltr"' : ''}>${esc(value)}</b></div>` : '';
  const section = (title: string, body?: string | null, cls = '') => (body?.trim() ? `<section class="sec ${cls}"><h2>${esc(title)}</h2>${para(body)}</section>` : '');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(d.order.code)}</title>
<style>
${d.fontCss}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Plex Arabic','Noto Naskh Arabic','DejaVu Sans',sans-serif;color:${C.ink};font-size:12px;line-height:1.7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:3px solid ${C.petrol}}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:58px;height:58px;border-radius:12px;background:${C.mint};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:26px;color:${C.petrol};overflow:hidden}
.logo img{width:100%;height:100%;object-fit:cover}
h1{margin:0;font-size:19px;font-weight:700;color:${C.petrol}}
.en,.sub{font-size:10.5px;color:${C.muted}}
.doc{text-align:left}
.doc .t{font-size:15px;font-weight:700}
.doc .code{font-size:11px;color:${C.muted}}
.acc{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:20px;background:${C.mint};color:${C.petrol};font-size:10px;font-weight:600}
.panel{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 18px;background:${C.paper};border:1px solid ${C.line};border-radius:10px;padding:10px 14px;margin:12px 0}
.kv{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed ${C.line};padding:2px 0;font-size:11px}
.kv span{color:${C.muted}}
.kv b{font-weight:600}
.exam{display:flex;align-items:baseline;gap:10px;margin:4px 0 10px}
.exam .name{font-size:16px;font-weight:700;color:${C.petrol}}
.exam .mod{font-size:11px;color:${C.muted}}
.alert{border:1.5px solid ${C.signal};background:#FBEDEA;color:${C.signal};border-radius:8px;padding:6px 12px;margin:0 0 10px;font-weight:600}
.sec{margin:10px 0;break-inside:avoid-page}
.sec h2{font-size:12.5px;margin:0 0 2px;color:${C.petrol};border-bottom:1px solid ${C.line};padding-bottom:2px}
.sec p{margin:0 0 6px;white-space:normal}
.impression{background:${C.mint};border-right:4px solid ${C.petrol};border-radius:6px;padding:8px 12px}
.impression h2{border:0}
.impression p{font-weight:600}
.imgs{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px;break-inside:avoid}
.imgs figure{margin:0;border:1px solid ${C.line};border-radius:8px;overflow:hidden;background:#000}
.imgs img{width:100%;height:58mm;object-fit:contain;display:block}
.imgs figcaption{background:#fff;font-size:9.5px;color:${C.muted};padding:2px 6px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:16px;padding-top:10px;border-top:1px solid ${C.line};break-inside:avoid}
.sig{display:flex;gap:28px}
.sig span{display:block;color:${C.muted};font-size:10px}
.sig b{font-weight:600}
.qr{display:flex;align-items:center;gap:10px;text-align:left}
.qr img{width:86px;height:86px}
.qr small{display:block;color:${C.muted};font-size:9.5px;max-width:190px;line-height:1.4}
.qr code{direction:ltr;font-family:inherit;font-size:9.5px}
.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9}
.wm span{transform:rotate(-30deg);font-size:110px;font-weight:700;color:rgba(200,67,43,.12);letter-spacing:8px}
.disclaimer{margin-top:8px;color:${C.muted};font-size:9.5px}
</style></head><body>
${d.draft ? '<div class="wm"><span>مسودة</span></div>' : ''}
<div class="head">
  <div class="brand">
    <div class="logo">${d.center.logoDataUrl ? `<img src="${d.center.logoDataUrl}" alt="">` : esc(d.center.name.charAt(0))}</div>
    <div>
      <h1>${esc(d.center.name)}</h1>
      ${d.center.nameEn ? `<div class="en" dir="ltr">${esc(d.center.nameEn)}</div>` : ''}
      <div class="sub">${esc(d.center.address || '')}${d.center.address && d.center.phone ? ' · ' : ''}${d.center.phone ? `<span dir="ltr">${esc(d.center.phone)}</span>` : ''}</div>
      ${d.center.accreditation ? `<span class="acc">${esc(d.center.accreditation)}</span>` : ''}
    </div>
  </div>
  <div class="doc"><div class="t">تقرير أشعة</div><div class="code" dir="ltr">${esc(d.order.code)}</div></div>
</div>

<div class="panel">
  ${info('اسم المريض', d.patient.name)}
  ${info('النوع', d.patient.gender === 'MALE' ? 'ذكر' : d.patient.gender === 'FEMALE' ? 'أنثى' : '')}
  ${info('السن', d.patient.age != null ? `${d.patient.age} سنة` : '')}
  ${info('تاريخ الفحص', d.order.examDate)}
  ${info('اعتماد التقرير', d.order.approvedAt || (d.draft ? 'لم يعتمد بعد' : ''))}
  ${info('رقم Accession', d.order.accession, true)}
  ${info('الطبيب المحوِّل', d.order.referringDoctor)}
  ${info('تاريخ الطباعة', d.order.printedAt)}
</div>

<div class="exam"><span class="name">${esc(d.order.service)}</span><span class="mod">${esc(d.order.modality)}</span></div>
${d.report.critical ? '<div class="alert">نتيجة تستدعي متابعة طبية عاجلة — يرجى مراجعة الطبيب المعالج فوراً.</div>' : ''}
${section('دواعي الفحص', d.order.indication)}
${section('طريقة الفحص', d.report.technique)}
${section('المقارنة', d.report.comparison)}
${section('النتائج', d.report.findings)}
${section('الخلاصة', d.report.impression, 'impression')}
${section('التوصيات', d.report.recommendations)}
${
  d.images.length
    ? `<div class="imgs">${d.images.map((i) => `<figure><img src="${i.dataUrl}" alt="">${i.caption ? `<figcaption dir="auto">${esc(i.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`
    : ''
}
<div class="foot">
  <div class="sig">
    ${d.signatures.reportedBy ? `<div><span>طبيب الأشعة</span><b>${esc(d.signatures.reportedBy)}</b></div>` : ''}
    ${d.signatures.approvedBy ? `<div><span>الاعتماد</span><b>${esc(d.signatures.approvedBy)}</b></div>` : ''}
  </div>
  ${
    d.qrDataUrl
      ? `<div class="qr"><div><small>امسح الرمز للتحقق من صحة التقرير على ${esc(d.platformName)}. صفحة التحقق لا تعرض أي بيانات طبية.</small><code>${esc(d.verificationCode)}</code></div><img src="${d.qrDataUrl}" alt=""></div>`
      : ''
  }
</div>
<div class="disclaimer">التقرير يُفسَّر بمعرفة الطبيب المعالج في ضوء الحالة الإكلينيكية. صادر إلكترونياً من ${esc(d.center.name)} عبر منصة ${esc(d.platformName)}.</div>
</body></html>`;
}
