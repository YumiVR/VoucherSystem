import { useState, type FormEvent } from 'react';
import { DEFAULT_AMOUNT_PENCE, LIMITS } from '@shared/constants/index';
import type { AppState, CreatedVoucher } from '@shared/types/api';
import { formatPence } from '@shared/utilities/money';
import { AdminUnlock, Notice } from '../components/common';
import { BarcodeView } from '../components/Barcode';
import { call, errorMessage } from '../services/api';

const DEFAULT_AMOUNT = (DEFAULT_AMOUNT_PENCE / 100).toFixed(2);

export function CreateVoucherPage({ app, setApp }: { app: AppState; setApp: (s: AppState) => void }) {
  const [fullName, setFullName] = useState('');
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [wantsCustom, setWantsCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState<CreatedVoucher | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setCreated(await call('voucher:create', { fullName, amount }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const again = (): void => {
    setCreated(null);
    setFullName('');
    setAmount(DEFAULT_AMOUNT);
    setMessage('');
  };

  const savePdf = async (): Promise<void> => {
    if (!created) return;
    try {
      const r = await call('voucher:savePdf', { voucherId: created.voucherId });
      setMessage(r.saved ? 'PDF saved.' : 'Save cancelled.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const printPdf = async (): Promise<void> => {
    if (!created) return;
    try {
      const r = await call('voucher:printPdf', { voucherId: created.voucherId });
      setMessage(r.opened ? 'The PDF has opened in your PDF viewer. Use its Print command.' : 'The PDF could not be opened.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (created) {
    return (
      <section>
        <h1>Voucher created</h1>
        <div className="card">
          <p className="big-name">{created.fullName}</p>
          <p className="big-amount">{created.amountDisplay}</p>
          <p>Created {created.dateCreatedUk} · Reference {created.reference}</p>
          <div className="preview">
            <BarcodeView barcode={created.barcode} label="Voucher barcode preview" />
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {message && <Notice kind="success">{message}</Notice>}
        <div className="row wrap">
          <button type="button" className="primary large" onClick={() => void savePdf()}>
            Save PDF
          </button>
          <button type="button" className="secondary large" onClick={() => void printPdf()}>
            Print PDF
          </button>
          <button type="button" className="secondary large" onClick={again}>
            Create another voucher
          </button>
        </div>
        <p className="hint">The voucher is not stored on this computer. Save or print it now.</p>
      </section>
    );
  }

  const canEditAmount = app.adminUnlocked;

  return (
    <section>
      <h1>Create voucher</h1>
      <form className="card narrow" onSubmit={(e) => void submit(e)}>
        <label>
          Full name
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={LIMITS.fullNameChars} required autoFocus autoComplete="off" />
        </label>
        <label>
          Amount (GBP)
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={!canEditAmount}
            required
            aria-describedby="amount-help"
          />
        </label>
        <p id="amount-help" className="hint">
          {canEditAmount
            ? `Enter an amount in pounds with up to two decimal places. The standard amount is ${formatPence(DEFAULT_AMOUNT_PENCE)}.`
            : `The standard amount is ${formatPence(DEFAULT_AMOUNT_PENCE)}. Only an administrator can change it.`}
        </p>
        {!canEditAmount && (
          <button type="button" className="link" onClick={() => setWantsCustom(!wantsCustom)}>
            {wantsCustom ? 'Hide administrator sign-in' : 'Use a different amount (administrator)'}
          </button>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <button type="submit" className="primary large" disabled={busy || fullName.trim() === ''}>
          {busy ? 'Creating…' : 'Create voucher'}
        </button>
      </form>
      {wantsCustom && !canEditAmount && (
        <AdminUnlock
          hint="Sign in to enter a custom amount."
          onUnlocked={(s) => {
            setApp(s);
            setWantsCustom(false);
          }}
        />
      )}
    </section>
  );
}
