import { useRef, useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import { useSnackbar } from 'notistack';
import { errorMessage, uploadFile } from '../api/client';

/** Picks a file, uploads it with a purpose, returns the stored file DTO. */
export default function FileUploadButton({ purpose, onUploaded, accept = 'image/jpeg,image/png,image/webp,application/pdf', label = 'رفع ملف', maxMb = 10, ...btn }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const { enqueueSnackbar } = useSnackbar();
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      enqueueSnackbar(`الحد الأقصى لحجم الملف ${maxMb} ميجابايت`, { variant: 'error' });
      return;
    }
    setBusy(true);
    try {
      onUploaded(await uploadFile(f, purpose));
    } catch (err) {
      enqueueSnackbar(errorMessage(err), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={ref} type="file" hidden accept={accept} onChange={pick} />
      <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <UploadIcon />} disabled={busy} onClick={() => ref.current.click()} {...btn}>
        {label}
      </Button>
    </>
  );
}
