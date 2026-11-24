import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

const DISMISS_KEY = 'medix.nameDialogDismissed';

/**
 * Patients sign up with phone + password only; their name is asked once, gently, afterwards.
 * Skippable — doctors see "مريض ####" until it is filled in.
 */
export default function CompleteNameDialog() {
  const { user, reload } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || user.profileCompleted !== false || dismissed) return null;
  const skip = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode */
    }
    setDismissed(true);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/users/me', { fullName: name.trim() });
      await reload();
      enqueueSnackbar('تم حفظ الاسم', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(errorMessage(err), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={skip} maxWidth="xs" fullWidth PaperProps={{ component: 'form', onSubmit: save }}>
      <DialogTitle>أهلاً بيك في ميديكس 👋</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>اكتب اسمك عشان يظهر للدكتور والمعمل في الحجوزات. تقدر تكمله بعدين من «بياناتي».</Typography>
        <TextField autoFocus fullWidth label="الاسم بالكامل" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 100 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={skip}>لاحقاً</Button>
        <Button type="submit" variant="contained" disabled={busy || name.trim().length < 3}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}
