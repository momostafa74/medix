import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Box, Button, Card, Container, Skeleton, Stack, TextField, Typography } from '@mui/material';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import GppBadOutlined from '@mui/icons-material/GppBadOutlined';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ErrorState } from '../../components/common';
import { fmtDateTime, fmtShortDate } from '../../utils/format';
import { tokens } from '../../theme';

const TYPES = { LAB_REPORT: 'تقرير نتائج تحاليل', RADIOLOGY_REPORT: 'تقرير أشعة', PRESCRIPTION: 'روشتة إلكترونية' };
const RX_STATE_COLOR = { ACTIVE: tokens.success, DISPENSED: tokens.petrol, REVOKED: tokens.signal, EXPIRED: tokens.saffron };

/** Public QR landing page: confirms a document is authentic, never shows medical data. */
export default function Verify() {
  const { code } = useParams();
  const nav = useNavigate();
  const [input, setInput] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['verify', code], queryFn: () => api.get(`/verify/${encodeURIComponent(code)}`).then((r) => r.data), enabled: !!code });
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 2 }}>التحقق من مستند</Typography>
      {!code && (
        <Card sx={{ p: 3 }}>
          <Typography sx={{ mb: 2 }}>امسح رمز QR الموجود على التقرير أو الروشتة، أو اكتب كود التحقق المطبوع أسفله.</Typography>
          <Stack direction="row" spacing={1} component="form" onSubmit={(e) => { e.preventDefault(); if (input.trim()) nav(`/verify/${input.trim()}`); }}>
            <TextField fullWidth size="small" label="كود التحقق" value={input} onChange={(e) => setInput(e.target.value)} inputProps={{ dir: 'ltr' }} />
            <Button type="submit" variant="contained">تحقق</Button>
          </Stack>
        </Card>
      )}
      {code && error && <ErrorState error={error} onRetry={refetch} />}
      {code && isLoading && <Skeleton variant="rounded" height={220} />}
      {code && data && (
        <Card sx={{ p: 3, borderColor: data.valid ? tokens.success : tokens.signal, borderWidth: 2 }}>
          {data.valid ? (
            <>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ color: tokens.success, mb: 2 }}>
                <VerifiedOutlined sx={{ fontSize: 44 }} />
                <Box>
                  <Typography variant="h5" sx={{ color: 'inherit' }}>مستند صحيح وموثّق</Typography>
                  <Typography color="text.secondary">صادر ومعتمد عبر المنصة</Typography>
                </Box>
              </Stack>
              <Stack spacing={1}>
                {(data.type === 'PRESCRIPTION'
                  ? [
                      ['نوع المستند', TYPES.PRESCRIPTION],
                      ['رقم الروشتة', data.documentNumber],
                      ['الطبيب', `د. ${String(data.issuer.name || '').replace(/^د\.\s*/, '')}`],
                      ['تاريخ الإصدار', fmtDateTime(data.approvedAt)],
                      ['صالحة حتى', data.validUntil ? fmtShortDate(data.validUntil) : '—'],
                      ['المريض', data.patientInitials],
                      ['الحالة', <span key="s" style={{ color: RX_STATE_COLOR[data.state] }}>{data.stateLabel}{data.dispensedAt ? ` (${fmtShortDate(data.dispensedAt)})` : ''}</span>],
                    ]
                  : [
                      ['نوع المستند', TYPES[data.type] || data.type],
                      ['رقم المستند', data.documentNumber],
                      ['جهة الإصدار', data.issuer.name],
                      ['تاريخ الاعتماد', fmtDateTime(data.approvedAt)],
                      ['المريض', data.patientInitials],
                      data.testsCount != null ? ['عدد التحاليل', data.testsCount] : ['نوع الفحص', data.examType],
                    ]
                ).map(([k, v]) => (
                  <Stack key={k} direction="row" justifyContent="space-between" sx={{ borderBottom: `1px dashed ${tokens.line}`, pb: 0.75 }}>
                    <Typography color="text.secondary">{k}</Typography>
                    <Typography sx={{ fontWeight: 600 }} dir={k === 'رقم المستند' || k === 'رقم الروشتة' ? 'ltr' : undefined}>{v}</Typography>
                  </Stack>
                ))}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {data.type === 'PRESCRIPTION'
                  ? 'لحماية خصوصية المريض لا تعرض هذه الصفحة الأدوية أو التشخيص. الصيدلي المسجل على المنصة يستطيع فتح الروشتة كاملة وتسجيل صرفها.'
                  : 'لحماية خصوصية المريض لا تعرض هذه الصفحة أي نتائج أو بيانات طبية. قارن رقم المستند والتاريخ بما هو مطبوع على التقرير.'}
              </Typography>
              <Button component={RouterLink} to={data.type === 'PRESCRIPTION' ? `/doctors/${data.issuer.slug}` : `/providers/${data.issuer.slug}`} sx={{ mt: 1 }}>{data.type === 'PRESCRIPTION' ? 'صفحة الطبيب' : 'صفحة جهة الإصدار'}</Button>
            </>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ color: tokens.signal }}>
              <GppBadOutlined sx={{ fontSize: 44 }} />
              <Box>
                <Typography variant="h5" sx={{ color: 'inherit' }}>لم نتمكن من التحقق من هذا المستند</Typography>
                <Typography color="text.secondary">الكود غير صحيح أو المستند لم يُعتمد. لا تعتمد على هذا التقرير وتواصل مع الجهة المصدرة.</Typography>
              </Box>
            </Stack>
          )}
        </Card>
      )}
    </Container>
  );
}
