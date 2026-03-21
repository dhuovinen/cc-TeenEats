import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { getDriver, clearAuth } from '../lib/auth';
import { setDriverStatus, getScoreBreakdown } from '../lib/api';
import { connectDriverSocket, disconnectDriverSocket } from '../lib/socket';
import { startLocationTracking, stopLocationTracking } from '../lib/location';
import { acceptDelivery } from '../lib/api';
import { Delivery, ScoreBreakdown } from '../types';
import IncomingRequestModal from '../components/IncomingRequestModal';

interface Props {
  onLogout: () => void;
  onActiveDelivery: (delivery: Delivery) => void;
}

export default function HomeScreen({ onLogout, onActiveDelivery }: Props) {
  const driver = getDriver()!;
  const [status, setStatus] = useState<'offline' | 'online'>(
    driver.status === 'busy' ? 'online' : (driver.status as 'offline' | 'online')
  );
  const [toggling, setToggling] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState<Delivery | null>(null);
  const [score, setScore] = useState<ScoreBreakdown | null>(null);

  const loadScore = useCallback(async () => {
    try {
      const res = await getScoreBreakdown(driver.id);
      setScore(res.score);
    } catch {
      // Score unavailable — not blocking
    }
  }, [driver.id]);

  useEffect(() => {
    loadScore();
    const socket = connectDriverSocket();

    socket.on('delivery_request', ({ delivery }: { delivery: Delivery }) => {
      setIncomingRequest(delivery);
    });

    socket.on('request_expired', ({ deliveryId }: { deliveryId: string }) => {
      setIncomingRequest((prev) =>
        prev?.id === deliveryId ? null : prev
      );
    });

    socket.on('delivery_cancelled', ({ deliveryId }: { deliveryId: string }) => {
      setIncomingRequest((prev) =>
        prev?.id === deliveryId ? null : prev
      );
    });

    return () => {
      socket.off('delivery_request');
      socket.off('request_expired');
      socket.off('delivery_cancelled');
    };
  }, [loadScore]);

  async function toggleStatus() {
    const newStatus = status === 'offline' ? 'online' : 'offline';
    setToggling(true);
    try {
      await setDriverStatus(driver.id, newStatus);
      setStatus(newStatus);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setToggling(false);
    }
  }

  async function handleAccept(delivery: Delivery) {
    setIncomingRequest(null);
    try {
      const res = await acceptDelivery(delivery.id);
      // Start GPS tracking
      await startLocationTracking(delivery.id);
      onActiveDelivery(res.delivery as Delivery);
    } catch (err) {
      Alert.alert(
        'Could not accept',
        err instanceof Error ? err.message : 'Delivery may have been taken by another driver.'
      );
    }
  }

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          disconnectDriverSocket();
          clearAuth();
          onLogout();
        },
      },
    ]);
  }

  const scoreColor =
    score?.overall == null ? '#7b82a0'
    : score.overall >= 90 ? '#22c55e'
    : score.overall >= 75 ? '#4f7cff'
    : score.overall >= 55 ? '#f59e0b'
    : '#ef4444';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Hi, {driver.name.split(' ')[0]}</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutBtn}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 20 }}>
        {/* Availability toggle */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>AVAILABILITY</Text>
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.statusText}>
                {status === 'online' ? 'Online — ready for deliveries' : 'Offline'}
              </Text>
              <Text style={styles.statusSub}>
                {status === 'online'
                  ? 'You will receive delivery requests'
                  : 'You will not receive requests'}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                status === 'online' ? styles.toggleOn : styles.toggleOff,
                toggling && styles.toggleDisabled,
              ]}
              onPress={toggleStatus}
              disabled={toggling}
            >
              <Text style={styles.toggleText}>
                {toggling ? '…' : status === 'online' ? 'Go Offline' : 'Go Online'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Performance score */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>PERFORMANCE SCORE</Text>
          {score?.overall == null ? (
            <Text style={styles.noScore}>
              {score?.totalDeliveries === 0
                ? 'Complete deliveries to see your score'
                : 'Loading…'}
            </Text>
          ) : (
            <>
              <View style={styles.scoreRow}>
                <Text style={[styles.scoreBig, { color: scoreColor }]}>
                  {score.overall.toFixed(1)}
                </Text>
                <Text style={styles.scoreMax}>/100</Text>
              </View>
              <View style={styles.componentRow}>
                <ScoreComponent label="Acceptance" value={score.acceptance} />
                <ScoreComponent label="On-Time" value={score.onTime} />
                <ScoreComponent label="Completion" value={score.completion} />
              </View>
              <Text style={styles.scoreNote}>
                Rolling average · {score.totalDeliveries} deliveries completed
              </Text>
            </>
          )}
        </View>

        {/* Limitations notice */}
        <View style={[styles.card, styles.noticeCard]}>
          <Text style={styles.noticeTitle}>Alpha build</Text>
          <Text style={styles.noticeText}>
            • GPS tracking requires screen to stay on during delivery{'\n'}
            • ETA is a straight-line estimate (not real routing){'\n'}
            • Pre-seeded accounts only — no signup
          </Text>
        </View>
      </ScrollView>

      <IncomingRequestModal
        delivery={incomingRequest}
        onAccept={handleAccept}
        onDismiss={() => setIncomingRequest(null)}
      />
    </View>
  );
}

function ScoreComponent({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#e8eaf0' }}>
        {value != null ? `${value.toFixed(0)}%` : '—'}
      </Text>
      <Text style={{ fontSize: 11, color: '#7b82a0' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1117' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#2e3347',
    backgroundColor: '#1a1d27',
  },
  greeting: { fontSize: 18, fontWeight: '700', color: '#e8eaf0' },
  logoutBtn: { fontSize: 13, color: '#7b82a0' },
  card: {
    backgroundColor: '#1a1d27',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2e3347',
  },
  noticeCard: {
    borderColor: '#3a2e1a',
    backgroundColor: '#1e1a0f',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7b82a0',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  statusText: { fontSize: 14, fontWeight: '600', color: '#e8eaf0', marginBottom: 2 },
  statusSub: { fontSize: 12, color: '#7b82a0' },
  toggleButton: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: '#2a1515', borderWidth: 1, borderColor: '#ef4444' },
  toggleOff: { backgroundColor: '#14201a', borderWidth: 1, borderColor: '#22c55e' },
  toggleDisabled: { opacity: 0.5 },
  toggleText: { fontWeight: '600', fontSize: 13, color: '#e8eaf0' },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  scoreBig: { fontSize: 48, fontWeight: '700', lineHeight: 52 },
  scoreMax: { fontSize: 18, color: '#7b82a0', marginBottom: 4, marginLeft: 4 },
  componentRow: { flexDirection: 'row', marginBottom: 8 },
  scoreNote: { fontSize: 11, color: '#7b82a0' },
  noScore: { color: '#7b82a0', fontSize: 14 },
  noticeTitle: { fontSize: 12, fontWeight: '600', color: '#f59e0b', marginBottom: 6 },
  noticeText: { fontSize: 12, color: '#7b82a0', lineHeight: 18 },
});
