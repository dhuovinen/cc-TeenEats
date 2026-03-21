'use client';

import { useState } from 'react';
import { Settings } from '@/types';
import { updateSetting } from '@/lib/api';

interface Props {
  settings: Settings;
  onClose: () => void;
  onUpdated: (settings: Settings) => void;
}

export default function SettingsPanel({ settings, onClose, onUpdated }: Props) {
  const [timeout, setTimeout_] = useState(
    settings.request_timeout_seconds ?? '60'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const val = parseInt(timeout, 10);
    if (isNaN(val) || val < 5 || val > 3600) {
      setError('Must be between 5 and 3600 seconds');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateSetting('request_timeout_seconds', String(val));
      onUpdated({ ...settings, request_timeout_seconds: String(val) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: 360, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Settings</h2>
          <button className="btn-ghost" onClick={onClose} style={{ padding: '4px 10px' }}>✕</button>
        </div>

        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label>Request timeout (seconds)</label>
            <input
              type="number"
              min={5}
              max={3600}
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
            />
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
              How long a pending request waits before timing out. Applied to new requests only.
            </div>
          </div>

          {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}
          {saved && <div style={{ color: 'var(--green)', fontSize: 12 }}>Saved ✓</div>}

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </div>
    </div>
  );
}
