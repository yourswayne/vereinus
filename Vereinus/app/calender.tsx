import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

type CalendarViewMode = 'week' | 'month' | 'year';
type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  orgId?: string | null;
  scope: 'self' | 'org';
  readOnly?: boolean;
  source?: 'local' | 'remote';
};
type MonthCell = { date: Date; inMonth: boolean };
type EventDraft = {
  title: string;
  description: string;
  start: Date;
  end: Date;
  orgId: string | null;
  scope: 'self' | 'org';
};

type OrgRole = 'director' | 'teacher' | 'student';

const TIME_COLUMN_WIDTH = 50;
const MIN_HOUR_HEIGHT = 32;
const MAX_HOUR_HEIGHT = 120;
const INITIAL_HOUR_HEIGHT = 64;
const HOUR_SLOTS = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  label: `${hour.toString().padStart(2, '0')}:00`,
}));
const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_LABELS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
const addDays = (date: Date, amt: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amt);
  return next;
};
const startOfWeek = (date: Date) => {
  const next = new Date(date);
  const day = (next.getDay() + 6) % 7; // Monday first
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - day);
  return next;
};
const addWeeks = (date: Date, amt: number) => addDays(date, amt * 7);
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const formatWeekRange = (start: Date) => {
  const end = addDays(start, 6);
  const fmt = (d: Date) => `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}.`;
  return `${fmt(start)} - ${fmt(end)}`;
};
const buildMonthMatrix = (reference: Date): MonthCell[][] => {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const cells: MonthCell[] = [];
  for (let idx = 0; idx < totalCells; idx += 1) {
    const dayNum = idx - leading + 1;
    const cellDate = new Date(year, month, dayNum);
    cells.push({
      date: cellDate,
      inMonth: dayNum >= 1 && dayNum <= daysInMonth,
    });
  }
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
};
const formatTime = (date: Date) =>
  `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
const formatWeekdayLabel = (date: Date) => DAY_LABELS[(date.getDay() + 6) % 7];
const formatLongDate = (date: Date) =>
  `${formatWeekdayLabel(date)}, ${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}.${date.getFullYear()}`;
const formatTimeRange = (start: Date, end: Date) => `${formatTime(start)} - ${formatTime(end)}`;

export default function Calender() {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [referenceDate, setReferenceDate] = useState(new Date());
  const [hourHeight, setHourHeight] = useState(INITIAL_HOUR_HEIGHT);
  const pinchStartHeight = useRef(hourHeight);
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>([]);
  const [remoteEvents, setRemoteEvents] = useState<CalendarEvent[]>([]);
  const events = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    [...remoteEvents, ...localEvents].forEach((evt) => {
      const key = `${evt.id}-${evt.start}`;
      map.set(key, evt);
    });
    return Array.from(map.values());
  }, [remoteEvents, localEvents]);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(referenceDate.getFullYear());
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [roleByOrg, setRoleByOrg] = useState<Record<string, OrgRole>>({});
  const [eventDetail, setEventDetail] = useState<CalendarEvent | null>(null);
  const [timePickerField, setTimePickerField] = useState<'start' | 'end' | null>(null);
  const [timePickerValue, setTimePickerValue] = useState(new Date());
  const [gridWidth, setGridWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const handleScopeChange = (scope: EventDraft['scope']) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      if (scope === 'self') {
        return { ...prev, scope, orgId: null };
      }
      return { ...prev, scope };
    });
  };

  const [now, setNow] = useState(new Date());
  const weekStart = useMemo(() => startOfWeek(referenceDate), [referenceDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx)), [weekStart]);
  const isCurrentWeek = useMemo(() => {
    const start = startOfWeek(now);
    return start.getTime() === weekStart.getTime();
  }, [now, weekStart]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const refreshPersonalEvents = useCallback(async () => {
    if (!sessionUserId) {
      setLocalEvents([]);
      return;
    }
    const { data, error } = await supabase
      .from('personal_calendar_events')
      .select('id,title,description,start,end')
      .eq('user_id', sessionUserId)
      .order('start', { ascending: true });
    if (error) {
      setLocalEvents([]);
      return;
    }
    const mapped: CalendarEvent[] = (data ?? []).map((row: any) => ({
      id: row.id,
      title: row.title ?? '',
      description: row.description ?? '',
      start: new Date(row.start).toISOString(),
      end: new Date(row.end).toISOString(),
      orgId: null,
      scope: 'self',
      readOnly: false,
      source: 'remote',
    }));
    setLocalEvents(mapped);
  }, [sessionUserId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      setSessionUserId(userId ?? null);
      if (!userId) {
        if (!alive) return;
        setOrgs([]);
        setRoleByOrg({});
        return;
      }
      const { data: memberships } = await supabase
        .from('organisation_members')
        .select('org_id, role')
        .eq('user_id', userId);
      if (!alive) return;
      const mems = (memberships ?? []) as { org_id: string; role: OrgRole }[];
      const roleMap: Record<string, OrgRole> = {};
      mems.forEach((mem) => {
        roleMap[mem.org_id] = mem.role;
      });
      setRoleByOrg(roleMap);
      if (!mems.length) {
        setOrgs([]);
        return;
      }
      const orgIds = mems.map((m) => m.org_id);
      const { data: orgRows } = await supabase.from('organisations').select('id, name').in('id', orgIds);
      if (!alive) return;
      setOrgs((orgRows ?? []) as { id: string; name: string }[]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refreshRemoteEvents = useCallback(async () => {
    if (!orgs.length) {
      setRemoteEvents([]);
      return;
    }
    const orgIds = orgs.map((org) => org.id);
    const rangeStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from('calendar_sync_queue')
      .select('id,event_payload,org_id,created_at')
      .in('org_id', orgIds)
      .order('created_at', { ascending: true });
    if (error) {
      setRemoteEvents([]);
      return;
    }
    const eventsMap = new Map<string, CalendarEvent>();
    (data ?? []).forEach((row: any) => {
      const payload = (row.event_payload ?? null) as {
        id?: string;
        title?: string;
        description?: string | null;
          start?: string;
          end?: string;
          orgId?: string | null;
          scope?: 'self' | 'org';
        } | null;
        if (!payload?.start) return null;
        const start = new Date(payload.start);
        if (Number.isNaN(start.getTime())) return null;
        if (start < rangeStart || start > rangeEnd) return null;
        let end = payload.end ? new Date(payload.end) : null;
        if (!end || Number.isNaN(end.getTime())) end = new Date(start.getTime() + 60 * 60 * 1000);
        const baseId = payload.id ?? `remote-${row.id}`;
        const event: CalendarEvent = {
          id: baseId,
          title: payload.title ?? 'Termin',
          description: payload.description ?? '',
          start: start.toISOString(),
          end: end.toISOString(),
          orgId: payload.orgId ?? row.org_id ?? null,
          scope: payload.scope ?? 'org',
          readOnly: true,
          source: 'remote',
        };
        eventsMap.set(baseId, event);
      });
    setRemoteEvents(Array.from(eventsMap.values()));
  }, [orgs]);

  useEffect(() => {
    refreshRemoteEvents();
  }, [refreshRemoteEvents]);

  useEffect(() => {
    refreshPersonalEvents();
  }, [refreshPersonalEvents]);

  useFocusEffect(
    useCallback(() => {
      refreshRemoteEvents();
    }, [refreshRemoteEvents]),
  );

  useEffect(() => {
    if (!orgs.length) return undefined;
    const orgSet = new Set(orgs.map((org) => org.id));
    if (!orgSet.size) return undefined;
    const channel = supabase
      .channel('calendar-sync-all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_sync_queue' },
        (payload: { new?: { org_id?: string | null } | null; old?: { org_id?: string | null } | null }) => {
          const targetOrg = (payload.new?.org_id ?? payload.old?.org_id) as string | null;
          if (targetOrg && orgSet.has(targetOrg)) {
            refreshRemoteEvents();
          }
        },
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [orgs, refreshRemoteEvents]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          viewMode === 'week' && Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 12,
        onPanResponderRelease: (_evt, gesture) => {
          if (viewMode !== 'week') return;
          if (gesture.dx < -40) setReferenceDate((prev) => addWeeks(prev, 1));
          if (gesture.dx > 40) setReferenceDate((prev) => addWeeks(prev, -1));
        },
      }),
    [viewMode],
  );

  const handlePinchEvent = useCallback((event: any) => {
    if (event.nativeEvent.state !== State.ACTIVE) return;
    const scale = event.nativeEvent.scale ?? 1;
    const nextHeight = clamp(pinchStartHeight.current * scale, MIN_HOUR_HEIGHT, MAX_HOUR_HEIGHT);
    setHourHeight(nextHeight);
  }, []);

  const handlePinchStateChange = useCallback(
    (event: any) => {
      if (event.nativeEvent.state === State.BEGAN) {
        pinchStartHeight.current = hourHeight;
      }
      if (
        event.nativeEvent.state === State.END ||
        event.nativeEvent.state === State.CANCELLED ||
        event.nativeEvent.state === State.FAILED
      ) {
        pinchStartHeight.current = hourHeight;
      }
    },
    [hourHeight],
  );

  const openSlotComposer = useCallback(
    (day: Date, hour: number) => {
      const start = new Date(day);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(hour + 1);
      setEventDraft({
        title: '',
        description: '',
        start,
        end,
        orgId: orgs[0]?.id ?? null,
        scope: 'self',
      });
      setEditingEventId(null);
      setEventDetail(null);
      setTimePickerField(null);
      setTimePickerValue(start);
      setEventModalVisible(true);
    },
    [orgs],
  );

  const saveEvent = useCallback(async () => {
    if (!eventDraft) return;
    if (!eventDraft.title.trim()) {
      Alert.alert('Titel fehlt', 'Bitte gib dem Termin einen Titel.');
      return;
    }
    if (eventDraft.scope === 'org' && eventDraft.orgId && roleByOrg[eventDraft.orgId] !== 'director') {
      Alert.alert('Keine Berechtigung', 'Nur Direktoren können Termine für den gesamten Verein veröffentlichen.');
      return;
    }
    if (eventDraft.scope === 'org' && !eventDraft.orgId) {
      Alert.alert('Verein fehlt', 'Bitte wähle einen Verein aus.');
      return;
    }
    if (eventDraft.scope === 'self' && !sessionUserId) {
      Alert.alert('Login erforderlich', 'Bitte melde dich an, um persönliche Termine zu speichern.');
      return;
    }
    const eventId = editingEventId ?? `${Date.now()}`;
    const payload: CalendarEvent = {
      id: eventId,
      title: eventDraft.title.trim(),
      description: eventDraft.description.trim(),
      start: eventDraft.start.toISOString(),
      end: eventDraft.end.toISOString(),
      orgId: eventDraft.orgId,
      scope: eventDraft.scope,
      readOnly: false,
      source: 'local',
    };
    if (eventDraft.scope === 'self' && sessionUserId) {
      if (editingEventId) {
        const { data, error } = await supabase
          .from('personal_calendar_events')
          .update({
            title: payload.title,
            description: payload.description,
            start: payload.start,
            end: payload.end,
          })
          .eq('id', editingEventId)
          .eq('user_id', sessionUserId)
          .select('id,title,description,start,end')
          .single();
        if (!error && data) {
          payload.id = data.id;
          payload.start = new Date(data.start).toISOString();
          payload.end = new Date(data.end).toISOString();
          setLocalEvents((prev) => prev.map((evt) => (evt.id === editingEventId ? payload : evt)));
        }
      } else {
        const { data, error } = await supabase
          .from('personal_calendar_events')
          .insert({
            user_id: sessionUserId,
            title: payload.title,
            description: payload.description,
            start: payload.start,
            end: payload.end,
          })
          .select('id,title,description,start,end')
          .single();
        if (!error && data) {
          payload.id = data.id;
          payload.start = new Date(data.start).toISOString();
          payload.end = new Date(data.end).toISOString();
          setLocalEvents((prev) => [...prev, payload]);
        }
      }
    } else {
      // org scope: keep localEvents unchanged; remote fetch will refresh
    }
    // close event modal inline to avoid referencing a callback declared later
    setEventModalVisible(false);
    setEventDraft(null);
    setEditingEventId(null);
    if (eventDraft.scope === 'org' && eventDraft.orgId) {
      try {
        await supabase
          .from('calendar_sync_queue')
          .insert({
            event_payload: payload,
            org_id: eventDraft.orgId,
          });
        refreshRemoteEvents();
      } catch {
        // queue table optional during prototype
      }
    } else {
      refreshPersonalEvents();
    }
  }, [editingEventId, eventDraft, roleByOrg, sessionUserId, refreshPersonalEvents, refreshRemoteEvents]);

  const upcomingEventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((evt) => {
      const key = new Date(evt.start).toDateString();
      const list = map.get(key) ?? [];
      list.push(evt);
      map.set(key, list);
    });
    return map;
  }, [events]);

  const openMonthSwitcher = useCallback(() => {
    setPickerYear(referenceDate.getFullYear());
    setShowMonthPicker(true);
  }, [referenceDate]);

  const goToWeekOfDate = useCallback((targetDate: Date) => {
    setReferenceDate(new Date(targetDate));
    setViewMode('week');
  }, []);

  const jumpToCurrentWeek = useCallback(() => {
    const current = new Date();
    setReferenceDate(current);
    setViewMode('week');
  }, []);

  const openEventDetail = useCallback((event: CalendarEvent) => {
    setEventDetail(event);
  }, []);

  const closeEventDetail = useCallback(() => {
    setEventDetail(null);
  }, []);

  const beginEditEvent = useCallback((event: CalendarEvent) => {
    setEventDraft({
      title: event.title,
      description: event.description ?? '',
      start: new Date(event.start),
      end: new Date(event.end),
      orgId: event.orgId ?? null,
      scope: event.scope,
    });
    setEditingEventId(event.id);
    setTimePickerField(null);
    setTimePickerValue(new Date(event.start));
    setEventModalVisible(true);
  }, []);

  const handleEditFromDetail = useCallback(() => {
    if (!eventDetail || eventDetail.readOnly) return;
    beginEditEvent(eventDetail);
    setEventDetail(null);
  }, [beginEditEvent, eventDetail]);

  const deleteEvent = useCallback(async (evt: CalendarEvent) => {
    if (evt.scope === 'self') {
      if (!sessionUserId) {
        Alert.alert('Login erforderlich', 'Bitte melde dich an, um Termine zu löschen.');
        return false;
      }
      const { error } = await supabase
        .from('personal_calendar_events')
        .delete()
        .eq('id', evt.id)
        .eq('user_id', sessionUserId);
      if (error) {
        Alert.alert('Fehler', 'Termin konnte nicht gelöscht werden.');
        return false;
      }
      setLocalEvents((prev) => prev.filter((e) => e.id !== evt.id));
      return true;
    }
    if (evt.scope === 'org' && evt.orgId) {
      if (roleByOrg[evt.orgId] !== 'director') {
        Alert.alert('Keine Berechtigung', 'Nur Direktoren können Vereins-Termine löschen.');
        return false;
      }
      try {
        await supabase
          .from('calendar_sync_queue')
          .delete()
          .eq('org_id', evt.orgId)
          .or(`event_payload->>id.eq.${evt.id}`);
        refreshRemoteEvents();
        return true;
      } catch {
        Alert.alert('Fehler', 'Termin konnte nicht gelöscht werden.');
        return false;
      }
    }
    return false;
  }, [refreshRemoteEvents, roleByOrg, sessionUserId]);

  const closeEventModal = useCallback(() => {
    setEventModalVisible(false);
    setEventDraft(null);
    setEditingEventId(null);
    setTimePickerField(null);
  }, []);

  const applyTimeToDraft = useCallback((field: 'start' | 'end', picked: Date) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      const target = field === 'start' ? new Date(prev.start) : new Date(prev.end);
      target.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      return field === 'start' ? { ...prev, start: target } : { ...prev, end: target };
    });
  }, []);

  const openTimePicker = useCallback(
    (field: 'start' | 'end') => {
      if (!eventDraft) return;
      if (Platform.OS === 'ios') return;
      setTimePickerField(field);
      setTimePickerValue(new Date(field === 'start' ? eventDraft.start : eventDraft.end));
    },
    [eventDraft],
  );

  const handleTimePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS !== 'ios' && event.type === 'dismissed') {
        setTimePickerField(null);
        return;
      }
      if (!selectedDate || !timePickerField) return;
      setTimePickerValue(selectedDate);
      applyTimeToDraft(timePickerField, selectedDate);
      if (Platform.OS !== 'ios') setTimePickerField(null);
    },
    [applyTimeToDraft, timePickerField],
  );

  const monthMatrix = useMemo(() => buildMonthMatrix(referenceDate), [referenceDate]);
  const yearMatrices = useMemo(
    () => MONTH_LABELS.map((_label, idx) => buildMonthMatrix(new Date(referenceDate.getFullYear(), idx, 1))),
    [referenceDate],
  );

  const currentDayIndex = useMemo(() => weekDays.findIndex((d) => isSameDay(d, now)), [now, weekDays]);
  const detailStart = eventDetail ? new Date(eventDetail.start) : null;
  const detailEnd = eventDetail ? new Date(eventDetail.end) : null;
  const modalStartDate = eventDraft ? new Date(eventDraft.start) : new Date();
  const modalEndDate = eventDraft ? new Date(eventDraft.end) : new Date();
  const dayColumnWidth = useMemo(() => {
    const usable = gridWidth - TIME_COLUMN_WIDTH;
    return usable > 0 ? usable / 7 : 0;
  }, [gridWidth]);

  const eventsThisWeek = useMemo(() => {
    const rangeStart = weekStart.getTime();
    const rangeEnd = addDays(weekStart, 7).getTime();
    return events.filter((evt) => {
      const start = new Date(evt.start).getTime();
      return start >= rangeStart && start < rangeEnd;
    });
  }, [events, weekStart]);

  const weekEventLayouts = useMemo(() => {
    const layouts: { event: CalendarEvent; dayIndex: number; top: number; height: number }[] = [];
    eventsThisWeek.forEach((evt) => {
      const startDate = new Date(evt.start);
      const endDate = new Date(evt.end);
      const dayIndex = weekDays.findIndex((d) => isSameDay(d, startDate));
      if (dayIndex === -1) return;
      const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
      const endMinutesRaw = endDate.getHours() * 60 + endDate.getMinutes();
      const endMinutes = Math.max(endMinutesRaw, startMinutes + 15);
      const clampedStart = Math.max(0, Math.min(startMinutes, 24 * 60));
      const clampedEnd = Math.max(clampedStart + 15, Math.min(endMinutes, 24 * 60));
      const durationHours = (clampedEnd - clampedStart) / 60;
      layouts.push({
        event: evt,
        dayIndex,
        top: (clampedStart / 60) * hourHeight,
        height: durationHours * hourHeight,
      });
    });
    return layouts;
  }, [eventsThisWeek, weekDays, hourHeight]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={openMonthSwitcher} style={styles.headerPressable}>
            <Text style={styles.monthLabel}>{`${MONTH_LABELS[referenceDate.getMonth()]} ${referenceDate.getFullYear()}`}</Text>
            {viewMode === 'week' && <Text style={styles.weekRangeLabel}>{formatWeekRange(weekStart)} </Text>}
          </Pressable>
          <View style={styles.headerActionsRow}>
            <TouchableOpacity style={styles.todayButton} onPress={jumpToCurrentWeek}>
              <Text style={styles.todayButtonText}>Heute</Text>
            </TouchableOpacity>
            <View style={styles.viewSwitchRow}>
              {(['week', 'month', 'year'] as CalendarViewMode[]).map((mode) => (
                <Pressable
                  key={mode}
                onPress={() => setViewMode(mode)}
                style={[styles.viewSwitchButton, viewMode === mode && styles.viewSwitchButtonActive]}
              >
                <Text style={[styles.viewSwitchText, viewMode === mode && styles.viewSwitchTextActive]}>
                  {mode === 'week' ? 'Woche' : mode === 'month' ? 'Monat' : 'Jahr'}
                </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {viewMode === 'week' && (
          <>
            <View style={styles.dayHeaderRow}>
              <View style={styles.timeSpacer}>
                <Text style={styles.timeLabel}>Zeit</Text>
              </View>
              {weekDays.map((day, idx) => (
                <View
                  key={day.toISOString()}
                  style={[styles.dayHeaderCell, idx === currentDayIndex && styles.dayHeaderCellActive]}
                >
                  <Text style={styles.dayHeaderText}>{DAY_LABELS[idx]}</Text>
                  <Text style={styles.dayHeaderNumber}>{day.getDate()}</Text>
                </View>
              ))}
            </View>

            <PinchGestureHandler onGestureEvent={handlePinchEvent} onHandlerStateChange={handlePinchStateChange}>
              <View style={styles.gestureWrapper} {...panResponder.panHandlers}>
                <ScrollView
                  ref={scrollRef}
                  style={styles.gridScroll}
                  contentContainerStyle={styles.gridContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View
                    style={styles.gridAbsoluteWrapper}
                    onLayout={(evt) => setGridWidth(evt.nativeEvent.layout.width)}
                  >
                    {HOUR_SLOTS.map(({ hour, label }) => (
                      <View key={label} style={styles.gridRow}>
                        <View style={[styles.timeColumn, { height: hourHeight }]} />
                        {weekDays.map((day) => (
                          <Pressable
                            key={`${day.toISOString()}-${label}`}
                            style={[styles.gridCell, { height: hourHeight }]}
                            onPress={() => openSlotComposer(day, hour)}
                          />
                        ))}
                      </View>
                    ))}

                    <View pointerEvents="none" style={styles.timeLabelsOverlay}>
                      {HOUR_SLOTS.map(({ hour, label }) => (
                        <Text
                          key={`label-${label}`}
                          style={[
                            styles.timeLabelAbsolute,
                            {
                              top: Math.max(0, hour * hourHeight - 6),
                            },
                          ]}
                        >
                          {label}
                        </Text>
                      ))}
                    </View>

                    {isCurrentWeek && (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.nowIndicatorLine,
                          {
                            top: (now.getHours() + now.getMinutes() / 60) * hourHeight,
                          },
                        ]}
                      />
                    )}

                    {dayColumnWidth > 0 && weekEventLayouts.length > 0 && (
                      <View pointerEvents="box-none" style={styles.eventOverlay}>
                        {weekEventLayouts.map((layout, idx) => (
                          <Pressable
                            key={`${layout.event.id}-${layout.event.start}-${idx}`}
                            style={[
                              styles.eventBlock,
                              {
                                left: TIME_COLUMN_WIDTH + layout.dayIndex * dayColumnWidth + 2,
                                width: Math.max(dayColumnWidth - 8, 0) + 4,
                                top: layout.top,
                                height: Math.max(layout.height, 24),
                              },
                            ]}
                            onPress={() => openEventDetail(layout.event)}
                          >
                            <Text numberOfLines={1} style={styles.eventBlockTitle}>
                              {layout.event.title}
                            </Text>
                            {!!layout.event.description && (
                              <Text numberOfLines={1} style={styles.eventBlockBody}>
                                {layout.event.description}
                              </Text>
                            )}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </ScrollView>
              </View>
            </PinchGestureHandler>
          </>
        )}

        {viewMode === 'month' && (
          <ScrollView style={styles.monthScroll} contentContainerStyle={styles.monthScrollContent}>
            <View style={styles.monthGrid}>
              {monthMatrix.map((week, idx) => (
                <View key={`week-${idx}`} style={styles.monthWeekRow}>
                  {week.map((cell) => {
                    const key = cell.date.toISOString();
                    const eventsOnDay = upcomingEventsByDay.get(cell.date.toDateString()) ?? [];
                    return (
                      <Pressable
                        key={key}
                        disabled={!cell.inMonth}
                        style={[
                          styles.monthDayCell,
                          !cell.inMonth && styles.monthDayCellMuted,
                          isSameDay(cell.date, now) && styles.monthDayCellToday,
                        ]}
                        onPress={() => goToWeekOfDate(cell.date)}
                        onLongPress={() => openSlotComposer(cell.date, 9)}
                        delayLongPress={250}
                      >
                        <Text style={styles.monthDayText}>{cell.date.getDate()}</Text>
                        {!!eventsOnDay.length && <View style={styles.monthEventDot} />}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {viewMode === 'year' && (
          <ScrollView style={styles.yearScroll} contentContainerStyle={styles.yearScrollContent}>
            <View style={styles.yearGrid}>
              {yearMatrices.map((matrix, monthIdx) => (
                <View key={`year-month-${monthIdx}`} style={styles.yearMonthCard}>
                  <Text style={styles.yearMonthLabel}>{MONTH_LABELS[monthIdx]}</Text>
                  {matrix.map((week, idx) => (
                    <View key={`year-week-${monthIdx}-${idx}`} style={styles.monthWeekRow}>
                      {week.map((cell) => {
                        const eventsOnDay = upcomingEventsByDay.get(cell.date.toDateString()) ?? [];
                        return (
                          <Pressable
                            key={cell.date.toISOString()}
                            style={[
                              styles.yearDayCell,
                              !cell.inMonth && styles.monthDayCellMuted,
                              isSameDay(cell.date, now) && styles.monthDayCellToday,
                            ]}
                            onPress={() => goToWeekOfDate(cell.date)}
                            onLongPress={() => openSlotComposer(cell.date, 9)}
                            delayLongPress={250}
                          >
                            <Text style={styles.yearDayText}>{cell.date.getDate()}</Text>
                            {!!eventsOnDay.length && <View style={styles.monthEventDot} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      <Modal visible={showMonthPicker} transparent animationType="fade" onRequestClose={() => setShowMonthPicker(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.monthPickerHeader}>
              <TouchableOpacity onPress={() => setPickerYear((prev) => prev - 1)}>
                <Text style={styles.monthPickerHeaderText}>{'<'}</Text>
              </TouchableOpacity>
              <Text style={styles.monthPickerHeaderText}>{pickerYear}</Text>
              <TouchableOpacity onPress={() => setPickerYear((prev) => prev + 1)}>
                <Text style={styles.monthPickerHeaderText}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.monthPickerGrid}>
              {MONTH_LABELS.map((label, idx) => (
                <Pressable
                  key={label}
                  style={styles.monthPickerCell}
                  onPress={() => {
                    setReferenceDate(new Date(pickerYear, idx, 1));
                    setShowMonthPicker(false);
                  }}
                >
                  <Text style={styles.monthPickerCellText}>{label.slice(0, 3)}</Text>
                </Pressable>
              ))}
            </View>
            <TouchableOpacity style={styles.modalCancelButton} onPress={() => setShowMonthPicker(false)}>
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!eventDetail}
        transparent
        animationType="fade"
        onRequestClose={closeEventDetail}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.eventDetailCard}>
            <View style={styles.eventDetailHeader}>
              <Text style={styles.eventDetailTitle}>{eventDetail?.title}</Text>
              <View style={styles.eventDetailHeaderButtons}>
                {!eventDetail?.readOnly && (
                  <TouchableOpacity style={styles.eventDetailButton} onPress={handleEditFromDetail}>
                    <Text style={styles.eventDetailButtonText}>Bearbeiten</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.eventDetailButton} onPress={closeEventDetail}>
                  <Text style={styles.eventDetailButtonText}>Schließen</Text>
                </TouchableOpacity>
              </View>
            </View>
            {detailStart && detailEnd && (
              <>
                <Text style={styles.eventDetailSubtitle}>{formatLongDate(detailStart)}</Text>
                <Text style={styles.eventDetailTime}>{formatTimeRange(detailStart, detailEnd)}</Text>
              </>
            )}
            {!!eventDetail?.description && (
              <Text style={styles.eventDetailDescription}>{eventDetail.description}</Text>
            )}
            {eventDetail && (eventDetail.scope === 'self' || (eventDetail.scope === 'org' && eventDetail.orgId && roleByOrg[eventDetail.orgId] === 'director')) && (
              <View style={{ flexDirection: 'row', marginTop: 12 }}>

                <TouchableOpacity
                  style={[styles.modalCancelButton, { flex: 1, alignItems: 'center' }]}
                  onPress={() => {
                    Alert.alert('Termin löschen?', 'Dieser Termin wird entfernt.', [
                      { text: 'Abbrechen', style: 'cancel' },
                      {
                        text: 'Löschen',
                        style: 'destructive',
                        onPress: async () => {
                          const ok = await deleteEvent(eventDetail);
                          if (ok) setEventDetail(null);
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={[styles.modalCancelText, { color: '#ffb4b4', fontWeight: '700' }]}>Löschen</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={eventModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeEventModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.eventModalCard}>
            <Text style={styles.eventModalTitle}>{editingEventId ? 'Termin bearbeiten' : 'Neuer Termin'}</Text>
            <TextInput
              placeholder="Titel"
              placeholderTextColor="#7aa0a0"
              style={styles.input}
              value={eventDraft?.title ?? ''}
              onChangeText={(text) => setEventDraft((prev) => (prev ? { ...prev, title: text } : prev))}
            />
            <TextInput
              placeholder="Beschreibung"
              placeholderTextColor="#7aa0a0"
              style={[styles.input, styles.inputMultiline]}
              multiline
              numberOfLines={3}
              value={eventDraft?.description ?? ''}
              onChangeText={(text) => setEventDraft((prev) => (prev ? { ...prev, description: text } : prev))}
            />
            {Platform.OS === 'ios' ? (
              <View style={styles.timeInputRow}>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.timeInputLabel}>Start</Text>
                  <DateTimePicker
                    value={modalStartDate}
                    mode="time"
                    display="compact"
                    onChange={(_, date) => date && applyTimeToDraft('start', date)}
                    themeVariant="dark"
                    textColor="#E5F4EF"
                  />
                </View>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.timeInputLabel}>Ende</Text>
                  <DateTimePicker
                    value={modalEndDate}
                    mode="time"
                    display="compact"
                    onChange={(_, date) => date && applyTimeToDraft('end', date)}
                    themeVariant="dark"
                    textColor="#E5F4EF"
                  />
                </View>
              </View>
            ) : (
              <View style={styles.timeInputRow}>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.timeInputLabel}>Start</Text>
                  <TouchableOpacity style={styles.timeFieldButton} onPress={() => openTimePicker('start')}>
                    <Text style={styles.timeFieldValue}>{eventDraft ? formatTime(eventDraft.start) : '--:--'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.timeInputLabel}>Ende</Text>
                  <TouchableOpacity style={styles.timeFieldButton} onPress={() => openTimePicker('end')}>
                    <Text style={styles.timeFieldValue}>{eventDraft ? formatTime(eventDraft.end) : '--:--'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={styles.scopeRow}>
              <Text style={styles.timeInputLabel}>Sichtbarkeit</Text>
              <View style={styles.scopePills}>
                {[
                  { key: 'self', label: 'Nur ich' },
                  { key: 'org', label: 'Verein' },
                ].map((scope) => (
                  <Pressable
                    key={scope.key}
                    style={[styles.scopeChip, eventDraft?.scope === scope.key && styles.scopeChipActive]}
                    onPress={() => handleScopeChange(scope.key as EventDraft['scope'])}
                  >
                    <Text
                      style={[styles.scopeChipText, eventDraft?.scope === scope.key && styles.scopeChipTextActive]}
                    >
                      {scope.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            
            {eventDraft?.scope === 'org' && orgs.length > 0 && (
              <View style={styles.orgPickerSection}>
                <Text style={styles.timeInputLabel}>Verein</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orgChipsRow}>
                  {orgs.map((org) => (
                    <Pressable
                      key={org.id}
                      style={[styles.orgChip, eventDraft?.orgId === org.id && styles.orgChipActive]}
                      onPress={() => setEventDraft((prev) => (prev ? { ...prev, orgId: org.id } : prev))}
                    >
                      <Text
                        style={[styles.orgChipText, eventDraft?.orgId === org.id && styles.orgChipTextActive]}
                      >
                        {org.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Text style={[styles.broadcastLabel, { marginTop: 8 }]}>
                  Termin wird automatisch mit dem Verein geteilt.
                </Text>
              </View>
            )}



            


            <View style={styles.modalButtonsRow}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={closeEventModal}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveButton} onPress={saveEvent}>
                <Text style={styles.modalSaveText}>Speichern</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {Platform.OS !== 'ios' && timePickerField && (
        <DateTimePicker
          value={timePickerValue}
          mode="time"
          display="default"
          onChange={handleTimePickerChange}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a1c27',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
    backgroundColor: '#112a37',
  },
  headerRow: {
    width: '100%',
    marginBottom: 12,
  },
  headerPressable: {
    paddingBottom: 8,
  },
  headerActionsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: 12,
    flexWrap: 'wrap',
  },
  todayButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e4a54',
  },
  todayButtonText: {
    color: '#E5F4EF',
    fontSize: 13,
    fontWeight: '600',
  },
  monthLabel: {
    color: '#E5F4EF',
    fontSize: 24,
    fontWeight: '600',
  },
  weekRangeLabel: {
    color: '#85c3bf',
    fontSize: 14,
    marginTop: 2,
  },
  viewSwitchRow: {
    flexDirection: 'row',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e4a54',
    flexShrink: 0,
  },
  viewSwitchButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewSwitchButtonActive: {
    backgroundColor: '#1b3c47',
  },
  viewSwitchText: {
    color: '#7aa0a0',
    fontSize: 13,
  },
  viewSwitchTextActive: {
    color: '#E5F4EF',
    fontWeight: '600',
  },
  dayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: '#1c5c58',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    marginBottom: 8,
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  },
  dayHeaderCellActive: {
    backgroundColor: '#1c3c4a',
  },
  dayHeaderText: {
    color: '#E5F4EF',
    fontSize: 14,
  },
  dayHeaderNumber: {
    color: '#cbe7e4',
    fontSize: 12,
    marginTop: 2,
  },
  timeSpacer: {
    width: TIME_COLUMN_WIDTH,
  },
  gridScroll: {
    flex: 1,
  },
  gridContent: {
    paddingBottom: 60,
  },
  gridRow: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: TIME_COLUMN_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: '#1c5c58',
  },
  timeLabel: {
    color: '#85c3bf',
    fontSize: 12,
  },
  gridCell: {
    flex: 1,
    borderColor: '#1c5c58',
    borderWidth: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#0f2633',
    padding: 4,
  },
  gestureWrapper: {
    flex: 1,
  },
  gridAbsoluteWrapper: {
    position: 'relative',
  },
  nowIndicatorLine: {
    position: 'absolute',
    left: TIME_COLUMN_WIDTH,
    right: 0,
    height: 2,
    backgroundColor: '#ff5971',
  },
  eventOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  timeLabelsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TIME_COLUMN_WIDTH,
    bottom: 0,
    paddingLeft: 6,
  },
  timeLabelAbsolute: {
    position: 'absolute',
    color: '#85c3bf',
    fontSize: 12,
    textAlign: 'left',
    width: TIME_COLUMN_WIDTH,
  },
  eventBlock: {
    position: 'absolute',
    backgroundColor: 'rgba(28, 154, 147, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginHorizontal: 3,
    overflow: 'hidden',
  },
  eventBlockTitle: {
    color: '#082026',
    fontSize: 12,
    fontWeight: '700',
  },
  eventBlockBody: {
    color: '#0a3941',
    fontSize: 11,
    marginTop: 2,
  },
  monthScroll: {
    flex: 1,
  },
  monthScrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingBottom: 80,
  },
  monthGrid: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1c5c58',
    borderRadius: 12,
    overflow: 'hidden',
  },
  monthWeekRow: {
    flex: 1,
    flexDirection: 'row',
  },
  monthDayCell: {
    flex: 1,
    minHeight: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: '#1c5c58',
    borderWidth: StyleSheet.hairlineWidth,
  },
  monthDayCellMuted: {
    opacity: 0.3,
  },
  monthDayCellToday: {
    backgroundColor: '#1c3c4a',
  },
  monthDayText: {
    color: '#E5F4EF',
  },
  monthEventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1c9a93',
    marginTop: 4,
  },
  yearScroll: {
    flex: 1,
  },
  yearScrollContent: {
    paddingBottom: 32,
  },
  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  yearMonthCard: {
    width: '48%',
    backgroundColor: '#0f2633',
    borderRadius: 12,
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1c5c58',
  },
  yearMonthLabel: {
    color: '#E5F4EF',
    fontWeight: '600',
    marginBottom: 8,
  },
  yearDayCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
  },
  yearDayText: {
    color: '#E5F4EF',
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#14303d',
    borderRadius: 16,
    padding: 20,
  },
  eventDetailCard: {
    width: '100%',
    backgroundColor: '#14303d',
    borderRadius: 16,
    padding: 20,
  },
  eventDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eventDetailHeaderButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDetailButton: {
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1c5c58',
  },
  eventDetailButtonText: {
    color: '#E5F4EF',
    fontSize: 13,
    fontWeight: '600',
  },
  eventDetailTitle: {
    color: '#E5F4EF',
    fontSize: 20,
    fontWeight: '600',
    flex: 1,
  },
  eventDetailSubtitle: {
    color: '#85c3bf',
    marginBottom: 4,
  },
  eventDetailTime: {
    color: '#E5F4EF',
    fontWeight: '600',
    marginBottom: 12,
  },
  eventDetailDescription: {
    color: '#cbe7e4',
    lineHeight: 20,
  },
  monthPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthPickerHeaderText: {
    color: '#E5F4EF',
    fontSize: 18,
  },
  monthPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  monthPickerCell: {
    width: '30%',
    paddingVertical: 12,
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: '#1b3c47',
    alignItems: 'center',
  },
  monthPickerCellText: {
    color: '#E5F4EF',
    fontWeight: '500',
  },
  modalCancelButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modalCancelText: {
    color: '#85c3bf',
    fontSize: 15,
  },
  eventModalCard: {
    width: '100%',
    backgroundColor: '#14303d',
    borderRadius: 16,
    padding: 20,
  },
  eventModalTitle: {
    color: '#E5F4EF',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#0f2633',
    color: '#E5F4EF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1c5c58',
  },
  inputMultiline: {
    height: 80,
    textAlignVertical: 'top',
  },
  timeInputRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
  },
  timeInputGroup: {
    flex: 1,
    marginHorizontal: 6,
  },
  timeFieldButton: {
    backgroundColor: '#0f2633',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1c5c58',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  timeFieldValue: {
    color: '#E5F4EF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  timeInputLabel: {
    color: '#85c3bf',
    marginBottom: 4,
  },
  orgPickerSection: {
    marginBottom: 12,
  },
  orgChipsRow: {
    marginTop: 8,
  },
  orgChip: {
    borderWidth: 1,
    borderColor: '#1c5c58',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  orgChipActive: {
    backgroundColor: '#1c9a93',
    borderColor: '#1c9a93',
  },
  orgChipText: {
    color: '#E5F4EF',
    fontSize: 13,
  },
  orgChipTextActive: {
    color: '#0a1c27',
    fontWeight: '600',
  },
  scopeRow: {
    marginBottom: 12,
  },
  scopePills: {
    flexDirection: 'row',
    marginTop: 8,
  },
  scopeChip: {
    borderWidth: 1,
    borderColor: '#1c5c58',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  scopeChipActive: {
    backgroundColor: '#1c9a93',
    borderColor: '#1c9a93',
  },
  scopeChipText: {
    color: '#E5F4EF',
  },
  scopeChipTextActive: {
    color: '#0a1c27',
    fontWeight: '600',
  },
  broadcastLabel: {
    color: '#E5F4EF',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalSaveButton: {
    backgroundColor: '#1c9a93',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 12,
  },
  modalSaveText: {
    color: '#0a1c27',
    fontWeight: '600',
    
  },
}); 







