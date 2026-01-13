import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, TextInput, FlatList, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { supabase, supabaseUsingFallback } from '../lib/supabase';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function Setting() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [directorOrgs, setDirectorOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [profileEmail, setProfileEmail] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  // Modals state
  const [showRedeem, setShowRedeem] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<'teacher' | 'student'>('teacher');
  const [inviteDays, setInviteDays] = useState<string>('2');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  const directorReqRef = useRef(0);
  const handleCopyInviteCode = useCallback(async () => {
    if (!generatedCode) return;
    try {
      await Clipboard.setStringAsync(generatedCode);
      Alert.alert('Kopiert', 'Code ist in der Zwischenablage.');
    } catch {
      Alert.alert('Fehler', 'Kopieren nicht moeglich.');
    }
  }, [generatedCode]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then((res: any) => {
      if (!alive) return;
      setSessionUserId(res.data?.session?.user?.id ?? null);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!sessionUserId) return;
      const { data: userRes } = await supabase.auth.getUser();
      if (!alive) return;
      const user = userRes?.user ?? null;
      const meta = (user?.user_metadata ?? {}) as any;
      let nextEmail = user?.email ?? '';
      let nextUsername = typeof meta.username === 'string' ? meta.username : '';
      let nextFirstName = typeof meta.first_name === 'string' ? meta.first_name : '';
      let nextLastName = typeof meta.last_name === 'string' ? meta.last_name : '';
      let profileRow: any = null;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('display_name, username, first_name, last_name')
          .eq('id', sessionUserId)
          .single();
        if (!error) profileRow = data;
      } catch {
        // ignore missing columns
      }
      if (!profileRow) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', sessionUserId)
            .single();
          profileRow = data ?? null;
        } catch {
          // ignore missing profiles table
        }
      }
      if (profileRow) {
        if (!nextUsername && profileRow.username) nextUsername = profileRow.username;
        if (!nextFirstName && profileRow.first_name) nextFirstName = profileRow.first_name;
        if (!nextLastName && profileRow.last_name) nextLastName = profileRow.last_name;
        if ((!nextFirstName || !nextLastName) && profileRow.display_name) {
          const parts = String(profileRow.display_name).trim().split(' ').filter(Boolean);
          if (!nextFirstName && parts.length) nextFirstName = parts[0];
          if (!nextLastName && parts.length > 1) nextLastName = parts.slice(1).join(' ');
        }
      }
      setProfileEmail(nextEmail);
      setProfileUsername(nextUsername);
      setProfileFirstName(nextFirstName);
      setProfileLastName(nextLastName);
    })();
    return () => { alive = false; };
  }, [sessionUserId]);

  // Load organisations where user is director
  const refreshDirectorOrgs = useCallback(async () => {
    const req = ++directorReqRef.current;
    if (!sessionUserId) { setDirectorOrgs([]); setSelectedOrgId(null); return; }
    const { data: mems } = await supabase
      .from('organisation_members')
      .select('org_id, role')
      .eq('user_id', sessionUserId);
    if (req !== directorReqRef.current) return;
    const orgIds = (mems ?? [])
      .filter((m: any) => m.role === "director")
      .map((m: any) => m.org_id);
    if (!orgIds.length) { setDirectorOrgs([]); setSelectedOrgId(null); return; }
    const { data: orgRows } = await supabase.from('organisations').select('id,name').in('id', orgIds).order('name', { ascending: true });
    if (req !== directorReqRef.current) return;
    const list = (orgRows ?? []) as { id: string; name: string }[];
    setDirectorOrgs(list);
    setSelectedOrgId((prev) => prev && list.find((o) => o.id === prev) ? prev : (list[0]?.id ?? null));
  }, [sessionUserId]);

  useEffect(() => {
    refreshDirectorOrgs();
  }, [refreshDirectorOrgs]);

  useEffect(() => {
    if (supabaseUsingFallback || !sessionUserId) return;
    const chan = (supabase as any).channel?.(`settings-orgs-${sessionUserId}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'organisation_members', filter: `user_id=eq.${sessionUserId}` }, () => {
        refreshDirectorOrgs();
      })
      ?.subscribe();
    return () => chan?.unsubscribe?.();
  }, [sessionUserId, supabaseUsingFallback, refreshDirectorOrgs]);

  const SETTINGS_REFRESH_MS = 2000;
  useEffect(() => {
    if (supabaseUsingFallback || !sessionUserId) return;
    const tick = () => { refreshDirectorOrgs(); };
    tick();
    const id = setInterval(tick, SETTINGS_REFRESH_MS);
    return () => clearInterval(id);
  }, [sessionUserId, supabaseUsingFallback, refreshDirectorOrgs]);

  const saveProfile = async () => {
    if (!sessionUserId || profileBusy) return;
    const cleanEmail = profileEmail.trim();
    const cleanUsername = profileUsername.trim().toLowerCase();
    const cleanFirstName = profileFirstName.trim();
    const cleanLastName = profileLastName.trim();
    if (!cleanEmail || !cleanUsername || !cleanFirstName || !cleanLastName) {
      Alert.alert('Hinweis', 'Bitte E-Mail, Benutzername, Vorname und Nachname eingeben.');
      return;
    }
    setProfileBusy(true);
    try {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', cleanUsername)
          .neq('id', sessionUserId)
          .limit(1);
        if (!error && (data ?? []).length) {
          Alert.alert('Hinweis', 'Benutzername ist bereits vergeben.');
          return;
        }
      } catch {
        // ignore username lookup if column does not exist
      }

      const { error: authErr } = await supabase.auth.updateUser({
        email: cleanEmail,
        data: {
          username: cleanUsername,
          first_name: cleanFirstName,
          last_name: cleanLastName,
        },
      });
      if (authErr) {
        Alert.alert('Fehler', authErr.message);
        return;
      }

      const fullName = `${cleanFirstName} ${cleanLastName}`.trim();
      const displayName = fullName || cleanUsername;
      let profileError: any = null;
      try {
        const { error } = await supabase.from('profiles').upsert({
          id: sessionUserId,
          display_name: displayName,
          username: cleanUsername,
          first_name: cleanFirstName,
          last_name: cleanLastName,
          email: cleanEmail,
        });
        if (error) profileError = error;
      } catch (e) {
        profileError = e;
      }
      if (profileError) {
        try {
          await supabase.from('profiles').upsert({
            id: sessionUserId,
            display_name: displayName,
          });
        } catch {
          // ignore profile upsert errors
        }
      }

      Alert.alert(
        'Erfolg',
        'Profil gespeichert. Falls du die E-Mail geändert hast, bitte bestätigen.',
      );
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Einstellungen</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profil</Text>
          <TextInput
            style={styles.profileInput}
            placeholder="Benutzername"
            placeholderTextColor={'#9CA3AF'}
            autoCapitalize="none"
            value={profileUsername}
            onChangeText={setProfileUsername}
          />
          <TextInput
            style={styles.profileInput}
            placeholder="Vorname"
            placeholderTextColor={'#9CA3AF'}
            autoCapitalize="words"
            value={profileFirstName}
            onChangeText={setProfileFirstName}
          />
          <TextInput
            style={styles.profileInput}
            placeholder="Nachname"
            placeholderTextColor={'#9CA3AF'}
            autoCapitalize="words"
            value={profileLastName}
            onChangeText={setProfileLastName}
          />
          <TextInput
            style={styles.profileInput}
            placeholder="E-Mail"
            placeholderTextColor={'#9CA3AF'}
            autoCapitalize="none"
            keyboardType="email-address"
            value={profileEmail}
            onChangeText={setProfileEmail}
          />
          <TouchableOpacity
            style={[styles.btnSecondary, profileBusy && styles.btnDisabled]}
            onPress={saveProfile}
            disabled={profileBusy}
          >
            <Text style={styles.btnSecondaryText}>{profileBusy ? 'Speichern...' : 'Profil speichern'}</Text>
          </TouchableOpacity>
        </View>


        {/* Einladungscode einlösen */}
        <TouchableOpacity style={styles.btnSecondary} onPress={() => setShowRedeem(true)}>
          <Text style={styles.btnSecondaryText}>Einladungscode einlösen</Text>
        </TouchableOpacity>

        {/* Einladungscode generieren (nur Director-Orgs) */}
        {!!directorOrgs.length && (
          <TouchableOpacity style={styles.btnSecondary} onPress={() => setShowInvite(true)}>
            <Text style={styles.btnSecondaryText}>Einladungscode generieren</Text>
          </TouchableOpacity>
        )}

        {/* Abmelden */}
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#A93226', marginTop: 12, marginBottom: 10 }]}
          onPress={async () => { await supabase.auth.signOut(); }}
        >
          <Text style={styles.btnText}>Abmelden</Text>
        </TouchableOpacity>

        {/* Modal: Einladungscode einlösen */}
        <Modal visible={showRedeem} transparent animationType="fade" onRequestClose={() => setShowRedeem(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowRedeem(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={[styles.modalCard, { backgroundColor: '#112a37', borderColor: '#2A3E48' }]}>
              <View style={{ padding: 12 }}>
                <Text style={[styles.h2, { color: '#E5F4EF' }]}>Einladungscode einlösen</Text>
                <TextInput style={[styles.input, { color: '#E5F4EF', borderColor: '#2A3E48', backgroundColor: '#0F2530' }]} placeholder='CODE' placeholderTextColor={'#C7D2D6'} autoCapitalize='characters' value={inviteCode} onChangeText={setInviteCode} />
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={async () => {
                    const code = inviteCode.trim();
                    if (!code) return;
                    const { data, error } = await (supabase as any).rpc('redeem_invite', { p_code: code });
                    if (error) Alert.alert('Fehler', error.message);
                    else Alert.alert('Erfolg', 'Einladung angenommen.');
                    setInviteCode(''); setShowRedeem(false);
                  }}>
                    <Text style={[styles.btnLinkText, { color: '#9AD0C1' }]}>Einlösen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={() => setShowRedeem(false)}>
                    <Text style={[styles.btnLinkTextMuted, { color: '#C7D2D6' }]}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal: Einladungscode generieren */}
        <Modal visible={showInvite} transparent animationType="fade" onRequestClose={() => setShowInvite(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowInvite(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={[styles.modalCard, { backgroundColor: '#112a37', borderColor: '#2A3E48' }]}>
              <View style={{ padding: 12 }}>
                <Text style={[styles.h2, { color: '#E5F4EF' }]}>Einladungscode generieren</Text>
                {/* Org Auswahl */}
                <Text style={[styles.label, { color: '#C7D2D6' }]}>Verein</Text>
                <FlatList
                  horizontal
                  data={directorOrgs}
                  keyExtractor={(o) => o.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity onPress={() => setSelectedOrgId(item.id)} style={[styles.badge, selectedOrgId === item.id && styles.badgeActive, { borderColor: '#2A3E48' }]}>
                      <Text style={[styles.badgeText, selectedOrgId === item.id && styles.badgeTextActive, { color: selectedOrgId === item.id ? '#fff' : '#E5F4EF' }]}>{item.name}</Text>
                    </TouchableOpacity>
                  )}
                  style={{ marginBottom: 8 }}
                />

                {/* Rolle */}
                <Text style={[styles.label, { color: '#C7D2D6' }]}>Rolle</Text>
                <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                  {(['teacher', 'student'] as const).map(r => (
                    <TouchableOpacity key={r} onPress={() => setInviteRole(r)} style={[styles.badge, inviteRole === r && styles.badgeActive, { marginRight: 8, borderColor: '#2A3E48' }]}>
                      <Text style={[styles.badgeText, inviteRole === r && styles.badgeTextActive, { color: inviteRole === r ? '#fff' : '#E5F4EF' }]}>{r === 'teacher' ? 'Lehrer' : 'Schueler'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Gueltigkeit */}
                <Text style={[styles.label, { color: '#C7D2D6' }]}>Gueltigkeit (max. 2 Tage)</Text>
                <TextInput style={[styles.input, { color: '#E5F4EF', borderColor: '#2A3E48', backgroundColor: '#0F2530' }]} keyboardType='number-pad' placeholder='1-2' placeholderTextColor={'#C7D2D6'} value={inviteDays} onChangeText={setInviteDays} />

                {!!generatedCode && (
                  <View style={styles.inviteCodeRow}>
                    <View style={styles.inviteCodeTextWrap}>
                      <Text style={styles.inviteCodeLabel}>Neuer Code</Text>
                      <Text style={styles.inviteCodeValue}>{generatedCode}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.copyButton}
                      onPress={handleCopyInviteCode}
                      accessibilityRole="button"
                      accessibilityLabel="Code kopieren"
                    >
                      <Ionicons name="copy-outline" size={18} color="#E5F4EF" />
                    </TouchableOpacity>
                  </View>
                )}

                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={async () => {
                    if (!selectedOrgId) { Alert.alert('Hinweis', 'Bitte Verein wählen'); return; }
                    const parsed = parseInt(inviteDays || '2', 10);
                    const days = Math.max(1, Math.min(2, Number.isNaN(parsed) ? 2 : parsed));
                    const { data, error } = await (supabase as any).rpc('create_invite', {
                      p_org: selectedOrgId,
                      p_role: inviteRole,
                      p_valid_days: days,
                    });
                    if (error) Alert.alert('Fehler', error.message);
                    else setGeneratedCode((data as any)?.code ?? null);
                  }}>
                    <Text style={[styles.btnLinkText, { color: '#9AD0C1' }]}>Generieren</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={() => { setShowInvite(false); setGeneratedCode(null); }}>
                    <Text style={[styles.btnLinkTextMuted, { color: '#C7D2D6' }]}>Schliessen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#112a37',
  },
  content: { alignItems: 'center', top: 17, paddingTop: 48, paddingBottom: 24, paddingHorizontal: 16 },
  title: { color: '#E5F4EF', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  section: { width: '100%', maxWidth: 420, marginBottom: 16 },
  sectionTitle: { color: '#E5F4EF', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  btn: { backgroundColor: '#A93226', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
  btnSecondary: { backgroundColor: '#194055', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 12 },
  btnSecondaryText: { color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  profileInput: { borderWidth: 1, borderColor: '#2A3E48', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, color: '#E5F4EF', backgroundColor: '#0F2530' },
  // shared inputs
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, minWidth: 220 },
  label: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 8, marginBottom: 6 },
  // badges used for selection
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 999, marginRight: 8 },
  badgeActive: { backgroundColor: '#194055', borderColor: '#194055' },
  badgeText: { color: '#111827', fontWeight: '600' },
  badgeTextActive: { color: '#fff', fontWeight: '700' },
  inviteCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#2A3E48', borderRadius: 10, backgroundColor: '#0F2530' },
  inviteCodeTextWrap: { flex: 1 },
  inviteCodeLabel: { color: '#C7D2D6', fontSize: 12, marginBottom: 2 },
  inviteCodeValue: { color: '#E5F4EF', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  copyButton: { padding: 8, marginLeft: 8, borderRadius: 8, backgroundColor: '#194055', alignItems: 'center', justifyContent: 'center' },
  // modal helpers
  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  modalCenterWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '90%', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', maxHeight: 520, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 },
  btnLink: { paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLinkText: { color: '#2563EB', fontWeight: '700' },
  btnLinkTextMuted: { color: '#6B7280', fontWeight: '600' },
});

