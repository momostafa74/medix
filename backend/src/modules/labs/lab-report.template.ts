import { esc } from '../pdf/pdf.service';
import { FLAG_AR } from './lab-logic';

export interface ReportData {
  fontCss: string;
  draft: boolean;
  platformName: string;
  lab: { name: string; nameEn?: string | null; accreditation?: string | null; phone?: string | null; address?: string | null; logoDataUrl?: string | null };
  patient: { name: string; gender?: string | null; age?: number | null; phone?: string | null };
  order: { code: string; scheduledAt?: string | null; collectedAt?: string | null; receivedAt?: string | null; approvedAt?: string | null; printedAt: string; home: boolean };
  groups: {
    title: string;
    code: string;
    packageName?: string | null;
    rows: { name: string; value: string; unit?: string | null; ref?: string | null; flag: string; notes?: string | null }[];
  }[];
  notes?: string | null;
  signatures: { enteredBy?: string | null; reviewedBy?: string | null; approvedBy?: string | null };
  qrDataUrl?: string | null;
  verifyUrl?: string | null;
  verificationCode?: string | null;
}

const C = { petrol: '#0F4C5C', ink: '#13252B', mint: '#E7F3EF', paper: '#F6F8F8', saffron: '#E9A23B', signal: '#C8432B', line: '#D9E2E2', muted: '#5B6B70' };

const flagCell = (flag: string) => {
  if (flag === 'NORMAL') return `<span class="flag ok">${FLAG_AR.NORMAL}</span>`;
  const arrow = flag === 'HIGH' ? '▲' : flag === 'LOW' ? '▼' : '!';
  return `<span class="flag ${flag.toLowerCase()}">${arrow} ${esc(FLAG_AR[flag as keyof typeof FLAG_AR] ?? flag)}</span>`;
};

/** Self-contained A4 lab report (RTL Arabic, embedded fonts, no external assets). */
export function labReportHtml(d: ReportData): string {
  const info = (label: string, value: unknown, ltr = false) =>
    value ? `<div class="kv"><span>${esc(label)}</span><b${ltr ? ' dir="ltr"' : ''}>${esc(value)}</b></div>` : '';
  const critical = d.groups.some((g) => g.rows.some((r) => r.flag === 'CRITICAL'));
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(d.order.code)}</title>
<style>
${d.fontCss}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Plex Arabic','Noto Naskh Arabic','DejaVu Sans',sans-serif;color:${C.ink};font-size:11.5px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:3px solid ${C.petrol}}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:58px;height:58px;border-radius:12px;background:${C.mint};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:26px;color:${C.petrol};overflow:hidden}
.logo img{width:100%;height:100%;object-fit:cover}
.lab h1{margin:0;font-size:19px;font-weight:700;color:${C.petrol}}
.lab .en{font-size:11px;color:${C.muted}}
.lab .sub{font-size:10.5px;color:${C.muted}}
.doc{text-align:left}
.doc .t{font-size:15px;font-weight:700;letter-spacing:.2px}
.doc .code{font-size:11px;color:${C.muted}}
.acc{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:20px;background:${C.mint};color:${C.petrol};font-size:10px;font-weight:600}
.panel{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 18px;background:${C.paper};border:1px solid ${C.line};border-radius:10px;padding:10px 14px;margin:12px 0}
.kv{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed ${C.line};padding:2px 0}
.kv span{color:${C.muted}}
.kv b{font-weight:600}
.alert{border:1.5px solid ${C.signal};background:#FBEDEA;color:${C.signal};border-radius:8px;padding:6px 12px;margin:0 0 10px;font-weight:600}
.group{margin-top:12px;break-inside:avoid}
.group h2{font-size:13px;margin:0 0 4px;color:${C.petrol};display:flex;gap:8px;align-items:baseline}
.group h2 small{font-weight:400;color:${C.muted};font-size:10.5px}
table{width:100%;border-collapse:collapse}
th{background:${C.petrol};color:#fff;font-weight:600;font-size:10.5px;text-align:right;padding:5px 8px}
th:first-child{border-radius:0 6px 0 0} th:last-child{border-radius:6px 0 0 0}
td{padding:5px 8px;border-bottom:1px solid ${C.line};vertical-align:top}
tr.abn td{background:#FFF8EC}
tr.crit td{background:#FBEDEA}
td.val{font-weight:700;direction:ltr;text-align:right;font-size:12px}
td.ref,td.unit{direction:ltr;text-align:right;color:${C.muted}}
td.param{font-weight:600}
td .note{display:block;font-weight:400;color:${C.muted};font-size:10px}
.flag{display:inline-block;padding:0 7px;border-radius:12px;font-size:10px;font-weight:600;white-space:nowrap}
.flag.ok{color:${C.petrol};background:${C.mint}}
.flag.high,.flag.low{color:#8A5A00;background:#FCEFD6}
.flag.critical{color:#fff;background:${C.signal}}
.notes{margin-top:12px;border-right:3px solid ${C.saffron};background:${C.paper};padding:6px 12px;border-radius:4px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:18px;padding-top:12px;border-top:1px solid ${C.line};break-inside:avoid}
.sig{display:grid;grid-template-columns:repeat(3,auto);gap:4px 28px}
.sig div span{display:block;color:${C.muted};font-size:10px}
.sig div b{font-weight:600}
.qr{display:flex;align-items:center;gap:10px;text-align:left}
.qr img{width:86px;height:86px}
.qr small{display:block;color:${C.muted};font-size:9.5px;max-width:190px;line-height:1.4}
.qr code{direction:ltr;font-family:inherit;font-size:9.5px;color:${C.ink}}
.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9}
.wm span{transform:rotate(-30deg);font-size:110px;font-weight:700;color:rgba(200,67,43,.12);letter-spacing:8px}
.disclaimer{margin-top:10px;color:${C.muted};font-size:9.5px}
</style></head><body>
${d.draft ? '<div class="wm"><span>مسودة</span></div>' : ''}
<div class="head">
  <div class="brand">
    <div class="logo">${d.lab.logoDataUrl ? `<img src="${d.lab.logoDataUrl}" alt="">` : esc(d.lab.name.charAt(0))}</div>
    <div class="lab">
      <h1>${esc(d.lab.name)}</h1>
      ${d.lab.nameEn ? `<div class="en" dir="ltr">${esc(d.lab.nameEn)}</div>` : ''}
      <div class="sub">${esc(d.lab.address || '')}${d.lab.address && d.lab.phone ? ' · ' : ''}${d.lab.phone ? `<span dir="ltr">${esc(d.lab.phone)}</span>` : ''}</div>
      ${d.lab.accreditation ? `<span class="acc">${esc(d.lab.accreditation)}</span>` : ''}
    </div>
  </div>
  <div class="doc">
    <div class="t">تقرير نتائج التحاليل</div>
    <div class="code" dir="ltr">${esc(d.order.code)}</div>
  </div>
</div>

<div class="panel">
  ${info('اسم المريض', d.patient.name)}
  ${info('النوع', d.patient.gender === 'MALE' ? 'ذكر' : d.patient.gender === 'FEMALE' ? 'أنثى' : '')}
  ${info('السن', d.patient.age != null ? `${d.patient.age} سنة` : '')}
  ${info('رقم الطلب', d.order.code, true)}
  ${info('نوع السحب', d.order.home ? 'سحب منزلي' : 'بالفرع')}
  ${info('سحب العينة', d.order.collectedAt)}
  ${info('استلام المعمل', d.order.receivedAt)}
  ${info('اعتماد النتيجة', d.order.approvedAt || (d.draft ? 'لم تعتمد بعد' : ''))}
  ${info('تاريخ الطباعة', d.order.printedAt)}
</div>

${critical ? '<div class="alert">تحتوي هذه النتائج على قيم حرجة — يرجى مراجعة الطبيب المعالج فوراً.</div>' : ''}

${d.groups
  .map(
    (g) => `<section class="group">
  <h2>${esc(g.title)} <small dir="ltr">${esc(g.code)}</small>${g.packageName ? `<small>· ضمن ${esc(g.packageName)}</small>` : ''}</h2>
  <table>
    <thead><tr><th style="width:30%">البند</th><th style="width:16%">النتيجة</th><th style="width:12%">الوحدة</th><th style="width:22%">المعدل الطبيعي</th><th style="width:20%">الحالة</th></tr></thead>
    <tbody>
    ${g.rows
      .map(
        (r) => `<tr class="${r.flag === 'CRITICAL' ? 'crit' : r.flag !== 'NORMAL' ? 'abn' : ''}">
        <td class="param" dir="auto">${esc(r.name)}${r.notes ? `<span class="note">${esc(r.notes)}</span>` : ''}</td>
        <td class="val">${esc(r.value)}</td>
        <td class="unit">${esc(r.unit || '')}</td>
        <td class="ref">${esc(r.ref || '—')}</td>
        <td>${flagCell(r.flag)}</td>
      </tr>`,
      )
      .join('')}
    </tbody>
  </table>
</section>`,
  )
  .join('')}

${d.notes ? `<div class="notes"><b>ملاحظات المعمل:</b> ${esc(d.notes)}</div>` : ''}

<div class="foot">
  <div class="sig">
    ${d.signatures.enteredBy ? `<div><span>إدخال النتائج</span><b>${esc(d.signatures.enteredBy)}</b></div>` : ''}
    ${d.signatures.reviewedBy ? `<div><span>المراجعة</span><b>${esc(d.signatures.reviewedBy)}</b></div>` : ''}
    ${d.signatures.approvedBy ? `<div><span>الاعتماد</span><b>${esc(d.signatures.approvedBy)}</b></div>` : ''}
  </div>
  ${
    d.qrDataUrl
      ? `<div class="qr"><div><small>امسح الرمز للتحقق من صحة التقرير على ${esc(d.platformName)}. صفحة التحقق لا تعرض أي بيانات طبية.</small><code>${esc(d.verificationCode)}</code></div><img src="${d.qrDataUrl}" alt=""></div>`
      : ''
  }
</div>
<div class="disclaimer">النتائج تُفسَّر بمعرفة الطبيب المعالج في ضوء الحالة الإكلينيكية. تقرير صادر إلكترونياً من ${esc(d.lab.name)} عبر منصة ${esc(d.platformName)}.</div>
</body></html>`;
}

export const reportFooter = (code: string) =>
  `<div style="width:100%;font-size:8px;color:#5B6B70;padding:0 12mm;display:flex;justify-content:space-between;font-family:sans-serif" dir="ltr"><span>${esc(code)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
