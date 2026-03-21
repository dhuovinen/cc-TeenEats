'use client';

import { APIProvider, Map, Marker, InfoWindow } from '@vis.gl/react-google-maps';
import { useState } from 'react';
import { DriverLocation, Driver } from '@/types';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// San Francisco default center (change to match your demo city)
const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };

interface Props {
  driverLocations: Record<string, DriverLocation>;
  drivers: Driver[];
}

export default function DeliveryMap({ driverLocations, drivers }: Props) {
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  if (!API_KEY) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 8,
          color: 'var(--text-muted)',
          background: 'var(--surface2)',
          borderRadius: 'var(--radius)',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32 }}>🗺️</div>
        <div style={{ fontWeight: 500 }}>Map unavailable</div>
        <div style={{ fontSize: 12 }}>
          Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in .env.local to enable live driver tracking.
        </div>
        {Object.keys(driverLocations).length > 0 && (
          <div style={{ marginTop: 12, textAlign: 'left', width: '100%' }}>
            <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 12 }}>Live locations (text fallback):</div>
            {Object.values(driverLocations).map((loc) => {
              const driver = drivers.find((d) => d.id === loc.driverId);
              return (
                <div key={loc.driverId} style={{ fontSize: 12, marginBottom: 4 }}>
                  <strong>{driver?.name ?? loc.driverId}</strong>: {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY}>
      <Map
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={13}
        style={{ height: '100%', borderRadius: 'var(--radius)' }}
        gestureHandling="greedy"
        disableDefaultUI={false}
      >
        {Object.values(driverLocations).map((loc) => {
          const driver = drivers.find((d) => d.id === loc.driverId);
          return (
            <Marker
              key={loc.driverId}
              position={{ lat: loc.lat, lng: loc.lng }}
              title={driver?.name ?? loc.driverId}
              onClick={() => setSelectedDriver(loc.driverId)}
            />
          );
        })}
        {selectedDriver && driverLocations[selectedDriver] && (
          <InfoWindow
            position={{
              lat: driverLocations[selectedDriver].lat,
              lng: driverLocations[selectedDriver].lng,
            }}
            onCloseClick={() => setSelectedDriver(null)}
          >
            <div style={{ fontSize: 13 }}>
              <strong>
                {drivers.find((d) => d.id === selectedDriver)?.name ?? selectedDriver}
              </strong>
              <br />
              {driverLocations[selectedDriver].lat.toFixed(5)},{' '}
              {driverLocations[selectedDriver].lng.toFixed(5)}
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}
