import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { login } from '../lib/api';
import { setAuth } from '../lib/auth';
import { Driver } from '../types';

interface Props {
  onLoginSuccess: () => void;
}

export default function LoginScreen({ onLoginSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Email and password required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await login(email.trim().toLowerCase(), password);
      setAuth(res.token, res.driver as Driver);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>🍔</Text>
      <Text style={styles.title}>TeenEats</Text>
      <Text style={styles.subtitle}>Driver App</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Alpha test accounts:{'\n'}
        alex@teeneats.test / jordan@teeneats.test / sam@teeneats.test{'\n'}
        Password: password123
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f1117',
    padding: 24,
  },
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#e8eaf0' },
  subtitle: { fontSize: 14, color: '#7b82a0', marginBottom: 40 },
  form: { width: '100%', maxWidth: 320, gap: 12 },
  input: {
    backgroundColor: '#1a1d27',
    borderWidth: 1,
    borderColor: '#2e3347',
    borderRadius: 8,
    color: '#e8eaf0',
    fontSize: 15,
    padding: 12,
    marginBottom: 4,
  },
  error: { color: '#ef4444', fontSize: 13, textAlign: 'center' },
  button: {
    backgroundColor: '#4f7cff',
    borderRadius: 8,
    alignItems: 'center',
    padding: 14,
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  hint: {
    marginTop: 40,
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    lineHeight: 18,
  },
});
