'use client';

import { Delivery } from '@/types';
import { cancelDelivery } from '@/lib/api';

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

interface Props {
  deliveries: Delivery[];
  onCancelled: (id: string) => void;
}

export default function DeliveryBoard({ deliveries, onCancelled }: Props) {
  async function handleCancel(id: string) {
    try {
      await cancelDelivery(id);
      onCancelled(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  if (deliveries.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
        No deliveries yet. Submit a request above.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {deliveries.map((d) => (
        <div
          key={d.id}
          className="card"
          style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className={`badge badge-${d.status}`}>{d.status.replace('_', ' ')}</span>
              {d.driver_name && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  → {d.driver_name}
                </span>
              )}
              <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 'auto' }}>
                {timeAgo(d.created_at)}
              </span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              <strong style={{ color: 'var(--text-muted)', fontSize: 11 }}>FROM </strong>
              {d.pickup_address}
            </div>
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              <strong style={{ color: 'var(--text-muted)', fontSize: 11 }}>TO </strong>
              {d.dropoff_address}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {d.item_description} &middot; Est. {d.estimated_minutes} min &middot; Timeout {d.timeout_seconds}s
            </div>
          </div>
          {(d.status === 'pending' || d.status === 'assigned' || d.status === 'active') && (
            <button
              className="btn-danger"
              onClick={() => handleCancel(d.id)}
              style={{ flexShrink: 0 }}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
