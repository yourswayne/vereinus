import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { supabase, supabaseUsingFallback } from '../lib/supabase';

type EventScope = 'org' | 'group' | 'user';
type NewsCategory = 'announcement' | 'assignment' | 'exercise' | 'task' | 'event';
type NewsEventType = 'new' | 'update' | 'start';

type ActivityEventRow = {
  id: string;
  event_type: string;
  category: NewsCategory;
  scope: EventScope;
  org_id: string | null;
  group_id: string | null;
  user_id: string | null;
  actor_id: string | null;
  source_table: string;
  source_id: string;
  title: string | null;
  message: string | null;
  starts_at: string | null;
  payload: any;
  created_at: string;
};

type NewsItem = {
  id: string;
  createdAt: string;
  orgId?: string | null;
  orgName?: string | null;
  category: NewsCategory;
  categoryLabel: string;
  changeText: string;
  eventType: NewsEventType;
  scope: EventScope;
};

const NEWS_CACHE_BASE = '@vereinus/news_cache';
const FEED_LIMIT = 200;
const RETENTION_DAYS = 90;

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
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

const isStartEvent = (eventType: string) => eventType.endsWith('_start');
const isCreatedEvent = (eventType: string) => eventType.endsWith('_created');
const isUpdatedEvent = (eventType: string) => eventType.endsWith('_updated');

const toNewsEventType = (eventType: string): NewsEventType => {
  if (isStartEvent(eventType)) return 'start';
  if (isCreatedEvent(eventType)) return 'new';
  if (isUpdatedEvent(eventType)) return 'update';
  return 'update';
};

const baseKindForCategory = (category: NewsCategory) => {
  if (category === 'announcement') return 'Ankündigung';
  if (category === 'assignment') return 'Aufgabe';
  if (category === 'exercise') return 'Übung';
  if (category === 'task') return 'Aufgabe';
  return 'Termin';
};

const categoryLabelForEvent = (category: NewsCategory, scope: EventScope) => {
  if (category === 'task' && scope === 'user') return 'Aufgabe (Tasklist)';
  return baseKindForCategory(category);
};

const buildChangeText = (eventType: string, baseKind: string, title: string) => {
  if (isStartEvent(eventType)) return `Änderung: ${baseKind} "${title}" startet`;
  if (isUpdatedEvent(eventType)) return `Änderung: ${baseKind} aktualisiert "${title}"`;
  if (isCreatedEvent(eventType)) return `Änderung: Neue ${baseKind} "${title}"`;
  return `Änderung: ${baseKind} aktualisiert "${title}"`;
};

const buildOrgName = (orgId: string | null, orgNameById: Map<string, string>) => {
  if (!orgId) return 'Persönlich';
  return orgNameById.get(orgId) ?? 'Verein';
};

const buildNewsItem = (
  event: ActivityEventRow,
  orgNameById: Map<string, string>,
  userId: string,
  nowMs: number,
): NewsItem | null => {
  if (event.actor_id && event.actor_id === userId && event.scope !== 'user') return null;

  const title = event.title?.trim() || event.message?.trim() || 'Ohne Titel';
  const startMs = event.starts_at ? new Date(event.starts_at).getTime() : null;
  const isStart = isStartEvent(event.event_type);
  if (isStart) {
    if (!event.starts_at || startMs === null || Number.isNaN(startMs)) return null;
    if (startMs > nowMs) return null;
  }

  const effectiveIso = isStart && event.starts_at ? event.starts_at : event.created_at;
  const effectiveMs = new Date(effectiveIso).getTime();
  if (!Number.isFinite(effectiveMs)) return null;

  const cutoffMs = nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (effectiveMs < cutoffMs) return null;

  const baseKind = baseKindForCategory(event.category);
  const categoryLabel = categoryLabelForEvent(event.category, event.scope);
  const changeText = buildChangeText(event.event_type, baseKind, title);

  return {
    id: event.id,
    createdAt: effectiveIso,
    orgId: event.org_id ?? null,
    orgName: buildOrgName(event.org_id ?? null, orgNameById),
    category: event.category,
    categoryLabel,
    changeText,
    eventType: toNewsEventType(event.event_type),
    scope: event.scope,
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

  const cacheKey = useMemo(
    () => `${NEWS_CACHE_BASE}:${userId ?? 'anon'}`,
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
      const raw = await AsyncStorage.getItem(cacheKey);
      if (!alive) return;
      setNewsItems(safeJsonParse<NewsItem[]>(raw, []));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [cacheKey, userId]);

  const refreshNews = useCallback(async () => {
    if (!userId || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const cacheRaw = await AsyncStorage.getItem(cacheKey);
      const cached = safeJsonParse<NewsItem[]>(cacheRaw, []);

      if (supabaseUsingFallback) {
        setNewsItems(cached);
        return;
      }

      const { data, error } = await supabase
        .from('activity_events')
        .select('id,event_type,category,scope,org_id,group_id,user_id,actor_id,source_table,source_id,title,message,starts_at,payload,created_at')
        .order('created_at', { ascending: false })
        .limit(FEED_LIMIT);

      if (error) throw error;

      const events = (data ?? []) as ActivityEventRow[];
      const orgIds = Array.from(new Set(events.map((e) => e.org_id).filter(Boolean))) as string[];
      const orgNameById = new Map<string, string>();

      if (orgIds.length) {
        const { data: orgRows } = await supabase
          .from('organisations')
          .select('id,name')
          .in('id', orgIds);
        (orgRows ?? []).forEach((row: any) => {
          if (row?.id) orgNameById.set(row.id, row.name ?? 'Verein');
        });
      }

      const nowMs = Date.now();
      const items = events
        .map((event) => buildNewsItem(event, orgNameById, userId, nowMs))
        .filter((item): item is NewsItem => !!item);

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const limited = items.slice(0, FEED_LIMIT);

      setNewsItems(limited);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(limited));

      if (limited.length) {
        const seenPayload = limited.map((item) => ({ user_id: userId, event_id: item.id }));
        await supabase
          .from('activity_seen')
          .upsert(seenPayload as any, { onConflict: 'user_id,event_id', returning: 'minimal' } as any);
      }
    } catch {
      const fallbackRaw = await AsyncStorage.getItem(cacheKey);
      setNewsItems(safeJsonParse<NewsItem[]>(fallbackRaw, []));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [cacheKey, userId]);

  useFocusEffect(
    useCallback(() => {
      refreshNews();
    }, [refreshNews]),
  );

  const handleItemPress = (item: NewsItem) => {
    if (item.category === 'task') {
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
      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 12) }]}
      >
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
            ListEmptyComponent={<Text style={styles.emptyText}>Keine Neuigkeiten verfügbar.</Text>}
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
