'use client';

import { Driver } from '@/types';

function scoreTier(score: number | null): string {
  if (score == null) return '—';
  if (score >= 90) return '★ Excellent';
  if (score >= 75) return '▲ Good';
  if (score >= 55) return '● Fair';
  return '▼ Needs improvement';
}

export default function DriverRoster({ drivers }: { drivers: Driver[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {drivers.map((d) => (
        <div
          key={d.id}
          className="card"
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <span className={`status-dot dot-${d.status}`} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{d.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>
              {d.safety_score != null ? d.safety_score.toFixed(1) : '—'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {scoreTier(d.safety_score)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
