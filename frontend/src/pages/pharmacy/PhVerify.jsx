import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, Dialog, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import QrCodeScanner from '@mui/icons-material/QrCodeScanner';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import { useSnackbar } from 'notistack';
import { api, errorCode, errorMessage } from '../../api/client';
import { PageHeader, Section, useConfirm } from '../../components/common';
import { RxSheet } from '../../components/pharmacy/PhUi';
import { GENDER } from '../../utils/labels';
import { tokens } from '../../theme';

/** QR text is the public verify URL (…/verify/<code>) — keep the code only. */
const codeFrom = (raw) => {
  const t = String(raw || '').trim();
  const m = t.match(/\/verify\/([A-Za-z0-9_-]{8,64})/);
  return m ? m[1] : t;
};

/** Camera scanner using the browser's BarcodeDetector (Chrome / Edge / Android). */
function Scanner({ open, onClose, onCode }) {
  const video = useRef(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let stream;
    let timer;
    let stopped = false;
    (async () => {
      try {
        if (!('BarcodeDetector' in window)) throw new Error('unsupported');
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              cb.current(codeFrom(codes[0].rawValue));
              return;
            }
          } catch {
            /* keep scanning */
          }
          timer = setTimeout(tick, 300);
        };
        tick();
      } catch (e) {
        setErr(e.message === 'unsupported' ? 'المتصفح لا يدعم قراءة QR بالكاميرا — اكتب الكود المطبوع أسفل الرمز.' : 'تعذر فتح الكاميرا. اسمح بالوصول للكاميرا أو اكتب الكود يدوياً.');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>امسح رمز QR على الروشتة</DialogTitle>
      <DialogContent>
        {err ? <Alert severity="info">{err}</Alert> : <Box component="video" ref={video} muted playsInline sx={{ width: '100%', borderRadius: '12px', bgcolor: '#000' }} />}
      </DialogContent>
    </Dialog>
  );
}

export default function PhVerify() {
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [needPhone, setNeedPhone] = useState(false);
  const [rx, setRx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const lookup = async (c = code) => {
    const value = codeFrom(c);
    if (!value) return;
    setBusy(true);
    setRx(null);
    try {
      const { data } = await api.post('/pharmacy-prescriptions/lookup', { code: value, phone: phone || undefined });
      setRx({ ...data, lookupCode: value, lookupPhone: phone || undefined });
      setNeedPhone(false);
    } catch (e) {
      if (errorCode(e) === 'PHONE_REQUIRED') setNeedPhone(true);
      enqueueSnackbar(errorMessage(e), { variant: errorCode(e) === 'PHONE_REQUIRED' ? 'info' : 'error' });
    } finally {
      setBusy(false);
    }
  };
  const dispense = async () => {
    if (!(await confirm({ title: 'تسجيل صرف الروشتة', body: 'بعد التسجيل لن يمكن صرفها مرة أخرى من أي صيدلية، ويصل للمريض إشعار.', confirmText: 'تم الصرف' }))) return;
    setBusy(true);
    try {
      const { data } = await api.post('/pharmacy-prescriptions/dispense', { code: rx.lookupCode, phone: rx.lookupPhone });
      setRx({ ...data, lookupCode: rx.lookupCode, lookupPhone: rx.lookupPhone });
      enqueueSnackbar('تم تسجيل صرف الروشتة', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      lookup(rx.lookupCode);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="التحقق من روشتة" subtitle="امسح رمز QR أو اكتب الكود لتتأكد أن الروشتة صحيحة وسارية ولم تُصرف قبل ذلك." />
      <Grid container spacing={2}>
        <Grid xs={12} md={4}>
          <Section title="الروشتة">
            <Stack spacing={1.5} component="form" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
              <Button variant="outlined" startIcon={<QrCodeScanner />} onClick={() => setScan(true)}>مسح QR بالكاميرا</Button>
              <TextField label="كود التحقق أو رقم الروشتة" value={code} onChange={(e) => { setCode(e.target.value); setNeedPhone(false); }} inputProps={{ dir: 'ltr' }} helperText="الكود المطبوع أسفل الـ QR، أو الرقم RX-…" />
              {(needPhone || /^rx-/i.test(code.trim())) && <TextField label="موبايل المريض" value={phone} onChange={(e) => setPhone(e.target.value)} inputProps={{ dir: 'ltr' }} helperText="مطلوب عند البحث برقم الروشتة" />}
              <Button type="submit" variant="contained" disabled={busy || code.trim().length < 6}>تحقق</Button>
            </Stack>
          </Section>
          <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: tokens.mint }}>
            <Typography variant="body2">كل عملية تحقق وصرف تُسجَّل باسمك في سجل المراجعة. الروشتات المرتبطة بطلب على المنصة تُسجَّل «تم صرفها» تلقائياً عند تسليم الطلب.</Typography>
          </Box>
        </Grid>
        <Grid xs={12} md={8}>
          {rx ? (
            <Stack spacing={2}>
              <Card sx={{ p: 2, borderColor: rx.state === 'ACTIVE' ? tokens.success : tokens.signal, borderWidth: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <VerifiedOutlined sx={{ fontSize: 40, color: rx.state === 'ACTIVE' ? tokens.success : tokens.signal }} />
                    <Box>
                      <Typography variant="h6">{rx.state === 'ACTIVE' ? 'روشتة صحيحة وسارية' : `روشتة صحيحة — ${rx.stateLabel}`}</Typography>
                      <Typography variant="body2" color="text.secondary">{rx.patient.fullName} • {GENDER[rx.patient.gender] || ''} {rx.patient.ageYears != null ? `• ${rx.patient.ageYears} سنة` : ''}</Typography>
                      <Typography variant="body2" color="text.secondary">د. {rx.doctor.fullName}{rx.doctor.licenseNumber ? ` • ترخيص ${rx.doctor.licenseNumber}` : ''}</Typography>
                    </Box>
                  </Stack>
                  {rx.can.dispense && <Button variant="contained" color="success" size="large" disabled={busy} onClick={dispense}>تسجيل الصرف</Button>}
                </Stack>
              </Card>
              <RxSheet rx={rx} />
            </Stack>
          ) : (
            <Card sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              <QrCodeScanner sx={{ fontSize: 56 }} />
              <Typography>امسح رمز الروشتة أو اكتب الكود لعرضها.</Typography>
            </Card>
          )}
        </Grid>
      </Grid>
      <Scanner open={scan} onClose={() => setScan(false)} onCode={(c) => { setScan(false); setCode(c); lookup(c); }} />
    </>
  );
}
