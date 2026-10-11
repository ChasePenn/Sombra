import { useEffect, useState } from 'react';
import * as store from '../../public/js/store.js';
import { useSession } from '../lib/session';
import { Sheet } from './Sheet';

export function ImportOffer() {
  const { accountId, t, reloadProfile } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!accountId) { setOpen(false); return; }
    const snap = store.getLocalSnapshot();
    setOpen(store.hasLocalData(snap) && !store.hasImportedGuestData(accountId));
  }, [accountId]);

  if (!open || !accountId) return null;
  const skip = () => { store.skipGuestImport(accountId); setOpen(false); };
  const doImport = async () => {
    setBusy(true); setErr(false);
    try {
      await store.importGuestData(store.getLocalSnapshot(), accountId);
      setOpen(false);
      reloadProfile();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t.importTitle} onClose={skip} closeLabel={t.close}>
      <p>{t.importBody}</p>
      {err && <p className="error" role="alert">{t.somethingWrong}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" onClick={doImport} disabled={busy}>{busy ? t.saving : t.importYes}</button>
        <button type="button" className="btn btn-quiet" onClick={skip} disabled={busy}>{t.importNo}</button>
      </div>
    </Sheet>
  );
}
