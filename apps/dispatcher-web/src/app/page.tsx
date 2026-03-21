'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { fetchDrivers, fetchDeliveries, fetchSettings } from '@/lib/api';
import { connectDispatcher } from '@/lib/socket';
import { Driver, Delivery, DriverLocation, Settings } from '@/types';
import RequestForm from '@/components/RequestForm';
import DeliveryBoard from '@/components/DeliveryBoard';
import DriverRoster from '@/components/DriverRoster';
import SettingsPanel from '@/components/SettingsPanel';

// Lazy-load map to avoid SSR issues with Google Maps SDK
const DeliveryMap = dynamic(() => import('@/components/DeliveryMap'), { ssr: false });

export default function DashboardPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [settings, setSettings] = useState<Settings>({ request_timeout_seconds: '60' });
  const [driverLocations, setDriverLocations] = useState<Record<string, DriverLocation>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  const loadInitialData = useCallback(async () => {
    try {
      const [driversRes, deliveriesRes, settingsRes] = await Promise.all([
        fetchDrivers(),
        fetchDeliveries(),
        fetchSettings(),
      ]);
      setDrivers(driversRes.drivers);
      setDeliveries(deliveriesRes.deliveries);
      setSettings(settingsRes.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    }
  }, []);

  useEffect(() => {
    loadInitialData();

    const socket = connectDispatcher();

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('delivery_created', ({ delivery }: { delivery: Delivery }) => {
      setDeliveries((prev) => [delivery, ...prev]);
    });

    socket.on('delivery_state_change', ({ delivery }: { delivery: Delivery }) => {
      setDeliveries((prev) =>
        prev.map((d) => (d.id === delivery.id ? { ...d, ...delivery } : d))
      );
    });

    socket.on('driver_status_change', (data: {
      driverId: string;
      name: string;
      status: Driver['status'];
      safety_score?: number;
    }) => {
      setDrivers((prev) =>
        prev.map((d) =>
          d.id === data.driverId
            ? { ...d, status: data.status, ...(data.safety_score != null && { safety_score: data.safety_score }) }
            : d
        )
      );
    });

    socket.on('driver_location', (loc: DriverLocation) => {
      setDriverLocations((prev) => ({ ...prev, [loc.driverId]: loc }));
    });

    return () => {
      socket.off('delivery_created');
      socket.off('delivery_state_change');
      socket.off('driver_status_change');
      socket.off('driver_location');
    };
  }, [loadInitialData]);

  // Clear location pin when delivery completes/cancels
  useEffect(() => {
    const activeDriverIds = new Set(
      deliveries
        .filter((d) => d.status === 'active' || d.status === 'assigned')
        .map((d) => d.driver_id)
        .filter(Boolean)
    );
    setDriverLocations((prev) => {
      const next: Record<string, DriverLocation> = {};
      for (const [id, loc] of Object.entries(prev)) {
        if (activeDriverIds.has(id)) next[id] = loc;
      }
      return next;
    });
  }, [deliveries]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--surface)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '0.02em' }}>
          🍔 TeenEats <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Dispatcher</span>
        </div>
        <div
          style={{
            marginLeft: 8,
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: connected ? '#14201a' : '#2a1515',
            color: connected ? 'var(--green)' : 'var(--red)',
          }}
        >
          {connected ? '● Connected' : '○ Connecting…'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Timeout: {settings.request_timeout_seconds}s
          </span>
          <button
            className="btn-ghost"
            onClick={() => setShowSettings(true)}
            style={{ padding: '6px 10px', fontSize: 16 }}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {error && (
        <div
          style={{
            background: '#2a1515',
            color: 'var(--red)',
            padding: '10px 24px',
            fontSize: 13,
          }}
        >
          {error} —{' '}
          <button
            onClick={loadInitialData}
            style={{ background: 'none', color: 'var(--accent)', textDecoration: 'underline' }}
          >
            retry
          </button>
        </div>
      )}

      {/* Main grid */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '280px 1fr 220px',
          gridTemplateRows: '1fr',
          gap: 0,
          overflow: 'hidden',
          height: 'calc(100vh - 49px)',
        }}
      >
        {/* Left: Request form */}
        <div
          style={{
            borderRight: '1px solid var(--border)',
            padding: 16,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)' }}>
            NEW DELIVERY
          </div>
          <RequestForm onCreated={loadInitialData} />
        </div>

        {/* Center: Map + Delivery board */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Map */}
          <div style={{ flex: '0 0 300px', padding: 12, borderBottom: '1px solid var(--border)' }}>
            <DeliveryMap driverLocations={driverLocations} drivers={drivers} />
          </div>

          {/* Delivery board */}
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)' }}>
                DELIVERIES
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {deliveries.filter((d) => d.status === 'pending').length} pending ·{' '}
                {deliveries.filter((d) => d.status === 'active').length} active
              </div>
            </div>
            <DeliveryBoard
              deliveries={deliveries}
              onCancelled={(id) =>
                setDeliveries((prev) =>
                  prev.map((d) =>
                    d.id === id ? { ...d, status: 'cancelled' } : d
                  )
                )
              }
            />
          </div>
        </div>

        {/* Right: Driver roster */}
        <div
          style={{
            borderLeft: '1px solid var(--border)',
            padding: 16,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            DRIVERS
          </div>
          <DriverRoster drivers={drivers} />
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onUpdated={(updated) => {
            setSettings(updated);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}
