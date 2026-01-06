import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase, supabaseUsingFallback } from '../lib/supabase';

type OrgRole = 'director' | 'teacher' | 'student';

type AnnouncementRow = {
  id: string;
  org_id: string;
  group_id: string | null;
  author_id: string | null;
  title: string;
  body: string | null;
  event_date: string | null;
  created_at: string | null;
};

type AssignmentRow = {
  id: string;
  org_id: string | null;
  group_id: string | null;
  title: string;
  description?: string | null;
  attachment_url?: string | null;
  due_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

type Exercise = {
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
};

type Task = {
  id: string;
  title: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  done?: boolean;
  createdAt?: string;
  priority?: string;
};

type TaskList = {
  id: string;
  name: string;
  tasks: Task[];
  archived?: Task[];
};

type NewsCategory = 'announcement' | 'assignment' | 'exercise' | 'tasklist' | 'event';
type NewsEventType = 'new' | 'update' | 'start';
type NewsItem = {
  id: string;
  createdAt: string;
  orgId?: string | null;
  orgName?: string | null;
  category: NewsCategory;
  categoryLabel: string;
  changeText: string;
  sourceId: string;
  eventType: NewsEventType;
};

type NewsMeta = {
  signatures: Record<string, string>;
  seenStarts: Record<string, string>;
  lastStartCheck?: string | null;
};

const NEWS_STORAGE_BASE = '@vereinus/news';
const NEWS_META_BASE = '@vereinus/news_meta';
const EXERCISE_STORAGE_BASE = '@vereinus/exercises';
const TASKLIST_STORAGE_BASE = '@vereinus/tasklists';

const MAX_NEWS_ITEMS = 200;
const START_WINDOW_MINUTES = 15;

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toDateTimeString = (d: Date) => (
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
);
const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const safeJsonParse = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return `${hash}`;
};

const signatureOf = (...parts: Array<string | null | undefined>) => (
  hashString(parts.map((p) => (p ?? '').trim()).join('|'))
);

const parseTaskDateTime = (value?: string) => {
  if (!value) return null;
  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  if (!year || !month || !day) return null;
  const hasTime = Boolean(timePart);
  const [hour, minute] = hasTime ? timePart.split(':').map(Number) : [0, 0];
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0);
  return { date, hasTime };
};

const hasExplicitTime = (value?: string | null) => {
  if (!value) return false;
  if (value.includes(' ')) return Boolean(value.split(' ')[1]?.trim());
  if (value.includes('T')) return true;
  return false;
};

const buildNewsId = (kind: NewsCategory, eventType: NewsEventType, sourceId: string, stamp: string) => (
  `news-${kind}-${eventType}-${sourceId}-${hashString(stamp)}`
);

const buildNewsMeta = (raw: string | null | undefined): NewsMeta => {
  const parsed = safeJsonParse<NewsMeta>(raw, { signatures: {}, seenStarts: {}, lastStartCheck: null });
  return {
    signatures: parsed.signatures ?? {},
    seenStarts: parsed.seenStarts ?? {},
    lastStartCheck: parsed.lastStartCheck ?? null,
  };
};

export default function News() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const newsStorageKey = useMemo(
    () => `${NEWS_STORAGE_BASE}:${userId ?? 'anon'}`,
    [userId],
  );
  const newsMetaKey = useMemo(
    () => `${NEWS_META_BASE}:${userId ?? 'anon'}`,
    [userId],
  );

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }: { data: { session: { user?: { id?: string } } | null } }) => {
      if (!alive) return;
      setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setNewsItems([]);
      setLoading(false);
      return () => { alive = false; };
    }
    (async () => {
      const raw = await AsyncStorage.getItem(newsStorageKey);
      if (!alive) return;
      const parsed = safeJsonParse<NewsItem[]>(raw, []);
      setNewsItems(parsed);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [newsStorageKey, userId]);

  const refreshNews = useCallback(async () => {
    if (!userId || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const [storedRaw, metaRaw] = await Promise.all([
        AsyncStorage.getItem(newsStorageKey),
        AsyncStorage.getItem(newsMetaKey),
      ]);
      const storedNews = safeJsonParse<NewsItem[]>(storedRaw, []);
      const nextMeta = buildNewsMeta(metaRaw);
      const newItems: NewsItem[] = [];
      const seenNewIds = new Set<string>();
      const now = new Date();
      const nowIso = now.toISOString();
      const nowMs = now.getTime();
      const lastStartMs = nextMeta.lastStartCheck ? new Date(nextMeta.lastStartCheck).getTime() : nowMs - START_WINDOW_MINUTES * 60 * 1000;
      const startWindowMs = Math.max(lastStartMs, nowMs - START_WINDOW_MINUTES * 60 * 1000);

      const pushItem = (item: NewsItem) => {
        if (seenNewIds.has(item.id)) return;
        seenNewIds.add(item.id);
        newItems.push(item);
      };

      const maybeAddStartEvent = (params: {
        kind: NewsCategory;
        sourceId: string;
        title: string;
        startAt: Date | null;
        hasTime: boolean;
        orgId?: string | null;
        orgName?: string | null;
        categoryLabel: string;
        changeKind?: string;
      }) => {
        if (!params.startAt || !params.hasTime) return;
        const startMs = params.startAt.getTime();
        if (!Number.isFinite(startMs)) return;
        if (startMs > nowMs || startMs <= startWindowMs) return;
        const startStamp = params.startAt.toISOString();
        const startKey = `start:${params.kind}:${params.sourceId}:${startStamp}`;
        if (nextMeta.seenStarts[startKey]) return;
        nextMeta.seenStarts[startKey] = startStamp;
        const createdAt = startStamp;
        const changeBase = params.changeKind ?? params.categoryLabel;
        const changeText = `Aenderung: ${changeBase} "${params.title}" startet`;
        pushItem({
          id: buildNewsId(params.kind, 'start', params.sourceId, startStamp),
          createdAt,
          orgId: params.orgId ?? null,
          orgName: params.orgName ?? 'Verein',
          category: params.kind,
          categoryLabel: params.categoryLabel,
          changeText,
          sourceId: params.sourceId,
          eventType: 'start',
        });
      };

      if (!supabaseUsingFallback) {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUserId = sessionData.session?.user?.id ?? null;
        if (sessionUserId) {
          const { data: memberships } = await supabase
            .from('organisation_members')
            .select('org_id, role')
            .eq('user_id', sessionUserId);
          const mems = (memberships ?? []) as { org_id: string; role: OrgRole }[];
          const orgIds = mems.map((m) => m.org_id);
          const roleByOrg: Record<string, OrgRole> = {};
          mems.forEach((m) => { roleByOrg[m.org_id] = m.role; });
          const { data: orgRows } = orgIds.length
            ? await supabase.from('organisations').select('id, name').in('id', orgIds)
            : { data: [] as any[] };
          const orgNameById = new Map<string, string>();
          (orgRows ?? []).forEach((row: any) => {
            if (row?.id) orgNameById.set(row.id, row.name ?? 'Verein');
          });
          const { data: groupRows } = await supabase
            .from('group_members')
            .select('group_id')
            .eq('user_id', sessionUserId);
          const groupIds = new Set((groupRows ?? []).map((row: any) => row.group_id).filter(Boolean));

          if (orgIds.length) {
            const annRes = await supabase
              .from('announcements')
              .select('id, org_id, group_id, author_id, title, body, event_date, created_at')
              .in('org_id', orgIds)
              .order('created_at', { ascending: false });
            const announcements = (annRes?.data ?? []) as AnnouncementRow[];
            announcements.forEach((ann) => {
              if (!ann?.id || !ann.org_id) return;
              if (ann.author_id && ann.author_id === sessionUserId) return;
              const role = roleByOrg[ann.org_id];
              if (ann.group_id && role !== 'director' && !groupIds.has(ann.group_id)) return;
              const key = `ann:${ann.id}`;
              const signature = signatureOf(ann.title, ann.body, ann.event_date);
              const prev = nextMeta.signatures[key];
              const orgName = orgNameById.get(ann.org_id) ?? 'Verein';
              if (!prev) {
                pushItem({
                  id: buildNewsId('announcement', 'new', ann.id, nowIso),
                  createdAt: nowIso,
                  orgId: ann.org_id,
                  orgName,
                  category: 'announcement',
                  categoryLabel: 'Ankuendigung',
                  changeText: `Aenderung: ${ann.title}`,
                  sourceId: ann.id,
                  eventType: 'new',
                });
              } else if (prev !== signature) {
                pushItem({
                  id: buildNewsId('announcement', 'update', ann.id, nowIso),
                  createdAt: nowIso,
                  orgId: ann.org_id,
                  orgName,
                  category: 'announcement',
                  categoryLabel: 'Ankuendigung',
                  changeText: `Aenderung: Ankuendigung aktualisiert "${ann.title}"`,
                  sourceId: ann.id,
                  eventType: 'update',
                });
              }
              nextMeta.signatures[key] = signature;
            });

            const assignmentRes = await supabase
              .from('assignments')
              .select('id, org_id, group_id, title, description, attachment_url, due_at, created_by, created_at')
              .in('org_id', orgIds);
            const assignments = (assignmentRes?.data ?? []) as AssignmentRow[];
            assignments.forEach((assignment) => {
              if (!assignment?.id || !assignment.org_id) return;
              if (assignment.created_by && assignment.created_by === sessionUserId) return;
              const role = roleByOrg[assignment.org_id];
              if (assignment.group_id && role !== 'director' && !groupIds.has(assignment.group_id)) return;
              const key = `asg:${assignment.id}`;
              const signature = signatureOf(
                assignment.title,
                assignment.description ?? '',
                assignment.due_at ?? '',
                assignment.group_id ?? '',
                assignment.attachment_url ?? '',
              );
              const orgName = orgNameById.get(assignment.org_id) ?? 'Verein';
              if (!nextMeta.signatures[key]) {
                pushItem({
                  id: buildNewsId('assignment', 'new', assignment.id, nowIso),
                  createdAt: nowIso,
                  orgId: assignment.org_id,
                  orgName,
                  category: 'assignment',
                  categoryLabel: 'Aufgabe',
                  changeText: `Aenderung: Neue Aufgabe "${assignment.title}"`,
                  sourceId: assignment.id,
                  eventType: 'new',
                });
              } else if (nextMeta.signatures[key] !== signature) {
                pushItem({
                  id: buildNewsId('assignment', 'update', assignment.id, nowIso),
                  createdAt: nowIso,
                  orgId: assignment.org_id,
                  orgName,
                  category: 'assignment',
                  categoryLabel: 'Aufgabe',
                  changeText: `Aenderung: Aufgabe aktualisiert "${assignment.title}"`,
                  sourceId: assignment.id,
                  eventType: 'update',
                });
              }
              nextMeta.signatures[key] = signature;
              if (assignment.due_at) {
                const startDate = new Date(assignment.due_at);
                const hasTime = hasExplicitTime(assignment.due_at);
                maybeAddStartEvent({
                  kind: 'assignment',
                  sourceId: assignment.id,
                  title: assignment.title ?? 'Aufgabe',
                  startAt: Number.isNaN(startDate.getTime()) ? null : startDate,
                  hasTime,
                  orgId: assignment.org_id,
                  orgName,
                  categoryLabel: 'Aufgabe',
                });
              }
            });

            const exerciseKeys = orgIds.map((orgId) => `${EXERCISE_STORAGE_BASE}:${orgId}`);
            const exerciseRaws = await Promise.all(exerciseKeys.map((key) => AsyncStorage.getItem(key)));
            exerciseRaws.forEach((raw, idx) => {
              const orgId = orgIds[idx];
              const orgName = orgNameById.get(orgId) ?? 'Verein';
              const exercises = safeJsonParse<Exercise[]>(raw, []);
              exercises.forEach((exercise) => {
                if (!exercise?.id) return;
                const key = `ex:${orgId}:${exercise.id}`;
                const signature = signatureOf(exercise.title, exercise.description ?? '', exercise.createdAt ?? '');
                if (!nextMeta.signatures[key]) {
                  pushItem({
                    id: buildNewsId('exercise', 'new', exercise.id, nowIso),
                    createdAt: nowIso,
                    orgId,
                    orgName,
                    category: 'exercise',
                    categoryLabel: 'Uebung',
                    changeText: `Aenderung: Neue Uebung "${exercise.title}"`,
                    sourceId: exercise.id,
                    eventType: 'new',
                  });
                } else if (nextMeta.signatures[key] !== signature) {
                  pushItem({
                    id: buildNewsId('exercise', 'update', exercise.id, nowIso),
                    createdAt: nowIso,
                    orgId,
                    orgName,
                    category: 'exercise',
                    categoryLabel: 'Uebung',
                    changeText: `Aenderung: Uebung aktualisiert "${exercise.title}"`,
                    sourceId: exercise.id,
                    eventType: 'update',
                  });
                }
                nextMeta.signatures[key] = signature;
              });
            });

            const queueRes = await supabase
              .from('calendar_sync_queue')
              .select('id, event_payload, org_id')
              .in('org_id', orgIds);
            const queueRows = (queueRes?.data ?? []) as any[];
            queueRows.forEach((row) => {
              const payload = (row?.event_payload ?? null) as {
                id?: string;
                title?: string;
                start?: string;
                orgId?: string | null;
              } | null;
              const startRaw = payload?.start ?? '';
              if (!startRaw || !hasExplicitTime(startRaw)) return;
              const startDate = new Date(startRaw);
              if (Number.isNaN(startDate.getTime())) return;
              const orgId = payload?.orgId ?? row?.org_id ?? null;
              const orgName = orgId ? (orgNameById.get(orgId) ?? 'Verein') : 'Verein';
              const sourceId = payload?.id ?? row?.id ?? startRaw;
              maybeAddStartEvent({
                kind: 'event',
                sourceId,
                title: payload?.title ?? 'Termin',
                startAt: startDate,
                hasTime: true,
                orgId,
                orgName,
                categoryLabel: 'Termin',
              });
            });
          }

          const tasklistTasks: Array<{ listId: string; task: Task }> = [];
          try {
            const listRes = await supabase
              .from('task_lists')
              .select('id, name')
              .eq('user_id', sessionUserId)
              .eq('kind', 'user');
            const listRows = (listRes?.data ?? []) as Array<{ id: string; name: string }>;
            const listIds = listRows.map((row) => row.id).filter(Boolean);
            if (listIds.length) {
              const taskRes = await supabase
                .from('tasks')
                .select('id, list_id, title, description, start_at, due_at, done, created_at, priority')
                .in('list_id', listIds);
              const taskRows = (taskRes?.data ?? []) as any[];
              taskRows.forEach((row) => {
                if (!row?.id || !row?.list_id) return;
                const startAt = row.start_at ? toDateTimeString(new Date(row.start_at)) : undefined;
                const endAt = row.due_at ? toDateTimeString(new Date(row.due_at)) : undefined;
                tasklistTasks.push({
                  listId: row.list_id,
                  task: {
                    id: row.id,
                    title: row.title ?? '',
                    description: row.description ?? undefined,
                    startAt,
                    endAt,
                    done: !!row.done,
                    createdAt: row.created_at ? toDateTimeString(new Date(row.created_at)) : undefined,
                    priority: row.priority ?? undefined,
                  },
                });
              });
            }
          } catch {
            // fall back to storage below
          }

          if (!tasklistTasks.length) {
            const storageKey = `${TASKLIST_STORAGE_BASE}:${sessionUserId}`;
            const raw = await AsyncStorage.getItem(storageKey);
            const lists = safeJsonParse<TaskList[]>(raw, []);
            lists.forEach((list) => {
              (list.tasks ?? []).forEach((task) => {
                tasklistTasks.push({ listId: list.id, task });
              });
            });
          }

          tasklistTasks.forEach(({ listId, task }) => {
            if (!task?.id || task.done) return;
            const key = `task:${listId}:${task.id}`;
            const signature = signatureOf(
              task.title,
              task.description ?? '',
              task.startAt ?? '',
              task.endAt ?? '',
              task.priority ?? '',
            );
            if (!nextMeta.signatures[key]) {
              pushItem({
                id: buildNewsId('tasklist', 'new', task.id, nowIso),
                createdAt: nowIso,
                orgId: null,
                orgName: 'Persoenlich',
                category: 'tasklist',
                categoryLabel: 'Aufgabe (Tasklist)',
                changeText: `Aenderung: Neue Aufgabe "${task.title}"`,
                sourceId: task.id,
                eventType: 'new',
              });
            } else if (nextMeta.signatures[key] !== signature) {
              pushItem({
                id: buildNewsId('tasklist', 'update', task.id, nowIso),
                createdAt: nowIso,
                orgId: null,
                orgName: 'Persoenlich',
                category: 'tasklist',
                categoryLabel: 'Aufgabe (Tasklist)',
                changeText: `Aenderung: Aufgabe aktualisiert "${task.title}"`,
                sourceId: task.id,
                eventType: 'update',
              });
            }
            nextMeta.signatures[key] = signature;

            const startInfo = parseTaskDateTime(task.startAt);
            const endInfo = parseTaskDateTime(task.endAt);
            const startCandidate = startInfo?.hasTime ? startInfo : endInfo?.hasTime ? endInfo : null;
            if (startCandidate?.date) {
              maybeAddStartEvent({
                kind: 'tasklist',
                sourceId: `${listId}:${task.id}`,
                title: task.title ?? 'Aufgabe',
                startAt: startCandidate.date,
                hasTime: true,
                orgId: null,
                orgName: 'Persoenlich',
                categoryLabel: 'Aufgabe (Tasklist)',
                changeKind: 'Aufgabe',
              });
            }
          });

          const personalRes = await supabase
            .from('personal_calendar_events')
            .select('id, title, start')
            .eq('user_id', sessionUserId);
          const personalRows = (personalRes?.data ?? []) as any[];
          personalRows.forEach((row) => {
            const startRaw = row?.start;
            if (!startRaw || !hasExplicitTime(startRaw)) return;
            const startDate = new Date(startRaw);
            if (Number.isNaN(startDate.getTime())) return;
            maybeAddStartEvent({
              kind: 'event',
              sourceId: `personal:${row.id}`,
              title: row.title ?? 'Termin',
              startAt: startDate,
              hasTime: true,
              orgId: null,
              orgName: 'Persoenlich',
              categoryLabel: 'Termin',
            });
          });
        }
      }

      nextMeta.lastStartCheck = nowIso;

      const merged = [...newItems, ...storedNews].filter((item) => !!item?.id);
      const deduped: NewsItem[] = [];
      const seen = new Set<string>();
      merged.forEach((item) => {
        if (seen.has(item.id)) return;
        seen.add(item.id);
        deduped.push(item);
      });
      deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const limited = deduped.slice(0, MAX_NEWS_ITEMS);

      setNewsItems(limited);
      await AsyncStorage.setItem(newsStorageKey, JSON.stringify(limited));
      await AsyncStorage.setItem(newsMetaKey, JSON.stringify(nextMeta));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [newsMetaKey, newsStorageKey, userId]);

  useFocusEffect(
    useCallback(() => {
      refreshNews();
    }, [refreshNews]),
  );

  const handleItemPress = (item: NewsItem) => {
    if (item.category === 'tasklist') {
      router.push('/tasklist');
      return;
    }
    if (item.category === 'event') {
      router.push('/calender');
      return;
    }
    router.push('/');
  };

  const renderItem = ({ item }: { item: NewsItem }) => (
    <Pressable
      onPress={() => handleItemPress(item)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardOrg}>{item.orgName ?? 'Verein'}</Text>
        <Text style={styles.cardTime}>{formatDateTime(item.createdAt)}</Text>
      </View>
      <Text style={styles.cardType}>{item.categoryLabel}</Text>
      <Text style={styles.cardChange}>{item.changeText}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Text style={styles.title}>Neuigkeiten</Text>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#9FE1C7" />
          </View>
        ) : (
          <FlatList
            data={newsItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshNews} tintColor="#9FE1C7" />}
            ListEmptyComponent={<Text style={styles.emptyText}>Keine Neuigkeiten verfuegbar.</Text>}
            contentContainerStyle={newsItems.length ? undefined : styles.emptyContainer}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#112a37',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: '#112a37',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#E5F4EF',
    marginBottom: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyText: {
    color: '#9CA3AF',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#0F2530',
    borderWidth: 1,
    borderColor: '#2A3E48',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardOrg: {
    color: '#9FE1C7',
    fontWeight: '700',
    fontSize: 13,
  },
  cardTime: {
    color: '#8EA3B2',
    fontSize: 12,
  },
  cardType: {
    color: '#E5F4EF',
    fontWeight: '700',
    fontSize: 16,
    marginTop: 6,
  },
  cardChange: {
    color: '#C7D2D6',
    marginTop: 4,
  },
});
