import { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import OpenInNew from '@mui/icons-material/OpenInNewOutlined';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../api/client';

/** Private files require the bearer token, so they are fetched as a blob — never linked directly. */
export default function ProtectedFile({ fileId, label = 'عرض الملف', size = 'small' }) {
  const [busy, setBusy] = useState(false);
  const { enqueueSnackbar } = useSnackbar();
  const open = async () => {
    setBusy(true);
    try {
      const res = await api.get(`/files/${fileId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} onClick={open} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : <OpenInNew />}>
      {label}
    </Button>
  );
}
