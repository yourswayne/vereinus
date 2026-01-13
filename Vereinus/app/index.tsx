import { View, Text, StyleSheet, BackHandler, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Modal, Pressable, Keyboard, Image, Alert, ScrollView, AppState } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { ImageStyle, TextStyle, StyleProp, ViewStyle } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase, supabaseAnonKey, supabaseUrl, supabaseUsingFallback } from '../lib/supabase';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { VideoViewProps } from 'expo-video';


type Screen = 'home' | 'ankuendigung' | 'chat' | 'uebungen' | 'aufgaben';
type AnnouncementRow = { id: string; title: string; body: string | null; event_date: string | null; created_at?: string | null };
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
type Assignment = {
  id: string;
  orgId: string | null;
  groupId: string | null;
  title: string;
  description?: string;
  attachmentUrl?: string;
  dueAt?: string;
  createdAt: string;
  createdBy?: string | null;
};
type AssignmentSubmission = {
  id: string;
  assignmentId: string;
  userId: string;
  userName?: string | null;
  note?: string;
  attachmentUrl?: string;
  submittedAt: string;
};
type ChatMedia = {
  url: string;
  type: 'image' | 'video' | 'file';
  name?: string | null;
};
type ChatMessage = {
  id: string;
  text: string;
  from: 'me' | 'other';
  at: string;
  createdAt: string;
  userId: string | null;
  senderName?: string | null;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | 'file' | null;
  mediaName?: string | null;
  mediaItems?: ChatMedia[] | null;
};
type PendingChatMedia = {
  uri: string;
  type: 'image' | 'video' | 'file';
  name?: string | null;
  mimeType?: string | null;
};
type PendingUpload = {
  uri: string;
  kind: 'image' | 'video' | 'file';
  name?: string | null;
  mimeType?: string | null;
};
type MediaPickerTarget = 'chat' | 'exercise' | 'assignment' | 'submission' | 'group' | 'org';

type InlineVideoProps = {
  uri: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'contain' | 'cover' | 'fill';
  nativeControls?: boolean;
  fullscreenOptions?: VideoViewProps['fullscreenOptions'];
};

const InlineVideo = ({
  uri,
  style,
  contentFit = 'cover',
  nativeControls = true,
  fullscreenOptions,
}: InlineVideoProps) => {
  const resolvedFullscreenOptions = fullscreenOptions ?? { enable: true };
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={style}
      nativeControls={nativeControls}
      contentFit={contentFit}
      fullscreenOptions={resolvedFullscreenOptions}
    />
  );
};
export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const insets = useSafeAreaInsets();
  const containerPaddings = { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 };
  const homePaddings = { paddingTop: insets.top , paddingBottom: insets.bottom + 100 };
  // Chat messages (remote)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageUserNames, setMessageUserNames] = useState<Record<string, string>>({});
  const messageUserNamesRef = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [pendingChatMedia, setPendingChatMedia] = useState<PendingChatMedia[]>([]);
  const [chatUploadBusy, setChatUploadBusy] = useState(false);
  const [chatMediaUrlCache, setChatMediaUrlCache] = useState<Record<string, string>>({});
  const chatMediaUrlCacheRef = useRef<Record<string, string>>({});
  const chatSeenByGroupRef = useRef<Record<string, string>>({});
  const groupByChannelRef = useRef<Record<string, string>>({});
  const chatModeRef = useRef<'pick' | 'in' | 'info'>('pick');
  const screenRef = useRef<Screen>('home');
  const [fullScreenMedia, setFullScreenMedia] = useState<ChatMedia | null>(null);
  // Chat input auto-grow up to a limit, then scroll
  const MIN_CHAT_INPUT_HEIGHT = 56;
  const MAX_CHAT_INPUT_HEIGHT = 120;
  const TAB_BAR_HEIGHT = 20; // Keep input above native tab bar
  const [chatInputHeight, setChatInputHeight] = useState<number>(MIN_CHAT_INPUT_HEIGHT);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [, setKeyboardHeight] = useState(0);

  // --- Supabase session + Orgs/Groups + remote Announcements ---
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string; logo_url?: string | null }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; org_id: string; image_url?: string | null }[]>([]);
  const [groupsRefreshKey, setGroupsRefreshKey] = useState(0);
  const [showSwitchHome, setShowSwitchHome] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

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

  useEffect(() => {
    messageUserNamesRef.current = messageUserNames;
  }, [messageUserNames]);

  useEffect(() => {
    chatMediaUrlCacheRef.current = chatMediaUrlCache;
  }, [chatMediaUrlCache]);

  useEffect(() => {
    if (screen !== 'chat' && fullScreenMedia) setFullScreenMedia(null);
  }, [screen, fullScreenMedia]);

  useEffect(() => {
    setOrgMembers([]);
    setOrgMemberGroups([]);
  }, [selectedOrgId]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroupIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId;
  }, [selectedGroupId]);
  const [orgRole, setOrgRole] = useState<'director' | 'teacher' | 'student' | null>(null);
  const [orgRoles, setOrgRoles] = useState<Record<string, 'director' | 'teacher' | 'student'>>({});
  const [annRemote, setAnnRemote] = useState<AnnouncementRow[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [annRefreshKey, setAnnRefreshKey] = useState(0);
  const [calendarSyncedAnnouncements, setCalendarSyncedAnnouncements] = useState<Record<string, boolean>>({});
  const getAnnouncementCalendarEventId = (announcementId: string) => `ann-${announcementId}`;
  const parseLocalDateOnly = (value?: string) => {
    if (!value) return null;
    const datePart = value.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  };
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
  const [chatMode, setChatMode] = useState<'pick' | 'in' | 'info'>('pick');
  const [seenAnnouncementsAt, setSeenAnnouncementsAt] = useState<string | null>(null);
  const [seenExercisesAt, setSeenExercisesAt] = useState<string | null>(null);
  const [seenAssignmentsAt, setSeenAssignmentsAt] = useState<string | null>(null);
  const [chatSeenByGroup, setChatSeenByGroup] = useState<Record<string, string>>({});
  const [chatUnreadByGroup, setChatUnreadByGroup] = useState<Record<string, number>>({});
  useEffect(() => {
    chatSeenByGroupRef.current = chatSeenByGroup;
  }, [chatSeenByGroup]);
  useEffect(() => {
    chatModeRef.current = chatMode;
  }, [chatMode]);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
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
  // --- Übungen ---
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
  const [mediaPickerTarget, setMediaPickerTarget] = useState<MediaPickerTarget | null>(null);
  const [mediaUploadBusy, setMediaUploadBusy] = useState(false);
  const [newMediaUrl, setNewMediaUrl] = useState('');
  const [newMediaType, setNewMediaType] = useState<'image' | 'video' | 'file'>('image');
  const [orgMembers, setOrgMembers] = useState<OrgMemberRow[]>([]);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [orgMemberGroups, setOrgMemberGroups] = useState<{ id: string; name: string }[]>([]);
  // --- Aufgaben ---
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentSubmissions, setAssignmentSubmissions] = useState<AssignmentSubmission[]>([]);
  const [assignmentView, setAssignmentView] = useState<'list' | 'detail' | 'create' | 'submissions' | 'submissionDetail'>('list');
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<AssignmentSubmission | null>(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [assignmentDescription, setAssignmentDescription] = useState('');
  const [assignmentAttachments, setAssignmentAttachments] = useState<string[]>([]);
  const [assignmentGroupId, setAssignmentGroupId] = useState<string | null>(null);
  const [submissionNote, setSubmissionNote] = useState('');
  const [submissionAttachments, setSubmissionAttachments] = useState<string[]>([]);
  const groupsReqRef = useRef(0);
  const prevOrgIdRef = useRef<string | null>(null);
  const annReqRef = useRef(0);

  const currentOrg = useMemo(() => orgs.find((o) => o.id === selectedOrgId) ?? null, [orgs, selectedOrgId]);
  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const roleLabel = useMemo(() => {
    if (orgRole === 'director') return 'Direktor';
    if (orgRole === 'teacher') return 'Lehrer';
    if (orgRole === 'student') return 'Schüler';
    return null;
  }, [orgRole]);
  const canEditGroupMedia = orgRole === 'director' || orgRole === 'teacher';
  const canCreateAnnouncement = useMemo(() => {
    return !!(sessionUserId && orgRole === 'director' && selectedOrgId);
  }, [sessionUserId, orgRole, selectedOrgId]);
  const EXERCISE_STORAGE_BASE = '@vereinus/exercises';
  const SEEN_STORAGE_BASE = '@vereinus/seen';
  const CHAT_MEDIA_BUCKET = 'chat-media';
  const ATTACHMENTS_BUCKET = 'assignment-attachments';
  const exerciseStorageKey = useMemo(
    () => `${EXERCISE_STORAGE_BASE}:${selectedOrgId ?? 'default'}`,
    [selectedOrgId],
  );
  const assignmentStorageKey = useMemo(
    () => `@vereinus/assignments:${selectedOrgId ?? 'default'}`,
    [selectedOrgId],
  );
  const submissionStorageKey = useMemo(
    () => `@vereinus/assignment_submissions:${selectedOrgId ?? 'default'}`,
    [selectedOrgId],
  );
  const buildSeenKey = (kind: string) => (
    `${SEEN_STORAGE_BASE}:${kind}:${sessionUserId ?? 'anon'}:${selectedOrgId ?? 'default'}`
  );
  const myMemberEntry = useMemo(
    () => orgMembers.find((m) => m.userId === sessionUserId) ?? null,
    [orgMembers, sessionUserId],
  );
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    orgMembers.forEach((m) => map.set(m.userId, m.displayName));
    return map;
  }, [orgMembers]);
  const myGroupIds = useMemo(() => {
    const ids = new Set<string>();
    (myMemberEntry?.groupIds ?? []).forEach((id) => ids.add(id));
    groups.forEach((g) => ids.add(g.id));
    return Array.from(ids);
  }, [myMemberEntry, groups]);
  const assignmentGroupsForTeacher = useMemo(() => {
    if (orgRole === 'director') return groups.filter((g) => g.org_id === selectedOrgId);
    if (orgRole === 'teacher') {
      const byMembership = groups.filter((g) => myGroupIds.includes(g.id));
      if (byMembership.length) return byMembership;
      // Fallback: wenn Gruppenmitgliedschaften (orgMembers) noch nicht geladen wurden, nimm alle Gruppen des Vereins
      return groups.filter((g) => g.org_id === selectedOrgId);
    }
    return [];
  }, [groups, selectedOrgId, orgRole, myGroupIds]);
  const [assignmentDueDate, setAssignmentDueDate] = useState<Date | null>(null);
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [showDueTimePicker, setShowDueTimePicker] = useState(false);
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<'all' | 'upcoming' | 'overdue' | 'submitted'>('all');
  const [assignmentRefreshKey, setAssignmentRefreshKey] = useState(0);
  const assignmentSyncErrorShown = useRef(false);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  const isUuid = (value?: string | null) =>
    !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const mergeById = <T extends { id: string }>(local: T[], remote: T[]) => {
    const map = new Map<string, T>();
    remote.forEach((item) => {
      if (item?.id) map.set(item.id, item);
    });
    local.forEach((item) => {
      if (item?.id) map.set(item.id, item);
    });
    return Array.from(map.values());
  };

  const buildProfileDisplayName = (
    profile?: {
      first_name?: string | null;
      last_name?: string | null;
      display_name?: string | null;
      full_name?: string | null;
      username?: string | null;
      email?: string | null;
    },
    fallbackId?: string,
  ) => {
    const first = profile?.first_name?.trim();
    const last = profile?.last_name?.trim();
    const full = [first, last].filter(Boolean).join(' ').trim();
    if (full) return full;
    const displayName = profile?.display_name?.trim();
    if (displayName) return displayName;
    const fullName = profile?.full_name?.trim();
    if (fullName) return fullName;
    const userName = profile?.username?.trim();
    if (userName) return userName;
    const email = profile?.email?.trim();
    if (email) return email;
    if (fallbackId) return `Mitglied ${fallbackId.slice(0, 6)}`;
    return 'Mitglied';
  };

  const fetchProfilesByIds = async (userIds: string[]) => {
    if (!userIds.length) return [] as any[];
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, username, first_name, last_name, email')
        .in('id', userIds);
      if (!error) return data ?? [];
    } catch {
      // fallback below
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);
      if (!error) return data ?? [];
    } catch {
      // ignore missing profiles table
    }
    return [] as any[];
  };

  const ensureMessageUserNames = async (userIds: string[]) => {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    const missing = unique.filter((id) => !messageUserNamesRef.current[id]);
    if (!missing.length) return;
    const next: Record<string, string> = {};
    missing.forEach((id) => {
      const memberName = memberNameById.get(id);
      if (memberName) next[id] = memberName;
    });
    const remaining = missing.filter((id) => !next[id]);
    if (remaining.length) {
      const rows = await fetchProfilesByIds(remaining);
      rows.forEach((p: any) => {
        if (p?.id) next[p.id] = buildProfileDisplayName(p, p.id);
      });
    }
    if (Object.keys(next).length) {
      setMessageUserNames((prev) => ({ ...prev, ...next }));
    }
  };

  const resolveCurrentUserDisplayName = useCallback(async () => {
    if (!sessionUserId) return null;
    if (myMemberEntry?.displayName) return myMemberEntry.displayName;
    const cached = messageUserNamesRef.current[sessionUserId];
    if (cached) return cached;
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (user) {
        const meta = (user.user_metadata ?? {}) as any;
        const fromMeta = buildProfileDisplayName({
          first_name: meta.first_name ?? null,
          last_name: meta.last_name ?? null,
          display_name: meta.display_name ?? null,
          full_name: meta.full_name ?? null,
          username: meta.username ?? null,
          email: user.email ?? null,
        }, sessionUserId);
        if (fromMeta) return fromMeta;
      }
    } catch {
      // ignore metadata errors
    }
    const rows = await fetchProfilesByIds([sessionUserId]);
    const row = rows?.[0];
    if (row) return buildProfileDisplayName(row, sessionUserId);
    return null;
  }, [buildProfileDisplayName, fetchProfilesByIds, myMemberEntry?.displayName, sessionUserId]);
  const buildChatMessage = (row: { id: string; user_id: string | null; body: string | null; created_at: string }) => {
    const parsed = parseChatBody(row.body);
    const mediaItems = parsed.mediaItems?.length
      ? parsed.mediaItems
      : parsed.media
        ? [parsed.media]
        : [];
    const firstMedia = mediaItems[0] ?? null;
    return {
      id: row.id,
      text: parsed.text,
      from: row.user_id === sessionUserId ? 'me' : 'other',
      at: timeFromIso(row.created_at),
      createdAt: row.created_at,
      userId: row.user_id ?? null,
      senderName: parsed.senderName ?? null,
      mediaUrl: firstMedia?.url ?? null,
      mediaType: firstMedia?.type ?? null,
      mediaName: firstMedia?.name ?? null,
      mediaItems: mediaItems.length ? mediaItems : null,
    } as ChatMessage;
  };

  const getChatMediaPathFromUrl = useCallback((url: string) => {
    if (!supabaseUrl) return null;
    const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/`;
    const authedPrefix = `${supabaseUrl}/storage/v1/object/${CHAT_MEDIA_BUCKET}/`;
    if (url.startsWith(publicPrefix)) return url.slice(publicPrefix.length);
    if (url.startsWith(authedPrefix)) return url.slice(authedPrefix.length).split('?')[0];
    return null;
  }, [supabaseUrl, CHAT_MEDIA_BUCKET]);

  useEffect(() => {
    if (supabaseUsingFallback || !supabaseUrl || !(supabase as any).storage) return;
    const pending = [
      ...messages.flatMap((m) => {
        if (m.mediaItems?.length) return m.mediaItems.map((item) => item.url).filter(Boolean);
        return m.mediaUrl ? [m.mediaUrl] : [];
      }),
      ...groups.map((g) => g.image_url).filter(Boolean),
      ...(currentOrg?.logo_url ? [currentOrg.logo_url] : []),
    ]
      .filter((url): url is string => !!url)
      .filter((url) => !chatMediaUrlCacheRef.current[url]);
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      const unique = Array.from(new Set(pending));
      await Promise.all(unique.map(async (url) => {
        const path = getChatMediaPathFromUrl(url);
        if (!path) return;
        const { data, error } = await (supabase as any)
          .storage
          .from(CHAT_MEDIA_BUCKET)
          .createSignedUrl(path, 60 * 60 * 24);
        if (cancelled || error || !data?.signedUrl) return;
        setChatMediaUrlCache((prev) => (prev[url] ? prev : { ...prev, [url]: data.signedUrl }));
      }));
    })();
    return () => { cancelled = true; };
  }, [messages, groups, currentOrg, supabaseUsingFallback, supabaseUrl, getChatMediaPathFromUrl, CHAT_MEDIA_BUCKET]);

  useEffect(() => {
    if (!selectedOrgId || supabaseUsingFallback) return;
    if (orgMembersLoading || orgMembers.length) return;
    if (screen === 'chat' || screen === 'aufgaben') {
      loadOrgMembers(selectedOrgId);
    }
  }, [screen, selectedOrgId, supabaseUsingFallback, orgMembers.length, orgMembersLoading]);

  useEffect(() => {
    if (!messages.length || !orgMembers.length) return;
    const ids = messages.map((m) => m.userId).filter(Boolean) as string[];
    if (ids.length) ensureMessageUserNames(ids);
  }, [messages, orgMembers.length]);

  useEffect(() => {
    if (!assignmentSubmissions.length) return;
    const ids = assignmentSubmissions.map((s) => s.userId).filter(Boolean) as string[];
    if (ids.length) ensureMessageUserNames(ids);
  }, [assignmentSubmissions]);

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
  const refreshOrgsAndGroups = useCallback(async () => {
    if (!sessionUserId) {
      setOrgs([]); setGroups([]); setSelectedOrgId(null); setSelectedGroupId(null); setOrgRole(null); setOrgRoles({}); setAnnRemote([]);
      return;
    }
    const { data: mems } = await supabase.from('organisation_members').select('org_id, role').eq('user_id', sessionUserId);
    const memsTyped = (mems ?? []) as { org_id: string; role: 'director' | 'teacher' | 'student' }[];
    const orgIds = memsTyped.map(m => m.org_id);
    if (!orgIds.length) {
      setOrgs([]); setSelectedOrgId(null); setGroups([]); setSelectedGroupId(null); setOrgRole(null); setOrgRoles({});
      return;
    }
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
  }, [sessionUserId, selectedOrgId]);

  // Realtime: listen for organisation membership changes for the current user
  useEffect(() => {
    if (supabaseUsingFallback || !sessionUserId) return;
    const chan = (supabase as any).channel?.(`org-sync-${sessionUserId}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'organisation_members', filter: `user_id=eq.${sessionUserId}` }, (payload: any) => {
        // refresh local orgs/groups when membership for this user changes
        refreshOrgsAndGroups();
      })
      // also watch for org deletions so we can remove the org immediately
      ?.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'organisations' }, (payload: any) => {
        const deletedId = payload.old?.id as string | undefined;
        if (deletedId) {
          // remove from local list and notify user if they were a member
          setOrgs((prev) => {
            const existed = prev.some((o) => o.id === deletedId);
            const next = prev.filter((o) => o.id !== deletedId);
            if (existed) {
              try {
                Alert.alert('Verein entfernt', 'Dieser Verein wurde gelöscht oder du wurdest entfernt.');
              } catch {
              }
            }
            return next;
          });

          // if the deleted org was selected, clear selection and related state
          setSelectedOrgId((prev) => {
            if (prev === deletedId) {
              setGroups([]);
              setSelectedGroupId(null);
              setChatChannelId(null);
              setChatMode('pick');
              return null;
            }
            return prev;
          });
        }
        refreshOrgsAndGroups();
      })
      ?.subscribe();

    return () => { chan?.unsubscribe?.(); };
  }, [sessionUserId, supabaseUsingFallback, refreshOrgsAndGroups, selectedOrgId]);

  useEffect(() => {
    if (supabaseUsingFallback || !selectedOrgId) return;
    const chan = (supabase as any).channel?.(`org-updates-${selectedOrgId}`)
      ?.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'organisations', filter: `id=eq.${selectedOrgId}` }, (payload: any) => {
        const updated = payload?.new as { id?: string; name?: string | null; logo_url?: string | null } | undefined;
        if (!updated?.id) return;
        setOrgs((prev) => prev.map((o) => (
          o.id === updated.id
            ? { ...o, name: updated.name ?? o.name, logo_url: updated.logo_url ?? null }
            : o
        )));
      })
      ?.subscribe();
    return () => { chan?.unsubscribe?.(); };
  }, [selectedOrgId, supabaseUsingFallback]);

  useEffect(() => {
    if (supabaseUsingFallback || !sessionUserId || !selectedOrgId) return;
    const chan = (supabase as any).channel?.(`groups-sync-${selectedOrgId}-${sessionUserId}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter: `org_id=eq.${selectedOrgId}` }, () => {
        setGroupsRefreshKey((prev) => prev + 1);
      })
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${sessionUserId}` }, () => {
        setGroupsRefreshKey((prev) => prev + 1);
      })
      ?.subscribe();
    return () => { chan?.unsubscribe?.(); };
  }, [selectedOrgId, sessionUserId, supabaseUsingFallback]);

  useEffect(() => {
    if (supabaseUsingFallback || !selectedOrgId) return;
    const chan = (supabase as any).channel?.(`announcements-${selectedOrgId}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `org_id=eq.${selectedOrgId}` }, () => {
        setAnnRefreshKey((prev) => prev + 1);
      })
      ?.subscribe();
    return () => { chan?.unsubscribe?.(); };
  }, [selectedOrgId, supabaseUsingFallback]);

  useEffect(() => {
    if (supabaseUsingFallback || !selectedOrgId) return;
    const chan = (supabase as any).channel?.(`assignments-${selectedOrgId}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `org_id=eq.${selectedOrgId}` }, () => {
        setAssignmentRefreshKey((prev) => prev + 1);
      })
      ?.subscribe();
    return () => { chan?.unsubscribe?.(); };
  }, [selectedOrgId, supabaseUsingFallback]);

  useEffect(() => {
    if (supabaseUsingFallback || !selectedOrgId) return;
    const ids = assignments.map((a) => a.id).filter(Boolean);
    if (!ids.length) return;
    const filter = `assignment_id=in.(${ids.join(',')})`;
    const chan = (supabase as any).channel?.(`assignment-subs-${selectedOrgId}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_submissions', filter }, () => {
        setAssignmentRefreshKey((prev) => prev + 1);
      })
      ?.subscribe();
    return () => { chan?.unsubscribe?.(); };
  }, [assignments, selectedOrgId, supabaseUsingFallback]);

  useEffect(() => {
      let alive = true;
      (async () => {
        let localExercises: Exercise[] = [];
        try {
          const raw = await AsyncStorage.getItem(exerciseStorageKey);
          localExercises = raw ? JSON.parse(raw) : [];
        } catch {
          localExercises = [];
        }

        if (!alive) return;
        setExercises(localExercises);

        if (supabaseUsingFallback || !selectedOrgId || !sessionUserId) return;

        try {
          const { data, error } = await supabase
            .from('exercises')
            .select('id, org_id, group_id, title, description, attachments, text_styles, created_at, updated_at')
            .eq('org_id', selectedOrgId)
            .order('created_at', { ascending: false });
          if (error) throw error;
          const remoteExercises = (data ?? []).map((row: any) => mapExerciseRow(row));
          if (!alive) return;
          const merged = sortExercises(mergeById(localExercises, remoteExercises));
          setExercises(merged);
          AsyncStorage.setItem(exerciseStorageKey, JSON.stringify(merged)).catch(() => { });
        } catch {
          // keep local cache on remote load errors
        }
      })();
      return () => { alive = false; };
    }, [exerciseStorageKey, selectedOrgId, sessionUserId, supabaseUsingFallback]);

    useEffect(() => {
    AsyncStorage.setItem(exerciseStorageKey, JSON.stringify(exercises)).catch(() => { });
  }, [exercises, exerciseStorageKey]);

  // Realtime subscription: keep exercises in sync across clients
  useEffect(() => {
    if (supabaseUsingFallback || !selectedOrgId) return;
    const chan = (supabase as any).channel?.(`exercises-org-${selectedOrgId}`)
      ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exercises', filter: `org_id=eq.${selectedOrgId}` }, (payload: any) => {
        try {
          const mapped = mapExerciseRow(payload.new);
          setExercises((prev) => sortExercises(mergeById(prev, [mapped])));
        } catch (e) {
          console.warn('Failed to map exercise INSERT payload', e);
        }
      })
      ?.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'exercises', filter: `org_id=eq.${selectedOrgId}` }, (payload: any) => {
        try {
          const mapped = mapExerciseRow(payload.new);
          setExercises((prev) => sortExercises(prev.map((ex) => (ex.id === mapped.id ? mapped : ex))));
        } catch (e) {
          console.warn('Failed to map exercise UPDATE payload', e);
        }
      })
      ?.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'exercises', filter: `org_id=eq.${selectedOrgId}` }, (payload: any) => {
        const oldId = payload.old?.id as string | undefined;
        if (!oldId) return;
        setExercises((prev) => prev.filter((ex) => ex.id !== oldId));
      })
      // backup: subscribe for DELETE events without filter to catch deletes that miss the org filter
      ?.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'exercises' }, (payload: any) => {
        const oldId = payload.old?.id as string | undefined;
        if (!oldId) return;
        setExercises((prev) => prev.filter((ex) => ex.id !== oldId));
      })
      ?.subscribe();

    return () => { chan?.unsubscribe?.(); };
  }, [selectedOrgId, supabaseUsingFallback]);

  // --- Exercises: manual refresh on screen focus or app resume as a fallback ---
  const lastExerciseRefreshRef = useRef<number>(0);
  const refreshExercises = useCallback(async (force = false) => {
    if (supabaseUsingFallback || !selectedOrgId || !sessionUserId) return;
    const now = Date.now();
    if (!force && now - lastExerciseRefreshRef.current < 5000) return; // throttle
    lastExerciseRefreshRef.current = now;
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, org_id, group_id, title, description, attachments, text_styles, created_at, updated_at')
        .eq('org_id', selectedOrgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const remoteExercises = (data ?? []).map((row: any) => mapExerciseRow(row));
      setExercises((prev) => {
        const merged = sortExercises(mergeById(prev, remoteExercises));
        AsyncStorage.setItem(exerciseStorageKey, JSON.stringify(merged)).catch(() => { });
        return merged;
      });
    } catch (e) {
      console.warn('[exercises][refresh] failed', e);
    }
  }, [selectedOrgId, sessionUserId, supabaseUsingFallback, exerciseStorageKey]);

  // Refresh when user opens the Übungen screen
  useEffect(() => {
    if (screen === 'uebungen') {
      refreshExercises(true);
    }
  }, [screen, refreshExercises]);

  // Refresh when app comes to foreground
  useEffect(() => {
    const handler = (nextState: any) => {
      if (nextState === 'active') {
        refreshExercises();
        setAssignmentRefreshKey((prev) => prev + 1);
      }
    };
    const sub = AppState.addEventListener ? AppState.addEventListener('change', handler) : null as any;
    return () => { try { sub?.remove?.(); } catch { /* ignore */ } };
  }, [refreshExercises]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let localAssignments: Assignment[] = [];
      let localSubs: AssignmentSubmission[] = [];
      try {
        const [rawAssignments, rawSubs] = await Promise.all([
          AsyncStorage.getItem(assignmentStorageKey),
          AsyncStorage.getItem(submissionStorageKey),
        ]);
        if (!alive) return;
        localAssignments = rawAssignments ? JSON.parse(rawAssignments) : [];
        localSubs = rawSubs ? JSON.parse(rawSubs) : [];
        setAssignments(localAssignments);
        setAssignmentSubmissions(localSubs);
      } catch {
        if (!alive) return;
        setAssignments([]);
        setAssignmentSubmissions([]);
        return;
      }

      if (supabaseUsingFallback || !selectedOrgId || !sessionUserId) return;

      try {
        const remoteAssignmentsRes = await (supabase.from('assignments' as any) as any)
          .select('id, org_id, group_id, title, description, attachment_url, due_at, created_by, created_at')
          .eq('org_id', selectedOrgId);
        if (remoteAssignmentsRes?.error) throw remoteAssignmentsRes.error;
        const remoteAssignments = (remoteAssignmentsRes?.data ?? []).map((row: any) => ({
          id: row.id,
          orgId: row.org_id ?? null,
          groupId: row.group_id ?? null,
          title: row.title ?? '',
          description: row.description ?? undefined,
          attachmentUrl: row.attachment_url ?? undefined,
          dueAt: row.due_at ?? undefined,
          createdBy: row.created_by ?? null,
          createdAt: row.created_at ?? undefined,
        })) as Assignment[];
        const assignmentIds = remoteAssignments.map((a) => a.id).filter(Boolean);

        let remoteSubs: AssignmentSubmission[] = [];
        if (assignmentIds.length) {
          const remoteSubsRes = await (supabase.from('assignment_submissions' as any) as any)
            .select('id, assignment_id, user_id, note, attachment_url, submitted_at, user_name')
            .in('assignment_id', assignmentIds);
          if (remoteSubsRes?.error) throw remoteSubsRes.error;
          remoteSubs = (remoteSubsRes?.data ?? []).map((row: any) => ({
            id: row.id,
            assignmentId: row.assignment_id,
            userId: row.user_id,
            note: row.note ?? undefined,
            attachmentUrl: row.attachment_url ?? undefined,
            submittedAt: row.submitted_at ?? undefined,
            userName: row.user_name ?? null,
          })) as AssignmentSubmission[];
        }

        if (!alive) return;
        setAssignments(mergeById(remoteAssignments, localAssignments));
        setAssignmentSubmissions(mergeById(remoteSubs, localSubs));
      } catch {
        // keep local state on remote load errors
      }
    })();
    return () => { alive = false; };
  }, [assignmentStorageKey, submissionStorageKey, selectedOrgId, sessionUserId, supabaseUsingFallback, assignmentRefreshKey]);

  useEffect(() => {
    AsyncStorage.setItem(assignmentStorageKey, JSON.stringify(assignments)).catch(() => { });
  }, [assignments, assignmentStorageKey]);
  useEffect(() => {
    AsyncStorage.setItem(submissionStorageKey, JSON.stringify(assignmentSubmissions)).catch(() => { });
  }, [assignmentSubmissions, submissionStorageKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!sessionUserId || !selectedOrgId) {
        setSeenAnnouncementsAt(null);
        setSeenExercisesAt(null);
        setSeenAssignmentsAt(null);
        setChatSeenByGroup({});
        setChatUnreadByGroup({});
        return;
      }
      try {
        const [ann, ex, asg, chatRaw] = await Promise.all([
          AsyncStorage.getItem(buildSeenKey('announcements')),
          AsyncStorage.getItem(buildSeenKey('exercises')),
          AsyncStorage.getItem(buildSeenKey('assignments')),
          AsyncStorage.getItem(buildSeenKey('chat')),
        ]);
        if (!alive) return;
        setSeenAnnouncementsAt(ann);
        setSeenExercisesAt(ex);
        setSeenAssignmentsAt(asg);
        setChatSeenByGroup(chatRaw ? JSON.parse(chatRaw) : {});
      } catch {
        if (!alive) return;
        setSeenAnnouncementsAt(null);
        setSeenExercisesAt(null);
        setSeenAssignmentsAt(null);
        setChatSeenByGroup({});
        setChatUnreadByGroup({});
      }
    })();
    return () => { alive = false; };
  }, [sessionUserId, selectedOrgId]);

  useEffect(() => {
    if (assignmentGroupId && !assignmentGroupsForTeacher.some((g) => g.id === assignmentGroupId)) {
      setAssignmentGroupId(assignmentGroupsForTeacher[0]?.id ?? null);
    }
  }, [assignmentGroupId, assignmentGroupsForTeacher]);

  const buildTextStyle = (style?: RichTextStyle): TextStyle => {
    const decorations: string[] = [];
    if (style?.underline) decorations.push('underline');
    return {
      ...(style?.bold ? { fontWeight: '800' } : {}),
      ...(style?.italic ? { fontStyle: 'italic' } : {}),
      ...(decorations.length ? { textDecorationLine: decorations.join(' ') as TextStyle['textDecorationLine'] } : {}),
    };
  };
  const markAnnouncementsSeen = (iso: string) => {
    if (!sessionUserId || !selectedOrgId) return;
    setSeenAnnouncementsAt((prev) => {
      if (prev && new Date(prev).getTime() >= new Date(iso).getTime()) return prev;
      AsyncStorage.setItem(buildSeenKey('announcements'), iso).catch(() => { });
      return iso;
    });
  };
  const markExercisesSeen = (iso: string) => {
    if (!sessionUserId || !selectedOrgId) return;
    setSeenExercisesAt((prev) => {
      if (prev && new Date(prev).getTime() >= new Date(iso).getTime()) return prev;
      AsyncStorage.setItem(buildSeenKey('exercises'), iso).catch(() => { });
      return iso;
    });
  };
  const markAssignmentsSeen = (iso: string) => {
    if (!sessionUserId || !selectedOrgId) return;
    setSeenAssignmentsAt((prev) => {
      if (prev && new Date(prev).getTime() >= new Date(iso).getTime()) return prev;
      AsyncStorage.setItem(buildSeenKey('assignments'), iso).catch(() => { });
      return iso;
    });
  };
  const markChatGroupSeen = (groupId: string, iso: string) => {
    if (!sessionUserId || !selectedOrgId) return;
    setChatSeenByGroup((prev) => {
      const prevIso = prev[groupId];
      if (prevIso && new Date(prevIso).getTime() >= new Date(iso).getTime()) return prev;
      const next = { ...prev, [groupId]: iso };
      AsyncStorage.setItem(buildSeenKey('chat'), JSON.stringify(next)).catch(() => { });
      return next;
    });
    setChatUnreadByGroup((prev) => ({ ...prev, [groupId]: 0 }));
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
    setMediaPickerTarget(null);
  };

  const closeAddExerciseModal = () => {
    setShowMediaModal(false);
    setMediaPickerTarget(null);
    setShowAddExercise(false);
  };

  useEffect(() => {
    if (!showAddExercise && showMediaModal && mediaPickerTarget === 'exercise') {
      setShowMediaModal(false);
      setMediaPickerTarget(null);
    }
  }, [showAddExercise, showMediaModal, mediaPickerTarget]);

  const openAddExercise = () => {
    resetExerciseForm();
    setShowAddExercise(true);
  };

  const addAttachmentFromModal = () => {
    if (mediaPickerTarget !== 'exercise') return;
    const url = newMediaUrl.trim();
    if (!url) return;
    setAttachments((prev) => [{ id: uid(), type: newMediaType, url }, ...prev]);
    setNewMediaUrl('');
    setShowMediaModal(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const renderAttachmentChip = (att: ExerciseAttachment) => {
    const label = fileLabelFromUrl(att.url, att.name ?? undefined);
    const youtubeThumb = att.type === 'video' ? getYouTubeThumb(att.url) : null;
    const thumb = att.type === 'image'
      ? (
        <Image source={{ uri: att.url }} style={styles.attachmentThumbImage} resizeMode="cover" />
      )
      : att.type === 'video'
        ? (
          <View style={styles.attachmentThumbImage}>
            {youtubeThumb ? (
              <Image source={{ uri: youtubeThumb }} style={styles.attachmentThumbVideo} resizeMode="cover" />
            ) : (
              <InlineVideo
                uri={att.url}
                style={styles.attachmentThumbVideo}
                contentFit="cover"
                nativeControls={false}
              />
            )}
            <View style={styles.attachmentThumbOverlay}>
              <Ionicons name="play" size={18} color="#E5F4EF" />
            </View>
          </View>
        )
        : (
          <View style={[styles.attachmentThumbImage, styles.attachmentThumbFile]}>
            <Ionicons name="document-text-outline" size={20} color="#9FE1C7" />
          </View>
        );

    return (
      <View key={att.id} style={styles.attachmentPreviewCard}>
        <TouchableOpacity
          style={styles.attachmentThumb}
          activeOpacity={0.85}
          onPress={() => openDocument(att.url)}
        >
          {thumb}
        </TouchableOpacity>
        <Text style={styles.attachmentText} numberOfLines={1}>{label}</Text>
        <TouchableOpacity onPress={() => removeAttachment(att.id)} style={styles.attachmentRemove}>
          <Ionicons name="close" size={16} color="#E5F4EF" />
        </TouchableOpacity>
      </View>
    );
  };

  const openMediaPicker = (target: MediaPickerTarget) => {
    setMediaPickerTarget(target);
    setShowMediaModal(true);
  };

  const closeMediaPicker = () => {
    setShowMediaModal(false);
    setMediaPickerTarget(null);
    setNewMediaUrl('');
  };

  const getFileExtension = (name?: string | null, uri?: string | null) => {
    const raw = (name ?? uri ?? '').split('?')[0].split('#')[0];
    const parts = raw.split('.');
    if (parts.length < 2) return '';
    return parts.pop()?.toLowerCase() ?? '';
  };

  const MIME_BY_EXT: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
  };

  const resolveMimeType = (mimeType?: string | null, name?: string | null, uri?: string | null) => {
    if (mimeType) return mimeType;
    const ext = getFileExtension(name, uri);
    if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
    return 'application/octet-stream';
  };

  const resolveMediaKind = (mimeType?: string | null, name?: string | null, uri?: string | null) => {
    const resolved = resolveMimeType(mimeType, name, uri);
    if (resolved.startsWith('image/')) return 'image';
    if (resolved.startsWith('video/')) return 'video';
    return 'file';
  };

  const buildUploadFileName = (upload: PendingUpload) => {
    const rawName = (upload.name ?? upload.uri.split('/').pop() ?? 'upload').trim();
    const cleanBase = rawName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
    const ext = getFileExtension(rawName, upload.uri)
      || (upload.kind === 'video' ? 'mp4' : upload.kind === 'image' ? 'jpg' : 'bin');
    return `${sessionUserId ?? 'anon'}-${Date.now()}-${cleanBase}.${ext}`;
  };

  const buildStoragePath = (target: MediaPickerTarget, fileName: string) => {
    const orgSegment = selectedOrgId ?? 'org';
    if (target === 'chat') {
      const groupSegment = selectedGroupId ?? 'group';
      return `${orgSegment}/${groupSegment}/${fileName}`;
    }
    if (target === 'group') {
      const groupSegment = selectedGroupId ?? 'group';
      return `${orgSegment}/groups/${groupSegment}/${fileName}`;
    }
    if (target === 'org') {
      return `${orgSegment}/org/${fileName}`;
    }
    if (target === 'exercise') return `${orgSegment}/exercises/${fileName}`;
    if (target === 'assignment') return `${orgSegment}/assignments/${fileName}`;
    return `${orgSegment}/submissions/${fileName}`;
  };

  const uploadAttachment = async (upload: PendingUpload, target: MediaPickerTarget) => {
    if (supabaseUsingFallback || !supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase nicht verbunden');
    }
    const { data: sessionData } = await supabase.auth.getSession();
    let accessToken = sessionData.session?.access_token ?? null;
    if (!accessToken && typeof supabase.auth.refreshSession === 'function') {
      const { data: refreshData } = await supabase.auth.refreshSession();
      accessToken = refreshData.session?.access_token ?? null;
    }
    if (!accessToken) {
      throw new Error('Nicht angemeldet');
    }
    const bucket = target === 'chat' || target === 'group' || target === 'org' ? CHAT_MEDIA_BUCKET : ATTACHMENTS_BUCKET;
    const kind = upload.kind ?? resolveMediaKind(upload.mimeType, upload.name, upload.uri);
    const fileName = buildUploadFileName({ ...upload, kind });
    const path = buildStoragePath(target, fileName);
    const contentType = resolveMimeType(upload.mimeType, fileName, upload.uri);
    const form = new FormData();
    form.append('file', {
      uri: upload.uri,
      name: fileName,
      type: contentType,
    } as any);
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        'x-upsert': 'true',
      },
      body: form,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rawMsg = (payload?.message ?? '').toString();
      if (rawMsg.toLowerCase().includes('bucket not found')) {
        throw new Error(`Storage-Bucket "${bucket}" fehlt. Bitte im Supabase-Dashboard unter Storage anlegen.`);
      }
      throw new Error(rawMsg || 'Upload fehlgeschlagen');
    }
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
    return {
      url: publicUrl,
      name: upload.name ?? fileName,
      kind,
    };
  };

  const applyGroupImage = async (groupId: string, imageUrl: string | null) => {
    if (!groupId) return;
    if (supabaseUsingFallback) {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, image_url: imageUrl } : g)));
      return;
    }
    const { data, error } = await supabase
      .from('groups')
      .update({ image_url: imageUrl })
      .eq('id', groupId)
      .select('id, image_url');
    if (error) throw error;
    if (!data || !data.length) {
      throw new Error('Gruppenbild konnte nicht gespeichert werden.');
    }
    const updated = data[0] as { id: string; image_url: string | null };
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, image_url: updated.image_url ?? null } : g)));
  };

  const applyOrgLogo = async (orgId: string, logoUrl: string | null) => {
    if (!orgId) return;
    if (supabaseUsingFallback) {
      setOrgs((prev) => prev.map((o) => (o.id === orgId ? { ...o, logo_url: logoUrl } : o)));
      return;
    }
    const { data, error } = await supabase
      .from('organisations')
      .update({ logo_url: logoUrl })
      .eq('id', orgId)
      .select('id, logo_url');
    if (error) throw error;
    if (!data || !data.length) {
      throw new Error('Vereinslogo konnte nicht gespeichert werden.');
    }
    const updated = data[0] as { id: string; logo_url: string | null };
    setOrgs((prev) => prev.map((o) => (o.id === orgId ? { ...o, logo_url: updated.logo_url ?? null } : o)));
  };

  const handlePickedUploads = async (uploads: PendingUpload[], target: MediaPickerTarget) => {
    if (!uploads.length) return;
    if (target === 'chat') {
      const next = uploads.map((item) => ({
        uri: item.uri,
        type: item.kind,
        name: item.name ?? null,
        mimeType: item.mimeType ?? null,
      }));
      if (next.length) {
        setPendingChatMedia((prev) => [...next, ...prev]);
      }
      setShowMediaModal(false);
      return;
    }
    if (supabaseUsingFallback || !supabaseUrl || !supabaseAnonKey) {
      Alert.alert('Supabase offline', 'Dateien können nicht hochgeladen werden.');
      return;
    }
    setMediaUploadBusy(true);
    try {
      if (target === 'group') {
        if (!selectedGroupId) throw new Error('Keine Gruppe ausgewaehlt.');
        const first = uploads[0];
        if (first.kind !== 'image') throw new Error('Bitte ein Bild wählen.');
        const previousImage = selectedGroup?.image_url ?? null;
        const uploaded = await uploadAttachment(first, target);
        await applyGroupImage(selectedGroupId, uploaded.url);
        if (previousImage && previousImage !== uploaded.url) {
          const prevPath = getChatMediaPathFromUrl(previousImage);
          if (prevPath) {
            await (supabase as any).storage.from(CHAT_MEDIA_BUCKET).remove([prevPath]);
            setChatMediaUrlCache((prev) => {
              if (!prev[previousImage]) return prev;
              const next = { ...prev };
              delete next[previousImage];
              return next;
            });
          }
        }
      } else if (target === 'org') {
        if (!selectedOrgId) throw new Error('Kein Verein ausgewaehlt.');
        const first = uploads[0];
        if (first.kind !== 'image') throw new Error('Bitte ein Bild wählen.');
        const previousLogo = currentOrg?.logo_url ?? null;
        const uploaded = await uploadAttachment(first, target);
        await applyOrgLogo(selectedOrgId, uploaded.url);
        if (previousLogo && previousLogo !== uploaded.url) {
          const prevPath = getChatMediaPathFromUrl(previousLogo);
          if (prevPath) {
            await (supabase as any).storage.from(CHAT_MEDIA_BUCKET).remove([prevPath]);
            setChatMediaUrlCache((prev) => {
              if (!prev[previousLogo]) return prev;
              const next = { ...prev };
              delete next[previousLogo];
              return next;
            });
          }
        }
      } else if (target === 'exercise') {
        const uploaded = await Promise.all(uploads.map((item) => uploadAttachment(item, target)));
        const next = uploaded.map((item) => ({
          id: uid(),
          type: item.kind,
          url: item.url,
          name: item.name ?? null,
        }));
        if (next.length) setAttachments((prev) => [...next, ...prev]);
      } else {
        const uploaded = await Promise.all(uploads.map((item) => uploadAttachment(item, target)));
        const urls = uploaded.map((item) => item.url);
        if (target === 'assignment') {
          setAssignmentAttachments((prev) => [...urls, ...prev]);
        }
        if (target === 'submission') {
          setSubmissionAttachments((prev) => [...urls, ...prev]);
        }
      }
      setShowMediaModal(false);
      setMediaPickerTarget(null);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Upload fehlgeschlagen.');
    } finally {
      setMediaUploadBusy(false);
    }
  };

  const handleRemoveGroupImage = async () => {
    if (!selectedGroupId) return;
    if (supabaseUsingFallback || !supabaseUrl || !supabaseAnonKey) {
      Alert.alert('Supabase offline', 'Gruppenbild kann nicht entfernt werden.');
      return;
    }
    const imageUrl = selectedGroup?.image_url ?? null;
    setMediaUploadBusy(true);
    try {
      if (imageUrl) {
        const path = getChatMediaPathFromUrl(imageUrl);
        if (!path) {
          throw new Error('Gruppenbild konnte im Speicher nicht gefunden werden.');
        }
        const { error } = await (supabase as any).storage.from(CHAT_MEDIA_BUCKET).remove([path]);
        if (error) throw error;
        setChatMediaUrlCache((prev) => {
          if (!prev[imageUrl]) return prev;
          const next = { ...prev };
          delete next[imageUrl];
          return next;
        });
      }
      await applyGroupImage(selectedGroupId, null);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Gruppenbild konnte nicht entfernt werden.');
    } finally {
      setMediaUploadBusy(false);
    }
  };

  const handleRemoveOrgLogo = async () => {
    if (!selectedOrgId) return;
    if (supabaseUsingFallback || !supabaseUrl || !supabaseAnonKey) {
      Alert.alert('Supabase offline', 'Vereinslogo kann nicht entfernt werden.');
      return;
    }
    const logoUrl = currentOrg?.logo_url ?? null;
    setMediaUploadBusy(true);
    try {
      if (logoUrl) {
        const path = getChatMediaPathFromUrl(logoUrl);
        if (!path) {
          throw new Error('Vereinslogo konnte im Speicher nicht gefunden werden.');
        }
        const { error } = await (supabase as any).storage.from(CHAT_MEDIA_BUCKET).remove([path]);
        if (error) throw error;
        setChatMediaUrlCache((prev) => {
          if (!prev[logoUrl]) return prev;
          const next = { ...prev };
          delete next[logoUrl];
          return next;
        });
      }
      await applyOrgLogo(selectedOrgId, null);
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Vereinslogo konnte nicht entfernt werden.');
    } finally {
      setMediaUploadBusy(false);
    }
  };

  const waitForPickerDismiss = async () => {
    Keyboard.dismiss();
    await new Promise((resolve) => setTimeout(resolve, 400));
  };

  const pickFromCamera = async () => {
    if (!mediaPickerTarget) return;
    const target = mediaPickerTarget;
    setShowMediaModal(false);
    await waitForPickerDismiss();
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Berechtigung benötigt', 'Bitte erlaube den Zugriff auf die Kamera.');
        setShowMediaModal(true);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: (target === 'group' || target === 'org' ? ['images'] : ['images', 'videos']) as ImagePicker.MediaType[],
        quality: 0.8,
      });
      if (result.canceled) {
        setShowMediaModal(true);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset) {
        setShowMediaModal(true);
        return;
      }
      const uploads: PendingUpload[] = [{
        uri: asset.uri,
        kind: asset.type === 'video' ? 'video' : 'image',
        name: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
      }];
      await handlePickedUploads(uploads, target);
    } catch {
      Alert.alert('Fehler', 'Kamera konnte nicht geöffnet werden.');
    }
  };

  const pickFromFiles = async () => {
    if (!mediaPickerTarget) return;
    const target = mediaPickerTarget;
    setShowMediaModal(false);
    await waitForPickerDismiss();
    try {
      const isImageOnly = target === 'group' || target === 'org';
      const allowMultiple = !isImageOnly && (target === 'exercise' || target === 'chat' || target === 'assignment' || target === 'submission');
      const res = await DocumentPicker.getDocumentAsync({
        multiple: allowMultiple,
        copyToCacheDirectory: true,
        type: isImageOnly ? 'image/*' : '*/*',
      });
      if ((res as any).canceled || (res as any).type === 'cancel') {
        setShowMediaModal(true);
        return;
      }
      const assets = 'assets' in res && Array.isArray((res as any).assets)
        ? (res as any).assets
        : (res as any).uri
          ? [res]
          : [];
      const uploads = assets
        .map((asset: any) => ({
          uri: asset.uri,
          kind: resolveMediaKind(asset.mimeType ?? null, asset.name ?? null, asset.uri),
          name: asset.name ?? null,
          mimeType: asset.mimeType ?? null,
        }))
        .filter((asset: any) => !!asset.uri);
      if (!uploads.length) {
        setShowMediaModal(true);
        return;
      }
      await handlePickedUploads(uploads, target);
    } catch {
      Alert.alert('Fehler', 'Datei konnte nicht geladen werden.');
    }
  };

  const pickFromLibrary = async () => {
    if (!mediaPickerTarget) return;
    const target = mediaPickerTarget;
    setShowMediaModal(false);
    await waitForPickerDismiss();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Berechtigung benötigt', 'Bitte erlaube den Zugriff auf Fotos/Videos.');
        setShowMediaModal(true);
        return;
      }
      const allowMultiple = target === 'exercise' || target === 'chat' || target === 'assignment' || target === 'submission';
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: (target === 'group' || target === 'org' ? ['images'] : ['images', 'videos']) as ImagePicker.MediaType[],
        allowsMultipleSelection: allowMultiple,
        quality: 0.8,
      });
      if (result.canceled) {
        setShowMediaModal(true);
        return;
      }
      const uploads = (result.assets ?? [])
        .map((asset) => ({
          uri: asset.uri,
          kind: asset.type === 'video' ? 'video' as const : 'image' as const,
          name: asset.fileName ?? null,
          mimeType: asset.mimeType ?? null,
        }))
        .filter((asset) => !!asset.uri);
      if (!uploads.length) {
        setShowMediaModal(true);
        return;
      }
      await handlePickedUploads(uploads, target);
    } catch {
      Alert.alert('Fehler', 'Medien konnten nicht geladen werden.');
    }
  };

  const pickDocument = async () => {
    await pickFromFiles();
  };

  const handleAttachmentButton = () => {
    openMediaPicker('exercise');
  };
  const pickChatMedia = async () => {
    openMediaPicker('chat');
  };
  const uploadChatMedia = async (media: PendingChatMedia) => {
    const uploaded = await uploadAttachment(
      {
        uri: media.uri,
        kind: media.type,
        name: media.name ?? null,
        mimeType: media.mimeType ?? null,
      },
      'chat',
    );
    return {
      url: uploaded.url,
      type: uploaded.kind,
      name: uploaded.name ?? null,
    } as ChatMedia;
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

  const normalizeExerciseAttachments = (raw: any): ExerciseAttachment[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && typeof item.url === 'string')
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `att-${index}`,
        type: item.type === 'video' ? 'video' : item.type === 'file' ? 'file' : 'image',
        url: item.url,
        name: typeof item.name === 'string' ? item.name : undefined,
      }));
  };

  const mapExerciseRow = (row: any): Exercise => {
    const attachments = normalizeExerciseAttachments(row?.attachments);
    const primaryImage = attachments.find((a) => a.type === 'image')?.url;
    const primaryVideo = attachments.find((a) => a.type === 'video')?.url;
    return {
      id: row.id,
      title: row.title ?? '',
      description: row.description ?? undefined,
      imageUrl: primaryImage || undefined,
      videoUrl: primaryVideo || undefined,
      attachments: attachments.length ? attachments : undefined,
      textStyles: row?.text_styles ?? undefined,
      createdAt: row?.created_at ?? row?.updated_at ?? undefined,
    };
  };

  const sortExercises = (items: Exercise[]) => (
    items.slice().sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    })
  );

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

  const deleteExercise = async (id: string) => {
    if (!isUuid(id) || supabaseUsingFallback || !selectedOrgId || !sessionUserId) {
      setExercises((prev) => prev.filter((ex) => ex.id !== id));
      if (selectedExercise?.id === id) setSelectedExercise(null);
      if (editingExerciseId === id) setEditingExerciseId(null);
      return;
    }
    try {
      const { error } = await supabase.from('exercises').delete().eq('id', id);
      if (error) throw error;
      setExercises((prev) => prev.filter((ex) => ex.id !== id));
      if (selectedExercise?.id === id) setSelectedExercise(null);
      if (editingExerciseId === id) setEditingExerciseId(null);
    } catch (err: any) {
      Alert.alert('Fehler', err?.message ?? 'Übung konnte nicht gelöscht werden.');
    }
  };

  const addExercise = async () => {
    const title = exerciseTitle.trim();
    if (!title) return;
    const isLocalEdit = !!editingExerciseId && !isUuid(editingExerciseId);
    const attachmentsToSave = attachments.length
      ? attachments
      : [
        ...(exerciseImageUrl.trim() ? [{ id: uid(), type: 'image' as const, url: exerciseImageUrl.trim() }] : []),
        ...(exerciseVideoUrl.trim() ? [{ id: uid(), type: 'video' as const, url: exerciseVideoUrl.trim() }] : []),
      ];
    const primaryImage = attachmentsToSave.find((a) => a.type === 'image')?.url;
    const primaryVideo = attachmentsToSave.find((a) => a.type === 'video')?.url;

    if (isLocalEdit || supabaseUsingFallback || !selectedOrgId || !sessionUserId) {
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
      return;
    }

    try {
      if (editingExerciseId) {
        const { data, error } = await supabase
          .from('exercises')
          .update({
            title,
            description: exerciseDescription.trim() || null,
            attachments: attachmentsToSave.length ? attachmentsToSave : null,
            text_styles: { title: titleStyle, description: descriptionStyle },
            updated_by: sessionUserId,
          })
          .eq('id', editingExerciseId)
          .select('id, org_id, group_id, title, description, attachments, text_styles, created_at, updated_at')
          .single();
        if (error) throw error;
        if (data) {
          const mapped = mapExerciseRow(data);
          setExercises((prev) => sortExercises(prev.map((ex) => (ex.id === mapped.id ? mapped : ex))));
        }
      } else {
        const { data, error } = await supabase
          .from('exercises')
          .insert({
            org_id: selectedOrgId,
            group_id: null,
            title,
            description: exerciseDescription.trim() || null,
            attachments: attachmentsToSave.length ? attachmentsToSave : null,
            text_styles: { title: titleStyle, description: descriptionStyle },
            created_by: sessionUserId,
            updated_by: sessionUserId,
          })
          .select('id, org_id, group_id, title, description, attachments, text_styles, created_at, updated_at')
          .single();
        if (error) throw error;
        if (data) {
          const mapped = mapExerciseRow(data);
          setExercises((prev) => sortExercises([mapped, ...prev]));
        }
      }
      resetExerciseForm();
      setShowAddExercise(false);
    } catch (err: any) {
      Alert.alert('Fehler', err?.message ?? 'Übung konnte nicht gespeichert werden.');
    }
  };

  const deleteOrganisationCascade = async (orgId: string) => {
    try {
      // Prefer server-side RPC which handles the cascade with security definer
      const rpcRes = await (supabase as any).rpc('delete_org_cascade', { p_org_id: orgId });
      if (rpcRes?.error) throw rpcRes.error;

      const { data: remainingRows, error: remErr } = await supabase.from('organisations').select('id').eq('id', orgId);
      if (remErr) throw remErr;
      if (remainingRows && remainingRows.length) {
        console.warn('[org-delete] still exists after RPC, attempting manual cascade', { remainingRows });
        // manual fallback (attempt to remove dependent rows)
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
      }

      return true;
    } catch (e: any) {
      console.warn('[org-delete] failed', e);
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
      const { data: assignmentsRows, error: assSelErr } = await (supabase.from('assignments' as any) as any)
        .select('id')
        .eq('group_id', groupId);
      if (assSelErr) throw assSelErr;
      const assignmentIds = (assignmentsRows ?? []).map((a: any) => a.id).filter(Boolean);
      if (assignmentIds.length) {
        const { error: subDelErr } = await (supabase.from('assignment_submissions' as any) as any)
          .delete()
          .in('assignment_id', assignmentIds);
        if (subDelErr) throw subDelErr;
      }
      const { error: assDelErr } = await (supabase.from('assignments' as any) as any).delete().eq('group_id', groupId);
      if (assDelErr) throw assDelErr;
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
    const removedAssignmentIds = assignments.filter((a) => a.groupId === groupId).map((a) => a.id);
    if (removedAssignmentIds.length) {
      setAssignments((prev) => prev.filter((a) => a.groupId !== groupId));
      setAssignmentSubmissions((prev) => prev.filter((s) => !removedAssignmentIds.includes(s.assignmentId)));
    }
    if (selectedAssignment?.groupId === groupId) {
      setSelectedAssignment(null);
      setSelectedSubmission(null);
      setAssignmentView('list');
    }
    if (assignmentGroupId === groupId) {
      setAssignmentGroupId(null);
    }
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
      let profileMap: Record<string, { display_name?: string | null; full_name?: string | null; email?: string | null; username?: string | null; first_name?: string | null; last_name?: string | null }> = {};
      if (userIds.length) {
        try {
          const { data: profilesRows, error: profilesErr } = await supabase
            .from('profiles')
            .select('id, display_name, username, first_name, last_name, email')
            .in('id', userIds);
          if (!profilesErr) {
            (profilesRows ?? []).forEach((p: any) => {
              profileMap[p.id] = {
                display_name: p.display_name,
                full_name: p.full_name,
                email: p.email,
                username: p.username,
                first_name: p.first_name,
                last_name: p.last_name,
              };
            });
          } else {
            const { data: fallbackRows, error: fallbackErr } = await supabase
              .from('profiles')
              .select('id, display_name')
              .in('id', userIds);
            if (!fallbackErr) {
              (fallbackRows ?? []).forEach((p: any) => {
                profileMap[p.id] = { display_name: p.display_name };
              });
            }
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
        const displayName = buildProfileDisplayName(profile, member.user_id);
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
          .select('id,title,body,event_date,created_at')
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
          .select('id,title,body,event_date,created_at')
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
      Alert.alert('Fehler', e?.message ?? 'Ankündigung konnte nicht gespeichert werden.');
    }
  };

  const openAnnouncementActions = (announcement: AnnouncementRow) => {
    if (!canCreateAnnouncement) return;
    setAnnouncementActionTarget(announcement);
  };

  const handleAnnouncementCalendarSync = async (announcement: AnnouncementRow) => {
    if (!selectedOrgId) {
      Alert.alert('Kalender', 'Bitte wähle zuerst einen Verein aus.');
      return;
    }
    const eventId = getAnnouncementCalendarEventId(announcement.id);
    const dateStr = announcement.event_date?.trim();
    if (!dateStr) {
      Alert.alert('Kalender', 'Diese Ankündigung hat kein Datum. Bitte füge zuerst ein Datum hinzu.');
      return;
    }
    const baseDate = parseLocalDateOnly(dateStr);
    if (!baseDate || Number.isNaN(baseDate.getTime())) {
      Alert.alert('Kalender', 'Das eingetragene Datum ist ungültig.');
      return;
    }
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
    const end = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
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
      Alert.alert('Kalender', 'Bitte w?hle zuerst einen Verein aus.');
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
      Alert.alert('Fehler', e?.message ?? 'Ankündigung konnte nicht gelöscht werden.');
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
          .select('id,title,body,event_date,created_at')
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
  }, [selectedOrgId, sessionUserId, annRefreshKey]);

  useEffect(() => {
    if (screen === 'ankuendigung') {
      setAnnRefreshKey((prev) => prev + 1);
    }
  }, [screen]);

  useEffect(() => {
    if (screen === 'aufgaben') {
      setAssignmentRefreshKey((prev) => prev + 1);
    }
  }, [screen]);

  useEffect(() => {
    if (screen === 'chat') setChatMode('pick');
  }, [screen]);

  useEffect(() => {
    if (screen === 'chat' && chatMode === 'pick') {
      setGroupsRefreshKey((prev) => prev + 1);
    }
  }, [chatMode, screen]);

  useEffect(() => {
    if (screen !== 'chat') {
      setPendingChatMedia([]);
      setChatUploadBusy(false);
    }
  }, [screen]);

  useEffect(() => {
    setPendingChatMedia([]);
  }, [selectedGroupId]);

  const refreshChatUnreadCounts = useCallback(async () => {
    if (supabaseUsingFallback || !sessionUserId || !selectedOrgId || !groups.length) {
      setChatUnreadByGroup({});
      return;
    }
    try {
      const groupIds = groups.map((g) => g.id);
      const { data: channels, error } = await (supabase.from('channels') as any)
        .select('id, group_id')
        .eq('org_id', selectedOrgId)
        .in('group_id', groupIds);
      if (error || !channels?.length) {
        setChatUnreadByGroup({});
        return;
      }
      const channelByGroup: Record<string, string> = {};
      const groupByChannel: Record<string, string> = {};
      (channels ?? []).forEach((c: any) => {
        if (c.group_id) {
          channelByGroup[c.group_id] = c.id;
          groupByChannel[c.id] = c.group_id;
        }
      });
      groupByChannelRef.current = groupByChannel;
      const counts: Record<string, number> = {};
      await Promise.all(groupIds.map(async (gid) => {
        const channelId = channelByGroup[gid];
        if (!channelId) {
          counts[gid] = 0;
          return;
        }
        let q: any = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', channelId);
        const seenIso = chatSeenByGroup[gid];
        if (seenIso) q = q.gt('created_at', seenIso);
        const { count, error: countErr } = await q;
        counts[gid] = !countErr && typeof count === 'number' ? count : 0;
      }));
      setChatUnreadByGroup(counts);
    } catch {
      setChatUnreadByGroup({});
    }
  }, [chatSeenByGroup, groups, selectedOrgId, sessionUserId, supabaseUsingFallback]);

  useEffect(() => {
    if (screen !== 'home' && !(screen === 'chat' && chatMode === 'pick')) return;
    refreshChatUnreadCounts();
    const intervalId = setInterval(refreshChatUnreadCounts, 5000);
    return () => clearInterval(intervalId);
  }, [chatMode, refreshChatUnreadCounts, screen]);

  useEffect(() => {
    if (supabaseUsingFallback || !sessionUserId || !selectedOrgId || !groups.length) return;
    let alive = true;
    let chan: any = null;
    (async () => {
      const groupIds = groups.map((g) => g.id);
      const { data, error } = await (supabase.from('channels') as any)
        .select('id, group_id')
        .eq('org_id', selectedOrgId)
        .in('group_id', groupIds);
      if (!alive || error) return;
      const groupByChannel: Record<string, string> = {};
      (data ?? []).forEach((c: any) => {
        if (c.id && c.group_id) groupByChannel[c.id] = c.group_id;
      });
      groupByChannelRef.current = groupByChannel;
      const channel = (supabase as any).channel?.(`chat-unread-${selectedOrgId}-${sessionUserId}`);
      (data ?? []).forEach((c: any) => {
        if (!c?.id) return;
        channel?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${c.id}` }, (payload: any) => {
          const row = payload.new as { channel_id?: string; created_at?: string; user_id?: string | null };
          if (!row?.channel_id) return;
          if (row.user_id && row.user_id === sessionUserId) return;
          const gid = groupByChannelRef.current[row.channel_id];
          if (!gid) return;
          if (screenRef.current === 'chat' && chatModeRef.current === 'in' && selectedGroupIdRef.current === gid) return;
          const seenIso = chatSeenByGroupRef.current[gid];
          if (seenIso && row.created_at && new Date(seenIso).getTime() >= new Date(row.created_at).getTime()) return;
          setChatUnreadByGroup((prev) => ({ ...prev, [gid]: (prev[gid] ?? 0) + 1 }));
        });
      });
      chan = channel?.subscribe?.();
    })();
    return () => {
      alive = false;
      chan?.unsubscribe?.();
    };
  }, [groups, selectedOrgId, sessionUserId, supabaseUsingFallback]);

  // Fast group loader on org change with request guard
  useEffect(() => {
    (async () => {
      if (!selectedOrgId || !sessionUserId) { setGroups([]); setSelectedGroupId(null); return; }
      const req = ++groupsReqRef.current;
      const orgChanged = prevOrgIdRef.current !== selectedOrgId;
      prevOrgIdRef.current = selectedOrgId;
      if (orgChanged) {
        // clear stale immediately for snappy UI
        setGroups([]); setSelectedGroupId(null); setChatChannelId(null); setChatMode('pick');
      }
      const { data, error } = await (supabase.from('groups') as any)
        .select('id,name,org_id,image_url, group_members!inner(user_id)')
        .eq('org_id', selectedOrgId)
        .eq('group_members.user_id', sessionUserId);
      if (groupsReqRef.current !== req) return; // stale
      if (error) { if (orgChanged) { setGroups([]); setSelectedGroupId(null); } return; }
      const list = ((data ?? []) as any[]).map((g: any) => ({ id: g.id, name: g.name, org_id: g.org_id, image_url: g.image_url }));
      setGroups(list);
      const currentSelected = selectedGroupIdRef.current;
      const stillSelected = currentSelected && list.some((g) => g.id === currentSelected);
      if (orgChanged || !stillSelected) {
        const nextSelected = list[0]?.id ?? null;
        setSelectedGroupId(nextSelected);
        if (!nextSelected) {
          setChatChannelId(null);
          setChatMode('pick');
        }
      }
    })();
  }, [selectedOrgId, sessionUserId, groupsRefreshKey]);

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
      const rows = (data ?? []) as { id: string; user_id: string | null; body: string | null; created_at: string }[];
      setMessages(rows.map(buildChatMessage));
      ensureMessageUserNames(rows.map((r) => r.user_id).filter(Boolean) as string[]);
      // realtime
      const chan = (supabase as any).channel?.(`msg-${chatChannelId}`)
        ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${chatChannelId}` }, (payload: any) => {
          const r = payload.new as { id: string; user_id: string | null; body: string | null; created_at: string };
          setMessages((prev: ChatMessage[]) => (prev.some((m) => m.id === r.id) ? prev : [...prev, buildChatMessage(r)]));
          if (r.user_id) ensureMessageUserNames([r.user_id]);
        })
        ?.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${chatChannelId}` }, (payload: any) => {
          const oldId = payload.old?.id as string | undefined;
          if (!oldId) return;
          setMessages((prev: ChatMessage[]) => prev.filter((m) => m.id !== oldId));
        })
        ?.subscribe();
      unsub = () => chan?.unsubscribe?.();
    })();
    return () => { if (unsub) unsub(); };
  }, [chatChannelId, sessionUserId]);

  useEffect(() => {
    if (screen !== 'chat' || chatMode !== 'in' || !selectedGroupId) return;
    const latest = messages[messages.length - 1]?.createdAt;
    if (latest) markChatGroupSeen(selectedGroupId, latest);
  }, [chatMode, messages, screen, selectedGroupId]);

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

  const visibleAssignments = useMemo(() => {
    return assignments
      .filter((a) => {
        if (selectedOrgId && a.orgId && a.orgId !== selectedOrgId) return false;
        if (orgRole === 'student') return !!(a.groupId && myGroupIds.includes(a.groupId));
        if (orgRole === 'teacher') return !!(a.groupId && myGroupIds.includes(a.groupId));
        if (orgRole === 'director') return selectedOrgId ? a.orgId === selectedOrgId : true;
        return false;
      })
      .filter((a) => {
        const now = new Date();
        const submission = assignmentSubmissions.find((s) => s.assignmentId === a.id && s.userId === sessionUserId);
        const due = a.dueAt ? new Date(a.dueAt) : null;
        if (assignmentStatusFilter === 'submitted') return !!submission;
        if (assignmentStatusFilter === 'overdue') return !submission && !!due && due.getTime() < now.getTime();
        if (assignmentStatusFilter === 'upcoming') return !submission && (!due || due.getTime() >= now.getTime());
        return true;
      })
      .sort((a, b) => {
        const da = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : 0;
        return da - db;
      });
  }, [assignments, assignmentSubmissions, assignmentStatusFilter, selectedOrgId, orgRole, myGroupIds, sessionUserId]);
  const assignmentsForBadge = useMemo(() => {
    return assignments.filter((a) => {
      if (selectedOrgId && a.orgId && a.orgId !== selectedOrgId) return false;
      if (orgRole === 'student') return !!(a.groupId && myGroupIds.includes(a.groupId));
      if (orgRole === 'teacher') return !!(a.groupId && myGroupIds.includes(a.groupId));
      if (orgRole === 'director') return selectedOrgId ? a.orgId === selectedOrgId : true;
      return false;
    });
  }, [assignments, selectedOrgId, orgRole, myGroupIds]);
  const unreadAnnouncementCount = useMemo(() => {
    const lastSeen = seenAnnouncementsAt ? new Date(seenAnnouncementsAt).getTime() : 0;
    return annRemote.filter((ann) => {
      const createdAt = ann.created_at ?? '';
      const ms = createdAt ? new Date(createdAt).getTime() : 0;
      return ms > lastSeen;
    }).length;
  }, [annRemote, seenAnnouncementsAt]);
  const unreadExerciseCount = useMemo(() => {
    const lastSeen = seenExercisesAt ? new Date(seenExercisesAt).getTime() : 0;
    return exercises.filter((ex) => {
      const ms = ex.createdAt ? new Date(ex.createdAt).getTime() : 0;
      return ms > lastSeen;
    }).length;
  }, [exercises, seenExercisesAt]);
  const unreadAssignmentCount = useMemo(() => {
    const lastSeen = seenAssignmentsAt ? new Date(seenAssignmentsAt).getTime() : 0;
    return assignmentsForBadge.filter((a) => {
      const ms = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      return ms > lastSeen;
    }).length;
  }, [assignmentsForBadge, seenAssignmentsAt]);
  const unreadChatCount = useMemo(() => (
    Object.values(chatUnreadByGroup).reduce((sum, n) => sum + n, 0)
  ), [chatUnreadByGroup]);

  useEffect(() => {
    if (screen !== 'ankuendigung') return;
    let latestIso = '';
    let latestMs = 0;
    annRemote.forEach((ann) => {
      const iso = ann.created_at ?? '';
      const ms = iso ? new Date(iso).getTime() : 0;
      if (ms > latestMs) {
        latestMs = ms;
        latestIso = iso;
      }
    });
    if (latestIso) markAnnouncementsSeen(latestIso);
  }, [annRemote, screen]);

  useEffect(() => {
    if (screen !== 'uebungen') return;
    let latestIso = '';
    let latestMs = 0;
    exercises.forEach((ex) => {
      const iso = ex.createdAt ?? '';
      const ms = iso ? new Date(iso).getTime() : 0;
      if (ms > latestMs) {
        latestMs = ms;
        latestIso = iso;
      }
    });
    if (latestIso) markExercisesSeen(latestIso);
  }, [exercises, screen]);

  useEffect(() => {
    if (screen !== 'aufgaben') return;
    let latestIso = '';
    let latestMs = 0;
    assignmentsForBadge.forEach((assignment) => {
      const iso = assignment.createdAt ?? '';
      const ms = iso ? new Date(iso).getTime() : 0;
      if (ms > latestMs) {
        latestMs = ms;
        latestIso = iso;
      }
    });
    if (latestIso) markAssignmentsSeen(latestIso);
  }, [assignmentsForBadge, screen]);

  useEffect(() => {
    if (supabaseUsingFallback || !selectedOrgId) return;
    if (!assignments.length && !assignmentSubmissions.length) return;
    const canWriteAssignments = orgRole === 'teacher' || orgRole === 'director';
    const sync = async () => {
      try {
        if (assignments.length && canWriteAssignments) {
          const payload = assignments
            .filter((a) => a.orgId && a.orgId === selectedOrgId)
            .map((a) => ({
              id: a.id,
              org_id: a.orgId,
              group_id: a.groupId,
              title: a.title,
              description: a.description ?? null,
              attachment_url: a.attachmentUrl ?? null,
              due_at: a.dueAt ?? null,
              created_by: a.createdBy ?? null,
              created_at: a.createdAt ?? new Date().toISOString(),
            }));
          if (payload.length) {
            await (supabase.from('assignments' as any) as any).upsert(payload, { onConflict: 'id' } as any);
          }
        }
        if (assignmentSubmissions.length && sessionUserId) {
          const payloadSubs = assignmentSubmissions
            .filter((s) => s.userId === sessionUserId)
            .map((s) => ({
              id: s.id,
              assignment_id: s.assignmentId,
              user_id: s.userId,
              user_name: s.userName ?? null,
              note: s.note ?? null,
              attachment_url: s.attachmentUrl ?? null,
              submitted_at: s.submittedAt,
            }));
          if (payloadSubs.length) {
            await (supabase.from('assignment_submissions' as any) as any).upsert(payloadSubs, { onConflict: 'id' } as any);
          }
        }
      } catch (e: any) {
        if (!assignmentSyncErrorShown.current) {
          assignmentSyncErrorShown.current = true;
          Alert.alert('Supabase Sync', e?.message ?? 'Aufgaben konnten nicht synchronisiert werden.');
        }
      }
    };
    sync();
  }, [assignments, assignmentSubmissions, selectedOrgId, orgRole, sessionUserId]);

  const groupNameFor = (id: string | null) => groups.find((g) => g.id === id)?.name ?? 'Ohne Gruppe';
  const formatAssignmentDue = (iso?: string) => {
    if (!iso) return 'Keine Deadline';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const resetAssignmentForm = () => {
    setAssignmentTitle('');
    setAssignmentDescription('');
    setAssignmentAttachments([]);
    setAssignmentDueDate(null);
    setAssignmentGroupId((prev) => prev ?? assignmentGroupsForTeacher[0]?.id ?? null);
    setEditingAssignmentId(null);
    setShowDueDatePicker(false);
    setShowDueTimePicker(false);
  };

  const removeAssignmentAttachmentAt = (index: number) => {
    setAssignmentAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const removeSubmissionAttachmentAt = (index: number) => {
    setSubmissionAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const startAssignmentEdit = (assignment: Assignment) => {
    setEditingAssignmentId(assignment.id);
    setAssignmentTitle(assignment.title ?? '');
    setAssignmentDescription(assignment.description ?? '');
    setAssignmentAttachments(parseAttachmentUrls(assignment.attachmentUrl));
    setAssignmentGroupId(assignment.groupId ?? assignmentGroupsForTeacher[0]?.id ?? null);
    setAssignmentDueDate(assignment.dueAt ? new Date(assignment.dueAt) : null);
    setShowDueDatePicker(false);
    setShowDueTimePicker(false);
    setSelectedAssignment(assignment);
    setAssignmentView('create');
  };

  useEffect(() => {
    if (supabaseUsingFallback) {
      Alert.alert('Supabase offline', 'Supabase Konfiguration fehlt. Aufgaben werden nur lokal gespeichert.');
    }
  }, []);

  const goBackToAssignmentList = () => {
    setAssignmentView('list');
    setSelectedAssignment(null);
    setSelectedSubmission(null);
    setEditingAssignmentId(null);
    setSubmissionNote('');
    setSubmissionAttachments([]);
  };

  const submissionMap = useMemo(() => {
    const map = new Map<string, AssignmentSubmission>();
    assignmentSubmissions.forEach((s) => {
      if (s.userId === sessionUserId) map.set(s.assignmentId, s);
    });
    return map;
  }, [assignmentSubmissions, sessionUserId]);

  useEffect(() => {
    if (!selectedOrgId || orgRole === 'student') return;
    if (assignmentView !== 'submissions' && assignmentView !== 'submissionDetail') return;
    if (orgMembersLoading || orgMembers.length) return;
    loadOrgMembers(selectedOrgId);
  }, [assignmentView, orgMembers.length, orgMembersLoading, orgRole, selectedOrgId]);

  const removeSubmission = async (assignmentId: string, submissionId?: string | null) => {
    setAssignmentSubmissions((prev) => prev.filter((s) => !(s.assignmentId === assignmentId && (!submissionId || s.id === submissionId))));
    if (supabase && typeof supabase.from === 'function') {
      try {
        let builder: any = supabase.from('assignment_submissions' as any).delete().eq('assignment_id', assignmentId);
        if (submissionId) builder = builder.eq('id', submissionId);
        await builder;
      } catch {
        // ignore remote delete errors
      }
    }
  };

  useEffect(() => {
    setAssignmentView('list');
    setSelectedAssignment(null);
    setSelectedSubmission(null);
    setSubmissionNote('');
    setSubmissionAttachments([]);
  }, [assignmentStorageKey]);

  const openAssignmentDetail = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    const mySubmission = submissionMap.get(assignment.id);
    setSubmissionNote(mySubmission?.note ?? '');
    setSubmissionAttachments(parseAttachmentUrls(mySubmission?.attachmentUrl));
    setAssignmentView(orgRole === 'student' ? 'detail' : 'submissions');
  };

  const assignmentSubsForSelected = useMemo(() => {
    if (!selectedAssignment) return [];
    return assignmentSubmissions.filter((s) => s.assignmentId === selectedAssignment.id);
  }, [assignmentSubmissions, selectedAssignment]);

  useEffect(() => {
    if (!orgMembers.length) return;
    setAssignmentSubmissions((prev) => {
      let changed = false;
      const next = prev.map((sub) => {
        if (sub.userName) return sub;
        const name = memberNameById.get(sub.userId);
        if (!name) return sub;
        changed = true;
        return { ...sub, userName: name };
      });
      return changed ? next : prev;
    });
  }, [memberNameById, orgMembers.length]);

  const outstandingMembers = useMemo(() => {
    if (!selectedAssignment || !selectedAssignment.groupId) return [];
    const gid = selectedAssignment.groupId;
    const members = orgMembers.filter((m) => m.role === 'student' && m.groupIds.includes(gid));
    return members.filter((m) => !assignmentSubsForSelected.some((s) => s.userId === m.userId));
  }, [assignmentSubsForSelected, orgMembers, selectedAssignment]);

  const submitAssignment = async () => {
    if (!selectedAssignment) return;
    if (!sessionUserId) {
      Alert.alert('Login erforderlich', 'Bitte melde dich an, um die Aufgabe abzugeben.');
      return;
    }
    const note = submissionNote.trim();
    const attachment = formatAttachmentUrls(submissionAttachments);
    const displayName = await resolveCurrentUserDisplayName();
    const payload: AssignmentSubmission = {
      id: uuidv4(),
      assignmentId: selectedAssignment.id,
      userId: sessionUserId,
      userName: displayName ?? null,
      note: note || undefined,
      attachmentUrl: attachment,
      submittedAt: new Date().toISOString(),
    };
    setAssignmentSubmissions((prev) => {
      const existingIdx = prev.findIndex((s) => s.assignmentId === selectedAssignment.id && s.userId === sessionUserId);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = { ...payload, id: prev[existingIdx].id };
        return copy;
      }
      return [payload, ...prev];
    });
    Alert.alert('Abgegeben', 'Deine Abgabe wurde gespeichert.');
  };

  const deleteAssignment = async (assignmentId: string) => {
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    setAssignmentSubmissions((prev) => prev.filter((s) => s.assignmentId !== assignmentId));
    setSelectedAssignment(null);
    setSelectedSubmission(null);
    if (supabase && typeof supabase.from === 'function') {
      try {
        await (supabase.from('assignment_submissions' as any) as any).delete().eq('assignment_id', assignmentId);
        await (supabase.from('assignments' as any) as any).delete().eq('id', assignmentId);
      } catch {
        // ignore remote delete errors
      }
    }
    setAssignmentView('list');
  };

  const openSubmissionDetail = (sub: AssignmentSubmission) => {
    setSelectedSubmission(sub);
    setAssignmentView('submissionDetail');
  };

  const onDueDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== 'ios') setShowDueDatePicker(false);
    if (!date) return;
    setAssignmentDueDate((prev) => {
      const next = new Date(date);
      if (prev) next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      return next;
    });
  };

  const onDueTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== 'ios') setShowDueTimePicker(false);
    if (!date) return;
    setAssignmentDueDate((prev) => {
      const base = prev ? new Date(prev) : new Date();
      base.setHours(date.getHours(), date.getMinutes(), 0, 0);
      if (!prev) {
        base.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      }
      return base;
    });
  };

  const saveAssignment = async () => {
    const title = assignmentTitle.trim();
    const desc = assignmentDescription.trim();
    const attachment = formatAttachmentUrls(assignmentAttachments);
    const groupId = assignmentGroupId ?? assignmentGroupsForTeacher[0]?.id ?? null;
    if (!title) {
      Alert.alert('Titel fehlt', 'Bitte gib einen Titel ein.');
      return;
    }
    if (!selectedOrgId) {
      Alert.alert('Kein Verein', 'Bitte wähle zuerst einen Verein.');
      return;
    }
    if (!sessionUserId) {
      Alert.alert('Login erforderlich', 'Bitte melde dich an, um Aufgaben zu speichern.');
      return;
    }
    if (!groupId) {
      Alert.alert('Keine Gruppe', 'Bitte wähle eine Gruppe für die Aufgabe.');
      return;
    }
    const dueIso = assignmentDueDate ? assignmentDueDate.toISOString() : undefined;
    const existing = editingAssignmentId
      ? assignments.find((a) => a.id === editingAssignmentId)
      : null;
    const assignmentId = existing?.id ?? uuidv4();
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    const createdBy = existing?.createdBy ?? sessionUserId ?? null;
    const nextAssignment: Assignment = {
      id: assignmentId,
      orgId: selectedOrgId,
      groupId,
      title,
      description: desc || undefined,
      attachmentUrl: attachment,
      dueAt: dueIso || undefined,
      createdAt,
      createdBy,
    };
    setAssignments((prev) => {
      if (existing) {
        return prev.map((a) => (a.id === assignmentId ? nextAssignment : a));
      }
      return [nextAssignment, ...prev];
    });
    if (selectedAssignment?.id === assignmentId) {
      setSelectedAssignment(nextAssignment);
    }
    if (supabase && typeof supabase.from === 'function') {
      try {
        await (supabase.from('assignments' as any) as any).upsert(
          {
            id: nextAssignment.id,
            org_id: nextAssignment.orgId,
            group_id: nextAssignment.groupId,
            title: nextAssignment.title,
            description: nextAssignment.description ?? null,
            attachment_url: nextAssignment.attachmentUrl ?? null,
            due_at: nextAssignment.dueAt ?? null,
            created_by: nextAssignment.createdBy ?? null,
            created_at: nextAssignment.createdAt,
          },
          { onConflict: 'id' } as any,
        );
      } catch {
        // ignore remote save error to stay offline-safe
      }
    }
    goBackToAssignmentList();
  };

  const getGroupInitials = (name?: string | null) => {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return 'G';
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  };

  const resolveChatMediaUrl = (url?: string | null) => {
    if (!url) return null;
    if (supabaseUsingFallback) return url;
    const path = getChatMediaPathFromUrl(url);
    if (path) return chatMediaUrlCache[url] ?? url;
    return url;
  };

  const renderGroupAvatar = (
    name: string | null | undefined,
    imageUrl: string | null | undefined,
    size: number,
    extraStyle?: StyleProp<ViewStyle>,
  ) => {
    const baseStyle = { width: size, height: size, borderRadius: size / 2 };
    const resolvedUrl = resolveChatMediaUrl(imageUrl ?? null);
    if (resolvedUrl) {
      return (
        <Image
          source={{ uri: resolvedUrl }}
          style={[styles.groupAvatar, baseStyle, extraStyle as StyleProp<ImageStyle>]}
          resizeMode="cover"
        />
      );
    }
    return (
      <View style={[styles.groupAvatar, styles.groupAvatarPlaceholder, baseStyle, extraStyle]}>
        <Text style={[styles.groupAvatarText, { fontSize: Math.max(12, Math.round(size * 0.35)) }]}>
          {getGroupInitials(name)}
        </Text>
      </View>
    );
  };

  const renderOrgLogo = (name?: string | null, logoUrl?: string | null) => {
    const resolvedUrl = resolveChatMediaUrl(logoUrl ?? null);
    if (resolvedUrl) {
      return (
        <Image
          source={{ uri: resolvedUrl }}
          style={styles.orgLogoImage}
          resizeMode="contain"
        />
      );
    }
    return (
      <View style={[styles.orgLogoImage, styles.orgLogoPlaceholder]}>
        <Text style={styles.orgLogoText}>{getGroupInitials(name ?? null)}</Text>
      </View>
    );
  };

  const isMediaImageOnly = mediaPickerTarget === 'group' || mediaPickerTarget === 'org';

  const renderMediaPickerCard = () => {
    const isOrgDirector = currentOrg?.id ? orgRoles[currentOrg.id] === 'director' : false;
    const canRemoveOrgLogo = mediaPickerTarget === 'org' && isOrgDirector && !!currentOrg?.logo_url;
    const canRemoveGroupImage = mediaPickerTarget === 'group' && canEditGroupMedia && !!selectedGroup?.image_url;
    const showRemoveButton = canRemoveOrgLogo || canRemoveGroupImage;
    return (
    <View style={[styles.modalCard, styles.orgModalCard]}>
      <View style={{ padding: 12 }}>
        <Text style={styles.sectionTitle}>{isMediaImageOnly ? 'Bild hinzufügen' : 'Datei hinzufügen'}</Text>
        <TouchableOpacity
          onPress={pickFromCamera}
          style={[styles.attachmentButton, { marginTop: 8 }, mediaUploadBusy && { opacity: 0.6 }]}
          disabled={mediaUploadBusy}
        >
          <Text style={styles.attachmentButtonText}>Kamera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={pickFromLibrary}
          style={[styles.attachmentButton, { marginTop: 8 }, mediaUploadBusy && { opacity: 0.6 }]}
          disabled={mediaUploadBusy}
        >
          <Text style={styles.attachmentButtonText}>Aus Galerie wählen</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={pickFromFiles}
          style={[styles.attachmentButton, { marginTop: 8 }, mediaUploadBusy && { opacity: 0.6 }]}
          disabled={mediaUploadBusy}
        >
          <Text style={styles.attachmentButtonText}>Aus Dateien wählen</Text>
        </TouchableOpacity>
        {showRemoveButton && (
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonDanger, mediaUploadBusy && styles.actionButtonDisabled, { marginTop: 12 }]}
            disabled={mediaUploadBusy}
            onPress={() => {
              const message = mediaPickerTarget === 'org'
                ? 'Soll das Vereinslogo entfernt werden?'
                : 'Soll das Gruppenbild entfernt werden?';
              Alert.alert('Bild entfernen', message, [
                { text: 'Abbrechen', style: 'cancel' },
                {
                  text: 'Entfernen',
                  style: 'destructive',
                  onPress: () => {
                    closeMediaPicker();
                    if (mediaPickerTarget === 'org') {
                      handleRemoveOrgLogo();
                    } else {
                      handleRemoveGroupImage();
                    }
                  },
                },
              ]);
            }}
          >
            <Text style={[styles.actionButtonText, styles.actionButtonDangerText]}>Bild entfernen</Text>
          </TouchableOpacity>
        )}{mediaPickerTarget === 'exercise' && (
          <>
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
                  ? 'Bild-URL einügen'
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
          </>
        )}
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          {mediaPickerTarget === 'exercise' && (
            <TouchableOpacity onPress={addAttachmentFromModal} style={[styles.actionButton, styles.actionButtonPrimary, { marginRight: 8 }]}>
              <Text style={styles.actionButtonText}>Hinzufügen</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={closeMediaPicker} style={styles.actionButton}>
            <Text style={styles.actionButtonText}>Schliessen</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
  };

  const mediaPickerOverlay = showMediaModal && mediaPickerTarget !== 'exercise' ? (
    <View style={styles.mediaPickerOverlay}>
      <Pressable style={styles.modalOverlay} onPress={closeMediaPicker} />
      <View style={styles.modalCenterWrap}>
        {renderMediaPickerCard()}
      </View>
    </View>
  ) : null;

  if (screen === 'ankuendigung') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'flex-start' }, containerPaddings]}>
        <View style={styles.sectionDivider} />
        <View style={[styles.chatHeader, styles.chatHeaderNoBorder, styles.chatHeaderLift]}>
          <View style={styles.headerSlot}>
            <TouchableOpacity onPress={() => setScreen('home')} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
          </View>
          <Text style={[styles.title, styles.headerTitleCentered]}>Ankündigungen</Text>
          <View style={[styles.headerSlot, styles.headerSlotRight]}>
            {!!groups.length && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              </View>
            )}
          </View>
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
          ListEmptyComponent={<Text style={styles.text}>{loadingRemote ? 'Laden' : 'Keine Ankündigungen vorhanden.'}</Text>}
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
                <Text style={[styles.sectionTitle,]}>{announcementModalMode === 'edit' ? 'Ankündigung bearbeiten' : 'Neue Ankündigung'}</Text>
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
                    {announcementDateObj ? `${pad(announcementDateObj.getDate())}.${pad(announcementDateObj.getMonth() + 1)}.${announcementDateObj.getFullYear()}` : 'Datum ausw?hlen'}
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
                    <Text style={styles.calendarToggleLabel}>Im Kalender für alle eintragen</Text>
                    <Text style={styles.calendarToggleHint}>Legt nach dem Speichern automatisch einen Termin für deinen Verein an.</Text>
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
                        text: 'Löschen',
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

      {mediaPickerOverlay}


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
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    {renderGroupAvatar(item.name, item.image_url ?? null, 42, styles.groupListAvatar)}
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: '#E5F4EF', flex: 1 }} numberOfLines={1}>{item.name}</Text>
                      {chatUnreadByGroup[item.id] > 0 && (
                        <View style={styles.groupBadge}>
                          <Text style={styles.groupBadgeText}>{formatBadgeCount(chatUnreadByGroup[item.id])}</Text>
                        </View>
                      )}
                    </View>
                  </View>
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
        {mediaPickerOverlay}

        </SafeAreaView>
      );
    }
    if (chatMode === 'info') {
      return (
        <SafeAreaView style={[styles.container, { justifyContent: 'flex-start' }, containerPaddings]}>
          <View style={styles.sectionDivider} />
          <View style={[styles.chatHeader, styles.chatHeaderNoBorder]}>
            <TouchableOpacity onPress={() => setChatMode('in')} style={[styles.headerBack, { bottom: 60 }]}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0, bottom: 60, left: 17 }]}>Gruppeninfo</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={{ width: '100%', maxWidth: 720, paddingHorizontal: 12 }}>
            <View style={styles.groupInfoCard}>
              {renderGroupAvatar(selectedGroup?.name ?? '', selectedGroup?.image_url ?? null, 96, styles.groupInfoAvatar)}
              <Text style={styles.groupInfoName} numberOfLines={2}>{selectedGroup?.name ?? 'Gruppe'}</Text>
            </View>
            {canEditGroupMedia && (
              <>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonPrimary, mediaUploadBusy && styles.actionButtonDisabled]}
                  disabled={mediaUploadBusy}
                  onPress={() => {
                    if (!selectedGroupId) return;
                    openMediaPicker('group');
                  }}
                >
                  <Text style={styles.actionButtonText}>
                    {selectedGroup?.image_url ? 'Bild ändern' : 'Bild hinzufügen'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          {mediaPickerOverlay}
        </SafeAreaView>
      );
    }
    const canDeleteChatMessage = (msg: ChatMessage) => {
      if (!sessionUserId) return false;
      if (msg.userId === sessionUserId) return true;
      return orgRole === 'director' || orgRole === 'teacher';
    };

    const confirmDeleteChatMessage = (msg: ChatMessage) => {
      if (!canDeleteChatMessage(msg)) return;
      Alert.alert('Nachricht löschen', 'Diese Nachricht wirklich löschen?', [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await (supabase.from('messages') as any)
                .delete()
                .eq('id', msg.id);
              if (error) throw error;
              setMessages((prev: ChatMessage[]) => prev.filter((m) => m.id !== msg.id));
            } catch (err: any) {
              const message = (err && err.message) ? err.message : 'Nachricht konnte nicht gelöscht werden.';
              Alert.alert('Fehler', message);
            }
          },
        },
      ]);
    };

    const renderItem = ({ item }: { item: typeof messages[number] }) => {
      const userId = item.userId ?? '';
      const displayName = (item.senderName?.trim())
        || (userId && messageUserNames[userId])
        || (userId && memberNameById.get(userId))
        || (item.from === 'me'
          ? 'Ich'
          : userId
            ? `Mitglied ${userId.slice(0, 6)}`
            : 'Mitglied');
      const hasText = item.text.trim().length > 0;
      const mediaItems = item.mediaItems?.length
        ? item.mediaItems
        : item.mediaUrl
          ? [{
            url: item.mediaUrl,
            type: item.mediaType ?? 'file',
            name: item.mediaName ?? null,
          }]
          : [];
      return (
        <View style={[styles.bubbleRow, item.from === 'me' ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
          <View style={{ width: '100%', alignItems: item.from === 'me' ? 'flex-end' : 'flex-start' }}>
            <View style={styles.bubbleHeader}>
              <Text style={[styles.bubbleName, item.from === 'me' && styles.bubbleNameMe]}>{displayName}</Text>
              {canDeleteChatMessage(item) && (
                <TouchableOpacity
                  onPress={() => confirmDeleteChatMessage(item)}
                  style={styles.chatDeleteBtn}
                >
                  <Ionicons name="trash-outline" size={14} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.bubble, item.from === 'me' ? styles.bubbleMe : styles.bubbleOther]}>
              {hasText && (
                <Text style={[styles.bubbleText, item.from === 'me' && { color: '#fff' }]}>{item.text}</Text>
              )}
              {mediaItems.map((media, index) => {
                const displayUrl = media.url ? (chatMediaUrlCache[media.url] ?? media.url) : null;
                if (!displayUrl) return null;
                if (media.type === 'image') {
                  return (
                    <TouchableOpacity
                      key={`${displayUrl}-${index}`}
                      activeOpacity={0.85}
                      onPress={() => setFullScreenMedia({ url: displayUrl, type: 'image', name: media.name ?? null })}
                      style={index > 0 ? { marginTop: 8 } : undefined}
                    >
                      <Image source={{ uri: displayUrl }} style={styles.chatMediaBubble} resizeMode="cover" />
                    </TouchableOpacity>
                  );
                }
                if (media.type === 'video') {
                  return (
                    <View key={`${displayUrl}-${index}`} style={index > 0 ? { marginTop: 8 } : undefined}>
                      <View style={styles.chatMediaBubble}>
                        <InlineVideo
                          uri={displayUrl}
                          style={styles.chatMediaVideo}
                          contentFit="cover"
                          nativeControls={false}
                        />
                        <Pressable
                          style={styles.chatVideoOverlay}
                          onPress={() => setFullScreenMedia({ url: displayUrl, type: 'video', name: media.name ?? null })}
                        >
                          <View style={styles.videoOverlay}>
                            <Ionicons name="expand" size={18} color="#E5F4EF" />
                            <Text style={styles.videoPreviewText} numberOfLines={1}>Vollbild</Text>
                          </View>
                        </Pressable>
                      </View>
                    </View>
                  );
                }
                return (
                  <TouchableOpacity
                    key={`${displayUrl}-${index}`}
                    activeOpacity={0.85}
                    onPress={() => openDocument(displayUrl)}
                    style={[styles.chatFileBubble, index > 0 && { marginTop: 8 }]}
                  >
                    <Ionicons name="document-text-outline" size={20} color="#9FE1C7" style={{ marginRight: 8 }} />
                    <Text style={styles.chatFileText} numberOfLines={1}>
                      {fileLabelFromUrl(displayUrl, media.name)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <Text style={styles.bubbleTime}>{item.at}</Text>
            </View>
          </View>
        </View>
      );
    };

    const bottomGap = keyboardVisible ? 8 : insets.bottom + TAB_BAR_HEIGHT + 8;
    return (
      <SafeAreaView style={[styles.chatSafeArea, { paddingTop: insets.top + 12 }]}>
        <KeyboardAvoidingView style={{ flex: 1, width: '100%', paddingHorizontal: 16 }} behavior={'padding'}>
          <Modal
            visible={!!fullScreenMedia}
            transparent
            animationType="fade"
            onRequestClose={() => setFullScreenMedia(null)}
          >
            {!!fullScreenMedia && (
              <View style={[styles.mediaFullscreenWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
                <TouchableOpacity
                  style={[styles.mediaFullscreenClose, { top: insets.top + 12 }]}
                  onPress={() => setFullScreenMedia(null)}
                >
                  <Ionicons name="close" size={24} color="#FFFFFF" />
                </TouchableOpacity>
                {fullScreenMedia.type === 'image' ? (
                  <Image source={{ uri: fullScreenMedia.url }} style={styles.mediaFullscreenImage} resizeMode="contain" />
                ) : (
                  <InlineVideo
                    uri={fullScreenMedia.url}
                    style={styles.mediaFullscreenVideo}
                    contentFit="contain"
                    nativeControls
                  />
                )}
              </View>
            )}
          </Modal>
          <View style={styles.sectionDivider} />
          <View style={[styles.chatHeader, styles.chatHeaderNoBorder]}>
            <TouchableOpacity onPress={() => setScreen('home')} style={[styles.headerBack, { bottom: 60 }]}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chatHeaderTitleRow, { bottom: 60, left: 17 }]}
              onPress={() => {
                if (!selectedGroupId) return;
                setChatMode('info');
              }}
              activeOpacity={0.85}
              disabled={!selectedGroupId}
            >
              {renderGroupAvatar(selectedGroup?.name ?? '', selectedGroup?.image_url ?? null, 36, styles.chatHeaderAvatar)}
              <Text style={[styles.title, { marginBottom: 0 }]} numberOfLines={1}>{selectedGroup?.name ?? 'Chat'}</Text>
            </TouchableOpacity>
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
          {!!pendingChatMedia.length && (
            <View style={styles.chatMediaPreview}>
              <ScrollView
                contentContainerStyle={styles.chatMediaPreviewContent}
                showsVerticalScrollIndicator={false}
              >
                {pendingChatMedia.map((media, index) => (
                  <View
                    key={`${media.uri}-${index}`}
                    style={[styles.chatMediaPreviewItem, index > 0 && { marginTop: 8 }]}
                  >
                  {media.type === 'image' && (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setFullScreenMedia({ url: media.uri, type: 'image', name: media.name ?? null })}
                    >
                      <Image source={{ uri: media.uri }} style={styles.chatMediaPreviewImage} resizeMode="cover" />
                    </TouchableOpacity>
                  )}
                  {media.type === 'video' && (
                    <View style={[styles.chatMediaPreviewImage, { overflow: 'hidden' }]}>
                      <InlineVideo
                        uri={media.uri}
                        style={styles.chatMediaPreviewVideo}
                        contentFit="cover"
                        nativeControls={false}
                      />
                      <Pressable
                        style={styles.chatVideoOverlay}
                        onPress={() => setFullScreenMedia({ url: media.uri, type: 'video', name: media.name ?? null })}
                      >
                        <View style={styles.videoOverlay}>
                          <Ionicons name="expand" size={18} color="#E5F4EF" />
                          <Text style={styles.videoPreviewText} numberOfLines={1}>Vollbild</Text>
                        </View>
                      </Pressable>
                    </View>
                  )}
                  {media.type === 'file' && (
                    <View style={styles.chatFileBubble}>
                      <Ionicons name="document-text-outline" size={20} color="#9FE1C7" style={{ marginRight: 8 }} />
                      <Text style={styles.chatFileText} numberOfLines={1}>
                        {fileLabelFromUrl(media.uri, media.name)}
                      </Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.chatMediaRemove}
                    onPress={() => setPendingChatMedia((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Ionicons name="close" size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={[styles.inputRow, { marginBottom: bottomGap }]}>
            <TouchableOpacity
              style={[styles.mediaPickBtn, chatUploadBusy && styles.mediaPickBtnDisabled]}
              disabled={chatUploadBusy}
              onPress={pickChatMedia}
            >
              <Ionicons name="image-outline" size={20} color="#9FE1C7" />
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, height: chatInputHeight, maxHeight: MAX_CHAT_INPUT_HEIGHT }]}
              placeholder="Nachricht schreiben."
              placeholderTextColor={'#95959588'}
              value={draft}
              onChangeText={setDraft}
              multiline
              scrollEnabled
              textAlignVertical="top"
              onContentSizeChange={(e) => {
                const h = Math.ceil(e.nativeEvent.contentSize.height);
                const next = Math.min(MAX_CHAT_INPUT_HEIGHT, Math.max(MIN_CHAT_INPUT_HEIGHT, h));
                if (next !== chatInputHeight) setChatInputHeight(next);
              }}
            />
            <TouchableOpacity
              style={[styles.sendBtn, chatUploadBusy && styles.sendBtnDisabled]}
              disabled={chatUploadBusy}
              onPress={() => {
                const txt = draft.trim();
                if (!chatChannelId || !sessionUserId || chatUploadBusy) return;
                if (!txt && !pendingChatMedia.length) return;
                (async () => {
                  setChatUploadBusy(true);
                  try {
                    let mediaPayload: ChatMedia[] | null = null;
                    if (pendingChatMedia.length) {
                      mediaPayload = await Promise.all(pendingChatMedia.map((item) => uploadChatMedia(item)));
                    }
                    const senderName = await resolveCurrentUserDisplayName();
                    const body = buildChatBody(txt, mediaPayload, senderName ?? undefined);
                    const { data, error } = await (supabase.from('messages') as any)
                      .insert({ channel_id: chatChannelId, user_id: sessionUserId, body })
                      .select('id,user_id,body,created_at')
                      .single();
                    if (error) throw error;
                    if (data) {
                      setMessages((prev: ChatMessage[]) => ([...prev, buildChatMessage(data)]));
                      ensureMessageUserNames([data.user_id]);
                      setDraft('');
                      setPendingChatMedia([]);
                    }
                  } catch (e: any) {
                    Alert.alert('Fehler', e?.message ?? 'Nachricht konnte nicht gesendet werden.');
                  } finally {
                    setChatUploadBusy(false);
                  }
                })();
              }}
            >
              <Ionicons name="mail-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      {mediaPickerOverlay}

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
              <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
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
                  <Text style={styles.attachmentButtonText}>+ Dateien, Bilder & Videos hinzufügen</Text>
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
              {showMediaModal && mediaPickerTarget === 'exercise' && (
                <View style={styles.mediaPickerOverlay}>
                  <Pressable style={styles.modalOverlay} onPress={closeMediaPicker} />
                  <View style={styles.modalCenterWrap}>
                    {renderMediaPickerCard()}
                  </View>
                </View>
              )}
        </Modal>

        <Modal visible={!!selectedExercise} transparent animationType="fade" onRequestClose={() => setSelectedExercise(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setSelectedExercise(null)} />
          <View style={[styles.modalCenterWrap, { paddingHorizontal: 8 }]}>
            <View style={[styles.modalCard, styles.orgModalCard]}>
              <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
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
                          onPress={() => openDocument(att.url)}
                          style={styles.videoPreview}
                          activeOpacity={0.9}
                        >
                          {getYouTubeThumb(att.url) ? (
                            <Image
                              source={{ uri: getYouTubeThumb(att.url) ?? undefined }}
                              style={styles.videoPlayer}
                              resizeMode="cover"
                            />
                          ) : (
                            <InlineVideo
                              uri={att.url}
                              style={styles.videoPlayer}
                              contentFit="contain"
                              nativeControls
                            />
                          )}
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
                      onPress={() => openDocument(att.url)}
                      style={styles.videoPreview}
                      activeOpacity={0.85}
                    >
                      <View style={styles.videoPreviewInner}>
                        <Ionicons name="document-text-outline" size={42} color="#9FE1C7" />
                        <Text style={styles.videoPreviewText} numberOfLines={2}>{fileLabelFromUrl(att.url)}</Text>
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
      {mediaPickerOverlay}

      </SafeAreaView>
    );
  }
  if (screen === 'aufgaben') {
    const isStudent = orgRole === 'student';
    const isTeacher = orgRole === 'teacher';
    const isDirector = orgRole === 'director';
    const canCreateAssignments = isTeacher || isDirector;

    if (assignmentView === 'create') {
      return (
        <SafeAreaView style={[styles.container, { paddingHorizontal: 16, alignItems: 'stretch' }]}>
          <View style={styles.assignmentHeader}>
            <TouchableOpacity onPress={goBackToAssignmentList} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0 }]}>
              {editingAssignmentId ? 'Aufgabe bearbeiten' : 'Aufgabe erstellen'}
            </Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView
            style={{ width: '100%', flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24, width: '100%', flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            horizontal={false}
          >
            <Text style={styles.label}>Titel</Text>
            <TextInput
              style={styles.input}
              placeholder="Titel der Aufgabe"
              placeholderTextColor={'#95959588'}
              value={assignmentTitle}
              onChangeText={setAssignmentTitle}
            />

            <Text style={[styles.label, { marginTop: 10 }]}>Beschreibung</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Beschreibung (optional)"
              placeholderTextColor={'#95959588'}
              value={assignmentDescription}
              onChangeText={setAssignmentDescription}
              multiline
            />

            <Text style={[styles.label, { marginTop: 10 }]}>Datei</Text>
            <TouchableOpacity onPress={() => openMediaPicker('assignment')} style={styles.attachmentButton}>
              <Text style={styles.attachmentButtonText}>Datei hinzufügen</Text>
            </TouchableOpacity>
            {!!assignmentAttachments.length && (
              <View style={{ marginTop: 6 }}>
                {assignmentAttachments.map((url, index) => (
                  <View key={`${url}-${index}`} style={[styles.attachmentPill, index > 0 && { marginTop: 6 }]}>
                    <Ionicons name="document-text-outline" size={18} color="#9FE1C7" style={styles.attachmentIcon} />
                    <Text style={styles.attachmentText} numberOfLines={1}>{fileLabelFromUrl(url)}</Text>
                    <TouchableOpacity onPress={() => removeAssignmentAttachmentAt(index)} style={styles.attachmentRemove}>
                      <Ionicons name="close" size={16} color="#E5F4EF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={[styles.label, { marginTop: 10 }]}>Fällig bis</Text>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity
                style={[styles.datePickerButton, showDueDatePicker && styles.datePickerButtonActive, { flex: 1, marginRight: 8 }]}
                onPress={() => setShowDueDatePicker((v) => !v)}
              >
                <Text style={assignmentDueDate ? styles.datePickerValue : styles.datePickerPlaceholder}>
                  {assignmentDueDate
                    ? `${pad(assignmentDueDate.getDate())}.${pad(assignmentDueDate.getMonth() + 1)}.${assignmentDueDate.getFullYear()}`
                    : 'Datum wählen'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.datePickerButton, showDueTimePicker && styles.datePickerButtonActive, { flex: 1 }]}
                onPress={() => setShowDueTimePicker((v) => !v)}
              >
                <Text style={assignmentDueDate ? styles.datePickerValue : styles.datePickerPlaceholder}>
                  {assignmentDueDate ? `${pad(assignmentDueDate.getHours())}:${pad(assignmentDueDate.getMinutes())}` : 'Zeit wählen'}
                </Text>
              </TouchableOpacity>
            </View>
            {showDueDatePicker && (
              <DateTimePicker
                mode="date"
                value={assignmentDueDate ?? new Date()}
                onChange={onDueDateChange}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              />
            )}
            {showDueTimePicker && (
              <DateTimePicker
                mode="time"
                value={assignmentDueDate ?? new Date()}
                onChange={onDueTimeChange}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              />
            )}

            <Text style={[styles.label, { marginTop: 10 }]}>Gruppe</Text>
            <View style={styles.groupChipRow}>
              {assignmentGroupsForTeacher.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => setAssignmentGroupId(g.id)}
                  style={[styles.groupChip, assignmentGroupId === g.id && styles.groupChipActive]}
                >
                  <Text style={[styles.groupChipText, assignmentGroupId === g.id && styles.groupChipTextActive]}>
                    {g.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {!assignmentGroupsForTeacher.length && (
                <Text style={styles.muted}>Keine Gruppe verfügbar.</Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', marginTop: 16 }}>
              <TouchableOpacity onPress={saveAssignment} style={[styles.actionButton, styles.actionButtonPrimary, { marginRight: 8 }]}>
                <Text style={styles.actionButtonText}>Speichern</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goBackToAssignmentList} style={styles.actionButton}>
                <Text style={styles.actionButtonText}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        {mediaPickerOverlay}

        </SafeAreaView>
      );
    }

    if (assignmentView === 'detail' && selectedAssignment) {
      const mine = submissionMap.get(selectedAssignment.id);
      const assignmentAttachmentList = parseAttachmentUrls(selectedAssignment.attachmentUrl);
      return (
        <SafeAreaView style={[styles.container, { paddingHorizontal: 16, alignItems: 'stretch' }]}>
          <View style={styles.assignmentHeader}>
            <TouchableOpacity onPress={goBackToAssignmentList} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0 }]}>Aufgabe</Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.assignmentTitle}>{selectedAssignment.title}</Text>
            {!!selectedAssignment.description && (
              <Text style={styles.assignmentBody}>{selectedAssignment.description}</Text>
            )}
            <Text style={styles.assignmentMeta}>Gruppe: {groupNameFor(selectedAssignment.groupId)}</Text>
            <Text style={styles.assignmentMeta}>Fällig: {formatAssignmentDue(selectedAssignment.dueAt)}</Text>
            {!!assignmentAttachmentList.length && (
              <View style={{ marginTop: 8 }}>
                {assignmentAttachmentList.map((url, index) => (
                  <TouchableOpacity
                    key={`${url}-${index}`}
                    onPress={() => openDocument(url)}
                    style={[styles.attachmentPill, index > 0 && { marginTop: 6 }]}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="document-text-outline" size={18} color="#9FE1C7" style={styles.attachmentIcon} />
                    <Text style={styles.attachmentText} numberOfLines={1}>{fileLabelFromUrl(url)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={{ marginTop: 20 }}>
              <Text style={styles.label}>Meine Notiz</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Kommentar oder Antwort"
                placeholderTextColor={'#95959588'}
                value={submissionNote}
                onChangeText={setSubmissionNote}
                multiline
              />
              <Text style={[styles.label, { marginTop: 10 }]}>Meine Datei</Text>
              <TouchableOpacity onPress={() => openMediaPicker('submission')} style={styles.attachmentButton}>
                <Text style={styles.attachmentButtonText}>Datei hinzufügen</Text>
              </TouchableOpacity>
              {!!submissionAttachments.length && (
                <View style={{ marginTop: 6 }}>
                  {submissionAttachments.map((url, index) => (
                    <View key={`${url}-${index}`} style={[styles.attachmentPill, index > 0 && { marginTop: 6 }]}>
                      <Ionicons name="document-text-outline" size={18} color="#9FE1C7" style={styles.attachmentIcon} />
                      <Text style={styles.attachmentText} numberOfLines={1}>{fileLabelFromUrl(url)}</Text>
                      <TouchableOpacity onPress={() => removeSubmissionAttachmentAt(index)} style={styles.attachmentRemove}>
                        <Ionicons name="close" size={16} color="#E5F4EF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              {mine && (
                <Text style={styles.assignmentMeta}>
                  Bereits abgegeben: {formatAssignmentDue(mine.submittedAt)}
                </Text>
              )}
              <TouchableOpacity
                onPress={() => {
                  if (mine) {
                    removeSubmission(selectedAssignment.id, mine.id);
                  } else {
                    submitAssignment();
                  }
                }}
                style={[
                  styles.actionButton,
                  styles.actionButtonPrimary,
                  { marginTop: 12 },
                  mine && { backgroundColor: '#7F1D1D', borderColor: '#7F1D1D' },
                ]}
              >
                <Text style={styles.actionButtonText}>{mine ? 'Abgabe rückgängig machen' : 'Abgeben'}</Text>
              </TouchableOpacity>
              {(isTeacher || isDirector) && (
                <>
                  <TouchableOpacity
                    onPress={() => startAssignmentEdit(selectedAssignment)}
                    style={[styles.actionButton, styles.actionButtonPrimary, { marginTop: 8 }]}
                  >
                    <Text style={styles.actionButtonText}>Bearbeiten</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert('Aufgabe löschen', 'Diese Aufgabe und Abgaben entfernen?', [
                        { text: 'Abbrechen', style: 'cancel' },
                        { text: 'Löschen', style: 'destructive', onPress: () => selectedAssignment && deleteAssignment(selectedAssignment.id) },
                      ]);
                    }}
                    style={[styles.actionButton, styles.actionButtonDanger, { marginTop: 8 }]}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonDangerText]}>Aufgabe löschen</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>
        {mediaPickerOverlay}

        </SafeAreaView>
      );
    }

    if (assignmentView === 'submissions' && selectedAssignment) {
      return (
        <SafeAreaView style={[styles.container, { paddingHorizontal: 16, alignItems: 'stretch' }]}>
          <View style={styles.assignmentHeader}>
            <TouchableOpacity onPress={goBackToAssignmentList} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0 }]}>Abgaben</Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.assignmentTitle}>{selectedAssignment.title}</Text>
            <Text style={styles.assignmentMeta}>Gruppe: {groupNameFor(selectedAssignment.groupId)}</Text>
            <Text style={styles.assignmentMeta}>Fällig: {formatAssignmentDue(selectedAssignment.dueAt)}</Text>

            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Eingereicht</Text>
            {assignmentSubsForSelected.length === 0 && (
              <Text style={styles.muted}>Noch keine Abgaben.</Text>
            )}
            {assignmentSubsForSelected.map((sub) => (
              <TouchableOpacity key={sub.id} onPress={() => openSubmissionDetail(sub)} style={styles.submissionCard}>
                <Text style={styles.assignmentMetaStrong}>
                  {memberNameById.get(sub.userId) ?? messageUserNames[sub.userId] ?? sub.userName ?? sub.userId}
                </Text>
                <Text style={styles.assignmentMeta}>Eingereicht: {formatAssignmentDue(sub.submittedAt)}</Text>
                {!!sub.note && <Text style={styles.assignmentBody} numberOfLines={2}>{sub.note}</Text>}
              </TouchableOpacity>
            ))}

            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Ausstehend</Text>
            {outstandingMembers.length === 0 && (
              <Text style={styles.muted}>Niemand offen.</Text>
            )}
            {outstandingMembers.map((m) => (
              <View key={m.userId} style={styles.submissionCard}>
                <Text style={styles.assignmentMetaStrong}>{m.displayName}</Text>
                <Text style={styles.assignmentMeta}>{m.email ?? m.userId}</Text>
                <Text style={styles.assignmentMeta}>Keine Abgabe</Text>
              </View>
            ))}
          </ScrollView>
        {mediaPickerOverlay}

        </SafeAreaView>
      );
    }

    if (assignmentView === 'submissionDetail' && selectedSubmission && selectedAssignment) {
      const submissionAttachmentList = parseAttachmentUrls(selectedSubmission.attachmentUrl);
      return (
        <SafeAreaView style={[styles.container, { paddingHorizontal: 16, alignItems: 'stretch' }]}>
          <View style={styles.assignmentHeader}>
            <TouchableOpacity onPress={() => setAssignmentView('submissions')} style={styles.headerBack}>
              <Ionicons name="chevron-back" size={22} color="#194055" />
            </TouchableOpacity>
            <Text style={[styles.title, { marginBottom: 0 }]}>Abgabe</Text>
            <View style={{ width: 32 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.assignmentTitle}>
              {memberNameById.get(selectedSubmission.userId) ?? messageUserNames[selectedSubmission.userId] ?? selectedSubmission.userName ?? selectedSubmission.userId}
            </Text>
            <Text style={styles.assignmentMeta}>Für: {selectedAssignment.title}</Text>
            <Text style={styles.assignmentMeta}>Eingereicht: {formatAssignmentDue(selectedSubmission.submittedAt)}</Text>
            {!!selectedSubmission.note && (
              <Text style={[styles.assignmentBody, { marginTop: 10 }]}>{selectedSubmission.note}</Text>
            )}
            {!!submissionAttachmentList.length && (
              <View style={{ marginTop: 12 }}>
                {submissionAttachmentList.map((url, index) => (
                  <TouchableOpacity
                    key={`${url}-${index}`}
                    onPress={() => openDocument(url)}
                    style={[styles.attachmentPill, index > 0 && { marginTop: 6 }]}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="document-text-outline" size={18} color="#9FE1C7" style={styles.attachmentIcon} />
                    <Text style={styles.attachmentText} numberOfLines={1}>{fileLabelFromUrl(url)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        {mediaPickerOverlay}

        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={[styles.container, { paddingHorizontal: 16, alignItems: 'stretch' }]}>
        <View style={styles.assignmentHeader}>
          <TouchableOpacity onPress={() => setScreen('home')} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={22} color="#194055" />
          </TouchableOpacity>
          <Text style={[styles.title, { marginBottom: 0 }]}>Aufgaben</Text>
          <View style={{ width: 32 }} />
        </View>
        {canCreateAssignments && (
          <TouchableOpacity
            onPress={() => { resetAssignmentForm(); setAssignmentView('create'); }}
            style={[styles.addExerciseButton, { alignSelf: 'flex-start', marginBottom: 8 }]}
          >
            <Text style={styles.addExerciseText}>+ Aufgabe</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.row, styles.statusRow]}>
          {[
            { key: 'all', label: 'Alle' },
            { key: 'upcoming', label: 'Bevorstehend' },
            { key: 'overdue', label: 'Überfällig' },
            { key: 'submitted', label: 'Abgegeben' },
          ].map((s) => (
            <TouchableOpacity
              key={s.key}
              onPress={() => setAssignmentStatusFilter(s.key as any)}
              style={[styles.filterChip, assignmentStatusFilter === s.key && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, assignmentStatusFilter === s.key && styles.filterChipTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={visibleAssignments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={<Text style={styles.exerciseEmpty}>Keine Aufgaben.</Text>}
          renderItem={({ item }) => {
            const sub = submissionMap.get(item.id);
            return (
              <TouchableOpacity
                onPress={() => openAssignmentDetail(item)}
                onLongPress={() => {
                  if (!(isTeacher || isDirector)) return;
                  Alert.alert('Aufgabe', 'Aktion auswählen', [
                    { text: 'Abbrechen', style: 'cancel' },
                    { text: 'Bearbeiten', onPress: () => startAssignmentEdit(item) },
                    {
                      text: 'Löschen',
                      style: 'destructive',
                      onPress: () => deleteAssignment(item.id),
                    },
                  ]);
                }}
                delayLongPress={250}
                style={styles.assignmentCard}
                activeOpacity={0.9}
              >
                <Text style={styles.assignmentTitle}>{item.title}</Text>
                {!!item.description && <Text style={styles.assignmentBody} numberOfLines={2}>{item.description}</Text>}
                <Text style={styles.assignmentMeta}>Gruppe: {groupNameFor(item.groupId)}</Text>
                <Text style={styles.assignmentMeta}>Fällig: {formatAssignmentDue(item.dueAt)}</Text>
                {isStudent && (
                  <Text style={[styles.assignmentMetaStrong, { marginTop: 6 }]}>
                    {sub ? `Abgegeben: ${formatAssignmentDue(sub.submittedAt)}` : 'Noch nicht abgegeben'}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      {mediaPickerOverlay}

      </SafeAreaView>
    );
  }
  // --- Home-Screen mit Buttons ---
  return (
    <SafeAreaView style={[styles.container, homePaddings]}>

      {!!currentOrg && (
        <View style={styles.orgLogoSection}>
          <TouchableOpacity
            style={styles.orgLogoWrap}
            activeOpacity={orgRoles[currentOrg.id] === 'director' ? 0.85 : 1}
            disabled={orgRoles[currentOrg.id] !== 'director' || mediaUploadBusy}
            onPress={() => {
              if (!selectedOrgId) return;
              openMediaPicker('org');
            }}
          >
            {renderOrgLogo(currentOrg.name, currentOrg.logo_url ?? null)}
          </TouchableOpacity>
        </View>
      )}

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
        {unreadAnnouncementCount > 0 && (
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{formatBadgeCount(unreadAnnouncementCount)}</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('chat')}>
        <Text style={styles.menuBtnText}>Kommunikationskanal</Text>
        {unreadChatCount > 0 && (
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{formatBadgeCount(unreadChatCount)}</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('uebungen')} >
        <Text style={styles.menuBtnText}>Übungen</Text>
        {unreadExerciseCount > 0 && (
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{formatBadgeCount(unreadExerciseCount)}</Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('aufgaben')} >
        <Text style={styles.menuBtnText}>Aufgaben</Text>
        {unreadAssignmentCount > 0 && (
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{formatBadgeCount(unreadAssignmentCount)}</Text>
          </View>
        )}
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

    {mediaPickerOverlay}


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
  orgLogoSection: { width: '100%', maxWidth: 720, alignItems: 'center', marginBottom: 12 },
  orgLogoWrap: { width: 140, height: 140, borderRadius: 20, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 8 },
  orgLogoImage: { width: '100%', height: '100%' },
  orgLogoPlaceholder: { backgroundColor: '#1b3746', alignItems: 'center', justifyContent: 'center' },
  orgLogoText: { color: '#E5F4EF', fontWeight: '700', fontSize: 28 },
  orgLogoActions: { width: '100%', maxWidth: 360 },
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
  attachmentPreviewCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginBottom: 6 },
  attachmentThumb: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden', marginRight: 10, backgroundColor: '#0f2633' },
  attachmentThumbImage: { width: '100%', height: '100%' },
  attachmentThumbVideo: { width: '100%', height: '100%' },
  attachmentThumbOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  attachmentThumbFile: { alignItems: 'center', justifyContent: 'center' },
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
  assignmentHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  assignmentCard: { width: '100%', alignSelf: 'stretch', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginBottom: 16, marginHorizontal: 0 },
  assignmentTitle: { color: '#E5F4EF', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  assignmentBody: { color: '#C7D2D6', fontSize: 14, marginBottom: 6 },
  assignmentMeta: { color: '#9CA3AF', fontSize: 13, marginTop: 2 },
  assignmentMetaStrong: { color: '#E5F4EF', fontWeight: '700', fontSize: 14 },
  submissionCard: { width: '100%', alignSelf: 'stretch', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginBottom: 12 },
  groupChipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  groupChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', marginRight: 8, marginBottom: 8, backgroundColor: '#0F2530' },
  groupChipActive: { backgroundColor: '#194055', borderColor: '#3D8B77' },
  groupChipText: { color: '#E5F4EF', fontWeight: '600' },
  groupChipTextActive: { color: '#9FE1C7' },
  muted: { color: '#6B7280', fontStyle: 'italic' },
  statusRow: { marginTop: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: '#2A3E48', marginRight: 10, marginBottom: 10, backgroundColor: '#0F2530', alignSelf: 'flex-start' },
  filterChipActive: { backgroundColor: '#194055', borderColor: '#3D8B77' },
  filterChipText: { color: '#C7D2D6', fontWeight: '700' },
  filterChipTextActive: { color: '#FFFFFF' },



  label: { color: '#ffffffff', fontSize: 14, fontWeight: '600', marginBottom: 6 },

  button: {
    backgroundColor: '#194055',   // Hintergrundfarbe
    paddingVertical: 14,          // H?he innen
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
  groupAvatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#0F2530', borderWidth: 1, borderColor: '#2A3E48' },
  groupAvatarPlaceholder: { backgroundColor: '#1b3746' },
  groupAvatarText: { color: '#E5F4EF', fontWeight: '700' },
  groupListAvatar: { marginRight: 12 },
  chatHeaderAvatar: { marginRight: 10 },
  groupInfoAvatar: { marginBottom: 10 },
  groupInfoCard: { alignItems: 'center', paddingVertical: 16, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#112a37', marginBottom: 12 },
  groupInfoName: { color: '#E5F4EF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  groupActionButton: { padding: 4, marginLeft: 12, borderRadius: 16, backgroundColor: '#1b3746' },
  groupBadge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 },
  groupBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  announcementCard: { minHeight: 150, justifyContent: 'space-between' },
  announcementCardRow: { flexDirection: 'row', alignItems: 'center' },
  annTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4, color: '#E5F4EF' },
  annMeta: { fontSize: 12, color: '#ffffffff', marginBottom: 6 },
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
  row: { flexDirection: 'row', alignItems: 'center' },
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
    position: 'relative',
  },
  menuBtnText: { color: '#E8F3F0', fontSize: 18, fontWeight: '600' },
  menuBadge: { position: 'absolute', right: -8, top: -8, minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  menuBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  circlePlaceholder: { width: 64, height: 64, borderRadius: 999, backgroundColor: '#184B3D', alignItems: 'center', justifyContent: 'center' },

  // Modal helpers
  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  mediaPickerOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'stretch', paddingHorizontal: 0, zIndex: 20, elevation: 20 },
  modalCenterWrap: { flex: 1, justifyContent: 'center', alignItems: 'stretch', paddingHorizontal: 0 },
  modalCard: { width: '100%', maxWidth: '100%', backgroundColor: '#194055', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', maxHeight: '92%', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6, alignSelf: 'stretch' },
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
  bubble: { maxWidth: '80%', minWidth: 48, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe: { backgroundColor: '#194055' },
  bubbleOther: { backgroundColor: '#F3F4F6' },
  bubbleName: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginBottom: 4 },
  bubbleNameMe: { color: '#C7D2D6' },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center' },
  chatDeleteBtn: { marginLeft: 6, padding: 2, borderRadius: 10, opacity: 0.7 },
  bubbleText: { fontSize: 15 },
  bubbleTime: { fontSize: 10, color: '#6B7280', marginTop: 4, alignSelf: 'flex-end' },
  chatMediaBubble: { width: 220, height: 160, borderRadius: 12, marginTop: 6, backgroundColor: '#0f2633', overflow: 'hidden' },
  chatMediaVideo: { width: '100%', height: '100%' },
  chatMediaPreviewVideo: { width: '100%', height: '100%' },
  chatVideoOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'flex-end', alignItems: 'center', padding: 8 },
  chatFileBubble: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530' },
  chatFileText: { color: '#E5F4EF', flex: 1 },
  chatMediaPreview: { width: '100%', maxWidth: 720, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', maxHeight: 220, marginBottom: 8, overflow: 'hidden' },
  chatMediaPreviewContent: { padding: 8 },
  chatMediaPreviewItem: { position: 'relative' },
  chatMediaPreviewImage: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#0f2633' },
  chatMediaRemove: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  mediaFullscreenWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  mediaFullscreenImage: { width: '100%', height: '100%' },
  mediaFullscreenVideo: { width: '100%', height: '100%' },
  mediaFullscreenClose: { position: 'absolute', right: 16, zIndex: 2, padding: 6, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', width: '100%', maxWidth: 720, marginTop: 1, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2A3E48' },
  mediaPickBtn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#2A3E48', backgroundColor: '#0F2530', marginRight: 8 },
  mediaPickBtnDisabled: { opacity: 0.5 },
  sendBtn: { paddingVertical: 14, paddingHorizontal: 16, marginLeft: 8, backgroundColor: '#194055', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.6 },
  chatHeader: { width: '100%', maxWidth: 720, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3E48' },
  chatHeaderTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  chatHeaderNoBorder: { borderBottomWidth: 0 },
  chatHeaderLift: { bottom: 60 },
  sectionDivider: { width: '100%', maxWidth: 720, height: StyleSheet.hairlineWidth, backgroundColor: '#2A3E48', marginBottom: 8 },
  headerBack: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 4 },
  headerBackText: { color: '#194055', fontWeight: '600', marginLeft: 2 },
  headerSlot: { width: 60, alignItems: 'flex-start', justifyContent: 'center' },
  headerSlotRight: { alignItems: 'flex-end' },
  headerTitleCentered: { flex: 1, textAlign: 'center', marginBottom: 0 },
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
const formatBadgeCount = (count: number) => (count > 99 ? '99+' : `${count}`);
const fileLabelFromUrl = (url?: string | null, fallback?: string | null) => {
  const preferred = fallback?.trim();
  if (preferred) return preferred;
  if (!url) return 'Datei';
  const clean = url.split('?')[0].split('#')[0];
  const name = clean.split('/').pop() || url;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};
const getYouTubeId = (url: string) => {
  try {
    const raw = url.trim();
    if (!raw) return null;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }
  return null;
};
const getYouTubeThumb = (url?: string | null) => {
  if (!url) return null;
  const id = getYouTubeId(url);
  if (!id) return null;
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
};
const openDocument = (url?: string | null) => {
  if (!url) return;
  WebBrowser.openBrowserAsync(url).catch(() => {
    Linking.openURL(url).catch(() => { });
  });
};
const parseAttachmentUrls = (value?: string | null) => {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // fall back to single value
    }
  }
  return [trimmed];
};
const formatAttachmentUrls = (urls: string[]) => {
  const clean = urls.map((u) => u.trim()).filter(Boolean);
  if (!clean.length) return undefined;
  if (clean.length === 1) return clean[0];
  return JSON.stringify(clean);
};
const parseChatBody = (body: string | null) => {
  if (!body) return { text: '' };
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return { text: body };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return { text: body };
    const rawText = typeof (parsed as any).text === 'string' ? (parsed as any).text : '';
    const rawSender = typeof (parsed as any).senderName === 'string'
      ? (parsed as any).senderName
      : typeof (parsed as any).userName === 'string'
        ? (parsed as any).userName
        : '';
    const senderName = rawSender.trim() ? rawSender.trim() : null;
    const normalizeMedia = (entry: any) => {
      if (!entry || typeof entry !== 'object') return null;
      const url = typeof entry.url === 'string' ? entry.url : '';
      const type = entry.type === 'video'
        ? 'video'
        : entry.type === 'image'
          ? 'image'
          : entry.type === 'file'
            ? 'file'
            : null;
      const name = typeof entry.name === 'string' ? entry.name : null;
      if (url && type) return { url, type, name } as ChatMedia;
      return null;
    };
    const rawMedia = (parsed as any).media;
    if (Array.isArray(rawMedia)) {
      const mediaItems = rawMedia.map(normalizeMedia).filter(Boolean) as ChatMedia[];
      if (mediaItems.length) {
        return { text: rawText, mediaItems, senderName };
      }
    }
    const single = normalizeMedia(rawMedia);
    if (single) {
      return { text: rawText, media: single, senderName };
    }
    if (rawText || senderName) return { text: rawText, senderName };
  } catch {
    return { text: body };
  }
  return { text: body };
};
const buildChatBody = (text: string, media: ChatMedia | ChatMedia[] | null, senderName?: string | null) => {
  const cleanSender = senderName?.trim() ?? '';
  const hasMedia = Array.isArray(media) ? media.length > 0 : !!media;
  if (hasMedia || cleanSender) {
    const payload: any = { text: text || null };
    if (hasMedia) payload.media = media;
    if (cleanSender) payload.senderName = cleanSender;
    return JSON.stringify(payload);
  }
  return text;
};

