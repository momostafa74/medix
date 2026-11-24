import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Card, Chip, InputAdornment, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { useQueryClient } from '@tanstack/react-query';
import { MODALITY, useMyCenter, useRadOrders } from '../../api/radiology';
import { useRealtime } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { ErrorState, PageHeader, useDebounced } from '../../components/common';
import { RadStatusChip } from '../../components/radiology/RadUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { tokens } from '../../theme';

export const RAD_TABS = [
  { key: 'today', label: 'قائمة الانتظار', status: 'BOOKED,CHECKED_IN,EXAMINATION' },
  { key: 'reporting', label: 'التقارير', status: 'REPORTING' },
  { key: 'ready', label: 'جاهزة للتسليم', status: 'APPROVED' },
  { key: 'delivered', label: 'تم التسليم', status: 'DELIVERED' },
  { key: 'closed', label: 'ملغاة / لم يحضر', status: 'CANCELLED,NO_SHOW' },
  { key: 'all', label: 'الكل', status: '' },
];

export default function RadOrdersBoard() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tab = params.get('tab') || 'today';
  const [text, setText] = useState('');
  const [modality, setModality] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data: me } = useMyCenter();
  useRealtime('radiology:order', () => qc.invalidateQueries({ queryKey: ['radiology-orders'] }));
  const t = RAD_TABS.find((x) => x.key === tab) || RAD_TABS[0];
  const { data, isLoading, error, refetch } = useRadOrders('center', { status: t.status, search, modality, branchId, page, pageSize: 20, sortDir: tab === 'today' || tab === 'reporting' ? 'asc' : 'desc' });
  return (
    <>
      <PageHeader title="الحجوزات" subtitle="من الحضور حتى تسليم التقرير — ابحث بالكود أو رقم Accession أو اسم المريض أو الهاتف." />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setParams({ tab: v }); setPage(1); }} variant="scrollable" allowScrollButtonsMobile>
          {RAD_TABS.map((x) => <Tab key={x.key} value={x.key} label={x.label} />)}
        </Tabs>
      </Card>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" fullWidth placeholder="الكود، Accession، اسم المريض، الهاتف أو الخدمة" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField size="small" select label="الجهاز" value={modality} onChange={(e) => { setModality(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">الكل</MenuItem>
          {(me?.offeredModalities || Object.keys(MODALITY)).map((m) => <MenuItem key={m} value={m}>{MODALITY[m] || m}</MenuItem>)}
        </TextField>
        {me?.branches?.length > 1 && (
          <TextField size="small" select label="الفرع" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }} sx={{ minWidth: 170 }}>
            <MenuItem value="">كل الفروع</MenuItem>
            {me.branches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </TextField>
        )}
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(o) => nav(`/provider/bookings/${o.id}`)}
          columns={[
            { key: 'when', label: 'الموعد', render: (o) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmtDateTime(o.scheduledAt)}</Typography> },
            {
              key: 'patient',
              label: 'المريض',
              render: (o) => (
                <Box>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography sx={{ fontWeight: 600 }}>{o.patientName}</Typography>
                    {o.critical && <WarningAmberRounded sx={{ color: tokens.signal, fontSize: 18 }} titleAccess="عاجل" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" dir="ltr">{o.patientPhone}</Typography>
                </Box>
              ),
            },
            { key: 'service', label: 'الفحص', render: (o) => <Box><Typography variant="body2">{o.serviceName}</Typography><Typography variant="caption" color="text.secondary">{MODALITY[o.modality]} • {o.branchName}</Typography></Box> },
            { key: 'acc', label: 'Accession', render: (o) => <Typography variant="body2" dir="ltr" sx={{ fontFamily: 'monospace' }}>{o.accessionNumber || '—'}</Typography> },
            { key: 'price', label: 'المبلغ', render: (o) => <Typography variant="body2" color={o.paymentStatus === 'PAID' ? 'success.main' : 'text.primary'}>{fmtMoney(o.price)}</Typography> },
            { key: 'status', label: 'الحالة', render: (o) => <Stack direction="row" spacing={0.5}><RadStatusChip value={o.status} />{o.status === 'REPORTING' && o.reportSubmitted && <Chip size="small" color="secondary" variant="outlined" label="بانتظار الاعتماد" />}</Stack> },
          ]}
        />
      </Card>
    </>
  );
}
