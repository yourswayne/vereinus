import { View, Text, StyleSheet, Button, BackHandler, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Modal, Pressable, Keyboard, Image, Alert, ScrollView } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { TextStyle } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Video, ResizeMode } from 'expo-av';


type Screen = 'home' | 'ankuendigung' | 'chat' | 'uebungen' | 'aufgaben';
type AnnouncementRow = { id: string; title: string; body: string | null; event_date: string | null };
type CalendarEventPayload = {
  id: string;
  title: string;
  description?: string | null;
  start: string;
  end: string;
  orgId?: string | null;
  scope: 'self' | 'org';
  source?: 'announcement' | 'task' | 'manual';
  announcementId?: string | null;
};
type OrgMemberRow = {
  userId: string;
  role: 'director' | 'teacher' | 'student';
  displayName: string;
  email: string | null;
  groupIds: string[];
};
type RichTextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
type ExerciseAttachment = {
  id: string;
  type: 'image' | 'video' | 'file';
  url: string;
  name?: string | null;
};
type Exercise = {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  attachments?: ExerciseAttachment[];
  textStyles?: {
    title?: RichTextStyle;
    description?: RichTextStyle;
  };
  createdAt: string;
};

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
  const TAB_BAR_HEIGHT = 20; // Keep input above native tab bar
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
const [orgRoles, setOrgRoles] = useState<Record<string, 'director' | 'teacher' | 'student'>>({});
const [annRemote, setAnnRemote] = useState<{ id: string; title: string; body: string | null; event_date: string | null }[]>([]);
const [loadingRemote, setLoadingRemote] = useState(false);
const [calendarSyncedAnnouncements, setCalendarSyncedAnnouncements] = useState<Record<string, boolean>>({});
const getAnnouncementCalendarEventId = (announcementId: string) => `ann-${announcementId}`;
const buildAnnouncementCalendarFilter = (announcementId: string, eventId: string) => {
  const legacyPrefix = `${eventId}-`;
  return [
    `event_payload->>announcementId.eq.${announcementId}`,
    `event_payload->>id.eq.${eventId}`,
    `event_payload->>id.like.${legacyPrefix}%`,
  ].join(',');
};
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
const [groupActionTarget, setGroupActionTarget] = useState<{ id: string; name: string } | null>(null);
const [orgActionTarget, setOrgActionTarget] = useState<{ id: string; name: string } | null>(null);
const [showRenameOrg, setShowRenameOrg] = useState(false);
const [renameOrgId, setRenameOrgId] = useState<string | null>(null);
const [renameOrgName, setRenameOrgName] = useState('');
const [showManageMembers, setShowManageMembers] = useState(false);
const [manageMembersOrg, setManageMembersOrg] = useState<{ id: string; name: string } | null>(null);
  // --- Uebungen ---
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [exerciseTitle, setExerciseTitle] = useState('');
  const [exerciseDescription, setExerciseDescription] = useState('');
  const [exerciseImageUrl, setExerciseImageUrl] = useState('');
  const [exerciseVideoUrl, setExerciseVideoUrl] = useState('');
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [titleStyle, setTitleStyle] = useState<RichTextStyle>({});
  const [descriptionStyle, setDescriptionStyle] = useState<RichTextStyle>({});
  const [attachments, setAttachments] = useState<ExerciseAttachment[]>([]);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [newMediaUrl, setNewMediaUrl] = useState('');
  const [newMediaType, setNewMediaType] = useState<'image' | 'video' | 'file'>('image');
  const [orgMembers, setOrgMembers] = useState<OrgMemberRow[]>([]);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [orgMemberGroups, setOrgMemberGroups] = useState<{ id: string; name: string }[]>([]);
  const groupsReqRef = useRef(0);

  const currentOrg = useMemo(() => orgs.find(o => o.id === selectedOrgId) ?? null, [orgs, selectedOrgId]);
  const roleLabel = useMemo(() => {
    if (orgRole === 'director') return 'Direktor';
    if (orgRole === 'teacher') return 'Lehrer';
    if (orgRole === 'student') return 'Schüler';
    return null;
  }, [orgRole]);
  const canCreateAnnouncement = useMemo(() => {
    return !!(sessionUserId && orgRole === 'director' && selectedOrgId);
  }, [sessionUserId, orgRole, selectedOrgId]);
  const EXERCISE_STORAGE_BASE = '@vereinus/exercises';
  const exerciseStorageKey = useMemo(
    () => `${EXERCISE_STORAGE_BASE}:${selectedOrgId ?? 'default'}`,
    [selectedOrgId],
  );
  const uid = () => Math.random().toString(36).slice(2, 10);

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
        setOrgs([]); setGroups([]); setSelectedOrgId(null); setSelectedGroupId(null); setOrgRole(null); setOrgRoles({}); setAnnRemote([]);
        return;
      }
      // load org memberships and orgs
      const { data: mems } = await supabase.from('organisation_members').select('org_id, role').eq('user_id', sessionUserId);
      const memsTyped = (mems ?? []) as { org_id: string; role: 'director' | 'teacher' | 'student' }[];
      const orgIds = memsTyped.map(m => m.org_id);
      if (!orgIds.length) { setOrgs([]); setSelectedOrgId(null); setSelectedGroupId(null); setOrgRole(null); setOrgRoles({}); return; }
      const { data: orgRows } = await supabase.from('organisations').select('id, name, logo_url').in('id', orgIds);
      const orgList = (orgRows ?? []) as any[];
      setOrgs(orgList);
      const nextOrg = selectedOrgId && orgIds.includes(selectedOrgId) ? selectedOrgId : (orgList[0]?.id ?? null);
      setSelectedOrgId(nextOrg);
      setOrgRole(memsTyped.find(m => m.org_id === nextOrg)?.role ?? null);
      const roleMap = memsTyped.reduce((acc, mem) => { acc[mem.org_id] = mem.role; return acc; }, {} as Record<string, 'director' | 'teacher' | 'student'>);
      setOrgRoles(roleMap);
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
      setOrgs([]); setGroups([]); setSelectedOrgId(null); setSelectedGroupId(null); setOrgRole(null); setOrgRoles({}); setAnnRemote([]);
      return;
    }
    const { data: mems } = await supabase.from('organisation_members').select('org_id, role').eq('user_id', sessionUserId);
    const memsTyped = (mems ?? []) as { org_id: string; role: 'director' | 'teacher' | 'student' }[];
    const orgIds = memsTyped.map(m => m.org_id);
    if (!orgIds.length) { setOrgs([]); setSelectedOrgId(null); setGroups([]); setSelectedGroupId(null); setOrgRole(null); setOrgRoles({}); return; }
    const { data: orgRows } = await supabase.from('organisations').select('id, name, logo_url').in('id', orgIds);
    const orgList = (orgRows ?? []) as any[];
    setOrgs(orgList);
    const nextOrg = selectedOrgId && orgIds.includes(selectedOrgId) ? selectedOrgId : (orgList[0]?.id ?? null);
    setSelectedOrgId(nextOrg);
    setOrgRole(memsTyped.find(m => m.org_id === nextOrg)?.role ?? null);
    const roleMap = memsTyped.reduce((acc, mem) => { acc[mem.org_id] = mem.role; return acc; }, {} as Record<string, 'director' | 'teacher' | 'student'>);
    setOrgRoles(roleMap);
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(exerciseStorageKey);
        if (!alive) return;
        if (raw) setExercises(JSON.parse(raw));
        else setExercises([]);
      } catch {
        if (alive) setExercises([]);
      }
    })();
    return () => { alive = false; };
  }, [exerciseStorageKey]);

  useEffect(() => {
    AsyncStorage.setItem(exerciseStorageKey, JSON.stringify(exercises)).catch(() => {});
  }, [exercises, exerciseStorageKey]);

  const buildTextStyle = (style?: RichTextStyle): TextStyle => {
    const decorations: string[] = [];
    if (style?.underline) decorations.push('underline');
    return {
      ...(style?.bold ? { fontWeight: '800' } : {}),
      ...(style?.italic ? { fontStyle: 'italic' } : {}),
      ...(decorations.length ? { textDecorationLine: decorations.join(' ') as TextStyle['textDecorationLine'] } : {}),
    };
  };

  const resetExerciseForm = () => {
    setExerciseTitle('');
    setExerciseDescription('');
    setExerciseImageUrl('');
    setExerciseVideoUrl('');
    setEditingExerciseId(null);
    setTitleStyle({});
    setDescriptionStyle({});
    setAttachments([]);
    setNewMediaUrl('');
    setNewMediaType('image');
    setShowMediaModal(false);
  };

  const closeAddExerciseModal = () => {
    setShowMediaModal(false);
    setShowAddExercise(false);
  };

  useEffect(() => {
    if (!showAddExercise && showMediaModal) {
      setShowMediaModal(false);
    }
  }, [showAddExercise, showMediaModal]);

  const openAddExercise = () => {
    resetExerciseForm();
    setShowAddExercise(true);
  };

  const addAttachmentFromModal = () => {
    const url = newMediaUrl.trim();
    if (!url) return;
    setAttachments((prev) => [{ id: uid(), type: newMediaType, url }, ...prev]);
    setNewMediaUrl('');
    setShowMediaModal(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const pickFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Berechtigung benötigt', 'Bitte erlaube den Zugriff auf Fotos/Videos, um Medien hinzuzufügen.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        quality: 0.7,
      });
      if (result.canceled) return;
      const picked = (result.assets ?? []).map((asset) => ({
        id: uid(),
        type: asset.type === 'video' ? 'video' as const : 'image' as const,
        url: asset.uri,
      }));
      if (picked.length) setAttachments((prev) => [...picked, ...prev]);
    } catch {
      Alert.alert('Fehler', 'Medien konnten nicht geladen werden.');
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (res.type === 'cancel') return;
      const assets = 'assets' in res && Array.isArray((res as any).assets) ? (res as any).assets : [res];
      const picked = (assets ?? []).map((asset: any) => ({
        id: uid(),
        type: 'file' as const,
        url: asset.uri,
        name: asset.name ?? null,
      }));
      if (picked.length) setAttachments((prev) => [...picked, ...prev]);
    } catch {
      Alert.alert('Fehler', 'Datei konnte nicht geladen werden.');
    }
  };

  const handleAttachmentButton = () => {
    setShowMediaModal(true);
    // Direkt Galerie öffnen, damit sofort etwas passiert; Modal bleibt für Links/Dateien offen.
    pickFromLibrary().catch(() => {});
  };

  const toggleStyle = (target: 'title' | 'description', key: keyof RichTextStyle) => {
    if (target === 'title') {
      setTitleStyle((prev) => ({ ...prev, [key]: !prev[key] }));
    } else {
      setDescriptionStyle((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const getExerciseAttachments = (ex: Exercise | null): ExerciseAttachment[] => {
    if (!ex) return [];
    if (ex.attachments?.length) return ex.attachments;
    const legacy: ExerciseAttachment[] = [];
    if (ex.imageUrl) legacy.push({ id: `${ex.id}-legacy-image`, type: 'image', url: ex.imageUrl });
    if (ex.videoUrl) legacy.push({ id: `${ex.id}-legacy-video`, type: 'video', url: ex.videoUrl });
    return legacy;
  };

  const beginEditExercise = (ex: Exercise) => {
    setShowMediaModal(false);
    setSelectedExercise(null);
    setEditingExerciseId(ex.id);
    setExerciseTitle(ex.title);
    setExerciseDescription(ex.description ?? '');
    setTitleStyle(ex.textStyles?.title ?? {});
    setDescriptionStyle(ex.textStyles?.description ?? {});
    setAttachments(getExerciseAttachments(ex));
    setNewMediaUrl('');
    setNewMediaType('image');
    setShowAddExercise(true);
  };

  const deleteExercise = (id: string) => {
    setExercises((prev) => prev.filter((ex) => ex.id !== id));
    if (selectedExercise?.id === id) setSelectedExercise(null);
    if (editingExerciseId === id) setEditingExerciseId(null);
  };

  const addExercise = () => {
    const title = exerciseTitle.trim();
    if (!title) return;
    const attachmentsToSave = attachments.length
      ? attachments
      : [
        ...(exerciseImageUrl.trim() ? [{ id: uid(), type: 'image' as const, url: exerciseImageUrl.trim() }] : []),
        ...(exerciseVideoUrl.trim() ? [{ id: uid(), type: 'video' as const, url: exerciseVideoUrl.trim() }] : []),
      ];
    const primaryImage = attachmentsToSave.find((a) => a.type === 'image')?.url;
    const primaryVideo = attachmentsToSave.find((a) => a.type === 'video')?.url;
    if (editingExerciseId) {
      setExercises((prev) => {
        const existing = prev.find((e) => e.id === editingExerciseId);
        const updated: Exercise = {
          ...(existing ?? { id: editingExerciseId, createdAt: new Date().toISOString() }),
          title,
          description: exerciseDescription.trim() || undefined,
          imageUrl: primaryImage || undefined,
          videoUrl: primaryVideo || undefined,
          attachments: attachmentsToSave.length ? attachmentsToSave : undefined,
          textStyles: { title: titleStyle, description: descriptionStyle },
        };
        return prev.map((ex) => (ex.id === editingExerciseId ? updated : ex));
      });
      setSelectedExercise((prev) => (prev && prev.id === editingExerciseId ? {
        ...prev,
        title,
        description: exerciseDescription.trim() || undefined,
        imageUrl: primaryImage || undefined,
        videoUrl: primaryVideo || undefined,
        attachments: attachmentsToSave.length ? attachmentsToSave : undefined,
        textStyles: { title: titleStyle, description: descriptionStyle },
      } : prev));
    } else {
      const newEx: Exercise = {
        id: uid(),
        title,
        description: exerciseDescription.trim() || undefined,
        imageUrl: primaryImage || undefined,
        videoUrl: primaryVideo || undefined,
        attachments: attachmentsToSave.length ? attachmentsToSave : undefined,
        textStyles: { title: titleStyle, description: descriptionStyle },
        createdAt: new Date().toISOString(),
      };
      setExercises((prev) => [newEx, ...prev]);
    }
    resetExerciseForm();
    setShowAddExercise(false);
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

  const removeGroupLocally = (groupId: string) => {
    setGroups(prev => prev.filter(g => g.id !== groupId));
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
      setChatMode('pick');
      setChatChannelId(null);
    }
  };

  const handleGroupDelete = async (groupId: string) => {
    const ok = await deleteGroupCascade(groupId);
    if (ok) removeGroupLocally(groupId);
  };

  const openGroupActions = (group: { id: string; name: string }) => {
    if (orgRole !== 'director') return;
    setGroupActionTarget({ id: group.id, name: group.name });
  };

  const openOrgActions = (org: { id: string; name: string }) => {
    if (orgRoles[org.id] !== 'director') return;
    setShowSwitchHome(false);
    setOrgActionTarget({ id: org.id, name: org.name });
  };

  const closeRenameOrgModal = () => {
    setShowRenameOrg(false);
    setRenameOrgId(null);
    setRenameOrgName('');
  };

  const handleOrgRenameSave = async () => {
    const id = renameOrgId;
    const name = renameOrgName.trim();
    if (!id || !name) return;
    const { error } = await supabase.from('organisations').update({ name }).eq('id', id);
    if (error) {
      Alert.alert('Fehler', error.message);
      return;
    }
    setOrgs((prev) => prev.map((org) => (org.id === id ? { ...org, name } : org)));
    closeRenameOrgModal();
  };

  const loadOrgMembers = async (orgId: string) => {
    setOrgMembersLoading(true);
    try {
      const { data: memRows, error: memErr } = await supabase
        .from('organisation_members')
        .select('user_id, role')
        .eq('org_id', orgId);
      if (memErr) throw memErr;
      const membersData = (memRows ?? []) as { user_id: string; role: 'director' | 'teacher' | 'student' }[];
      const userIds = membersData.map((m) => m.user_id);
      let profileMap: Record<string, { full_name?: string | null; email?: string | null }> = {};
      if (userIds.length) {
        try {
          const { data: profilesRows, error: profilesErr } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds);
          if (!profilesErr) {
            (profilesRows ?? []).forEach((p: any) => {
              profileMap[p.id] = { full_name: p.full_name, email: p.email };
            });
          }
        } catch {
          // ignore missing profiles table
        }
      }
      const { data: groupRows, error: groupErr } = await supabase.from('groups').select('id,name').eq('org_id', orgId);
      if (groupErr) throw groupErr;
      const groupList = (groupRows ?? []) as { id: string; name: string }[];
      setOrgMemberGroups(groupList);
      let groupMemberships: { user_id: string; group_id: string }[] = [];
      const groupIds = groupList.map((g) => g.id);
      if (groupIds.length) {
        const { data: gmRows, error: gmErr } = await supabase
          .from('group_members')
          .select('group_id,user_id')
          .in('group_id', groupIds);
        if (gmErr) throw gmErr;
        groupMemberships = (gmRows ?? []) as { group_id: string; user_id: string }[];
      }
      const mapped: OrgMemberRow[] = membersData.map((member) => {
        const profile = profileMap[member.user_id];
        const displayName = profile?.full_name || profile?.email || `Mitglied ${member.user_id.slice(0, 6)}`;
        const groupsForMember = groupMemberships
          .filter((gm) => gm.user_id === member.user_id)
          .map((gm) => gm.group_id);
        return {
          userId: member.user_id,
          role: member.role,
          displayName,
          email: profile?.email ?? null,
          groupIds: groupsForMember,
        };
      });
      setOrgMembers(mapped);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Mitglieder konnten nicht geladen werden.');
    } finally {
      setOrgMembersLoading(false);
    }
  };

  const openManageMembers = (org: { id: string; name: string }) => {
    if (orgRoles[org.id] !== 'director') return;
    setManageMembersOrg(org);
    setShowManageMembers(true);
    loadOrgMembers(org.id);
  };

  const closeManageMembers = () => {
    setShowManageMembers(false);
    setManageMembersOrg(null);
    setOrgMembers([]);
    setOrgMemberGroups([]);
  };

  const toggleMemberGroup = async (userId: string, groupId: string) => {
    if (!manageMembersOrg || orgRoles[manageMembersOrg.id] !== 'director') return;
    const member = orgMembers.find((m) => m.userId === userId);
    if (!member) return;
    const assigned = member.groupIds.includes(groupId);
    try {
      if (assigned) {
        await supabase.from('group_members').delete().match({ group_id: groupId, user_id: userId });
      } else {
        await supabase.from('group_members').insert({ group_id: groupId, user_id: userId });
      }
      setOrgMembers((prev) =>
        prev.map((m) =>
          m.userId === userId
            ? { ...m, groupIds: assigned ? m.groupIds.filter((id) => id !== groupId) : [...m.groupIds, groupId] }
            : m,
        ),
      );
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Gruppenzuordnung konnte nicht aktualisiert werden.');
    }
  };

  const renderMemberCard = (member: OrgMemberRow, canEdit: boolean) => (
    <View key={`${member.userId}-${member.role}`} style={styles.memberCard}>
      <View style={{ marginBottom: 6 }}>
        <Text style={styles.memberName}>{member.displayName}</Text>
        <Text style={styles.memberEmail}>{member.email ?? member.userId}</Text>
      </View>
      {orgMemberGroups.length ? (
        <View style={styles.memberGroupsRow}>
          {orgMemberGroups.map((group) => {
            const assigned = member.groupIds.includes(group.id);
            return (
              <TouchableOpacity
                key={`${member.userId}-${group.id}`}
                disabled={!canEdit}
                onPress={() => canEdit && toggleMemberGroup(member.userId, group.id)}
                style={[
                  styles.memberGroupChip,
                  assigned && styles.memberGroupChipActive,
                  !canEdit && styles.memberGroupChipDisabled,
                ]}
              >
                <Text style={[styles.memberGroupChipText, assigned && styles.memberGroupChipTextActive]}>
                  {group.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={styles.memberEmptyText}>Keine Gruppen vorhanden.</Text>
      )}
    </View>
  );

  const normalizeAnnouncementDate = (date: Date) => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  };

  const toAnnouncementDateString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const applyAnnouncementDateValue = (date: Date | null) => {
    if (!date) {
      setAnnouncementDate('');
      setAnnouncementDateObj(null);
      return;
    }
    const normalized = normalizeAnnouncementDate(date);
    const iso = toAnnouncementDateString(normalized);
    setAnnouncementDate(iso);
    setAnnouncementDateObj(normalized);
  };

  const resetAnnouncementForm = () => {
    setAnnouncementTitle('');
    setAnnouncementBody('');
    setAnnouncementDate('');
    setAnnouncementDateObj(null);
    setShowAnnouncementDatePicker(false);
    setEditingAnnouncementId(null);
    setAnnouncementCalendarBroadcast(false);
  };

  const openAnnouncementModal = (mode: 'create' | 'edit', announcement?: AnnouncementRow) => {
    setAnnouncementModalMode(mode);
    if (mode === 'edit' && announcement) {
      setEditingAnnouncementId(announcement.id);
      setAnnouncementTitle(announcement.title);
      setAnnouncementBody(announcement.body ?? '');
      setAnnouncementDate(announcement.event_date ?? '');
      if (announcement.event_date) {
        const parsed = new Date(announcement.event_date);
        if (!Number.isNaN(parsed.getTime())) {
          setAnnouncementDateObj(normalizeAnnouncementDate(parsed));
        } else {
          setAnnouncementDateObj(null);
        }
      } else {
        setAnnouncementDateObj(null);
      }
      setAnnouncementCalendarBroadcast(Boolean(calendarSyncedAnnouncements[announcement.id]));
      setShowAnnouncementDatePicker(false);
    } else {
      resetAnnouncementForm();
    }
    setAnnouncementModalVisible(true);
  };

  const closeAnnouncementModal = () => {
    setAnnouncementModalVisible(false);
    resetAnnouncementForm();
  };

  const handleAnnouncementDatePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed') {
      setShowAnnouncementDatePicker(false);
      return;
    }
    if (selected) {
      applyAnnouncementDateValue(selected);
    }
    if (Platform.OS !== 'ios') {
      setShowAnnouncementDatePicker(false);
    }
  };

  const handlePersistAnnouncement = async () => {
    const title = announcementTitle.trim();
    const body = announcementBody.trim();
    const eventDate = announcementDate.trim();
    if (!title || !selectedOrgId || !sessionUserId) return;
    const payloadBase = { title, body: body || null, event_date: eventDate || null };
    const wasSynced = editingAnnouncementId ? Boolean(calendarSyncedAnnouncements[editingAnnouncementId]) : false;
    try {
      let savedAnnouncement: AnnouncementRow | null = null;
      if (announcementModalMode === 'edit' && editingAnnouncementId) {
        const { data, error } = await supabase
          .from('announcements')
          .update(payloadBase)
          .eq('id', editingAnnouncementId)
          .select('id,title,body,event_date')
          .single();
        if (error) throw error;
        if (data) {
          savedAnnouncement = data as AnnouncementRow;
          setAnnRemote((prev) => prev.map((ann) => (ann.id === data.id ? (data as AnnouncementRow) : ann)));
        }
      } else {
        const payload = {
          ...payloadBase,
          org_id: selectedOrgId,
          group_id: selectedGroupId,
          author_id: sessionUserId,
        };
        const { data, error } = await supabase
          .from('announcements')
          .insert(payload as any)
          .select('id,title,body,event_date')
          .single();
        if (error) throw error;
        if (data) {
          savedAnnouncement = data as AnnouncementRow;
          setAnnRemote((prev) => [data as AnnouncementRow, ...prev]);
        }
      }
      if (savedAnnouncement) {
      if (announcementCalendarBroadcast) {
        await handleAnnouncementCalendarSync(savedAnnouncement);
      } else if (wasSynced) {
        await handleAnnouncementCalendarUnsync(savedAnnouncement);
      }
      }
      closeAnnouncementModal();
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Ankuendigung konnte nicht gespeichert werden.');
    }
  };

  const openAnnouncementActions = (announcement: AnnouncementRow) => {
    if (!canCreateAnnouncement) return;
    setAnnouncementActionTarget(announcement);
  };

  const handleAnnouncementCalendarSync = async (announcement: AnnouncementRow) => {
    if (!selectedOrgId) {
      Alert.alert('Kalender', 'Bitte waehle zuerst einen Verein aus.');
      return;
    }
    const eventId = getAnnouncementCalendarEventId(announcement.id);
    const dateStr = announcement.event_date?.trim();
    if (!dateStr) {
      Alert.alert('Kalender', 'Diese Ankuendigung hat kein Datum. Bitte fuege zuerst ein Datum hinzu.');
      return;
    }
    const start = new Date(dateStr);
    if (Number.isNaN(start.getTime())) {
      Alert.alert('Kalender', 'Das eingetragene Datum ist ungueltig.');
      return;
    }
    if (!dateStr.includes('T')) {
      start.setHours(9, 0, 0, 0);
    }
    const end = new Date(start.getTime());
    if (end <= start) {
      end.setHours(start.getHours() + 1);
    }
    const payload: CalendarEventPayload = {
      id: eventId,
      title: announcement.title,
      description: announcement.body ?? '',
      start: start.toISOString(),
      end: end.toISOString(),
      orgId: selectedOrgId,
      scope: 'org',
      source: 'announcement',
      announcementId: announcement.id,
    };
    setCalendarQueueBusy(true);
    try {
      const filter = buildAnnouncementCalendarFilter(announcement.id, eventId);
      await supabase
        .from('calendar_sync_queue')
        .delete()
        .eq('org_id', selectedOrgId)
        .or(filter);

      const { error } = await supabase.from('calendar_sync_queue').insert({
        org_id: selectedOrgId,
        event_payload: payload,
      });
      if (error) throw error;
      Alert.alert('Kalender', 'Termin wurde für alle in den Kalender eingetragen.');
      setCalendarSyncedAnnouncements((prev) => ({ ...prev, [announcement.id]: true }));
    } catch (e: any) {
      Alert.alert('Kalender', e?.message ?? 'Termin konnte nicht übertragen werden.');
    } finally {
      setCalendarQueueBusy(false);
    }
  };
  const handleAnnouncementCalendarUnsync = async (announcement: AnnouncementRow) => {
    if (!selectedOrgId) {
      Alert.alert('Kalender', 'Bitte waehle zuerst einen Verein aus.');
      return;
    }
    const eventId = getAnnouncementCalendarEventId(announcement.id);
    const orFilter = buildAnnouncementCalendarFilter(announcement.id, eventId);
    setCalendarQueueBusy(true);
    try {
      const { error } = await supabase
        .from('calendar_sync_queue')
        .delete()
        .eq('org_id', selectedOrgId)
        .or(orFilter);
      if (error) throw error;
      setCalendarSyncedAnnouncements((prev) => {
        const next = { ...prev };
        delete next[announcement.id];
        return next;
      });
      Alert.alert('Kalender', 'Termin wurde entfernt.');
    } catch (e: any) {
      Alert.alert('Kalender', e?.message ?? 'Termin konnte nicht entfernt werden.');
    } finally {
      setCalendarQueueBusy(false);
    }
  };

  const handleAnnouncementDelete = async (announcementId: string) => {
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
      if (error) throw error;
      setAnnRemote((prev) => prev.filter((ann) => ann.id !== announcementId));
      setCalendarSyncedAnnouncements((prev) => {
        if (!prev[announcementId]) return prev;
        const next = { ...prev };
        delete next[announcementId];
        return next;
      });
      if (editingAnnouncementId === announcementId) {
        resetAnnouncementForm();
        setAnnouncementModalVisible(false);
      }
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Ankuendigung konnte nicht gelöscht werden.');
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!selectedOrgId || !sessionUserId) { setAnnRemote([]); setCalendarSyncedAnnouncements({}); setLoadingRemote(false); return; }
      setLoadingRemote(true);
      const [annRes, queueRes] = await Promise.all([
        supabase
          .from('announcements')
          .select('id,title,body,event_date')
          .eq('org_id', selectedOrgId)
          .order('created_at', { ascending: false }),
        supabase
          .from('calendar_sync_queue')
          .select('event_payload')
          .eq('org_id', selectedOrgId),
      ]);
      if (!alive) return;
      if (annRes.error) {
        Alert.alert('Fehler', annRes.error.message ?? 'Ankündigungen konnten nicht geladen werden.');
        setAnnRemote([]);
      } else {
        setAnnRemote((annRes.data ?? []) as any[]);
      }
      if (queueRes.error) {
        setCalendarSyncedAnnouncements({});
      } else {
        const map = ((queueRes.data ?? []) as any[]).reduce<Record<string, boolean>>((acc, row: any) => {
          const payload = row.event_payload as (CalendarEventPayload & { announcementId?: string }) | null;
          let annId = payload?.announcementId ?? null;
          if (!annId && payload?.id?.startsWith('ann-')) {
            const remainder = payload.id.slice(4);
            const legacyMatch = remainder.match(/(.+)-(\d{10,})$/);
            annId = legacyMatch ? legacyMatch[1] : remainder;
          }
          if (annId) acc[annId] = true;
          return acc;
        }, {});
        setCalendarSyncedAnnouncements(map);
      }
      setLoadingRemote(false);
    })();
    return () => { alive = false; };
  }, [selectedOrgId, sessionUserId]);

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

  const [announcementModalVisible, setAnnouncementModalVisible] = useState(false);
  const [announcementModalMode, setAnnouncementModalMode] = useState<'create' | 'edit'>('create');
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementDate, setAnnouncementDate] = useState('');
  const [announcementDateObj, setAnnouncementDateObj] = useState<Date | null>(null);
  const [showAnnouncementDatePicker, setShowAnnouncementDatePicker] = useState(false);
  const [announcementActionTarget, setAnnouncementActionTarget] = useState<AnnouncementRow | null>(null);
  const [calendarQueueBusy, setCalendarQueueBusy] = useState(false);
  const [announcementCalendarBroadcast, setAnnouncementCalendarBroadcast] = useState(false);

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
        <View style={styles.sectionDivider} />
        <View style={[styles.chatHeader, styles.chatHeaderNoBorder]}>
          <TouchableOpacity onPress={() => setScreen('home')} style={[styles.headerBack, {bottom: 60}]}>
            <Ionicons name="chevron-back" size={22} color="#194055" />
            
          </TouchableOpacity>
          <Text style={[styles.title, { marginBottom: 0, bottom: 60, left: 20 }]}>Ankündigungen</Text>
          <View style={{ width: 60 }} />

            {!!groups.length && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                
              </View>
            )}
        </View>

        <FlatList
          style={{ width: '100%', maxWidth: 720 }}
          data={annRemote}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, width: '100%' }}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={canCreateAnnouncement ? 0.85 : 1}
              onLongPress={() => canCreateAnnouncement && openAnnouncementActions(item)}
              style={[styles.card, styles.announcementCard, styles.announcementCardRow]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.annTitle}>{item.title}</Text>
                <Text style={styles.annMeta}>{item.event_date ? formatDateDE(item.event_date) : 'Ohne Datum'}</Text>
                {!!item.body && <Text style={styles.annBody}>{item.body}</Text>}
              </View>
              {canCreateAnnouncement && (
                <TouchableOpacity
                  onPress={(e: GestureResponderEvent) => { e.stopPropagation(); openAnnouncementActions(item); }}
                  style={styles.groupActionButton}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color="#E5F4EF" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.text}>{loadingRemote ? 'Laden…' : 'Keine Ankündigungen vorhanden.'}</Text>}
        />




        {canCreateAnnouncement && (
          <TouchableOpacity style={[styles.button, styles.annButton]} onPress={() => openAnnouncementModal('create')}>
            <Text style={styles.buttonText}>+ Neue Ankündigung</Text>
          </TouchableOpacity>
        )}


        <Modal visible={announcementModalVisible} transparent animationType="fade" onRequestClose={closeAnnouncementModal}>
          <Pressable style={styles.modalOverlay} onPress={closeAnnouncementModal} />
          <View style={styles.modalCenterWrap}>
            <View style={[styles.modalCard, styles.orgModalCard, styles.announcementModalCard]}>
              <View style={{ padding: 12 }}>
                <Text style={[styles.sectionTitle,  ]}>{announcementModalMode === 'edit' ? 'Ankündigung bearbeiten' : 'Neue Ankündigung'}</Text>
                <TextInput style={styles.input} placeholder="Titel" placeholderTextColor={'#95959588'} value={announcementTitle} onChangeText={setAnnouncementTitle} />
                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder="Inhalt"
                  placeholderTextColor={'#95959588'}
                  value={announcementBody}
                  onChangeText={setAnnouncementBody}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                />
                <Text style={styles.label}>Datum</Text>
                <TouchableOpacity
                  style={[styles.datePickerButton, showAnnouncementDatePicker && styles.datePickerButtonActive]}
                  onPress={() => setShowAnnouncementDatePicker((prev) => !prev)}
                >
                  <Text style={announcementDateObj ? styles.datePickerValue : styles.datePickerPlaceholder}>
                    {announcementDateObj ? `${pad(announcementDateObj.getDate())}.${pad(announcementDateObj.getMonth() + 1)}.${announcementDateObj.getFullYear()}` : 'Datum auswaehlen'}
                  </Text>
                </TouchableOpacity>
                {showAnnouncementDatePicker && Platform.OS === 'ios' && (
                  <DateTimePicker
                    mode="date"
                    display="spinner"
                    value={announcementDateObj ?? new Date()}
                    onChange={handleAnnouncementDatePickerChange}
                  />
                )}
                {showAnnouncementDatePicker && Platform.OS !== 'ios' && (
                  <DateTimePicker
                    mode="date"
                    display="calendar"
                    value={announcementDateObj ?? new Date()}
                    onChange={handleAnnouncementDatePickerChange}
                  />
                )}
                <TouchableOpacity
                  style={[styles.calendarToggleRow, announcementCalendarBroadcast && styles.calendarToggleRowActive]}
                  onPress={() => setAnnouncementCalendarBroadcast((prev) => !prev)}
                >
                  <View style={[styles.calendarToggleCheckbox, announcementCalendarBroadcast && styles.calendarToggleCheckboxActive]}>
                    {announcementCalendarBroadcast && <Ionicons name="checkmark" size={16} color="#0F2530" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calendarToggleLabel}>Im Kalender fuer alle eintragen</Text>
                    <Text style={styles.calendarToggleHint}>Legt nach dem Speichern automatisch einen Termin fuer deinen Verein an.</Text>
                  </View>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity
                    style={[styles.btnLink, { marginRight: 8 }]}
                    onPress={handlePersistAnnouncement}
                  >
                    <Text style={styles.btnLinkText}>Speichern</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={closeAnnouncementModal}>
                    <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={!!announcementActionTarget} transparent animationType="fade" onRequestClose={() => setAnnouncementActionTarget(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setAnnouncementActionTarget(null)} />
          <View style={styles.modalCenterWrap}>
            <View style={styles.modalCard}>
              <View style={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>Ankündigung</Text>
                {!!announcementActionTarget && (
                  <Text style={styles.modalSubtitle}>{announcementActionTarget.title}</Text>
                )}
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    if (!announcementActionTarget) return;
                    const target = announcementActionTarget;
                    setAnnouncementActionTarget(null);
                    openAnnouncementModal('edit', target);
                  }}
                >
                  <Text style={styles.actionButtonText}>Bearbeiten</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonPrimary, calendarQueueBusy && styles.actionButtonDisabled]}
                  disabled={calendarQueueBusy}
                  onPress={async () => {
                    if (!announcementActionTarget || calendarQueueBusy) return;
                    const target = announcementActionTarget;
                    if (calendarSyncedAnnouncements[target.id]) {
                      await handleAnnouncementCalendarUnsync(target);
                    } else {
                      await handleAnnouncementCalendarSync(target);
                    }
                  }}
                >
                  <Text style={styles.actionButtonText}>
                    {announcementActionTarget && calendarSyncedAnnouncements[announcementActionTarget.id]
                      ? 'Im Kalender für alle austragen'
                      : 'Im Kalender für alle eintragen'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonDanger]}
                  onPress={() => {
                    if (!announcementActionTarget) return;
                    const target = announcementActionTarget;
                    Alert.alert('Ankündigung löschen', `Soll "${target.title}" dauerhaft entfernt werden?`, [
                      { text: 'Abbrechen', style: 'cancel' },
                      {
                        text: 'Löeschen',
                        style: 'destructive',
                        onPress: async () => {
                          setAnnouncementActionTarget(null);
                          await handleAnnouncementDelete(target.id);
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={[styles.actionButtonText, styles.actionButtonDangerText]}>Löschen</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnLink} onPress={() => setAnnouncementActionTarget(null)}>
                  <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                </TouchableOpacity>
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
          <View style={styles.sectionDivider} />
          <View style={[styles.chatHeader, styles.chatHeaderNoBorder]}>
            <TouchableOpacity onPress={() => setScreen('home')} style={[styles.headerBack, { bottom: 60 }]}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0, bottom: 60, left: 17 }]}>Kommunikationskanäle</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: 12 }}>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { setSelectedGroupId(item.id); setChatMode('in'); }}
                  onLongPress={() => openGroupActions(item)}
                  style={[styles.card, styles.groupCard]}
                >
                  <Text style={{ fontWeight: '700', color: '#E5F4EF', flex: 1 }}>{item.name}</Text>
                  {(orgRole === 'director') && (
                    <TouchableOpacity
                      onPress={(e: GestureResponderEvent) => { e.stopPropagation(); openGroupActions(item); }}
                      style={styles.groupActionButton}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="ellipsis-horizontal" size={20} color="#E5F4EF" />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={(
                <View style={{ paddingVertical: 8 }}>
                  <Text style={styles.text}>Keine Gruppen vorhanden.</Text>
                  {(orgRole === 'director') && (
                    <TouchableOpacity style={[styles.button, styles.centerButton]} onPress={() => setShowCreateGroup(true)}>
                      <Text style={styles.buttonText}>+ Gruppe erstellen</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
            {(orgRole === 'director' && groups.length > 0) && (
              <TouchableOpacity style={[styles.button, styles.centerButton, { marginTop: 8 }]} onPress={() => setShowCreateGroup(true)}>
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
          <Modal visible={!!groupActionTarget} transparent animationType="fade" onRequestClose={() => setGroupActionTarget(null)}>
            <Pressable style={styles.modalOverlay} onPress={() => setGroupActionTarget(null)} />
            <View style={styles.modalCenterWrap}>
              <View style={styles.modalCard}>
                <View style={{ padding: 12 }}>
                  <Text style={styles.sectionTitle}>Gruppe verwalten</Text>
                  {!!groupActionTarget && (
                    <Text style={styles.modalSubtitle}>{groupActionTarget.name}</Text>
                  )}
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => {
                      if (!groupActionTarget) return;
                      setRenameGroupId(groupActionTarget.id);
                      setRenameGroupName(groupActionTarget.name);
                      setGroupActionTarget(null);
                      setShowRenameGroup(true);
                    }}
                  >
                    <Text style={styles.actionButtonText}>Umbenennen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonDanger]}
                    onPress={() => {
                      if (!groupActionTarget) return;
                      const target = groupActionTarget;
                      setGroupActionTarget(null);
                      Alert.alert('Gruppe löschen', `Soll die Gruppe "${target.name}" wirklich gelöscht werden?`, [
                        { text: 'Abbrechen', style: 'cancel' },
                        { text: 'Löschen', style: 'destructive', onPress: () => { handleGroupDelete(target.id); } },
                      ]);
                    }}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonDangerText]}>Gruppe löschen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={() => setGroupActionTarget(null)}>
                    <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                  </TouchableOpacity>
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
    return (
      <SafeAreaView style={[styles.chatSafeArea, { paddingTop: insets.top + 12 }]}>
        <KeyboardAvoidingView style={{ flex: 1, width: '100%', paddingHorizontal: 16 }} behavior={'padding'}>
          <View style={styles.sectionDivider} />
          <View style={[styles.chatHeader, styles.chatHeaderNoBorder]}>
            <TouchableOpacity onPress={() => setScreen('home')} style={[styles.headerBack, { bottom: 60 }]}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0, bottom: 60, left: 17 }]}>{(groups.find(g => g.id === selectedGroupId)?.name) || 'Chat'}</Text>
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
              placeholder="Nachricht schreiben."
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
      </SafeAreaView>
    );
  }

    if (screen === 'uebungen') {
    const canAddExercises = orgRole === 'director';
    const renderExerciseCard = ({ item }: { item: Exercise }) => (
      <TouchableOpacity
        style={styles.exerciseCard}
        activeOpacity={0.85}
        onPress={() => setSelectedExercise(item)}
      >
        <Text style={[styles.exerciseCardTitle, buildTextStyle(item.textStyles?.title)]} numberOfLines={2}>{item.title}</Text>
      </TouchableOpacity>
    );
    const renderStyleToggle = (target: 'title' | 'description', key: keyof RichTextStyle, label: string) => {
      const isActive = target === 'title' ? !!titleStyle[key] : !!descriptionStyle[key];
      return (
        <TouchableOpacity
          onPress={() => toggleStyle(target, key)}
          style={[styles.formatButton, isActive && styles.formatButtonActive]}
        >
          <Text style={[styles.formatButtonText, isActive && styles.formatButtonTextActive]}>{label}</Text>
        </TouchableOpacity>
      );
    };
    const renderAttachmentChip = (att: ExerciseAttachment) => (
      <View key={att.id} style={styles.attachmentPill}>
        <Ionicons
          name={
            att.type === 'image'
              ? 'image-outline'
              : att.type === 'video'
                ? 'videocam-outline'
                : 'document-text-outline'
          }
          size={18}
          color="#9FE1C7"
          style={styles.attachmentIcon}
        />
        <Text style={styles.attachmentText} numberOfLines={1}>{att.name || att.url}</Text>
        <TouchableOpacity onPress={() => removeAttachment(att.id)} style={styles.attachmentRemove}>
          <Ionicons name="close" size={16} color="#E5F4EF" />
        </TouchableOpacity>
      </View>
    );
    const selectedAttachments = getExerciseAttachments(selectedExercise);

    return (
      <SafeAreaView style={[styles.container, { paddingHorizontal: 16, alignItems: 'stretch', justifyContent: 'flex-start' }]}>
        <View style={styles.exerciseHeader}>
          <TouchableOpacity onPress={() => setScreen('home')} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={22} color="#194055" />
          </TouchableOpacity>
          <Text style={[styles.title, { marginBottom: 0 }]}>Übungen</Text>
          <View style={{ width: 32 }} />
        </View>

        {canAddExercises && (
          <TouchableOpacity style={styles.addExerciseButton} onPress={openAddExercise}>
            <Text style={styles.addExerciseText}>+ Übung hinzufügen</Text>
          </TouchableOpacity>
        )}

        <FlatList
          data={exercises}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.exerciseRow}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={renderExerciseCard}
          ListEmptyComponent={<Text style={styles.exerciseEmpty}>Noch keine Übungen.</Text>}
          showsVerticalScrollIndicator={false}
        />

        <Modal visible={showAddExercise} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={closeAddExerciseModal}>
          <Pressable style={styles.modalOverlay} onPress={closeAddExerciseModal} />
          <View style={styles.modalCenterWrap}>
              <View style={[styles.modalCard, styles.orgModalCard]}>
              <ScrollView contentContainerStyle={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>{editingExerciseId ? 'Übung bearbeiten' : 'Übung anlegen'}</Text>
                <Text style={styles.label}>Titel</Text>
                <View style={styles.formatBar}>
                  {renderStyleToggle('title', 'bold', 'B')}
                  {renderStyleToggle('title', 'italic', 'I')}
                  {renderStyleToggle('title', 'underline', 'U')}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Titel"
                  placeholderTextColor={'#95959588'}
                  value={exerciseTitle}
                  onChangeText={setExerciseTitle}
                />
                <Text style={[styles.label, { marginTop: 6 }]}>Beschreibung</Text>
                <View style={styles.formatBar}>
                  {renderStyleToggle('description', 'bold', 'B')}
                  {renderStyleToggle('description', 'italic', 'I')}
                  {renderStyleToggle('description', 'underline', 'U')}
                </View>
                <TextInput
                  style={[styles.input, styles.textarea, { height: 100 }]}
                  placeholder="Beschreibung"
                  placeholderTextColor={'#95959588'}
                  multiline
                  value={exerciseDescription}
                  onChangeText={setExerciseDescription}
                />
                <TouchableOpacity onPress={handleAttachmentButton} style={styles.attachmentButton}>
                  <Text style={styles.attachmentButtonText}>+ Bilder & Videos hinzufuegen</Text>
                </TouchableOpacity>
                {!!attachments.length && (
                  <View style={{ marginTop: 6 }}>
                    {attachments.map(renderAttachmentChip)}
                  </View>
                )}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <TouchableOpacity onPress={addExercise} style={[styles.actionButton, styles.actionButtonPrimary, { marginRight: 8 }]}>
                    <Text style={styles.actionButtonText}>Speichern</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={closeAddExerciseModal} style={styles.actionButton}>
                    <Text style={styles.actionButtonText}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal visible={showMediaModal} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setShowMediaModal(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowMediaModal(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={[styles.modalCard, styles.orgModalCard]}>
              <View style={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>Medien hinzufuegen</Text>
                <TouchableOpacity onPress={pickFromLibrary} style={[styles.attachmentButton, { marginTop: 8 }]}>
                  <Text style={styles.attachmentButtonText}>Aus Galerie auswaehlen</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={pickDocument} style={[styles.attachmentButton, { marginTop: 8 }]}>
                  <Text style={styles.attachmentButtonText}>Aus Dateien waehlen</Text>
                </TouchableOpacity>
                <Text style={[styles.label, styles.mediaHint]}>Oder per Link:</Text>
                <View style={styles.mediaTypeRow}>
                  <TouchableOpacity
                    style={[styles.formatButton, styles.mediaTypeButton, newMediaType === 'image' && styles.formatButtonActive]}
                    onPress={() => setNewMediaType('image')}
                  >
                    <Text style={[styles.formatButtonText, newMediaType === 'image' && styles.formatButtonTextActive]}>Bild</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formatButton, styles.mediaTypeButton, newMediaType === 'video' && styles.formatButtonActive]}
                    onPress={() => setNewMediaType('video')}
                  >
                    <Text style={[styles.formatButtonText, newMediaType === 'video' && styles.formatButtonTextActive]}>Video</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formatButton, styles.mediaTypeButton, newMediaType === 'file' && styles.formatButtonActive]}
                    onPress={() => setNewMediaType('file')}
                  >
                    <Text style={[styles.formatButtonText, newMediaType === 'file' && styles.formatButtonTextActive]}>Datei</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { marginTop: 8 }]}
                  placeholder={
                    newMediaType === 'image'
                      ? 'Bild-URL einfuegen'
                      : newMediaType === 'video'
                        ? 'Video-Link (YouTube, Vimeo, etc.)'
                        : 'Datei-Link (PDF, Dokumente, etc.)'
                  }
                  placeholderTextColor={'#95959588'}
                  value={newMediaUrl}
                  onChangeText={setNewMediaUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {!!attachments.length && (
                  <ScrollView style={{ maxHeight: 180, marginTop: 8 }}>
                    {attachments.map(renderAttachmentChip)}
                  </ScrollView>
                )}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <TouchableOpacity onPress={addAttachmentFromModal} style={[styles.actionButton, styles.actionButtonPrimary, { marginRight: 8 }]}>
                    <Text style={styles.actionButtonText}>hinzufuegen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowMediaModal(false)} style={styles.actionButton}>
                    <Text style={styles.actionButtonText}>Schliessen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={!!selectedExercise} transparent animationType="fade" onRequestClose={() => setSelectedExercise(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setSelectedExercise(null)} />
          <View style={styles.modalCenterWrap}>
            <View style={[styles.modalCard, styles.orgModalCard]}>
              <ScrollView contentContainerStyle={{ padding: 12 }}>
                <Text style={[styles.exerciseDetailTitle, buildTextStyle(selectedExercise?.textStyles?.title)]}>{selectedExercise?.title}</Text>
                {!!selectedExercise?.description && (
                  <Text style={[styles.exerciseDetailBody, buildTextStyle(selectedExercise?.textStyles?.description)]}>{selectedExercise?.description}</Text>
                )}
                {selectedAttachments.map((att) => {
                  if (att.type === 'image') {
                    return (
                      <View key={att.id} style={styles.mediaWrapper}>
                        <Image
                          source={{ uri: att.url }}
                          style={styles.exerciseImage}
                          resizeMode="contain"
                        />
                      </View>
                    );
                  }
                  if (att.type === 'video') {
                    return (
                      <View key={att.id} style={styles.mediaWrapper}>
                        <TouchableOpacity
                          onPress={() => att.url && Linking.openURL(att.url).catch(() => {})}
                          style={styles.videoPreview}
                          activeOpacity={0.9}
                        >
                          <Video
                            source={{ uri: att.url }}
                            style={styles.videoPlayer}
                            resizeMode={ResizeMode.CONTAIN}
                            useNativeControls
                            shouldPlay={false}
                            isLooping={false}
                          />
                          <View style={styles.videoOverlay}>
                            <Ionicons name="expand" size={22} color="#E5F4EF" />
                            <Text style={styles.videoPreviewText} numberOfLines={1}>Vollbild öffnen</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={att.id}
                      onPress={() => att.url && Linking.openURL(att.url).catch(() => {})}
                      style={styles.videoPreview}
                      activeOpacity={0.85}
                    >
                      <View style={styles.videoPreviewInner}>
                        <Ionicons name="document-text-outline" size={42} color="#9FE1C7" />
                        <Text style={styles.videoPreviewText} numberOfLines={2}>{att.url}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={() => setSelectedExercise(null)} style={[styles.btnLink, { marginTop: 12 }]}>
                  <Text style={styles.btnLinkText}>Schliessen</Text>
                </TouchableOpacity>
                {canAddExercises && (
                  <View style={styles.detailActionsRow}>
                    <TouchableOpacity
                      onPress={() => selectedExercise && beginEditExercise(selectedExercise)}
                      style={[styles.actionButton, styles.actionButtonPrimary, { flex: 1, marginRight: 8 }]}
                    >
                      <Text style={styles.actionButtonText}>Bearbeiten</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        if (!selectedExercise) return;
                        Alert.alert('Übung löschen?', 'Diese Übung wird entfernt.', [
                          { text: 'Abbrechen', style: 'cancel' },
                          {
                            text: 'Löschen',
                            style: 'destructive',
                            onPress: () => deleteExercise(selectedExercise.id),
                          },
                        ]);
                      }}
                      style={[styles.actionButton, styles.actionButtonDanger, { flex: 1 }]}
                    >
                      <Text style={styles.actionButtonDangerText}>Löschen</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }
  if (screen === 'aufgaben') {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Aufgaben</Text>
      <Text style={styles.text}>Hier kommen To-Dos, Checklisten oder Aufgabenlisten hin.</Text>
      <Button title="Zurueck" onPress={() => setScreen('home')} />
    </View>
  );
}
// --- Home-Screen mit Buttons ---
  return (
    <SafeAreaView style={[styles.container, containerPaddings]}>

      <View style={styles.orgHeader}>
        <TouchableOpacity
          onPress={() => setShowSwitchHome(true)}
          style={styles.orgNamePressable}
          activeOpacity={0.8}
        >
          <Text style={styles.orgNameText}>{currentOrg?.name ?? 'Kein Verein'}</Text>
          <Ionicons name="chevron-down" size={22} color="#E5F4EF" style={styles.orgNameIcon} />
        </TouchableOpacity>
        {!!roleLabel && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleLabel}</Text>
          </View>
        )}
      </View>
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
          <View style={[styles.modalCard, styles.switchModalCard]}>
            <View style={{ padding: 16, width: '100%' }}>
              <View style={styles.switchModalHeader}>
                <TouchableOpacity onPress={() => setShowSwitchHome(false)} style={styles.switchModalBack}>
                  <Text style={styles.switchModalBackText}>{'<'}</Text>
                </TouchableOpacity>
                <Text style={styles.switchModalTitle}>Verein wechseln</Text>
                <View style={styles.switchModalHeaderSpacer} />
              </View>
              <View style={styles.switchModalListWrap}>
                <FlatList
                  data={orgs}
                  keyExtractor={(o) => o.id}
                  contentContainerStyle={styles.switchModalList}
                  renderItem={({ item }) => {
                    const isDirector = orgRoles[item.id] === 'director';
                    return (
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedOrgId(item.id);
                          setGroups([]);
                          setSelectedGroupId(null);
                          setChatChannelId(null);
                          setChatMode('pick');
                          setShowSwitchHome(false);
                        }}
                        onLongPress={() => {
                          if (!isDirector || selectedOrgId !== item.id) return;
                          Alert.alert('Verein löschen?', 'Dieser Verein wird dauerhaft gelöscht.', [
                            { text: 'Abbrechen', style: 'cancel' },
                            {
                              text: 'Löschen',
                              style: 'destructive',
                              onPress: async () => {
                                const ok = await deleteOrganisationCascade(item.id);
                                if (ok) await refreshOrgsAndGroups();
                              }
                            }
                          ]);
                        }}
                        style={[styles.orgSwitchButton, styles.orgSwitchRow, selectedOrgId === item.id && styles.orgSwitchButtonActive]}
                      >
                        <Text style={styles.orgSwitchButtonText}>{item.name}</Text>
                        {isDirector && (
                          <TouchableOpacity
                            onPress={(e) => { e.stopPropagation(); openOrgActions(item); }}
                            style={styles.orgActionButton}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons name="ellipsis-horizontal" size={18} color="#E5F4EF" />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                  ListFooterComponent={(
                    <TouchableOpacity
                      onPress={() => { setShowSwitchHome(false); setShowCreateOrg(true); }}
                      style={[styles.orgSwitchButton, styles.createOrgButton]}
                    >
                      <Text style={[styles.orgSwitchButtonText, styles.createOrgButtonText]}>+ Verein</Text>
                    </TouchableOpacity>
                  )}
                  showsVerticalScrollIndicator={false}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!orgActionTarget} transparent animationType="fade" onRequestClose={() => setOrgActionTarget(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setOrgActionTarget(null)} />
        <View style={styles.modalCenterWrap}>
          <View style={styles.modalCard}>
            <View style={{ padding: 12 }}>
              <Text style={styles.sectionTitle}>Verein</Text>
              {!!orgActionTarget && (
                <Text style={styles.modalSubtitle}>{orgActionTarget.name}</Text>
              )}
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => {
                  if (!orgActionTarget) return;
                  setOrgActionTarget(null);
                  setRenameOrgId(orgActionTarget.id);
                  setRenameOrgName(orgActionTarget.name);
                  setShowRenameOrg(true);
                }}
              >
                <Text style={styles.actionButtonText}>Verein umbenennen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => {
                  if (!orgActionTarget) return;
                  const target = orgActionTarget;
                  setOrgActionTarget(null);
                  openManageMembers(target);
                }}
              >
                <Text style={styles.actionButtonText}>Mitglieder verwalten</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonDanger]}
                onPress={() => {
                  if (!orgActionTarget) return;
                  const target = orgActionTarget;
                  Alert.alert('Verein löschen?', `Soll "${target.name}" dauerhaft gelöscht werden?`, [
                    { text: 'Abbrechen', style: 'cancel' },
                    {
                      text: 'Löschen',
                      style: 'destructive',
                      onPress: async () => {
                        setOrgActionTarget(null);
                        const ok = await deleteOrganisationCascade(target.id);
                        if (ok) await refreshOrgsAndGroups();
                      },
                    },
                  ]);
                }}
              >
                <Text style={[styles.actionButtonText, styles.actionButtonDangerText]}>Löschen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnLink} onPress={() => setOrgActionTarget(null)}>
                <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
              </TouchableOpacity>
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
        <Modal visible={showRenameOrg} transparent animationType="fade" onRequestClose={() => setShowRenameOrg(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowRenameOrg(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={styles.modalCard}>
              <View style={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>Verein umbenennen</Text>
                <TextInput style={styles.input} placeholder="Neuer Name" placeholderTextColor={'#95959588'} value={renameOrgName} onChangeText={setRenameOrgName} />
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity style={[styles.btnLink, { marginRight: 8 }]} onPress={handleOrgRenameSave}>
                    <Text style={styles.btnLinkText}>Speichern</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnLink} onPress={closeRenameOrgModal}>
                    <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={showManageMembers} transparent animationType="fade" onRequestClose={closeManageMembers}>
          <Pressable style={styles.modalOverlay} onPress={closeManageMembers} />
          <View style={styles.modalCenterWrap}>
            <View style={[styles.modalCard, styles.orgModalCard, styles.membersModalCard]}>
              <View style={{ padding: 12, maxHeight: 520 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.sectionTitle}>Mitglieder verwalten</Text>
                  <TouchableOpacity onPress={closeManageMembers}>
                    <Ionicons name="close" size={20} color="#E5F4EF" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalSubtitle}>{manageMembersOrg?.name ?? ''}</Text>
                {(!manageMembersOrg || orgRoles[manageMembersOrg.id] !== 'director') && (
                  <Text style={styles.memberHint}>Bearbeitung nur für Direktoren möglich.</Text>
                )}
                {orgMembersLoading ? (
                  <Text style={styles.text}>Lade Mitglieder...</Text>
                ) : (
                  <ScrollView style={{ maxHeight: 420 }}>
                    <View style={styles.memberSection}>
                      <Text style={styles.memberSectionTitle}>Lehrer</Text>
                      {orgMembers.filter((m) => m.role === 'teacher').length ? (
                        orgMembers
                          .filter((m) => m.role === 'teacher')
                          .map((member) =>
                            renderMemberCard(member, !!(manageMembersOrg && orgRoles[manageMembersOrg.id] === 'director')),
                          )
                      ) : (
                        <Text style={styles.memberEmptyText}>Keine Lehrer vorhanden.</Text>
                      )}
                    </View>
                    <View style={styles.memberSection}>
                      <Text style={styles.memberSectionTitle}>Schüler</Text>
                      {orgMembers.filter((m) => m.role === 'student').length ? (
                        orgMembers
                          .filter((m) => m.role === 'student')
                          .map((member) =>
                            renderMemberCard(member, !!(manageMembersOrg && orgRoles[manageMembersOrg.id] === 'director')),
                          )
                      ) : (
                        <Text style={styles.memberEmptyText}>Keine Schüler vorhanden.</Text>
                      )}
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </View>
        </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#112a37' },
  chatSafeArea: { flex: 1, backgroundColor: '#112a37' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 20, color: '#E5F4EF' },
  orgHeader: { width: '100%', maxWidth: 720, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  orgNamePressable: { flexDirection: 'row', alignItems: 'center' },
  orgNameText: { fontSize: 40, fontWeight: '800', color: '#E5F4EF' },
  orgNameIcon: { marginLeft: 6 },
  roleBadge: { backgroundColor: '#194055', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  roleBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  switchModalCard: { backgroundColor: '#194055', borderColor: '#194055' },
  switchModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  switchModalBack: { width: 32, paddingVertical: 4, alignItems: 'flex-start' },
  switchModalBackText: { color: '#E5F4EF', fontSize: 20, fontWeight: '900' },
  switchModalHeaderSpacer: { width: 32 },
  switchModalTitle: { flex: 1, textAlign: 'center', color: '#E5F4EF', fontSize: 18, fontWeight: '700' },
  switchModalListWrap: { maxHeight: 360, marginTop: 8, width: '100%', paddingHorizontal: 6 },
  switchModalList: { paddingVertical: 4, paddingHorizontal: 4 },
  orgSwitchButton: { paddingVertical: 16, paddingHorizontal: 18, borderRadius: 28, borderWidth: 1, borderColor: '#3D8B77', backgroundColor: '#215C4A', marginBottom: 10 },
  orgSwitchButtonActive: { backgroundColor: '#2F7A60', borderColor: '#2F7A60' },
  orgSwitchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orgSwitchButtonText: { color: '#E5F4EF', fontWeight: '700', fontSize: 16 },
  orgActionButton: { padding: 6, borderRadius: 16, backgroundColor: '#1b3746', marginLeft: 12 },
  createOrgButton: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  createOrgButtonText: { color: '#9FE1C7' },
  annButton: { marginTop: 12, marginBottom: 12, alignSelf: 'center' },
  text: { fontSize: 16, textAlign: 'center', marginBottom: 20, color: '#E5F4EF' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, color: '#E5F4EF' },
  exerciseHeader: { width: '100%', maxWidth: 720, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  addExerciseButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#3D8B77', backgroundColor: '#0F2530', marginBottom: 12 },
  addExerciseText: { color: '#9FE1C7', fontWeight: '700' },
  exerciseRow: { justifyContent: 'space-between', marginBottom: 12 },
  exerciseCard: { width: '48%', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530' },
  exerciseCardTitle: { color: '#E5F4EF', fontWeight: '700', fontSize: 16 },
  exerciseEmpty: { color: '#9CA3AF', textAlign: 'center', marginTop: 12 },
  exerciseDetailTitle: { color: '#E5F4EF', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  exerciseDetailBody: { color: '#C7D2D6', fontSize: 15, marginBottom: 12 },
  mediaWrapper: { width: '100%', borderRadius: 12, overflow: 'hidden', marginBottom: 12, backgroundColor: '#0f2633' },
  exerciseImage: { width: '100%', height: 220, backgroundColor: '#0f2633' },
  videoLink: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  videoLinkText: { color: '#9FE1C7', marginLeft: 8, flex: 1, textDecorationLine: 'underline' },
  formatBar: { flexDirection: 'row', marginBottom: 6 },
  formatButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginRight: 8 },
  formatButtonActive: { backgroundColor: '#194055', borderColor: '#3D8B77' },
  formatButtonText: { color: '#E5F4EF', fontWeight: '700' },
  formatButtonTextActive: { color: '#9FE1C7' },
  attachmentButton: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#3D8B77', backgroundColor: '#0F2530', marginTop: 8 },
  attachmentButtonText: { color: '#9FE1C7', fontWeight: '700' },
  attachmentPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginBottom: 6 },
  attachmentIcon: { marginRight: 8 },
  attachmentText: { color: '#E5F4EF', flex: 1 },
  attachmentRemove: { marginLeft: 8, padding: 4 },
  mediaTypeRow: { flexDirection: 'row', marginTop: 4, marginBottom: 4 },
  mediaTypeButton: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  videoPreview: { width: '100%', borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0f2633', padding: 8, marginBottom: 12 },
  videoPlayer: { width: '100%', height: 220, backgroundColor: '#0f2633', borderRadius: 10 },
  videoPreviewInner: { alignItems: 'center', justifyContent: 'center' },
  videoPreviewText: { color: '#E5F4EF', marginTop: 6, textAlign: 'center' },
  videoOverlay: { position: 'absolute', bottom: 8, right: 8, left: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  mediaHint: { marginTop: 10, color: '#E5F4EF', fontWeight: '600' },
  detailActionsRow: { flexDirection: 'row', marginTop: 12 },

  label: { color: '#ffffffff', fontSize: 14, fontWeight: '600', marginBottom: 6 },

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
  centerButton: { alignSelf: 'center' },

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
  groupCard: { flexDirection: 'row', alignItems: 'center' },
  groupActionButton: { padding: 4, marginLeft: 12, borderRadius: 16, backgroundColor: '#1b3746' },
  announcementCard: { minHeight: 150, justifyContent: 'space-between' },
  announcementCardRow: { flexDirection: 'row', alignItems: 'center' },
  annTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4, color: '#E5F4EF' },
  annMeta: { fontSize: 12, color: '#000000ff', marginBottom: 6 },
  annBody: { fontSize: 14, color: '#E5F4EF' },
  input: { borderWidth: 1, borderColor: '#2A3E48', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, color: '#E5F4EF', backgroundColor: '#0F2530' },
  inputMultiline: { height: 44 },
  textarea: { height: 120 },
  datePickerButton: { borderWidth: 1, borderColor: '#2A3E48', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, backgroundColor: '#0F2530', marginBottom: 12 },
  datePickerButtonActive: { borderColor: '#3D8B77' },
  datePickerPlaceholder: { color: '#6B7280', fontSize: 16 },
  datePickerValue: { color: '#E5F4EF', fontSize: 16, fontWeight: '600' },
  calendarToggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginBottom: 12 },
  calendarToggleRowActive: { borderColor: '#3D8B77' },
  calendarToggleCheckbox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: '#3D8B77', marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  calendarToggleCheckboxActive: { backgroundColor: '#3D8B77', borderColor: '#3D8B77' },
  calendarToggleLabel: { color: '#E5F4EF', fontSize: 16, fontWeight: '600' },
  calendarToggleHint: { color: '#9CA3AF', fontSize: 13, marginTop: 2 },
  // Flat menu buttons with separators
  menuBtn: {
    width: '100%',
    alignSelf: 'stretch',
    paddingVertical: 16,
    alignItems: 'center',
    marginVertical: 6,
    borderWidth: 2,
    borderColor: '#3D8B77',
    borderRadius: 18,
    backgroundColor: '#112a37',
  },
  menuBtnText: { color: '#E8F3F0', fontSize: 18, fontWeight: '600' },
  circlePlaceholder: { width: 64, height: 64, borderRadius: 999, backgroundColor: '#184B3D', alignItems: 'center', justifyContent: 'center' },

  // Modal helpers
  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  modalCenterWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '90%', backgroundColor: '#194055', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', maxHeight: 520, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 },
  orgModalCard: { backgroundColor: '#0f2533', borderColor: '#3D8B77' },
  announcementModalCard: { maxHeight: 660 },
  membersModalCard: { maxHeight: 640 },
  modalSubtitle: { color: '#9FE1C7', fontWeight: '600', marginBottom: 16 },
  btnLink: { paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLinkText: { color: '#2563EB', fontWeight: '700' },
  btnLinkTextMuted: { color: '#ffffffff', fontWeight: '600' },
  actionButton: { width: '100%', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginBottom: 10, alignItems: 'center' },
  actionButtonPrimary: { borderColor: '#2563EB', backgroundColor: '#1a2f49' },
  actionButtonDanger: { borderColor: '#7F1D1D', backgroundColor: '#1a1414' },
  actionButtonText: { color: '#E5F4EF', fontWeight: '700' },
  actionButtonDangerText: { color: '#F87171' },
  actionButtonDisabled: { opacity: 0.5 },
  memberHint: { color: '#9CA3AF', marginBottom: 8 },
  memberSection: { marginBottom: 16 },
  memberSectionTitle: { color: '#E5F4EF', fontWeight: '700', marginBottom: 8 },
  memberCard: { borderWidth: 1, borderColor: '#2A3E48', borderRadius: 10, padding: 10, marginBottom: 10, backgroundColor: '#0F2530' },
  memberName: { color: '#E5F4EF', fontWeight: '600', fontSize: 16 },
  memberEmail: { color: '#9CA3AF', fontSize: 13 },
  memberGroupsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  memberGroupChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: '#2A3E48', marginRight: 6, marginBottom: 6 },
  memberGroupChipActive: { backgroundColor: '#194055', borderColor: '#194055' },
  memberGroupChipDisabled: { opacity: 0.5 },
  memberGroupChipText: { color: '#E5F4EF', fontSize: 13 },
  memberGroupChipTextActive: { fontWeight: '700' },
  memberEmptyText: { color: '#9CA3AF', fontStyle: 'italic', marginBottom: 8 },

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
  chatHeaderNoBorder: { borderBottomWidth: 0 },
  sectionDivider: { width: '100%', maxWidth: 720, height: StyleSheet.hairlineWidth, backgroundColor: '#2A3E48', marginBottom: 8 },
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


























