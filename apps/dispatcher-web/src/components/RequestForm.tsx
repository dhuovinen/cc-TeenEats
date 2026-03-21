'use client';

import { useState } from 'react';
import { createDelivery } from '@/lib/api';

// For alpha, lat/lng are entered manually or via preset demo locations.
// Post-MVP: replace with address autocomplete + geocoding via Google Maps Geocoding API.

const DEMO_LOCATIONS = [
  { label: 'McDonald\'s - 100 Main St', lat: 37.7749, lng: -122.4194 },
  { label: 'Chipotle - 200 Market St', lat: 37.7935, lng: -122.3964 },
  { label: 'Pizza Hut - 300 Mission St', lat: 37.7879, lng: -122.4074 },
];

const DEMO_DROPOFFS = [
  { label: '123 Oak Ave', lat: 37.7690, lng: -122.4270 },
  { label: '456 Pine St', lat: 37.7820, lng: -122.4120 },
  { label: '789 Cedar Rd', lat: 37.7710, lng: -122.4000 },
];

export default function RequestForm({ onCreated }: { onCreated: () => void }) {
  const [pickupIdx, setPickupIdx] = useState(0);
  const [dropoffIdx, setDropoffIdx] = useState(0);
  const [itemDesc, setItemDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemDesc.trim()) {
      setError('Item description required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const pickup = DEMO_LOCATIONS[pickupIdx];
      const dropoff = DEMO_DROPOFFS[dropoffIdx];
      await createDelivery({
        pickup_address: pickup.label,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_address: dropoff.label,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        item_description: itemDesc.trim(),
      });
      setItemDesc('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create delivery');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label>Pickup location</label>
        <select value={pickupIdx} onChange={e => setPickupIdx(Number(e.target.value))}>
          {DEMO_LOCATIONS.map((l, i) => (
            <option key={i} value={i}>{l.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label>Dropoff location</label>
        <select value={dropoffIdx} onChange={e => setDropoffIdx(Number(e.target.value))}>
          {DEMO_DROPOFFS.map((l, i) => (
            <option key={i} value={i}>{l.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label>Item description</label>
        <input
          type="text"
          value={itemDesc}
          onChange={e => setItemDesc(e.target.value)}
          placeholder="e.g. Big Mac + fries"
          maxLength={200}
        />
      </div>
      {error && (
        <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>
      )}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Sending…' : 'Send to Drivers'}
      </button>
      <p style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 }}>
        Request broadcasts to all online drivers simultaneously. First to accept wins.
      </p>
    </form>
  );
}
