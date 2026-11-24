import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';

/** Small dialog asking for a reason/note before an action. onSubmit returns a promise. */
export default function ReasonDialog({ open, title, body, label = 'السبب', required, confirmText = 'تأكيد', danger, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText('');
      onClose();
    } catch {
      /* caller already reported the error; keep the dialog open */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {body && <Typography sx={{ mb: 2 }}>{body}</Typography>}
        <TextField autoFocus fullWidth multiline minRows={2} label={label} required={required} value={text} onChange={(e) => setText(e.target.value)} sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>تراجع</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={busy || (required && text.trim().length < 3)} onClick={submit}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
