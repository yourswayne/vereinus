import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, TextInput, FlatList, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import React, { useEffect, useMemo, useState } from 'react';

export default function Setting() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [directorOrgs, setDirectorOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Modals state
  const [showRedeem, setShowRedeem] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<'teacher' | 'student'>('teacher');
  const [inviteDays, setInviteDays] = useState<string>('2');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then((res: any) => {
      if (!alive) return;
      setSessionUserId(res.data?.session?.user?.id ?? null);
    });
    return () => { alive = false; };
  }, []);

  // Load organisations where user is director
  useEffect(() => {
    (async () => {
      if (!sessionUserId) { setDirectorOrgs([]); return; }
      const { data: mems } = await supabase
        .from('organisation_members')
        .select('org_id, role')
        .eq('user_id', sessionUserId);
      const orgIds = (mems ?? [])
        .filter((m: any) => m.role === 'director')
        .map((m: any) => m.org_id);
      if (!orgIds.length) { setDirectorOrgs([]); setSelectedOrgId(null); return; }
      const { data: orgRows } = await supabase.from('organisations').select('id,name').in('id', orgIds);
      const list = (orgRows ?? []) as { id: string; name: string }[];
      setDirectorOrgs(list);
      setSelectedOrgId((prev) => prev && list.find(o => o.id === prev) ? prev : (list[0]?.id ?? null));
    })();
  }, [sessionUserId]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Einstellungen</Text>

      {/* Abmelden */}
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: '#A93226', marginBottom: 10 }]}
        onPress={async () => { await supabase.auth.signOut(); }}
      >
        <Text style={styles.btnText}>Abmelden</Text>
      </TouchableOpacity>

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
                    <Text style={[styles.badgeText, inviteRole === r && styles.badgeTextActive, { color: inviteRole === r ? '#fff' : '#E5F4EF' }]}>{r === 'teacher' ? 'Lehrer' : 'Schüler'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Gültigkeit */}
              <Text style={[styles.label, { color: '#C7D2D6' }]}>Gültigkeit (max. 2 Tage)</Text>
              <TextInput style={[styles.input, { color: '#E5F4EF', borderColor: '#2A3E48', backgroundColor: '#0F2530' }]} keyboardType='number-pad' placeholder='1-2' placeholderTextColor={'#C7D2D6'} value={inviteDays} onChangeText={setInviteDays} />

              {!!generatedCode && (
                <Text style={{ marginBottom: 8 }}>Neuer Code: <Text style={{ fontWeight: '700' }}>{generatedCode}</Text></Text>
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
                  <Text style={[styles.btnLinkTextMuted, { color: '#C7D2D6' }]}>Schließen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#112a37',
  },
  title: { color: '#E5F4EF', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  btn: { backgroundColor: '#A93226', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
  btnSecondary: { backgroundColor: '#194055', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  btnSecondaryText: { color: '#fff', fontWeight: '700' },
  // shared inputs
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, minWidth: 220 },
  label: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 8, marginBottom: 6 },
  // badges used for selection
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 999, marginRight: 8 },
  badgeActive: { backgroundColor: '#194055', borderColor: '#194055' },
  badgeText: { color: '#111827', fontWeight: '600' },
  badgeTextActive: { color: '#fff', fontWeight: '700' },
  // modal helpers
  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  modalCenterWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '90%', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', maxHeight: 520, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 },
  btnLink: { paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLinkText: { color: '#2563EB', fontWeight: '700' },
  btnLinkTextMuted: { color: '#6B7280', fontWeight: '600' },
});
