import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Delivery } from '../types';
import { completeDelivery } from '../lib/api';
import { stopLocationTracking } from '../lib/location';

interface Props {
  delivery: Delivery;
  onCompleted: () => void;
  onCancelled: () => void;
}

interface Position {
  lat: number;
  lng: number;
}

export default function ActiveDeliveryScreen({ delivery, onCompleted, onCancelled }: Props) {
  const [completing, setCompleting] = useState(false);
  const [currentPos, setCurrentPos] = useState<Position | null>(null);
  const mapRef = useRef<MapView>(null);

  // Keep current position in sync — location.ts pushes to server every 5s,
  // we also update our local display position.
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const Location = await import('expo-location');
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 3000 },
          (loc) => {
            const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
            setCurrentPos(pos);
            mapRef.current?.animateToRegion({
              latitude: pos.lat,
              longitude: pos.lng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }, 500);
          }
        );
      } catch {
        // GPS unavailable (simulator without location set)
      }
    })();
    return () => { sub?.remove(); };
  }, []);

  // Listen for cancellation via socket
  useEffect(() => {
    try {
      const { getSocket } = require('../lib/socket');
      const socket = getSocket();
      const handler = ({ deliveryId }: { deliveryId: string }) => {
        if (deliveryId === delivery.id) {
          stopLocationTracking();
          Alert.alert('Delivery cancelled', 'This delivery was cancelled by the dispatcher.');
          onCancelled();
        }
      };
      socket.on('delivery_cancelled', handler);
      return () => { socket.off('delivery_cancelled', handler); };
    } catch { return undefined; }
  }, [delivery.id, onCancelled]);

  async function handleComplete() {
    Alert.alert(
      'Mark as Delivered?',
      'Confirm that you have delivered the item to the dropoff location.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Yes, delivered!',
          style: 'default',
          onPress: async () => {
            setCompleting(true);
            try {
              stopLocationTracking();
              await completeDelivery(delivery.id);
              onCompleted();
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Could not complete delivery');
              setCompleting(false);
            }
          },
        },
      ]
    );
  }

  const initialRegion = {
    latitude: delivery.pickup_lat,
    longitude: delivery.pickup_lng,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={initialRegion}
          showsUserLocation
          showsMyLocationButton
        >
          <Marker
            coordinate={{ latitude: delivery.pickup_lat, longitude: delivery.pickup_lng }}
            title="Pickup"
            description={delivery.pickup_address}
            pinColor="blue"
          />
          <Marker
            coordinate={{ latitude: delivery.dropoff_lat, longitude: delivery.dropoff_lng }}
            title="Dropoff"
            description={delivery.dropoff_address}
            pinColor="red"
          />
          {currentPos && (
            <Marker
              coordinate={{ latitude: currentPos.lat, longitude: currentPos.lng }}
              title="You"
              pinColor="green"
            />
          )}
        </MapView>
      </View>

      {/* Delivery info panel */}
      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 20 }}>
        <View style={styles.statusRow}>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>● ACTIVE DELIVERY</Text>
          </View>
          <Text style={styles.eta}>Est. {delivery.estimated_minutes} min</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>PICKUP</Text>
          <Text style={styles.address}>{delivery.pickup_address}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>DROPOFF</Text>
          <Text style={styles.address}>{delivery.dropoff_address}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>ITEM</Text>
          <Text style={styles.itemDesc}>{delivery.item_description}</Text>
        </View>

        <View style={styles.hint}>
          <Text style={styles.hintText}>
            ⚠ Keep screen on — GPS tracking requires screen to stay active.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.completeButton, completing && styles.buttonDisabled]}
          onPress={handleComplete}
          disabled={completing}
        >
          <Text style={styles.completeText}>
            {completing ? 'Completing…' : '✓ Mark as Delivered'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1117' },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  panel: {
    maxHeight: 340,
    backgroundColor: '#1a1d27',
    borderTopWidth: 1,
    borderTopColor: '#2e3347',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeBadge: {
    backgroundColor: '#2a1f10',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  activeBadgeText: { color: '#f97316', fontSize: 11, fontWeight: '700' },
  eta: { color: '#7b82a0', fontSize: 13 },
  section: { marginBottom: 12 },
  label: { fontSize: 10, fontWeight: '600', color: '#7b82a0', letterSpacing: 0.8, marginBottom: 2 },
  address: { fontSize: 14, color: '#e8eaf0', fontWeight: '500' },
  itemDesc: { fontSize: 14, color: '#e8eaf0' },
  hint: {
    backgroundColor: '#1e1a0f',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3a2e1a',
  },
  hintText: { fontSize: 12, color: '#f59e0b', lineHeight: 16 },
  completeButton: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  completeText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
