import { useState } from 'react';
import {

  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  Menu,
  MenuItem,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import MoreVert from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { PageHeader, StatusChip, useConfirm, useDebounced } from '../../components/common';
import { fmtDateTime, fmtShortDate } from '../../utils/format';
import { ROLE_LABEL, USER_STATUS } from '../../utils/labels';

export default function AdminUsers({ fixedRole, title = 'المستخدمون' }) {
  const qc = useQueryClient();
  const { user: me, can } = useAuth();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [role, setRole] = useState(fixedRole || '');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState(null);
  const [rolesFor, setRolesFor] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const search = useDebounced(text);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', role, status, search, page],
    queryFn: () => api.get(`/users${qs({ role, status, search, page, pageSize: 20 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const setUserStatus = async (u, s) => {
    setMenu(null);
    if (s !== 'ACTIVE' && !(await confirm({ title: `${s === 'SUSPENDED' ? 'إيقاف' : 'تعطيل'} ${u.fullName}؟`, body: 'سيتم تسجيل خروجه من كل الأجهزة فوراً ولن يستطيع الدخول.', confirmText: 'تأكيد', danger: true }))) return;
    try {
      await api.patch(`/users/${u.id}/status`, { status: s });
      enqueueSnackbar('تم تحديث الحالة', { variant: 'success' });
      invalidate();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader title={title} actions={!fixedRole && can('users.manage') && <Button variant="contained" onClick={() => setCreateOpen(true)}>إضافة موظف</Button>} />
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
          <TextField placeholder="ابحث بالاسم أو الموبايل أو البريد" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} sx={{ maxWidth: 380 }} inputProps={{ 'aria-label': 'بحث' }} />
          {!fixedRole && (
            <TextField select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} sx={{ maxWidth: 200 }} inputProps={{ 'aria-label': 'الدور' }}>
              <MenuItem value="">كل الأدوار</MenuItem>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
          )}
          <TextField select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ maxWidth: 180 }} inputProps={{ 'aria-label': 'الحالة' }}>
            <MenuItem value="">كل الحالات</MenuItem>
            {Object.entries(USER_STATUS).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
          </TextField>
        </Stack>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          columns={[
            { key: 'fullName', label: 'الاسم', render: (u) => <b>{u.fullName}</b> },
            { key: 'phone', label: 'الموبايل', render: (u) => <span dir="ltr">{u.phone}</span> },
            { key: 'email', label: 'البريد', render: (u) => <span dir="ltr">{u.email || '—'}</span> },
            { key: 'roles', label: 'الأدوار', render: (u) => <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{u.roles.map((r) => <Chip key={r} size="small" label={ROLE_LABEL[r] || r} />)}</Stack> },
            { key: 'lastLoginAt', label: 'آخر دخول', render: (u) => fmtDateTime(u.lastLoginAt) },
            { key: 'createdAt', label: 'التسجيل', render: (u) => fmtShortDate(u.createdAt) },
            { key: 'status', label: 'الحالة', render: (u) => <StatusChip value={u.status} map={USER_STATUS} /> },
            {
              key: 'x',
              label: '',
              render: (u) =>
                can('users.manage') && u.id !== me.id ? (
                  <IconButton size="small" onClick={(e) => setMenu({ el: e.currentTarget, u })} aria-label="إجراءات"><MoreVert /></IconButton>
                ) : null,
            },
          ]}
        />
      </Card>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu?.u.status !== 'ACTIVE' && <MenuItem onClick={() => setUserStatus(menu.u, 'ACTIVE')}>تفعيل</MenuItem>}
        {menu?.u.status === 'ACTIVE' && <MenuItem onClick={() => setUserStatus(menu.u, 'INACTIVE')}>تعطيل</MenuItem>}
        {menu?.u.status !== 'SUSPENDED' && <MenuItem sx={{ color: 'error.main' }} onClick={() => setUserStatus(menu.u, 'SUSPENDED')}>إيقاف</MenuItem>}
        {can('roles.manage') && <MenuItem onClick={() => { setRolesFor(menu.u); setMenu(null); }}>تعديل الأدوار</MenuItem>}
      </Menu>
      {rolesFor && <RolesDialog user={rolesFor} onClose={() => setRolesFor(null)} onSaved={invalidate} />}
      {createOpen && <CreateStaffDialog onClose={() => setCreateOpen(false)} onSaved={invalidate} />}
    </>
  );
}

function RolesDialog({ user, onClose, onSaved }) {
  const [roles, setRoles] = useState(user.roles);
  const { enqueueSnackbar } = useSnackbar();
  const save = useMutation({
    mutationFn: () => api.put(`/users/${user.id}/roles`, { roles }),
    onSuccess: () => { onSaved(); onClose(); enqueueSnackbar('تم تحديث الأدوار', { variant: 'success' }); },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>أدوار {user.fullName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>التخصصات الطبية ليست أدواراً — تُدار من ملف الطبيب.</Typography>
        {Object.entries(ROLE_LABEL).map(([k, v]) => (
          <FormControlLabel key={k} sx={{ display: 'flex' }} control={<Checkbox checked={roles.includes(k)} onChange={(e) => setRoles(e.target.checked ? [...roles, k] : roles.filter((r) => r !== k))} />} label={v} />
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" disabled={!roles.length || save.isPending} onClick={() => save.mutate()}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateStaffDialog({ onClose, onSaved }) {
  const [f, setF] = useState({ fullName: '', phone: '', email: '', password: '', role: 'SUPPORT' });
  const { enqueueSnackbar } = useSnackbar();
  const save = useMutation({
    mutationFn: () => api.post('/users/staff', f),
    onSuccess: () => { onSaved(); onClose(); enqueueSnackbar('تم إنشاء الحساب', { variant: 'success' }); },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>إضافة موظف للمنصة</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="الاسم" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          <TextField label="الموبايل" inputProps={{ dir: 'ltr' }} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <TextField label="البريد" inputProps={{ dir: 'ltr' }} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <TextField label="كلمة مرور مبدئية" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} helperText="8 أحرف على الأقل وتحتوي على حروف وأرقام" />
          <TextField select label="الدور" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {['ADMIN', 'SUPPORT', 'ACCOUNTANT'].map((r) => <MenuItem key={r} value={r}>{ROLE_LABEL[r]}</MenuItem>)}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>إنشاء</Button>
      </DialogActions>
    </Dialog>
  );
}
