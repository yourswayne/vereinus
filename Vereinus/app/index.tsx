import { View, Text, StyleSheet, Button, BackHandler, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Modal, Pressable, Keyboard, Image, Alert } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type Screen = 'home' | 'ankuendigung' | 'chat' | 'uebungen' | 'aufgaben';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const insets = useSafeAreaInsets();
  const containerPaddings = { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 };
  // Chat messages (remote)
  const [messages, setMessages] = useState<{ id: string; text: string; from: 'me' | 'other'; at: string }[]>([]);
  const [draft, setDraft] = useState('');
  // Chat input auto-grow up to a limit, then scroll
  const MIN_CHAT_INPUT_HEIGHT = 56;
  const MAX_CHAT_INPUT_HEIGHT = 120;
  const TAB_BAR_HEIGHT = 56; // Keep input above native tab bar
  const [chatInputHeight, setChatInputHeight] = useState<number>(MIN_CHAT_INPUT_HEIGHT);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const s = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardVisible(true);
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    });
    const h = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => { s.remove(); h.remove(); };
  }, []);

  // --- Supabase session + Orgs/Groups + remote Announcements ---
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string; logo_url?: string | null }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; org_id: string; image_url?: string | null }[]>([]);
  const [showSwitchHome, setShowSwitchHome] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [orgRole, setOrgRole] = useState<'director' | 'teacher' | 'student' | null>(null);
  const [annRemote, setAnnRemote] = useState<{ id: string; title: string; body: string | null; event_date: string | null }[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  // --- Chat from Supabase ---
  const [chatChannelId, setChatChannelId] = useState<string | null>(null);
  const [rtSubKey, setRtSubKey] = useState<string | null>(null);
  // --- Create Org/Group modals ---
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [chatMode, setChatMode] = useState<'pick' | 'in'>('pick');
  const [showRenameGroup, setShowRenameGroup] = useState(false);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupName, setRenameGroupName] = useState('');
  const groupsReqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSessionUserId(data.session?.user?.id ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e: any, s: any) => {
      setSessionUserId(s?.user?.id ?? null);
    });
    return () => { sub.subscription.unsubscribe(); alive = false; };
  }, []);

  useEffect(() => {
    (async () => {
      if (!sessionUserId) {
        setOrgs([]); setGroups([]); setSelectedOrgId(null); setSelectedGroupId(null); setOrgRole(null); setAnnRemote([]);
        return;
      }
      // load org memberships and orgs
      const { data: mems } = await supabase.from('organisation_members').select('org_id, role').eq('user_id', sessionUserId);
      const memsTyped = (mems ?? []) as { org_id: string; role: 'director' | 'teacher' | 'student' }[];
      const orgIds = memsTyped.map(m => m.org_id);
      if (!orgIds.length) { setOrgs([]); return; }
      const { data: orgRows } = await supabase.from('organisations').select('id, name, logo_url').in('id', orgIds);
      const orgList = (orgRows ?? []) as any[];
      setOrgs(orgList);
      const nextOrg = selectedOrgId && orgIds.includes(selectedOrgId) ? selectedOrgId : (orgList[0]?.id ?? null);
      setSelectedOrgId(nextOrg);
      setOrgRole(memsTyped.find(m => m.org_id === nextOrg)?.role ?? null);
      if (nextOrg) {
        // defer to fast group loader effect
        setGroups([]); setSelectedGroupId(null);
      } else {
        setGroups([]); setSelectedGroupId(null);
      }
    })();
  }, [sessionUserId]);
  const refreshOrgsAndGroups = async () => {
    if (!sessionUserId) {
      setOrgs([]); setGroups([]); setSelectedOrgId(null); setSelectedGroupId(null); setOrgRole(null); setAnnRemote([]);
      return;
    }
    const { data: mems } = await supabase.from('organisation_members').select('org_id, role').eq('user_id', sessionUserId);
    const memsTyped = (mems ?? []) as { org_id: string; role: 'director' | 'teacher' | 'student' }[];
    const orgIds = memsTyped.map(m => m.org_id);
    if (!orgIds.length) { setOrgs([]); setSelectedOrgId(null); setGroups([]); setSelectedGroupId(null); setOrgRole(null); return; }
    const { data: orgRows } = await supabase.from('organisations').select('id, name, logo_url').in('id', orgIds);
    const orgList = (orgRows ?? []) as any[];
    setOrgs(orgList);
    const nextOrg = selectedOrgId && orgIds.includes(selectedOrgId) ? selectedOrgId : (orgList[0]?.id ?? null);
    setSelectedOrgId(nextOrg);
    setOrgRole(memsTyped.find(m => m.org_id === nextOrg)?.role ?? null);
    if (nextOrg) {
      const { data: gm } = await supabase.from('group_members').select('group_id').eq('user_id', sessionUserId);
      const gmTyped = (gm ?? []) as { group_id: string }[];
      const gIds = gmTyped.map((x) => x.group_id);
      const { data: groupRows } = await supabase.from('groups').select('id, name, org_id, image_url').eq('org_id', nextOrg).in('id', gIds.length ? gIds : ['00000000-0000-0000-0000-000000000000']);
      const list = (groupRows ?? []) as any[];
      setGroups(list);
      setSelectedGroupId((list[0]?.id ?? null));
    } else {
      setGroups([]); setSelectedGroupId(null);
    }
  };

  const deleteOrganisationCascade = async (orgId: string) => {
    try {
      const { data: chans, error: chSelErr } = await supabase.from('channels').select('id').eq('org_id', orgId);
      if (chSelErr) throw chSelErr;
      const channelIds = (chans ?? []).map((c: any) => c.id);
      if (channelIds.length) {
        const { error: msgDelErr } = await supabase.from('messages').delete().in('channel_id', channelIds);
        if (msgDelErr) throw msgDelErr;
      }

      const { error: chanDelErr } = await supabase.from('channels').delete().eq('org_id', orgId);
      if (chanDelErr) throw chanDelErr;

      const { data: gs, error: gSelErr } = await supabase.from('groups').select('id').eq('org_id', orgId);
      if (gSelErr) throw gSelErr;
      const gIds = (gs ?? []).map((g: any) => g.id);
      if (gIds.length) {
        const { error: gmDelErr } = await supabase.from('group_members').delete().in('group_id', gIds);
        if (gmDelErr) throw gmDelErr;
      }

      const { error: annDelErr } = await supabase.from('announcements').delete().eq('org_id', orgId);
      if (annDelErr) throw annDelErr;

      const { error: grpDelErr } = await supabase.from('groups').delete().eq('org_id', orgId);
      if (grpDelErr) throw grpDelErr;

      const { error: memDelErr } = await supabase.from('organisation_members').delete().eq('org_id', orgId);
      if (memDelErr) throw memDelErr;

      const { error: orgDelErr } = await supabase.from('organisations').delete().eq('id', orgId);
      if (orgDelErr) throw orgDelErr;

      return true;
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Löschen fehlgeschlagen.');
      return false;
    }
  };

  const deleteGroupCascade = async (groupId: string) => {
    try {
      const { data: chans, error: chSelErr } = await supabase.from('channels').select('id').eq('group_id', groupId);
      if (chSelErr) throw chSelErr;
      const channelIds = (chans ?? []).map((c: any) => c.id);
      if (channelIds.length) {
        const { error: msgDelErr } = await supabase.from('messages').delete().in('channel_id', channelIds);
        if (msgDelErr) throw msgDelErr;
      }
      const { error: chanDelErr } = await supabase.from('channels').delete().eq('group_id', groupId);
      if (chanDelErr) throw chanDelErr;
      const { error: annDelErr } = await supabase.from('announcements').delete().eq('group_id', groupId);
      if (annDelErr) throw annDelErr;
      const { error: memDelErr } = await supabase.from('group_members').delete().eq('group_id', groupId);
      if (memDelErr) throw memDelErr;
      const { error: grpDelErr } = await supabase.from('groups').delete().eq('id', groupId);
      if (grpDelErr) throw grpDelErr;
      return true;
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Gruppe konnte nicht gelöscht werden.');
      return false;
    }
  };

  useEffect(() => {
    (async () => {
      if (!selectedOrgId || !sessionUserId) { setAnnRemote([]); return; }
      setLoadingRemote(true);
      let q = supabase.from('announcements').select('id,title,body,event_date').eq('org_id', selectedOrgId).order('created_at', { ascending: false });
      if (selectedGroupId) q = q.eq('group_id', selectedGroupId); else q = q.is('group_id', null);
      const { data } = await q;
      setAnnRemote((data ?? []) as any[]);
      setLoadingRemote(false);
    })();
  }, [selectedOrgId, selectedGroupId, sessionUserId]);

  useEffect(() => {
    if (screen === 'chat') setChatMode('pick');
  }, [screen]);

  // Fast group loader on org change with request guard
  useEffect(() => {
    (async () => {
      if (!selectedOrgId || !sessionUserId) { setGroups([]); setSelectedGroupId(null); return; }
      const req = ++groupsReqRef.current;
      // clear stale immediately for snappy UI
      setGroups([]); setSelectedGroupId(null); setChatChannelId(null); setChatMode('pick');
      const { data, error } = await (supabase.from('groups') as any)
        .select('id,name,org_id,image_url, group_members!inner(user_id)')
        .eq('org_id', selectedOrgId)
        .eq('group_members.user_id', sessionUserId);
      if (groupsReqRef.current !== req) return; // stale
      if (error) { setGroups([]); setSelectedGroupId(null); return; }
      const list = ((data ?? []) as any[]).map((g: any) => ({ id: g.id, name: g.name, org_id: g.org_id, image_url: g.image_url }));
      setGroups(list);
      setSelectedGroupId(list[0]?.id ?? null);
    })();
  }, [selectedOrgId, sessionUserId]);

  // Load chat channel for selection; auto-create default for Director (no button UI)
  useEffect(() => {
    (async () => {
      if (!selectedOrgId || !sessionUserId) { setChatChannelId(null); return; }
      let q = supabase.from('channels').select('id,name').eq('org_id', selectedOrgId);
      if (selectedGroupId) q = q.eq('group_id', selectedGroupId); else q = q.is('group_id', null as any);
      const { data } = await q as any;
      const ch = (data ?? [])[0];
      if (ch?.id) {
        setChatChannelId(ch.id);
      } else if (orgRole === 'director') {
        const { data: created, error } = await (supabase.from('channels') as any)
          .insert({ org_id: selectedOrgId, group_id: selectedGroupId, name: 'Allgemein' })
          .select('id')
          .single();
        if (!error && created) setChatChannelId((created as any).id);
        else setChatChannelId(null);
      } else {
        setChatChannelId(null);
      }
    })();
  }, [selectedOrgId, selectedGroupId, sessionUserId, orgRole]);

  // Load messages and subscribe
  useEffect(() => {
    let unsub: any = null;
    (async () => {
      if (!chatChannelId) return;
      // initial load
      const { data } = await (supabase.from('messages')
        .select('id, user_id, body, created_at')
        .eq('channel_id', chatChannelId)
        .order('created_at', { ascending: true }) as any);
      const rows = (data ?? []) as { id: string; user_id: string; body: string; created_at: string }[];
      setMessages(rows.map(r => ({ id: r.id, text: r.body, from: r.user_id === sessionUserId ? 'me' : 'other', at: timeFromIso(r.created_at) })) as any);
      // realtime
      const chan = (supabase as any).channel?.(`msg-${chatChannelId}`)
        ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${chatChannelId}` }, (payload: any) => {
          const r = payload.new as { id: string; user_id: string; body: string; created_at: string };
          setMessages((prev: any) => (prev.some((m: any) => m.id === r.id) ? prev : [...prev, { id: r.id, text: r.body, from: r.user_id === sessionUserId ? 'me' : 'other', at: timeFromIso(r.created_at) }]));
        })
        ?.subscribe();
      unsub = () => chan?.unsubscribe?.();
    })();
    return () => { if (unsub) unsub(); };
  }, [chatChannelId, sessionUserId]);

  // Announcements state (template)
  const [announcements, setAnnouncements] = useState(
    [
      { id: 'a1', title: 'Sommerfest am 21.07.', body: 'Ab 14 Uhr auf dem Vereinsgelände. Kuchen- und Salatspenden willkommen!', date: '2025-07-10' },
      { id: 'a2', title: 'Neue Trikots eingetroffen', body: 'Abholung diese Woche beim Training möglich.', date: '2025-07-08' },
    ]
  );
  const [showNewAnnouncement, setShowNewAnnouncement] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');

  // Hardware-Back für Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen !== 'home') {
        setScreen('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  // Beim erneuten Tippen auf den Verein-Tab immer zur Startseite wechseln
  useEffect(() => {
    return navigation.addListener('tabPress', () => {
      setScreen('home');
    });
  }, [navigation]);


  if (screen === 'ankuendigung') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'flex-start' }, containerPaddings]}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={() => setScreen('home')} style={[styles.headerBack, {bottom: 60}]}>
            <Ionicons name="chevron-back" size={22} color="#194055" />
            
          </TouchableOpacity>
          <Text style={[styles.title, { marginBottom: 0, bottom: 60, left: 17 }]}>Ankündigungen</Text>
          <View style={{ width: 60 }} />

            {!!groups.length && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                
              </View>
            )}
        </View>

        <FlatList
          data={annRemote}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, width: '100%', maxWidth: 360 }}
          renderItem={({ item }) => (
            <View style={styles.card}> 
              <Text style={styles.annTitle}>{item.title}</Text>
              <Text style={styles.annMeta}>{item.event_date ? formatDateDE(item.event_date) : 'Ohne Datum'}</Text>
              {!!item.body && <Text style={styles.annBody}>{item.body}</Text>}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.text}>{loadingRemote ? 'Laden…' : 'Keine Ankündigungen vorhanden.'}</Text>}
        />

        {(sessionUserId && (orgRole === 'teacher' || orgRole === 'director') && selectedOrgId) && (
          <TouchableOpacity style={[styles.button, { marginTop: 8 }]} onPress={() => setShowNewAnnouncement(true)}>
            <Text style={styles.buttonText}>+ Neue Ankündigung</Text>
          </TouchableOpacity>
        )}


        <Modal visible={showNewAnnouncement} transparent animationType="fade" onRequestClose={() => setShowNewAnnouncement(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowNewAnnouncement(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={styles.modalCard}>
              <View style={{ padding: 12 }}>
                <Text style={[styles.sectionTitle,  ]}>Ankündigungen</Text>
                <TextInput style={styles.input} placeholder="Titel" placeholderTextColor={'#95959588'} value={newTitle} onChangeText={setNewTitle} />
                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder="Inhalt"
                  placeholderTextColor={'#95959588'}
                  value={newBody}
                  onChangeText={setNewBody}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity
                    style={[styles.btnLink, { marginRight: 8 }]}
                    onPress={async () => {
                      const t = newTitle.trim();
                      const b = newBody.trim();
                      if (!t || !selectedOrgId || !sessionUserId) return;
                      const payload: any = { org_id: selectedOrgId, group_id: selectedGroupId, author_id: sessionUserId, title: t, body: b || null };
                      const { data, error } = await supabase.from('announcements').insert(payload).select('id,title,body,event_date').single();
                      if (!error && data) {
                        setAnnRemote((prev) => [data as any, ...prev]);
                        setNewTitle(''); setNewBody(''); setShowNewAnnouncement(false);
                      }
                    }}
                  >
                    <Text style={styles.btnLinkText}>Speichern</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={() => setShowNewAnnouncement(false)}>
                    <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
        {/* Modal: Verein erstellen */}
        

        {/* Modal: Gruppe erstellen */}
        
      </SafeAreaView>
    );
  }

  if (screen === 'chat') {
    if (chatMode === 'pick') {
      return (
        <SafeAreaView style={[styles.container, { justifyContent: 'flex-start' }, containerPaddings]}>
          <View style={styles.chatHeader}>
            <TouchableOpacity onPress={() => setScreen('home')} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0, left: 12 }]}>Kommunikationskanal</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: 12 }}>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { setSelectedGroupId(item.id); setChatMode('in'); }}
                  onLongPress={() => {
                    if (orgRole !== 'director') return;
                    Alert.alert('Gruppe', 'Aktion wählen', [
                      { text: 'Umbenennen', onPress: () => { setRenameGroupId(item.id); setRenameGroupName(item.name); setShowRenameGroup(true); } },
                      { text: 'Löschen', style: 'destructive', onPress: async () => { const ok = await deleteGroupCascade(item.id); if (ok) { setGroups((prev) => prev.filter(g => g.id !== item.id)); if (selectedGroupId === item.id) { setSelectedGroupId(null); setChatMode('pick'); setChatChannelId(null); } } } },
                      { text: 'Abbrechen', style: 'cancel' },
                    ]);
                  }}
                  style={styles.card}
                >
                  <Text style={{ fontWeight: '700', color: '#E5F4EF' }}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={(
                <View style={{ paddingVertical: 8 }}>
                  <Text style={styles.text}>Keine Gruppen vorhanden.</Text>
                  {(orgRole === 'director') && (
                    <TouchableOpacity style={[styles.button]} onPress={() => setShowCreateGroup(true)}>
                      <Text style={styles.buttonText}>+ Gruppe erstellen</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
            {(orgRole === 'director' && groups.length > 0) && (
              <TouchableOpacity style={[styles.button, { marginTop: 8 }]} onPress={() => setShowCreateGroup(true)}>
                <Text style={styles.buttonText}>+ Gruppe erstellen</Text>
              </TouchableOpacity>
            )}
          </View>
          <Modal visible={showCreateGroup} transparent animationType="fade" onRequestClose={() => setShowCreateGroup(false)}>
            <Pressable style={styles.modalOverlay} onPress={() => setShowCreateGroup(false)} />
            <View style={styles.modalCenterWrap}>
              <View style={styles.modalCard}>
                <View style={{ padding: 12 }}>
                  <Text style={styles.sectionTitle}>Gruppe erstellen</Text>
                  <TextInput style={styles.input} placeholder="Gruppenname" placeholderTextColor={'#95959588'} value={newGroupName} onChangeText={setNewGroupName} />
                  <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={async () => {
                      const name = newGroupName.trim();
                      if (!name || !selectedOrgId || !sessionUserId) return;
                      const ins = await supabase.from('groups').insert({ org_id: selectedOrgId, name }).select('id').single();
                      if (ins.error) { Alert.alert('Fehler', ins.error.message); return; }
                      const gid = (ins.data as any)?.id as string;
                      if (gid) {
                        await supabase.from('group_members').insert({ group_id: gid, user_id: sessionUserId });
                        setSelectedGroupId(gid);
                        setChatMode('in');
                      }
                      setNewGroupName('');
                      setShowCreateGroup(false);
                      await refreshOrgsAndGroups();
                    }}>
                      <Text style={styles.btnLinkText}>Erstellen</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnLink} onPress={() => setShowCreateGroup(false)}>
                      <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </Modal>
          <Modal visible={showRenameGroup} transparent animationType="fade" onRequestClose={() => setShowRenameGroup(false)}>
            <Pressable style={styles.modalOverlay} onPress={() => setShowRenameGroup(false)} />
            <View style={styles.modalCenterWrap}>
              <View style={styles.modalCard}>
                <View style={{ padding: 12 }}>
                  <Text style={styles.sectionTitle}>Gruppe umbenennen</Text>
                  <TextInput style={styles.input} placeholder="Neuer Name" placeholderTextColor={'#95959588'} value={renameGroupName} onChangeText={setRenameGroupName} />
                  <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={async () => {
                      const id = renameGroupId; const name = renameGroupName.trim();
                      if (!id || !name) return;
                      const { error } = await supabase.from('groups').update({ name }).eq('id', id);
                      if (error) Alert.alert('Fehler', error.message);
                      else { setGroups(prev => prev.map(g => g.id === id ? { ...g, name } : g)); setShowRenameGroup(false); }
                    }}>
                      <Text style={styles.btnLinkText}>Speichern</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnLink} onPress={() => setShowRenameGroup(false)}>
                      <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      );
    }
    const renderItem = ({ item }: { item: typeof messages[number] }) => (
      <View style={[styles.bubbleRow, item.from === 'me' ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[styles.bubble, item.from === 'me' ? styles.bubbleMe : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, item.from === 'me' && { color: '#fff' }]}>{item.text}</Text>
          <Text style={styles.bubbleTime}>{item.at}</Text>
        </View>
      </View>
    );

    const bottomGap = keyboardVisible ? 8 : insets.bottom + TAB_BAR_HEIGHT + 8;
    const chatPaddings = { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 12 };
    return (
      <KeyboardAvoidingView style={[styles.container, chatPaddings, { justifyContent: 'flex-start' }]} behavior={'padding'}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={() => setScreen('home')} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={22} color="#194055" />
          </TouchableOpacity>
          <Text style={[styles.title, { marginBottom: 0, left: 12 }]}>{(groups.find(g => g.id === selectedGroupId)?.name) || 'Chat'}</Text>
          <View style={{ width: 60 }} />
        </View>
        <FlatList
          style={{ width: '100%', flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 12, width: '100%', maxWidth: 720 }}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
        />
        {/* Kanal-Hinweis entfernt: für Director wird automatisch ein Standardkanal erstellt */}
        <View style={[styles.inputRow, { marginBottom: bottomGap}]}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0, height: chatInputHeight, maxHeight: MAX_CHAT_INPUT_HEIGHT }]}
            placeholder="Nachricht schreiben…"
            placeholderTextColor={'#95959588'}
            value={draft}
            onChangeText={setDraft}
            multiline
            scrollEnabled={chatInputHeight >= MAX_CHAT_INPUT_HEIGHT}
            textAlignVertical="top"
            onContentSizeChange={(e) => {
              const h = Math.ceil(e.nativeEvent.contentSize.height);
              const next = Math.min(MAX_CHAT_INPUT_HEIGHT, Math.max(MIN_CHAT_INPUT_HEIGHT, h));
              if (next !== chatInputHeight) setChatInputHeight(next);
            }}
          />
          <TouchableOpacity
            style={[styles.sendBtn]}
            onPress={() => {
              const txt = draft.trim();
              if (!txt || !chatChannelId || !sessionUserId) return;
              (async () => {
                const { data, error } = await (supabase.from('messages') as any)
                  .insert({ channel_id: chatChannelId, user_id: sessionUserId, body: txt })
                  .select('id,user_id,body,created_at')
                  .single();
                if (!error && data) {
                  setMessages((prev: any) => ([...prev, { id: data.id, text: data.body, from: data.user_id === sessionUserId ? 'me' : 'other', at: timeFromIso(data.created_at) }]));
                  setDraft('');
                }
              })();
            }}
          >
            <Ionicons name="mail-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (screen === 'uebungen') {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Übungen</Text>
      <Text style={styles.text}>Hier könntest du Übungen, Trainingspläne oder Tipps darstellen.</Text>
      <Button title="Zurück" onPress={() => setScreen('home')} />
    </View>
  );
}
if (screen === 'aufgaben') {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Aufgaben</Text>
      <Text style={styles.text}>Hier kommen To-Dos, Checklisten oder Aufgabenlisten hin.</Text>
      <Button title="Zurück" onPress={() => setScreen('home')} />
    </View>
  );
}
// --- Home-Screen mit Buttons ---
  return (
    <SafeAreaView style={[styles.container, containerPaddings]}>
      
      <Text style={styles.title}>Vereins Übersicht</Text>

      {(() => {
        const currentOrg = orgs.find(o => o.id === selectedOrgId);
        const currentGroup = groups.find(g => g.id === selectedGroupId);
        return (
          <View style={[styles.card, { width: '100%', maxWidth: 720, alignItems: 'center' }]}>
            {!!currentOrg?.logo_url && (
              <Image source={{ uri: currentOrg.logo_url }} style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 6 }} />
            )}
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#E5F4EF' }}>{currentOrg?.name ?? 'Kein Verein'}</Text>
            {!!orgRole && (
              <View style={{ marginTop: 6 }}>
                <View style={[styles.badge, styles.badgeActive]}>
                  <Text style={[styles.badgeTextActive]}>{orgRole === 'director' ? 'Direktor' : orgRole === 'teacher' ? 'Lehrer' : 'Schüler'}</Text>
                </View>
              </View>
            )}
            {!!currentGroup && (
              <View style={{ marginTop: 10, alignItems: 'center' }}>
                {!!(currentGroup as any).image_url && (
                  <Image source={{ uri: (currentGroup as any).image_url }} style={{ width: 40, height: 40, borderRadius: 10, marginBottom: 4 }} />
                )}
                <Text style={{ fontSize: 14, fontWeight: '600' }}>Gruppe: {currentGroup.name}</Text>
              </View>
            )}
            <TouchableOpacity onPress={() => setShowSwitchHome(true)} style={[styles.btnLink, { marginTop: 6 }]}>
              <Text style={styles.btnLinkText}>Wechseln</Text>
            </TouchableOpacity>
          </View>
        );
      })()}
      {/* Login-Button entfernt: Auth flow steht jetzt über /login */}

<TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('ankuendigung')}>
  <Text style={styles.menuBtnText}>Ankündigungen</Text>
</TouchableOpacity>

<TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('chat')}>
  <Text style={styles.menuBtnText}>Kommunikationskanal</Text>
</TouchableOpacity>

<TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('uebungen')} >
  <Text style={styles.menuBtnText}>Übungen</Text>
</TouchableOpacity>
      <TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('aufgaben')} >
        <Text style={styles.menuBtnText}>Aufgaben</Text>
      </TouchableOpacity>

      {/* Wechsel-Modal */}
      <Modal visible={showSwitchHome} transparent animationType="fade" onRequestClose={() => setShowSwitchHome(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSwitchHome(false)} />
        <View style={styles.modalCenterWrap}>
          <View style={styles.modalCard}>
            <View style={{ padding: 12 }}>
              <Text style={styles.sectionTitle}>Verein wechseln</Text>
              <FlatList
                horizontal
                data={orgs}
                keyExtractor={(o) => o.id}
                renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => { setSelectedOrgId(item.id); setGroups([]); setSelectedGroupId(null); setChatChannelId(null); setChatMode('pick'); }} onLongPress={() => { if (selectedOrgId !== item.id || orgRole !== 'director') return; Alert.alert('Verein löschen?', 'Dieser Verein wird dauerhaft gelöscht.', [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Löschen', style: 'destructive', onPress: async () => { const ok = await deleteOrganisationCascade(item.id); if (ok) await refreshOrgsAndGroups(); } } ]); }} style={[styles.badge, selectedOrgId === item.id && styles.badgeActive]}>
                    <Text style={[styles.badgeText, selectedOrgId === item.id && styles.badgeTextActive]}>{item.name}</Text>
                  </TouchableOpacity>
                )}
                ListFooterComponent={(<TouchableOpacity onPress={() => { setShowSwitchHome(false); setShowCreateOrg(true); }} style={[styles.badge, { borderColor: '#3D8B77' }]}><Text style={[styles.badgeText, { color: '#194055', fontWeight: '700' }]}>+ Verein</Text></TouchableOpacity>)}
                style={{ marginBottom: 8 }}
              />
              {!!groups.length && (
                <>
                  <Text style={styles.label}>Gruppe</Text>
                  <FlatList horizontal data={groups} keyExtractor={(g) => g.id}
                    renderItem={({ item }) => (
                      <TouchableOpacity onPress={() => setSelectedGroupId(item.id)} onLongPress={() => { if (orgRole !== 'director' || selectedOrgId == null) return; if (selectedGroupId !== item.id) return; Alert.alert('Gruppe löschen?', 'Diese Gruppe wird dauerhaft gelöscht.', [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Löschen', style: 'destructive', onPress: async () => { const { error } = await supabase.from('groups').delete().eq('id', item.id); if (error) Alert.alert('Fehler', error.message); else await refreshOrgsAndGroups(); } } ]); }} style={[styles.badge, selectedGroupId === item.id && styles.badgeActive]}>
                        <Text style={[styles.badgeText, selectedGroupId === item.id && styles.badgeTextActive]}>{item.name}</Text>
                      </TouchableOpacity>
                    )}
                ListFooterComponent={(orgRole === 'director' && selectedOrgId) ? (<TouchableOpacity onPress={() => { setShowSwitchHome(false); setShowCreateGroup(true); }} style={[styles.badge, { borderColor: '#3D8B77' }]}><Text style={[styles.badgeText, { color: '#194055', fontWeight: '700' }]}>+ Gruppe</Text></TouchableOpacity>) : null}
                  />
                </>
              )}
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={() => setShowSwitchHome(false)}>
                  <Text style={styles.btnLinkText}>OK</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnLink} onPress={() => setShowSwitchHome(false)}>
                  <Text style={styles.btnLinkTextMuted}>Schließen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
        {/* Modal: Verein erstellen (Home) */}
        <Modal visible={showCreateOrg} transparent animationType="fade" onRequestClose={() => setShowCreateOrg(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowCreateOrg(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={styles.modalCard}>
              <View style={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>Verein erstellen</Text>
                <TextInput style={styles.input} placeholder="Vereinsname" placeholderTextColor={'#95959588'} value={newOrgName} onChangeText={setNewOrgName} />
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={async () => {
                    const name = newOrgName.trim();
                    if (!name) return;
                    const { error } = await (supabase as any).rpc('create_organisation_as_director', { p_name: name, p_logo_url: null });
                    if (error) Alert.alert('Fehler', error.message);
                    else { setNewOrgName(''); setShowCreateOrg(false); await refreshOrgsAndGroups(); }
                  }}>
                    <Text style={styles.btnLinkText}>Erstellen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={() => setShowCreateOrg(false)}>
                    <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal: Gruppe erstellen (Home) */}
        <Modal visible={showCreateGroup} transparent animationType="fade" onRequestClose={() => setShowCreateGroup(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowCreateGroup(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={styles.modalCard}>
              <View style={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>Gruppe erstellen</Text>
                <TextInput style={styles.input} placeholder="Gruppenname" placeholderTextColor={'#95959588'} value={newGroupName} onChangeText={setNewGroupName} />
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={async () => {
                    const name = newGroupName.trim();
                    if (!name || !selectedOrgId || !sessionUserId) return;
                    const ins = await supabase.from('groups').insert({ org_id: selectedOrgId, name }).select('id').single();
                    if (ins.error) { Alert.alert('Fehler', ins.error.message); return; }
                    const gid = (ins.data as any)?.id as string;
                    if (gid) await supabase.from('group_members').insert({ group_id: gid, user_id: sessionUserId });
                    setNewGroupName('');
                    setShowCreateGroup(false);
                    await refreshOrgsAndGroups();
                  }}>
                    <Text style={styles.btnLinkText}>Erstellen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={() => setShowCreateGroup(false)}>
                    <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#112a37' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 20, color: '#E5F4EF' },
  text: { fontSize: 16, textAlign: 'center', marginBottom: 20, color: '#E5F4EF' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },

  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },

  button: {
    backgroundColor: '#194055',   // Hintergrundfarbe
    paddingVertical: 14,          // Höhe innen
    paddingHorizontal: 24,        // Breite innen
    borderRadius: 12,             // Runde Ecken
    marginVertical: 8,            // Abstand zwischen Buttons
    width: '80%',                 // Breite relativ zum Container
    alignItems: 'center',         // Text zentrieren
    shadowColor: '#000',          // Schatten für iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.5,
    elevation: 4,                 // Schatten für Android
  },

  // Button-Text
  buttonText: {
    color: '#FFFFFF',                // Schriftfarbe
    fontSize: 18,
    fontWeight: '600',
  },
  // duplicate menuBtn/menuBtnText removed

  buttonSendText: {
    color: '#FFFFFF',                // Schriftfarbe
    fontSize: 18,
    fontWeight: '600',
    top: 2,
  },
  // Speziell für "Zurück"-Button
  backButton: {
    backgroundColor: '#A93226',   // Rote Variante
  },

  // Text im Zurück-Button
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },

  // Cards & inputs
  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', marginBottom: 10, backgroundColor: '#112a37', width: '100%' },
  annTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4, color: '#E5F4EF' },
  annMeta: { fontSize: 12, color: '#000000ff', marginBottom: 6 },
  annBody: { fontSize: 14, color: '#E5F4EF' },
  input: { borderWidth: 1, borderColor: '#2A3E48', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, color: '#E5F4EF', backgroundColor: '#0F2530' },
  inputMultiline: { height: 44 },
  textarea: { height: 120 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 999, marginRight: 8 },
  badgeActive: { backgroundColor: '#194055', borderColor: '#194055' },
  badgeText: { color: '#000000ff', fontWeight: '600' },
  // Flat menu buttons with separators
  menuBtn: {

    width: '109%',
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 6,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#3D8B77',
  },
  menuBtnText: { color: '#E8F3F0', fontSize: 18, fontWeight: '600' },
  badgeTextActive: { color: '#fff', fontWeight: '700' },
  circlePlaceholder: { width: 64, height: 64, borderRadius: 999, backgroundColor: '#184B3D', alignItems: 'center', justifyContent: 'center' },

  // Modal helpers
  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  modalCenterWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '90%', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', maxHeight: 520, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 },
  btnLink: { paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLinkText: { color: '#2563EB', fontWeight: '700' },
  btnLinkTextMuted: { color: '#6B7280', fontWeight: '600' },

  // Chat bubbles
  bubbleRow: { width: '100%', flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe: { backgroundColor: '#194055' },
  bubbleOther: { backgroundColor: '#F3F4F6' },
  bubbleText: { fontSize: 15 },
  bubbleTime: { fontSize: 10, color: '#6B7280', marginTop: 4, alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', width: '100%', maxWidth: 720, marginTop: 1, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2A3E48' },
  sendBtn: { paddingVertical: 14, paddingHorizontal: 16, marginLeft: 8, backgroundColor: '#194055', borderRadius: 12, alignItems: 'center', justifyContent: 'center'  },
  chatHeader: { width: '100%', maxWidth: 720, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3E48' },
  headerBack: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 4 },
  headerBackText: { color: '#194055', fontWeight: '600', marginLeft: 2 },
});

// Small helpers used above
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const timeFromIso = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const formatDateDE = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
