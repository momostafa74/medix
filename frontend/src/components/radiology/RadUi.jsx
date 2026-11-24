import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, ButtonBase, Chip, Dialog, IconButton, Skeleton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { api } from '../../api/client';
import { RAD_STAGES, RAD_STATUS } from '../../api/radiology';
import { StatusChip } from '../common';
import { fmtDateTime } from '../../utils/format';
import { tokens } from '../../theme';

export const RadStatusChip = ({ value, size }) => <StatusChip value={value} map={RAD_STATUS} size={size} />;

export function RadTrack({ status }) {
  if (['CANCELLED', 'NO_SHOW'].includes(status)) return null;
  const idx = RAD_STAGES.findIndex((s) => s.statuses.includes(status));
  return (
    <Stack direction="row" sx={{ my: 1 }}>
      {RAD_STAGES.map((s, i) => (
        <Box key={s.label} sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ height: 6, borderRadius: 3, mx: 0.25, bgcolor: i <= idx ? (i === idx && idx < 3 ? tokens.saffron : tokens.petrol) : tokens.line }} />
          <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5, textAlign: 'center', fontWeight: i === idx ? 700 : 400, color: i <= idx ? tokens.ink : 'text.secondary' }}>
            {s.label}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

const Para = ({ text }) =>
  text ? (
    <Typography component="div" dir="auto" sx={{ whiteSpace: 'pre-line', lineHeight: 1.8 }}>
      {text}
    </Typography>
  ) : null;

/** The radiologist's report as the patient / doctor reads it. */
export function ReportView({ report, indication }) {
  const block = (title, text, highlight) =>
    text ? (
      <Box sx={highlight ? { p: 1.5, borderRadius: '10px', bgcolor: tokens.mint, borderInlineStart: `4px solid ${tokens.petrol}` } : undefined}>
        <Typography variant="subtitle2" sx={{ color: tokens.petrol, fontWeight: 700, mb: 0.25 }}>{title}</Typography>
        <Para text={text} />
      </Box>
    ) : null;
  return (
    <Stack spacing={1.75}>
      {report.critical && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#FBEDEA', color: tokens.signal, border: `1px solid ${tokens.signal}` }}>
          <WarningAmberRounded />
          <Typography sx={{ fontWeight: 600 }}>نتيجة تستدعي متابعة طبية عاجلة — يرجى مراجعة الطبيب فوراً.</Typography>
        </Stack>
      )}
      {block('دواعي الفحص', indication)}
      {block('طريقة الفحص', report.technique)}
      {block('المقارنة', report.comparison)}
      {block('النتائج', report.findings)}
      {block('الخلاصة', report.impression, true)}
      {block('التوصيات', report.recommendations)}
    </Stack>
  );
}

/** Private image fetched with the bearer token; shown as a thumbnail that opens full size. */
function Thumb({ fileId, mimeType, caption, onOpen, onRemove }) {
  const [url, setUrl] = useState(null);
  const isImage = mimeType?.startsWith('image/');
  useEffect(() => {
    let href;
    let alive = true;
    api.get(`/files/${fileId}`, { responseType: 'blob' }).then((r) => {
      href = URL.createObjectURL(r.data);
      if (alive) setUrl(href);
    }).catch(() => {});
    return () => {
      alive = false;
      if (href) URL.revokeObjectURL(href);
    };
  }, [fileId]);
  return (
    <Box sx={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${tokens.line}`, bgcolor: '#0b1215' }}>
      <ButtonBase onClick={() => url && (isImage ? onOpen(url, caption) : window.open(url, '_blank', 'noopener'))} sx={{ display: 'block', width: '100%' }} aria-label={caption || 'صورة'}>
        {!url ? (
          <Skeleton variant="rectangular" height={120} />
        ) : isImage ? (
          <Box component="img" src={url} alt={caption || ''} sx={{ width: '100%', height: 120, objectFit: 'contain', display: 'block' }} />
        ) : (
          <Stack alignItems="center" justifyContent="center" sx={{ height: 120, color: '#fff' }}><PictureAsPdfOutlined sx={{ fontSize: 40 }} /><Typography variant="caption">PDF</Typography></Stack>
        )}
      </ButtonBase>
      {caption && <Typography variant="caption" noWrap dir="auto" sx={{ display: 'block', px: 1, py: 0.5, bgcolor: '#fff' }}>{caption}</Typography>}
      {onRemove && (
        <IconButton size="small" onClick={onRemove} aria-label="حذف" sx={{ position: 'absolute', top: 4, insetInlineStart: 4, bgcolor: 'rgba(255,255,255,.85)', '&:hover': { bgcolor: '#fff' } }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}

export function ImageGallery({ images, onRemove }) {
  const [open, setOpen] = useState(null);
  if (!images?.length) return null;
  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1 }}>
        {images.map((i) => (
          <Thumb key={i.id} fileId={i.fileId} mimeType={i.mimeType} caption={i.caption} onOpen={(url, caption) => setOpen({ url, caption })} onRemove={onRemove ? () => onRemove(i) : undefined} />
        ))}
      </Box>
      <Dialog open={!!open} onClose={() => setOpen(null)} maxWidth="lg" PaperProps={{ sx: { bgcolor: '#000' } }}>
        {open && <Box component="img" src={open.url} alt={open.caption || ''} sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }} />}
        {open?.caption && <Typography sx={{ color: '#fff', p: 1 }} dir="auto">{open.caption}</Typography>}
      </Dialog>
    </>
  );
}

/** Approved radiology reports of a patient (medical record for the patient and treating providers). */
export function RadiologyReportsHistory({ patientId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['radiology-history', patientId],
    queryFn: () => api.get(`/patients/${patientId}/radiology-reports`).then((r) => r.data),
    enabled: !!patientId,
  });
  const [open, setOpen] = useState(null);
  if (error) return <Typography color="text.secondary">{error.response?.status === 403 ? 'لا تملك صلاحية عرض تقارير الأشعة.' : 'تعذر تحميل تقارير الأشعة.'}</Typography>;
  if (isLoading) return <Skeleton variant="rounded" height={100} />;
  if (!data.length) return <Typography color="text.secondary">لا توجد تقارير أشعة معتمدة.</Typography>;
  return (
    <Stack spacing={1}>
      {data.map((r) => {
        const isOpen = open === r.orderId;
        return (
          <Box key={r.orderId} sx={{ borderRadius: '10px', border: `1px solid ${r.critical ? tokens.signal : tokens.line}` }}>
            <ButtonBase onClick={() => setOpen(isOpen ? null : r.orderId)} sx={{ width: '100%', p: 1.5, justifyContent: 'space-between', textAlign: 'right' }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{r.serviceName}</Typography>
                <Typography variant="caption" color="text.secondary">{r.center.nameAr} • {fmtDateTime(r.examDate)}</Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {r.critical && <Chip size="small" label="عاجل" sx={{ bgcolor: tokens.signal, color: '#fff' }} />}
                <Chip size="small" variant="outlined" label={r.modalityLabel} />
              </Stack>
            </ButtonBase>
            {isOpen && (
              <Box sx={{ px: 2, pb: 2 }}>
                <ReportView report={r} />
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
