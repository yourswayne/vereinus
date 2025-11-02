import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      // RootLayout reagiert auf Session-Änderungen; keine Navigation nötig
    })();
    return () => { mounted = false; };
  }, []);

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!email || !password) { setError('Bitte E-Mail und Passwort eingeben'); return; }
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else {
        // Wenn E-Mail-Verifizierung aktiviert ist, existiert noch keine Session.
        setInfo('Bitte E-Mail bestätigen. Wir haben dir eine Bestätigungsmail gesendet.');
      }
    }
  };

  const resetPassword = async () => {
    setError(null);
    setInfo(null);
    if (!email) { setError('Bitte E-Mail eingeben'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email as any);
    if (error) setError(error.message);
    else setInfo('Link zum Zurücksetzen gesendet. Bitte E-Mail prüfen.');
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        {/* Optional: App Logo if available */}
        {/* <Image source={require('../../assets/icon.png')} style={{ width: 72, height: 72, marginBottom: 6 }} /> */}
        <Text style={styles.brand}>Vereinus</Text>
      </View>
      {/*
        App-Logo: feste Größe, rund, nicht bildschirmfüllend
        <Image
          source={require('../assets/images/vereinus_logo1.png')}
          style={{ width: 96, height: 96, marginBottom: 8 }}
          resizeMode="cover"
        />
      */}

      <View style={styles.card}>
        <Text style={styles.title}>{mode === 'login' ? 'Anmeldung' : 'Registrieren'}</Text>
        <TextInput
          style={styles.input}
          placeholder={"E-Mail"}
          placeholderTextColor={'#C7D2D6'}
          autoCapitalize='none'
          keyboardType='email-address'
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder={'Passwort'}
          placeholderTextColor={'#C7D2D6'}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!info && <Text style={styles.info}>{info}</Text>}

        <TouchableOpacity style={styles.primaryBtn} onPress={submit}>
          <Text style={styles.primaryBtnText}>{mode === 'login' ? 'Anmelden' : 'Registrieren'}</Text>
        </TouchableOpacity>

        {mode === 'login' && (
          <TouchableOpacity onPress={resetPassword} style={{ alignSelf: 'center', marginTop: 6 }}>
            <Text style={styles.linkText}>Passwort vergessen?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={styles.switchText}>
            {mode === 'login' ? 'Noch nicht angemeldet? Registrieren' : 'Schon ein Konto? Anmelden'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#182732', alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { alignItems: 'center', marginBottom: 20 },
  brand: { color: '#fff', fontSize: 28, fontWeight: '800' },
  card: { width: '90%', maxWidth: 420, backgroundColor: '#2E6B58', padding: 16, borderRadius: 16 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', alignSelf: 'center', marginBottom: 12 },
  input: { backgroundColor: '#184B3D', color: '#fff', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10, borderWidth: 1, borderColor: '#3D8B77' },
  primaryBtn: { backgroundColor: '#194055', paddingVertical: 12, borderRadius: 20, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  switchText: { color: '#E5F4EF', textAlign: 'center', marginTop: 4 },
  error: { color: '#FFE4E6', backgroundColor: '#7F1D1D55', padding: 8, borderRadius: 10, marginBottom: 8 },
  info: { color: '#E0F2FE', backgroundColor: '#1D4ED855', padding: 8, borderRadius: 10, marginBottom: 8 },
  linkText: { color: '#E5F4EF', fontWeight: '600' }
});
