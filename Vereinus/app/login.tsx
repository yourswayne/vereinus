import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      // RootLayout reagiert auf Session-Änderungen; keine Navigation nötig
    })();
    return () => { mounted = false; };
  }, []);

  const resolveEmailFromIdentifier = async (identifier: string) => {
    const clean = identifier.trim();
    if (!clean) return { email: null, error: 'Bitte E-Mail oder Benutzername eingeben.' };
    if (clean.includes('@')) return { email: clean.toLowerCase(), error: null };
    const usernameKey = clean.toLowerCase();
    try {
      const { data, error } = await supabase.rpc('resolve_login_email', { p_identifier: usernameKey });
      const rpcEmail = typeof data === 'string' ? data.trim() : '';
      if (!error && rpcEmail) return { email: rpcEmail.toLowerCase(), error: null };
      if (!error && !rpcEmail) return { email: null, error: 'Benutzername nicht gefunden.' };
    } catch {
      // ignore rpc errors and fallback to profiles query
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('email, username')
        .eq('username', usernameKey)
        .limit(1);
      if (error) return { email: null, error: 'Benutzername nicht verfuegbar. Bitte E-Mail verwenden.' };
      const found = (data ?? [])[0]?.email ?? null;
      if (!found) return { email: null, error: 'Benutzername nicht gefunden.' };
      return { email: String(found).toLowerCase(), error: null };
    } catch {
      return { email: null, error: 'Benutzername nicht verfuegbar. Bitte E-Mail verwenden.' };
    }
  };

  const syncProfileFromUser = async (user?: any) => {
    try {
      const current = user ?? (await supabase.auth.getUser()).data?.user;
      if (!current) return;
      const meta = (current.user_metadata ?? {}) as any;
      const usernameMeta = typeof meta.username === 'string' ? meta.username.trim().toLowerCase() : '';
      const firstNameMeta = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
      const lastNameMeta = typeof meta.last_name === 'string' ? meta.last_name.trim() : '';
      const fullNameMeta = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
      const composedFull = [firstNameMeta, lastNameMeta].filter(Boolean).join(' ').trim();
      const displayName = composedFull || fullNameMeta || usernameMeta || (current.email ?? '');
      const payload: any = { id: current.id, display_name: displayName };
      if (usernameMeta) payload.username = usernameMeta;
      if (firstNameMeta) payload.first_name = firstNameMeta;
      if (lastNameMeta) payload.last_name = lastNameMeta;
      if (current.email) payload.email = current.email;
      let profileError: any = null;
      try {
        const { error } = await supabase.from('profiles').upsert(payload);
        if (error) profileError = error;
      } catch (e) {
        profileError = e;
      }
      if (profileError) {
        try {
          await supabase.from('profiles').upsert({ id: current.id, display_name: displayName });
        } catch {
          // ignore profile upsert errors
        }
      }
    } catch {
      // ignore sync errors
    }
  };

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!email || !password) { setError('Bitte E-Mail/Benutzername und Passwort eingeben'); return; }
    if (mode === 'login') {
      const { email: loginEmail, error: lookupError } = await resolveEmailFromIdentifier(email);
      if (!loginEmail) { setError(lookupError ?? 'Benutzername oder E-Mail ungueltig.'); return; }
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) setError(error.message);
      else await syncProfileFromUser(data?.user);
    } else {
      const cleanEmail = email.trim();
      const cleanUsername = username.trim().toLowerCase();
      const cleanFirstName = firstName.trim();
      const cleanLastName = lastName.trim();
      if (!cleanEmail || !cleanUsername || !cleanFirstName || !cleanLastName || !password) {
        setError('Bitte Benutzername, Vorname, Nachname, E-Mail und Passwort eingeben.');
        return;
      }
      try {
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', cleanUsername)
          .limit(1);
        if ((existing ?? []).length) {
          setError('Benutzername ist bereits vergeben.');
          return;
        }
      } catch {
        // ignore lookup errors (profiles table might not be available)
      }
      const fullName = `${cleanFirstName} ${cleanLastName}`.trim();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            username: cleanUsername,
            first_name: cleanFirstName,
            last_name: cleanLastName,
            full_name: fullName,
          },
        },
      });
      if (error) setError(error.message);
      else {
        if (data?.user?.id) {
          const profileId = data.user.id;
          const displayName = fullName || cleanUsername;
          let profileError: any = null;
          try {
            const { error: upsertError } = await supabase.from('profiles').upsert({
              id: profileId,
              display_name: displayName,
              username: cleanUsername,
              first_name: cleanFirstName,
              last_name: cleanLastName,
              email: cleanEmail,
            });
            if (upsertError) profileError = upsertError;
          } catch (e) {
            profileError = e;
          }
          if (profileError) {
            try {
              await supabase.from('profiles').upsert({
                id: profileId,
                display_name: displayName,
              });
            } catch {
              // ignore profile upsert errors
            }
          }
        }
        // Wenn E-Mail-Verifizierung aktiviert ist, existiert noch keine Session.
        setInfo('Bitte E-Mail bestaetigen. Wir haben dir eine Bestaetigungsmail gesendet.');
      }
    }
  };
  const resetPassword = async () => {
    setError(null);
    setInfo(null);
    const { email: resetEmail, error: lookupError } = await resolveEmailFromIdentifier(email);
    if (!resetEmail) { setError(lookupError ?? 'Bitte E-Mail eingeben'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail as any);
    if (error) setError(error.message);
    else setInfo('Link zum Zuruecksetzen gesendet. Bitte E-Mail pruefen.');
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
        {mode === 'register' && (
          <>
            <TextInput
              style={styles.input}
              placeholder={'Benutzername'}
              placeholderTextColor={'#C7D2D6'}
              autoCapitalize='none'
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              style={styles.input}
              placeholder={'Vorname'}
              placeholderTextColor={'#C7D2D6'}
              value={firstName}
              onChangeText={setFirstName}
            />
            <TextInput
              style={styles.input}
              placeholder={'Nachname'}
              placeholderTextColor={'#C7D2D6'}
              value={lastName}
              onChangeText={setLastName}
            />
          </>
        )}
        <TextInput
          style={styles.input}
          placeholder={mode === 'login' ? 'E-Mail oder Benutzername' : 'E-Mail'}
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


