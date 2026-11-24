import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Autocomplete, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import AddIcon from '@mui/icons-material/Add';
import ArrowForward from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { downloadRx, usePrescription, usePrescriptions } from '../../api/pharmacy';
import DataTable from '../../components/DataTable';
import ReasonDialog from '../../components/lab/ReasonDialog';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section, useDebounced } from '../../components/common';
import { PhStatusChip, RxSheet, RxStateChip, RxWriterDialog } from '../../components/pharmacy/PhUi';
import { fmtDateTime, fmtShortDate } from '../../utils/format';

/** Pick one of the doctor's patients, then open the writer. */
function NewRxFlow({ open, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [patient, setPatient] = useState(null);
  const [writer, setWriter] = useState(false);
  const search = useDebounced(text);
  const { data } = useQuery({ queryKey: ['patients', 'pick', search], queryFn: () => api.get(`/patients${qs({ search, pageSize: 15 })}`).then((r) => r.data.items), enabled: open });
  const { data: detail } = useQuery({ queryKey: ['patients', patient?.id], queryFn: () => api.get(`/patients/${patient.id}`).then((r) => r.data), enabled: !!patient });
  const appts = (detail?.appointments || []).filter((a) => ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)).slice(0, 10);
  return (
    <>
      <Dialog open={open && !writer} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>روشتة جديدة</DialogTitle>
        <DialogContent>
          <Autocomplete
            sx={{ mt: 1 }}
            options={data || []}
            value={patient}
            onChange={(_, v) => setPatient(v)}
            onInputChange={(_, v) => setText(v)}
            filterOptions={(x) => x}
            getOptionLabel={(p) => p.fullName}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={(props, p) => (
              <li {...props} key={p.id}>
                <Box>
                  <Typography>{p.fullName}</Typography>
                  <Typography variant="caption" color="text.secondary" dir="ltr">{p.phone}</Typography>
                </Box>
              </li>
            )}
            noOptionsText="لا يوجد مرضى مطابقون — تظهر هنا المرضى الذين حجزوا معك"
            renderInput={(p) => <TextField {...p} label="المريض" autoFocus />}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="contained" disabled={!patient || !detail} onClick={() => setWriter(true)}>متابعة</Button>
        </DialogActions>
      </Dialog>
      {patient && detail && (
        <RxWriterDialog
          open={open && writer}
          patient={patient}
          appointments={appts}
          onClose={() => {
            setWriter(false);
            setPatient(null);
            onClose();
          }}
          onCreated={onCreated}
        />
      )}
    </>
  );
}

export function DoctorPrescriptions() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = usePrescriptions('doctor', { search, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="الروشتات" subtitle="روشتات إلكترونية برمز QR تصل للمريض فوراً ويمكن صرفها من أي صيدلية على المنصة مرة واحدة." actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>روشتة جديدة</Button>} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <Box sx={{ p: 2 }}>
          <TextField size="small" placeholder="ابحث بالمريض أو الدواء أو التشخيص أو رقم الروشتة" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ maxWidth: 460, width: '100%' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        </Box>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(r) => nav(`/doctor/prescriptions/${r.id}`)}
          columns={[
            { key: 'issuedAt', label: 'التاريخ', render: (r) => fmtShortDate(r.issuedAt) },
            { key: 'patientName', label: 'المريض', render: (r) => <b>{r.patientName}</b> },
            { key: 'diagnosis', label: 'التشخيص', render: (r) => r.diagnosis || '—' },
            { key: 'medicines', label: 'الأدوية', render: (r) => <Typography variant="body2" dir="auto" sx={{ maxWidth: 320 }} noWrap>{r.medicines.join('، ')}</Typography> },
            { key: 'code', label: 'الرقم', render: (r) => <span dir="ltr">{r.code}</span> },
            { key: 'state', label: 'الحالة', render: (r) => <RxStateChip value={r.state} /> },
          ]}
          empty={<EmptyState title="لم تكتب روشتات بعد" body="اكتب روشتة من هنا أو من صفحة المريض." />}
        />
      </Card>
      <NewRxFlow open={open} onClose={() => setOpen(false)} onCreated={(rx) => { qc.invalidateQueries({ queryKey: ['prescriptions'] }); nav(`/doctor/prescriptions/${rx.id}`); }} />
    </>
  );
}

export function DoctorPrescriptionDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: rx, isLoading, error, refetch } = usePrescription(id);
  const [revoke, setRevoke] = useState(false);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={140} />;
  return (
    <>
      <Button component={RouterLink} to="/doctor/prescriptions" startIcon={<ArrowForward />} sx={{ mb: 1 }}>كل الروشتات</Button>
      <PageHeader
        title={rx.patient.fullName}
        subtitle={`${rx.diagnosis || 'روشتة'} • ${fmtShortDate(rx.issuedAt)}`}
        actions={[
          <Button key="pdf" variant="outlined" startIcon={<PictureAsPdfOutlined />} onClick={() => downloadRx(rx).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>PDF</Button>,
          <Button key="p" component={RouterLink} to={`/doctor/patients/${rx.patient.id}`}>ملف المريض</Button>,
          rx.can.revoke && <Button key="r" color="error" onClick={() => setRevoke(true)}>إلغاء الروشتة</Button>,
        ].filter(Boolean)}
      />
      <Grid container spacing={2}>
        <Grid xs={12} md={8}><RxSheet rx={rx} /></Grid>
        <Grid xs={12} md={4}>
          <Section title="الصرف">
            {rx.dispensedAt ? (
              <Stack spacing={1}>
                <Typography>صُرفت من <b>{rx.dispensedBy?.nameAr}</b></Typography>
                <Typography variant="body2" color="text.secondary">{fmtDateTime(rx.dispensedAt)}</Typography>
                {rx.orders?.map((o) => <Stack key={o.id} direction="row" justifyContent="space-between"><Typography variant="body2" dir="ltr">{o.code}</Typography><PhStatusChip value={o.status} /></Stack>)}
              </Stack>
            ) : <Typography color="text.secondary">لم تُصرف بعد. يمكن إلغاؤها قبل الصرف، ويصل للمريض وللصيدلية إشعار فوري.</Typography>}
          </Section>
        </Grid>
      </Grid>
      <ReasonDialog open={revoke} title="إلغاء الروشتة" body="لن تتمكن أي صيدلية من صرفها بعد الإلغاء." label="السبب (يظهر للمريض)" required confirmText="إلغاء الروشتة" danger onClose={() => setRevoke(false)}
        onSubmit={async (reason) => {
          try {
            await api.post(`/prescriptions/${id}/revoke`, { reason });
            enqueueSnackbar('تم إلغاء الروشتة', { variant: 'success' });
            qc.invalidateQueries({ queryKey: ['prescriptions'] });
          } catch (e) {
            enqueueSnackbar(errorMessage(e), { variant: 'error' });
            throw e;
          }
        }}
      />
    </>
  );
}
