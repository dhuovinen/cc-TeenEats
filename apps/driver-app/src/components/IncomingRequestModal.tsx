import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';
import { Delivery } from '../types';

interface Props {
  delivery: Delivery | null;
  onAccept: (delivery: Delivery) => void;
  onDismiss: () => void;
}

export default function IncomingRequestModal({ delivery, onAccept, onDismiss }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const progress = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!delivery) return;
    setSecondsLeft(delivery.timeout_seconds);

    // Countdown timer
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onDismiss();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    // Animated progress bar
    Animated.timing(progress, {
      toValue: 0,
      duration: delivery.timeout_seconds * 1000,
      useNativeDriver: false,
    }).start();

    return () => clearInterval(interval);
  }, [delivery?.id]);

  if (!delivery) return null;

  return (
    <Modal
      visible={!!delivery}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Timeout progress bar */}
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressBar,
                { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>

          <View style={styles.header}>
            <Text style={styles.title}>New Delivery Request</Text>
            <Text style={styles.timer}>{secondsLeft}s</Text>
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

          <View style={styles.meta}>
            <Text style={styles.metaText}>Est. {delivery.estimated_minutes} min</Text>
          </View>

          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => onAccept(delivery)}
          >
            <Text style={styles.acceptText}>Accept Delivery</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>Request will expire automatically when timer runs out.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1a1d27',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2e3347',
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#2e3347',
    borderRadius: 2,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#4f7cff',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#e8eaf0' },
  timer: { fontSize: 18, fontWeight: '700', color: '#f59e0b' },
  section: { marginBottom: 12 },
  label: { fontSize: 10, fontWeight: '600', color: '#7b82a0', letterSpacing: 0.8, marginBottom: 2 },
  address: { fontSize: 14, color: '#e8eaf0', fontWeight: '500' },
  itemDesc: { fontSize: 14, color: '#e8eaf0' },
  meta: { marginBottom: 16 },
  metaText: { fontSize: 12, color: '#7b82a0' },
  acceptButton: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  acceptText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hint: { fontSize: 11, color: '#555', textAlign: 'center' },
});
