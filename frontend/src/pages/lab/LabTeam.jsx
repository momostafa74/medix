import { useState } from 'react';
import { Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { useMyProvider } from '../../components/ProviderManagement';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '../../components/common';
import { fmtRelative } from '../../utils/format';
import { tokens } from '../../theme';

const ROLE_HELP = {
  staff: 'فني: يستقبل الطلبات، يسحب العينات، يدخل النتائج ويراجعها',
  admin: 'مدير: كل ما سبق + اعتماد النتائج، الكتالوج والأسعار، الفريق والإعدادات',
};

const ROLE_HINT = (roles = []) =>
  roles.some((r) => r.startsWith('PHARMACY_')) ? { title: 'صيدلي', body: 'أضف الصيادلة ليستقبلوا الطلبات ويتحققوا من الروشتات بحساباتهم.' }
  : roles.some((r) => r.startsWith('RADIOLOGY_')) ? { title: 'فني أشعة', body: 'أضف الفنيين وأطباء الأشعة ليستقبلوا الحجوزات ويكتبوا التقارير بحساباتهم.' }
  : { title: 'أخصائي تحاليل', body: 'أضف الفنيين ليستقبلوا الطلبات ويدخلوا النتائج بحساباتهم.' };

function AddMember({ provider, onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState({ fullName: '', phone: '', email: '', password: '', title: '', branchId: '', isAdmin: false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/providers/${provider.id}/staff`, { ...f, email: f.email || undefined, title: f.title || undefined, branchId: f.branchId || undefined });
      enqueueSnackbar('تمت إضافة العضو — أرسل له رقم الهاتف وكلمة المرور ليسجل الدخول', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>إضافة عضو للفريق</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid xs={12} sm={6}><TextField label="الاسم" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Grid>
          <Grid xs={12} sm={6}><TextField label="المسمى الوظيفي" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={ROLE_HINT(user?.roles).title} /></Grid>
          <Grid xs={12} sm={6}><TextField label="رقم الموبايل (للدخول)" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12} sm={6}><TextField label="البريد (اختياري)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12} sm={6}><TextField label="كلمة مرور مبدئية" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} helperText="8 أحرف على الأقل، حروف وأرقام" /></Grid>
          <Grid xs={12} sm={6}>
            <TextField select label="الفرع" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <MenuItem value="">كل الفروع</MenuItem>
              {provider.branches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={12}>
            <FormControlLabel control={<Switch checked={f.isAdmin} onChange={(e) => setF({ ...f, isAdmin: e.target.checked })} />} label="صلاحيات مدير" />
            <Typography variant="body2" color="text.secondary">{f.isAdmin ? ROLE_HELP.admin : ROLE_HELP.staff}</Typography>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" disabled={busy || !f.fullName || !f.phone || f.password.length < 8} onClick={save}>إضافة</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function LabTeam() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: provider } = useMyProvider();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['staff', provider?.id], queryFn: () => api.get(`/providers/${provider.id}/staff`).then((r) => r.data), enabled: !!provider });
  const update = async (m, patch, msg) => {
    try {
      await api.patch(`/providers/${provider.id}/staff/${m.id}`, patch);
      enqueueSnackbar(msg, { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['staff'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader title="فريق العمل" subtitle="حسابات منفصلة لكل موظف — كل إجراء على الطلبات مسجل باسم من قام به." actions={<Button variant="contained" startIcon={<PersonAddOutlined />} disabled={!provider} onClick={() => setAdding(true)}>إضافة عضو</Button>} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading || !data ? <ListSkeleton rows={3} height={80} /> : (
        <Stack spacing={1.5}>
          <Card sx={{ p: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Avatar sx={{ bgcolor: tokens.petrol }}>{data.owner.fullName[0]}</Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>{data.owner.fullName}</Typography>
                <Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: 'right' }}>{data.owner.phone}</Typography>
              </Box>
              <Chip label="المالك" color="primary" />
            </Stack>
          </Card>
          {data.members.map((m) => (
            <Card key={m.id} sx={{ p: 2, opacity: m.isActive ? 1 : 0.6 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <Avatar sx={{ bgcolor: tokens.mint, color: tokens.petrol }}>{m.fullName[0]}</Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontWeight: 700 }}>{m.fullName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[m.title, m.branchName || 'كل الفروع'].filter(Boolean).join(' • ')} • <span dir="ltr">{m.phone}</span>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{m.lastLoginAt ? `آخر دخول ${fmtRelative(m.lastLoginAt)}` : 'لم يسجل الدخول بعد'}</Typography>
                </Box>
                <FormControlLabel control={<Switch checked={m.isAdmin} disabled={m.userId === user.id || !m.isActive} onChange={(e) => update(m, { isAdmin: e.target.checked }, e.target.checked ? 'أصبح مديراً' : 'أصبح فنياً')} />} label="مدير" />
                <FormControlLabel control={<Switch checked={m.isActive} disabled={m.userId === user.id} onChange={(e) => update(m, { isActive: e.target.checked }, e.target.checked ? 'تم التفعيل' : 'تم إيقاف الوصول')} />} label={m.isActive ? 'نشط' : 'موقوف'} />
              </Stack>
            </Card>
          ))}
          {!data.members.length && <EmptyState title="لا يوجد موظفون بعد" body={ROLE_HINT(user?.roles).body} />}
        </Stack>
      )}
      {adding && provider && <AddMember provider={provider} onClose={() => setAdding(false)} />}
    </>
  );
}
