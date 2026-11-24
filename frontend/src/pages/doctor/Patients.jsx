import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Card, InputAdornment, Tab, Tabs, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { LabResultsHistory } from '../../components/lab/LabUi';
import { RadiologyReportsHistory } from '../../components/radiology/RadUi';
import { PrescriptionsHistory, RxWriterDialog } from '../../components/pharmacy/PhUi';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import MedicalRecordView from '../../components/MedicalRecordView';
import ChatButton from '../../components/ChatButton';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section, StatusChip, useDebounced } from '../../components/common';
import { ageFrom, fmtDateTime, fmtMoney, fmtShortDate } from '../../utils/format';
import { APPOINTMENT_STATUS, GENDER } from '../../utils/labels';

export function PatientsList({ base }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data, isLoading } = useQuery({
    queryKey: ['patients', search, page],
    queryFn: () => api.get(`/patients${qs({ search, page, pageSize: 20 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="المرضى" subtitle="المرضى الذين حجزوا معك. لا يمكنك الاطلاع على بيانات مريض لم يحجز معك." />
      <Card>
        <Box sx={{ p: 2 }}>
          <TextField placeholder="ابحث بالاسم أو الموبايل" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ maxWidth: 380 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} inputProps={{ 'aria-label': 'بحث' }} />
        </Box>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(p) => nav(`${base}/${p.id}`)}
          columns={[
            { key: 'fullName', label: 'الاسم', render: (p) => <b>{p.fullName}</b> },
            { key: 'phone', label: 'الموبايل', render: (p) => <span dir="ltr">{p.phone}</span> },
            { key: 'age', label: 'السن', render: (p) => (p.dateOfBirth ? `${ageFrom(p.dateOfBirth)} سنة` : '—') },
            { key: 'gender', label: 'النوع', render: (p) => GENDER[p.gender] || '—' },
            { key: 'completedVisits', label: 'زيارات مكتملة' },
            { key: 'lastVisit', label: 'آخر زيارة', render: (p) => fmtShortDate(p.lastVisit) },
            { key: 'nextVisit', label: 'الموعد القادم', render: (p) => (p.nextVisit ? fmtDateTime(p.nextVisit) : '—') },
          ]}
          empty={<EmptyState title="لا يوجد مرضى بعد" body="يظهر المرضى هنا بعد أول حجز معك." />}
        />
      </Card>
    </>
  );
}

export function PatientDetail({ base }) {
  const { id } = useParams();
  const [tab, setTab] = useState('visits');
  const [writer, setWriter] = useState(false);
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: p, isLoading, error } = useQuery({ queryKey: ['patients', id], queryFn: () => api.get(`/patients/${id}`).then((r) => r.data) });
  const { data: record, error: recErr } = useQuery({
    queryKey: ['patients', id, 'record'],
    queryFn: () => api.get(`/patients/${id}/medical-record`).then((r) => r.data),
    enabled: tab === 'record' && !!p?.canSeeMedicalRecord,
  });
  if (error) return <ErrorState error={error} />;
  if (isLoading) return <ListSkeleton />;
  return (
    <>
      <PageHeader actions={[
        can('prescriptions.write') && p.canSeeMedicalRecord && <Button key="rx" variant="contained" onClick={() => setWriter(true)}>كتابة روشتة</Button>,
        <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', patientId: p.id }} label="مراسلة المريض" />,
      ].filter(Boolean)} back={<Button component={RouterLink} to={base} size="small" sx={{ mb: 1 }}>→ كل المرضى</Button>} title={p.fullName} subtitle={[p.gender && GENDER[p.gender], p.dateOfBirth && `${ageFrom(p.dateOfBirth)} سنة`, p.city].filter(Boolean).join(' • ')} />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={12} md={4}>
          <Section title="التواصل">
            <Typography dir="ltr" sx={{ textAlign: 'right' }}>{p.phone}</Typography>
            {p.email && <Typography dir="ltr" sx={{ textAlign: 'right' }}>{p.email}</Typography>}
            {p.address && <Typography color="text.secondary">{[p.address, p.area, p.city].filter(Boolean).join('، ')}</Typography>}
          </Section>
        </Grid>
      </Grid>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="visits" label="الزيارات" />
        <Tab value="record" label="السجل الطبي" disabled={!p.canSeeMedicalRecord} />
        <Tab value="labs" label="نتائج التحاليل" disabled={!p.canSeeMedicalRecord} />
        <Tab value="radiology" label="تقارير الأشعة" disabled={!p.canSeeMedicalRecord} />
        <Tab value="prescriptions" label="الروشتات" disabled={!p.canSeeMedicalRecord} />
      </Tabs>
      {tab === 'prescriptions' && (
        <Card sx={{ p: 2 }}>
          <PrescriptionsHistory patientId={id} />
        </Card>
      )}
      {can('prescriptions.write') && (
        <RxWriterDialog
          open={writer}
          onClose={() => setWriter(false)}
          patient={{ id: p.id, fullName: p.fullName }}
          appointments={(p.appointments || []).filter((a) => ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)).slice(0, 10)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['prescriptions'] });
            setTab('prescriptions');
          }}
        />
      )}
      {tab === 'radiology' && (
        <Card sx={{ p: 2 }}>
          <RadiologyReportsHistory patientId={id} />
        </Card>
      )}
      {tab === 'labs' && (
        <Card sx={{ p: 2 }}>
          <LabResultsHistory patientId={id} />
        </Card>
      )}
      {tab === 'visits' && (
        <Card>
          <DataTable
            rows={p.appointments}
            columns={[
              { key: 'startAt', label: 'الموعد', render: (a) => fmtDateTime(a.startAt) },
              { key: 'code', label: 'رقم الحجز', render: (a) => <span dir="ltr">{a.code}</span> },
              { key: 'providerName', label: 'لدى' },
              { key: 'status', label: 'الحالة', render: (a) => <StatusChip value={a.status} map={APPOINTMENT_STATUS} /> },
              { key: 'finalPrice', label: 'السعر', render: (a) => fmtMoney(a.finalPrice) },
              { key: 'doctorNotes', label: 'ملاحظاتك', render: (a) => a.doctorNotes || '—' },
            ]}
          />
        </Card>
      )}
      {tab === 'record' && (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>يتم تسجيل كل اطلاع على السجل الطبي في سجل المراجعة.</Alert>
          {recErr ? <ErrorState error={recErr} /> : record ? <MedicalRecordView data={record} /> : <ListSkeleton />}
        </>
      )}
    </>
  );
}
