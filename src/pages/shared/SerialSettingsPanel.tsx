import React, { useState } from 'react';
import { Hash } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { addRcGasSerials } from '../../lib/addRcGasSerials';
import { parseGasStickerSerials } from '../../lib/parseGasStickerSerials';

function callableMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Failed to add serials.';
  const coded = err as { code?: string; message?: string; details?: unknown };
  const msg = String(coded.message || '').trim();
  const details = typeof coded.details === 'string' ? coded.details.trim() : '';
  if (coded.code === 'functions/permission-denied') return msg || 'Permission denied.';
  if (coded.code === 'functions/unauthenticated') return 'Sign in required.';
  if (coded.code === 'functions/invalid-argument') return msg || 'Invalid serials.';
  if (coded.code === 'functions/failed-precondition') return msg || 'Serial conflict.';
  if (coded.code === 'functions/not-found') {
    return 'addRcGasSerials not deployed (firebase deploy --only functions:addRcGasSerials --project yesgatc).';
  }
  // Bare "internal" = missing callable / uncaught throw; Firebase hides detail for this code.
  if (coded.code === 'functions/internal' && (!msg || msg === 'internal')) {
    return (
      details
      || 'addRcGasSerials failed (undeployed or server crash). Deploy functions:addRcGasSerials or check Cloud logs.'
    );
  }
  if (msg && msg !== 'internal') return msg;
  return details || msg || 'Failed to add serials.';
}

export function SerialSettingsPanel() {
  const { user } = useAuth();
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.uid || saving) return;
    setError('');
    setOk('');

    const parsed = parseGasStickerSerials(raw);
    if (parsed.valid.length === 0) {
      setError('Paste at least one serial.');
      return;
    }

    setSaving(true);
    try {
      const result = await addRcGasSerials({ serials: raw });
      const parts: string[] = [];
      if (result.added.length > 0) {
        parts.push(`Added ${result.added.length} GAS seat${result.added.length === 1 ? '' : 's'}.`);
      }
      if (result.alreadyPresent.length > 0) {
        parts.push(`Already held: ${result.alreadyPresent.slice(0, 6).join(', ')}.`);
      }
      if (result.invalid.length > 0) {
        parts.push(`Skipped invalid: ${result.invalid.slice(0, 6).join(', ')}.`);
      }
      if (result.conflicts.length > 0) {
        parts.push(`Other RC owns: ${result.conflicts.slice(0, 6).join(', ')}.`);
      }
      if (result.added.length === 0 && result.conflicts.length > 0 && result.alreadyPresent.length === 0) {
        setError(parts.join(' ') || 'Serials belong to another RC.');
      } else if (result.added.length === 0) {
        setError(parts.join(' ') || 'Nothing new to add.');
      } else {
        setOk(parts.join(' '));
        setRaw('');
      }
    } catch (err: unknown) {
      setError(callableMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel glass serial-settings-panel">
      <form onSubmit={event => void handleAdd(event)}>
        {error ? <div className="login-error">{error}</div> : null}
        {ok ? <p className="text-muted text-sm mb-2">{ok}</p> : null}
        <p className="text-muted text-sm serial-settings-hint">
          Paste serials (comma, space, or newline). Joins unused GAS stamp bank.
        </p>
        <label className="form-group" htmlFor="rc-settings-serials">
          <span className="sr-only">GAS serials</span>
          <textarea
            id="rc-settings-serials"
            className="input-field text-mono serial-settings-textarea"
            rows={5}
            value={raw}
            onChange={e => {
              setOk('');
              setError('');
              setRaw(e.target.value);
            }}
            disabled={saving}
            placeholder="G0585, X00796"
            aria-label="GAS serials"
          />
        </label>
        <button type="submit" className="btn btn-primary flex items-center gap-2 mt-3" disabled={saving}>
          {saving ? <span className="spinner-inline" /> : <Hash size={16} aria-hidden />}
          Add
        </button>
      </form>
    </div>
  );
}
