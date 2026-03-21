import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ActiveDeliveryScreen from './src/screens/ActiveDeliveryScreen';
import { Delivery } from './src/types';
import { isAuthenticated } from './src/lib/auth';

type Screen = 'login' | 'home' | 'active-delivery';

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    isAuthenticated() ? 'home' : 'login'
  );
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null);

  function handleLoginSuccess() {
    setScreen('home');
  }

  function handleActiveDelivery(delivery: Delivery) {
    setActiveDelivery(delivery);
    setScreen('active-delivery');
  }

  function handleDeliveryComplete() {
    setActiveDelivery(null);
    setScreen('home');
  }

  function handleDeliveryCancelled() {
    setActiveDelivery(null);
    setScreen('home');
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {screen === 'login' && (
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      )}
      {screen === 'home' && (
        <HomeScreen
          onLogout={() => setScreen('login')}
          onActiveDelivery={handleActiveDelivery}
        />
      )}
      {screen === 'active-delivery' && activeDelivery && (
        <ActiveDeliveryScreen
          delivery={activeDelivery}
          onCompleted={handleDeliveryComplete}
          onCancelled={handleDeliveryCancelled}
        />
      )}
    </SafeAreaProvider>
  );
}
