import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Card, Chip, InputAdornment, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQueryClient } from '@tanstack/react-query';
import { FULFILLMENT, usePhOrders } from '../../api/pharmacy';
import { useRealtime } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { ErrorState, PageHeader, useDebounced } from '../../components/common';
import { PhStatusChip } from '../../components/pharmacy/PhUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';

const TABS = [
  { key: 'new', label: 'جديدة', status: 'PENDING' },
  { key: 'work', label: 'قيد التجهيز', status: 'CONFIRMED,PREPARING' },
  { key: 'ready', label: 'جاهزة', status: 'READY' },
  { key: 'out', label: 'في الطريق', status: 'OUT_FOR_DELIVERY' },
  { key: 'done', label: 'تم التسليم', status: 'DELIVERED' },
  { key: 'cancelled', label: 'ملغاة', status: 'CANCELLED' },
  { key: 'all', label: 'الكل', status: '' },
];

export default function PhOrdersBoard() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tab = params.get('tab') || 'new';
  const [text, setText] = useState('');
  const [fulfillment, setFulfillment] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  useRealtime('pharmacy:order', () => qc.invalidateQueries({ queryKey: ['pharmacy-orders'] }));
  const t = TABS.find((x) => x.key === tab) || TABS[0];
  const open = ['new', 'work', 'ready', 'out'].includes(tab);
  const { data, isLoading, error, refetch } = usePhOrders('pharmacy', { status: t.status, search, fulfillment, page, pageSize: 20, sortDir: open ? 'asc' : 'desc' });
  return (
    <>
      <PageHeader title="الطلبات" subtitle="أكّد الطلب وسعّر الروشتات، جهّزه ثم سلّمه — يتابع المريض كل خطوة لحظياً." />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setParams({ tab: v }); setPage(1); }} variant="scrollable" allowScrollButtonsMobile>
          {TABS.map((x) => <Tab key={x.key} value={x.key} label={x.label} />)}
        </Tabs>
      </Card>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" fullWidth placeholder="رقم الطلب، اسم المريض أو الهاتف" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField size="small" select label="الاستلام" value={fulfillment} onChange={(e) => { setFulfillment(e.target.value); setPage(1); }} sx={{ minWidth: 190 }}>
          <MenuItem value="">الكل</MenuItem>
          {Object.entries(FULFILLMENT).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
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
          onRowClick={(o) => nav(`/provider/pharmacy-orders/${o.id}`)}
          columns={[
            { key: 'createdAt', label: 'الوقت', render: (o) => <Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{fmtDateTime(o.createdAt)}</Typography><Typography variant="caption" color="text.secondary" dir="ltr">{o.code}</Typography></Box> },
            { key: 'patient', label: 'المريض', render: (o) => <Box><Typography sx={{ fontWeight: 600 }}>{o.patientName}</Typography><Typography variant="caption" color="text.secondary" dir="ltr">{o.patientPhone}</Typography></Box> },
            { key: 'items', label: 'الأصناف', render: (o) => <Box sx={{ maxWidth: 300 }}><Typography variant="body2" noWrap dir="auto">{o.summary || '—'}</Typography>{o.hasPrescription && <Chip size="small" variant="outlined" color={o.items ? 'default' : 'warning'} label={o.items ? 'مع روشتة' : 'تسعير روشتة'} sx={{ mt: 0.25 }} />}</Box> },
            { key: 'fulfillment', label: 'الاستلام', render: (o) => <Box><Typography variant="body2">{FULFILLMENT[o.fulfillment]}</Typography>{o.deliveryAddress && <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ maxWidth: 220 }}>{o.deliveryAddress}</Typography>}</Box> },
            { key: 'total', label: 'الإجمالي', render: (o) => <Typography variant="body2" color={o.paymentStatus === 'PAID' ? 'success.main' : 'text.primary'}>{o.items ? fmtMoney(o.total) : '—'}</Typography> },
            { key: 'status', label: 'الحالة', render: (o) => <PhStatusChip value={o.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
