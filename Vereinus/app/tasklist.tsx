import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Image,
  TouchableOpacity,
  FlatList,
  Platform,
  Modal,
  Pressable,
  Alert,
  useColorScheme,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

// --- Types ---
type Priority = 'low' | 'medium' | 'high';

type BaseTask = {
  id: string;
  title: string;
  description?: string;
  priority?: Priority;
  startAt?: string; // "YYYY-MM-DD HH:mm"
  endAt?: string; // "YYYY-MM-DD HH:mm"
  done?: boolean;
  createdAt?: string; // added: creation timestamp
};

type Task = BaseTask & { subtasks: BaseTask[] };

type TaskList = {
  id: string;
  name: string;
  tasks: Task[];
  archived: Task[];
};

// --- Helpers ---
const uid = () => Math.random().toString(36).slice(2, 10);

const getDurationMinutes = (start?: string, end?: string) => {
  if (!start || !end) return undefined;
  const toMs = (v: string) => {
    const [d, t] = v.split(' ');
    const [Y, M, D] = d.split('-').map(Number);
    const [h, m] = (t ?? '00:00').split(':').map(Number);
    return new Date(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0).getTime();
  };
  const diff = toMs(end) - toMs(start);
  if (!isFinite(diff) || diff <= 0) return undefined;
  return Math.round(diff / 60000);
};
const durationLabel = (mins?: number) => {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `(${h}h ${m}m)`;
  if (h) return `(${h}h)`;
  return `(${m}m)`;
};

// Date helpers
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDateStringDE = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const toTimeString = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDateTimeString = (d: Date) => `${toDateString(d)} ${toTimeString(d)}`;
const parseDateTime = (s?: string) => {
  if (!s) return undefined;
  try {
    const [date, time] = s.split(' ');
    const [Y, M, D] = date.split('-').map(Number);
    const [h, m] = (time ?? '00:00').split(':').map(Number);
    return new Date(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0);
  } catch {
    return undefined;
  }
};

// Builds the top meta line for tasks according to:
// - Dates as DD.MM.YYYY
// - If same day with times: show date once and time range
// - Else: "Date | Time - Date | Time (duration)"
const buildTopLine = (startAt?: string, endAt?: string) => {
  if (!startAt && !endAt) return '';
  const s = parseDateTime(startAt);
  const e = parseDateTime(endAt);
  const sHasTime = Boolean(startAt && startAt.includes(' '));
  const eHasTime = Boolean(endAt && endAt.includes(' '));
  const mins = getDurationMinutes(startAt, endAt);

  let label = '';
  if (s && e) {
    const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
    if (sHasTime && eHasTime) {
      if (sameDay) {
        label = `${toDateStringDE(s)} | ${toTimeString(s)} - ${toTimeString(e)}`;
      } else {
        label = `${toDateStringDE(s)} | ${toTimeString(s)} - ${toDateStringDE(e)} | ${toTimeString(e)}`;
      }
    } else {
      if (sameDay) {
        if (sHasTime || eHasTime) {
          const left = sHasTime ? `${toTimeString(s)}` : '';
          const right = eHasTime ? `${toTimeString(e)}` : '';
          const timePart = left && right ? `${left} - ${right}` : left || right;
          label = timePart ? `${toDateStringDE(s)} | ${timePart}` : `${toDateStringDE(s)}`;
        } else {
          label = `${toDateStringDE(s)}`;
        }
      } else {
        const left = `${toDateStringDE(s)}${sHasTime ? ` | ${toTimeString(s)}` : ''}`;
        const right = `${toDateStringDE(e)}${eHasTime ? ` | ${toTimeString(e)}` : ''}`;
        label = `${left} - ${right}`;
      }
    }
  } else if (s) {
    label = `${toDateStringDE(s)}${sHasTime ? ` | ${toTimeString(s)}` : ''}`;
  } else if (e) {
    label = `${toDateStringDE(e)}${eHasTime ? ` | ${toTimeString(e)}` : ''}`;
  }

  return `${label} ${durationLabel(mins)}`.trim();
};

function SimpleDropdown<T extends { id: string; name: string }>(
  {
    data,
    selectedId,
    onChange,
    placeholder = 'Liste waehlen',
    style,
  }: {
    data: T[];
    selectedId?: string;
    onChange: (id: string) => void;
    placeholder?: string;
    style?: any;
  },
) {
  const [open, setOpen] = useState(false);
  const selected = data.find((d) => d.id === selectedId);

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <Text numberOfLines={1} style={style}>{selected?.name ?? placeholder}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#E5F4EF" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)} />

        <View pointerEvents="box-none" style={styles.dropdownCenterWrap}>
          <View style={styles.dropdownPanel}>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={data}
              keyExtractor={(x) => x.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  style={styles.dropdownItem}
                >
                  <Text numberOfLines={1} style={styles.dropdownItemText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListFooterComponent={(
                <TouchableOpacity
                  onPress={() => {
                    onChange('__add__');
                    setOpen(false);
                  }}
                  style={styles.dropdownItem}
                >
                  <Text numberOfLines={1} style={styles.dropdownItemText}>+ Liste hinzufügen...</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.dropdownClose}>
              <Text style={styles.dropdownCloseText}>Schließen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const PrioritySelector = ({ value, onChange }: { value?: Priority; onChange: (p?: Priority) => void }) => (
  <View style={styles.priorityRow}>
    {(['low', 'medium', 'high'] as Priority[]).map((p, i) => (
      <TouchableOpacity
        key={p}
        onPress={() => onChange(value === p ? undefined : p)}
        style={[styles.chip, i !== 2 && styles.mr6, value === p && styles.chipActive]}
      >
        <Text style={styles.chipText}>{p === 'low' ? 'Niedrig' : p === 'medium' ? 'Mittel' : 'Hoch'}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const DateRangeInputs = ({
  startAt,
  endAt,
  onChange,
}: {
  startAt?: string;
  endAt?: string;
  onChange: (next: { startAt?: string; endAt?: string }) => void;
}) => {
  const colorScheme = useColorScheme();
  type Field = 'start' | 'end';
  type Kind = 'date' | 'time';
  const [picker, setPicker] = useState<null | { field: Field; kind: Kind; tempDate: Date }>(null);

  const get = (field: Field) => (field === 'start' ? startAt : endAt);
  const setDatePart = (field: Field, d: Date) => {
    const current = get(field);
    const time = current?.split(' ')[1];
    const next = toDateString(d) + (time ? ` ${time}` : '');
    onChange(field === 'start' ? { startAt: next } : { endAt: next });
  };
  const setTimePart = (field: Field, d: Date) => {
    const current = get(field);
    const baseDate = current?.split(' ')[0] ?? toDateString(new Date());
    const next = `${baseDate} ${toTimeString(d)}`;
    onChange(field === 'start' ? { startAt: next } : { endAt: next });
  };
  const clearTimePart = (field: Field) => {
    const current = get(field);
    if (!current) return;
    const dateOnly = current.split(' ')[0];
    onChange(field === 'start' ? { startAt: dateOnly } : { endAt: dateOnly });
  };
  const clearDate = (field: Field) => {
    onChange(field === 'start' ? { startAt: undefined } : { endAt: undefined });
  };

  const openDate = (field: Field) => {
    const initial = parseDateTime(get(field)) ?? new Date();
    setPicker({ field, kind: 'date', tempDate: initial });
  };
  const openTime = (field: Field) => {
    if (!get(field)) {
      openDate(field);
      return;
    }
    const initial = parseDateTime(get(field)) ?? new Date();
    setPicker({ field, kind: 'time', tempDate: initial });
  };
  const onNativeChange = (_: any, selected?: Date) => {
    if (!picker) return;
    if (!selected) {
      setPicker(null);
      return;
    }
    if (picker.kind === 'date') setDatePart(picker.field, selected);
    else setTimePart(picker.field, selected);
    setPicker(null);
  };

  // iOS: direkte kompakte Picker ohne zusaetzliche Inputs
  if (Platform.OS === 'ios') {
    const startDate = parseDateTime(startAt) ?? new Date();
    const endDate = parseDateTime(endAt) ?? new Date();
    const hasStartTime = Boolean(startAt && startAt.includes(' '));
    const hasEndTime = Boolean(endAt && endAt.includes(' '));
    const addTimeNow = (field: Field) => {
      const baseDate = (field === 'start' ? startAt : endAt)?.split(' ')[0] ?? toDateString(new Date());
      const next = `${baseDate} ${toTimeString(new Date())}`;
      onChange(field === 'start' ? { startAt: next } : { endAt: next });
    };
    return (
      <View>
        <View style={styles.row}>
          <View style={[styles.col, styles.mr8]}>
            <Text style={styles.label}>Von Datum</Text>
            <DateTimePicker value={startDate} mode="date" display="compact" onChange={(_, d) => d && setDatePart('start', d)} />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Bis Datum</Text>
            <DateTimePicker value={endDate} mode="date" display="compact" onChange={(_, d) => d && setDatePart('end', d)} />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.col, styles.mr8]}>
            <Text style={styles.label}>Von Uhrzeit (optional)</Text>
            {hasStartTime ? (
              <>
                <DateTimePicker
                  value={startDate}
                  mode="time"
                  display="compact"
                  onChange={(_, d) => d && setTimePart('start', d)}
                  themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                  textColor={colorScheme === 'dark' ? '#FFFFFF' : '#111827'}
                />
                <TouchableOpacity onPress={() => clearTimePart('start')} style={styles.btnLink}>
                  <Text style={styles.btnLinkTextMuted}>Uhrzeit entfernen</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={() => addTimeNow('start')} style={styles.btnLink}>
                <Text style={styles.btnLinkText}>Uhrzeit hinzufuegen</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Bis Uhrzeit (optional)</Text>
            {hasEndTime ? (
              <>
                <DateTimePicker
                  value={endDate}
                  mode="time"
                  display="compact"
                  onChange={(_, d) => d && setTimePart('end', d)}
                  themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                  textColor={colorScheme === 'dark' ? '#FFFFFF' : '#111827'}
                />
                <TouchableOpacity onPress={() => clearTimePart('end')} style={styles.btnLink}>
                  <Text style={styles.btnLinkTextMuted}>Uhrzeit entfernen</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={() => addTimeNow('end')} style={styles.btnLink}>
                <Text style={styles.btnLinkText}>Uhrzeit hinzufügen</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    const startDate = startAt?.split(' ')[0] ?? '';
    const startTime = startAt?.split(' ')[1] ?? '';
    const endDate = endAt?.split(' ')[0] ?? '';
    const endTime = endAt?.split(' ')[1] ?? '';
    return (
      <View>
        <View style={styles.row}>
          <View style={[styles.col, styles.mr8]}>
            <Text style={styles.label}>Von (Datum)</Text>
            <TextInput value={startDate} placeholder="YYYY-MM-DD" placeholderTextColor={'#9CA3AF'} onChangeText={(v) => onChange({ startAt: v ? v + (startTime ? ` ${startTime}` : '') : undefined })} style={styles.input} />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Von (Uhrzeit, optional)</Text>
            <TextInput value={startTime} placeholder="HH:mm" placeholderTextColor={'#9CA3AF'} onChangeText={(v) => onChange({ startAt: startDate ? startDate + (v ? ` ${v}` : '') : undefined })} style={styles.input} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={[styles.col, styles.mr8]}>
            <Text style={styles.label}>Bis (Datum)</Text>
            <TextInput value={endDate} placeholder="YYYY-MM-DD" placeholderTextColor={'#9CA3AF'} onChangeText={(v) => onChange({ endAt: v ? v + (endTime ? ` ${endTime}` : '') : undefined })} style={styles.input} />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Bis (Uhrzeit, optional)</Text>
            <TextInput value={endTime} placeholder="HH:mm" placeholderTextColor={'#9CA3AF'} onChangeText={(v) => onChange({ endAt: endDate ? endDate + (v ? ` ${v}` : '') : undefined })} style={styles.input} />
          </View>
        </View>
      </View>
    );
  }

  const startDateLabel = startAt?.split(' ')[0] ?? 'Datum wählen';
  const startTimeLabel = startAt?.split(' ')[1] ?? 'Uhrzeit hinzufügen (optional)';
  const endDateLabel = endAt?.split(' ')[0] ?? 'Datum wählen';
  const endTimeLabel = endAt?.split(' ')[1] ?? 'Uhrzeit hinzufügen (optional)';

  return (
    <View>
      <View style={styles.row}>
        <View style={[styles.col, styles.mr8]}>
          <Text style={styles.label}>Von Datum</Text>
          <TouchableOpacity onPress={() => openDate('start')} style={styles.input}>
            <Text style={[styles.inputText, !startAt && styles.inputPlaceholder]}>{startDateLabel}</Text>
          </TouchableOpacity>
          {!!startAt?.includes(' ') && (
            <TouchableOpacity onPress={() => clearTimePart('start')} style={styles.btnLink}>
              <Text style={styles.btnLinkTextMuted}>Uhrzeit entfernen</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Von Uhrzeit (optional)</Text>
          <TouchableOpacity onPress={() => openTime('start')} style={styles.input}>
            <Text style={[styles.inputText, (!startAt || !startAt.includes(' ')) && styles.inputPlaceholder]}>{startTimeLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.col, styles.mr8]}>
          <Text style={styles.label}>Bis Datum</Text>
          <TouchableOpacity onPress={() => openDate('end')} style={styles.input}>
            <Text style={[styles.inputText, !endAt && styles.inputPlaceholder]}>{endDateLabel}</Text>
          </TouchableOpacity>
          {!!endAt?.includes(' ') && (
            <TouchableOpacity onPress={() => clearTimePart('end')} style={styles.btnLink}>
              <Text style={styles.btnLinkTextMuted}>Uhrzeit entfernen</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Bis Uhrzeit (optional)</Text>
          <TouchableOpacity onPress={() => openTime('end')} style={styles.input}>
            <Text style={[styles.inputText, (!endAt || !endAt.includes(' ')) && styles.inputPlaceholder]}>{endTimeLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Android: nativer Dialog */}
      {picker && String(Platform.OS) !== 'ios' && (
        <DateTimePicker value={picker.tempDate} mode={picker.kind} display="default" onChange={onNativeChange} />
      )}

      {(startAt || endAt) && (
        <View style={styles.row}>
          {!!startAt && (
            <TouchableOpacity onPress={() => clearDate('start')} style={[styles.btnLink, styles.mr8]}>
              <Text style={styles.btnLinkTextMuted}>Von löschen</Text>
            </TouchableOpacity>
          )}
          {!!endAt && (
            <TouchableOpacity onPress={() => clearDate('end')} style={styles.btnLink}>
              <Text style={styles.btnLinkTextMuted}>Bis löschen</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

// --- Main ---
export default function Tasklist() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentSessionUserId, setCurrentSessionUserId] = useState<string | null>(null);
  // Start without default lists so the create-list flow
  // can enforce first-time creation when empty
  const [lists, setLists] = useState<TaskList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | undefined>(undefined);

  // Draft editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Task>>({});

  // Form state
  const [showCreate, setShowCreate] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState<Priority | undefined>('medium');
  const [taskStart, setTaskStart] = useState<string>('');
  const [taskEnd, setTaskEnd] = useState<string>('');

  const [showAddList, setShowAddList] = useState(false);
  const [addListName, setAddListName] = useState('');
  type StatusFilter = 'all' | 'upcoming' | 'overdue' | 'done';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const currentList = useMemo(() => lists.find((l) => l.id === selectedListId), [lists, selectedListId]);

  // Persistence
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STORAGE_KEY = '@vereinus/tasklists';
  const STORAGE_SEL = '@vereinus/selectedListId';
  const storageKey = useMemo(
    () => (currentSessionUserId ? `${STORAGE_KEY}:${currentSessionUserId}` : STORAGE_KEY),
    [currentSessionUserId],
  );
  const storageSelKey = useMemo(
    () => (currentSessionUserId ? `${STORAGE_SEL}:${currentSessionUserId}` : STORAGE_SEL),
    [currentSessionUserId],
  );
  const lastSelectedIdRef = useRef<string | undefined>(undefined);

  const loadRemoteState = useCallback(async (userId: string) => {
    try {
      const table: any = supabase?.from?.('tasklist_state');
      if (!table || typeof table.select !== 'function') return null;
      const query: any = table
        .select('data, selected_list_id')
        .eq('user_id', userId);
      const res = query?.maybeSingle
        ? await query.maybeSingle()
        : await query.single?.();
      const data = (res as any)?.data;
      const error = (res as any)?.error;
      if (error || !data) return null;
      return data as { data: TaskList[]; selected_list_id?: string | null };
    } catch {
      return null;
    }
  }, []);

  const saveRemoteState = useCallback(async (userId: string, payload: { data: TaskList[]; selected_list_id?: string | null }) => {
    try {
      const table: any = supabase?.from?.('tasklist_state');
      if (!table || typeof table.upsert !== 'function') return;
      await table.upsert({
        user_id: userId,
        data: payload.data,
        selected_list_id: payload.selected_list_id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch {
      // ignore remote write errors to avoid breaking offline mode
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }: { data: any }) => {
      if (!cancelled) setCurrentSessionUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      if (!cancelled) setCurrentSessionUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    // Reset state when switching users to avoid showing previous data while loading
    setLists([]);
    setSelectedListId(undefined);
    lastSelectedIdRef.current = undefined;
    (async () => {
      try {
        const [rawLists, rawSel] = await Promise.all([AsyncStorage.getItem(storageKey), AsyncStorage.getItem(storageSelKey)]);
        if (rawLists) {
          const parsed: TaskList[] = JSON.parse(rawLists);
          setLists(parsed);
          if (rawSel) setSelectedListId(rawSel);
          else if (parsed[0]) setSelectedListId(parsed[0].id);
        } else {
          setLists([]);
          setSelectedListId(undefined);
        }
        if (currentSessionUserId) {
          const remote = await loadRemoteState(currentSessionUserId);
          if (remote?.data) {
            setLists(remote.data);
            setSelectedListId(remote.selected_list_id ?? remote.data[0]?.id);
          }
        }
      } catch {
        setLists([]);
        setSelectedListId(undefined);
      }
    })();
  }, [storageKey, storageSelKey, currentSessionUserId, loadRemoteState]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(storageKey, JSON.stringify(lists)).catch(() => { });
      if (selectedListId) AsyncStorage.setItem(storageSelKey, selectedListId).catch(() => { });
      else AsyncStorage.removeItem(storageSelKey).catch(() => { });
      if (currentSessionUserId) {
        saveRemoteState(currentSessionUserId, { data: lists, selected_list_id: selectedListId ?? null });
      }
    }, 200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [lists, selectedListId, storageKey, storageSelKey, currentSessionUserId, saveRemoteState]);
  // Remove one-time gating: focus effect controls showing the add-list popup

  // Intercept special dropdown selection to add new list
  useEffect(() => {
    if (selectedListId === '__add__') {
      setShowAddList(true);
      setSelectedListId(lastSelectedIdRef.current ?? lists[0]?.id);
    } else {
      lastSelectedIdRef.current = selectedListId;
    }
  }, [selectedListId, lists]);

  const deleteCurrentList = useCallback(() => {
    if (!currentList) return;
    Alert.alert('Liste loeschen', `Soll die Liste "${currentList.name}" wirklich geloescht werden?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Loeschen',
        style: 'destructive',
        onPress: () => {
          setLists((prev) => {
            const next = prev.filter((l) => l.id !== currentList.id);
            setSelectedListId((prevSel) => (prevSel === currentList.id ? next[0]?.id : prevSel));
            return next;
          });
        },
      },
    ]);
  }, [currentList]);

  // --- Aufgaben ---
  const addTask = () => {
    if (!currentList) return;
    const title = taskTitle.trim();
    if (!title) return;
    const newTask: Task = {
      id: uid(),
      title,
      description: taskDesc.trim() || undefined,
      priority: taskPriority,
      startAt: taskStart.trim() || undefined,
      endAt: taskEnd.trim() || undefined,
      done: false,
      subtasks: [],
      createdAt: toDateTimeString(new Date()),
    };
    setLists((prev) => prev.map((l) => (l.id === currentList.id ? { ...l, tasks: [newTask, ...l.tasks] } : l)));
    setTaskTitle('');
    setTaskDesc('');
    setTaskPriority('medium');
    setTaskStart('');
    setTaskEnd('');
    setShowCreate(false);
  };

  const completeAndArchive = useCallback((taskId: string) => {
    if (!currentList) return;
    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== currentList.id) return l;
        const task = l.tasks.find((t) => t.id === taskId);
        if (!task) return l;
        const remaining = l.tasks.filter((t) => t.id !== taskId);
        const withoutDup = l.archived.filter((a) => a.id !== taskId);
        const archivedTask: Task = { ...task, done: true };
        return { ...l, tasks: remaining, archived: [archivedTask, ...withoutDup] };
      }),
    );
    setEditingId((eid) => (eid === taskId ? null : eid));
    setDrafts((d) => {
      const { [taskId]: _, ...rest } = d;
      return rest;
    });
  }, [currentList]);

  const restoreFromArchive = useCallback((taskId: string) => {
    if (!currentList) return;
    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== currentList.id) return l;
        const task = l.archived.find((t) => t.id === taskId);
        if (!task) return l;
        const remainingArchived = l.archived.filter((t) => t.id !== taskId);
        const restored: Task = { ...task, done: false };
        const tasksNoDup = l.tasks.filter((t) => t.id !== restored.id);
        return { ...l, archived: remainingArchived, tasks: [restored, ...tasksNoDup] };
      }),
    );
  }, [currentList]);

  // Draft editing
  const beginEdit = useCallback((task: Task) => {
    setEditingId(task.id);
    setDrafts((d) => ({ ...d, [task.id]: JSON.parse(JSON.stringify(task)) }));
  }, []);
  const updateDraft = (patch: Partial<Task>) => {
    if (!editingId) return;
    setDrafts((d) => ({ ...d, [editingId]: { ...(d[editingId] as Task), ...patch } }));
  };
  const commitEdit = () => {
    if (!currentList || !editingId) return;
    const draft = drafts[editingId];
    if (!draft) {
      setEditingId(null);
      return;
    }
    setLists((prev) => prev.map((l) => (l.id === currentList.id ? { ...l, tasks: l.tasks.map((t) => (t.id === editingId ? { ...t, ...draft } : t)) } : l)));
    setEditingId(null);
    setDrafts((d) => {
      const { [editingId]: _, ...rest } = d;
      return rest;
    });
  };
  const cancelEdit = () => {
    if (!editingId) return;
    setEditingId(null);
    setDrafts((d) => {
      const { [editingId]: _, ...rest } = d;
      return rest;
    });
  };

  const deleteTask = useCallback((taskId: string) => {
    if (!currentList) return;
    setLists((prev) => prev.map((l) => (l.id === currentList.id ? { ...l, tasks: l.tasks.filter((t) => t.id !== taskId) } : l)));
  }, [currentList]);

  type ListEntry = any;
  const visibleTasks = useMemo(() => {
    const now = new Date();
    const tasks = currentList?.tasks ?? [];
    const archived = currentList?.archived ?? [];
    if (statusFilter === 'done') {
      const doneActive = tasks.filter((t) => t.done);
      const archivedIds = new Set(archived.map((a) => a.id));
      const onlyActiveDone = doneActive.filter((t) => !archivedIds.has(t.id));
      return [...archived, ...onlyActiveDone];
    }
    if (statusFilter === 'overdue') {
      return tasks.filter((t) => {
        if (t.done) return false;
        const dt = parseDateTime(t.endAt || t.startAt);
        return !!dt && dt.getTime() < now.getTime();
      });
    }
    if (statusFilter === 'upcoming') {
      return tasks.filter((t) => {
        if (t.done) return false;
        const dt = parseDateTime(t.endAt || t.startAt);
        return !dt || dt.getTime() >= now.getTime();
      });
    }
    // 'all': show everything in the active list regardless of date
    return tasks;
  }, [currentList, statusFilter]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; items: Task[] }>();
    const add = (t: Task) => {
      const d = parseDateTime(t.startAt ?? t.endAt);
      const key = d ? toDateString(d) : 'nodate';
      const weekday = d ? d.toLocaleDateString('de-DE', { weekday: 'long' }) : '';
      const label = d ? `${toDateStringDE(d)}   ${weekday}` : 'Ohne Datum';
      if (!groups.has(key)) groups.set(key, { key, label, items: [] });
      groups.get(key)!.items.push(t);
    };
    visibleTasks.forEach(add);
    const sorted = Array.from(groups.values()).sort((a, b) => {
      if (a.key === 'nodate') return 1;
      if (b.key === 'nodate') return -1;
      return a.key.localeCompare(b.key);
    });
    const out: ListEntry[] = [];
    sorted.forEach((g) => {
      out.push({ _type: 'header', key: g.key, label: g.label });
      out.push(...g.items);
    });
    return out;
  }, [visibleTasks]);
  const processedTasks = groupedEntries;
  // --- Render ---
  const getPriorityFlag = useCallback((prio: Priority) => {
    try {
      if (prio === 'low') return require('../assets/images/flagg.png');
      if (prio === 'medium') return require('../assets/images/flago.png');
      if (prio === 'high') return require('../assets/images/flagr.png');
    } catch {
      return undefined;
    }
    return undefined;
  }, []);

  const renderTaskItem = useCallback(({ item: t }: { item: Task }) => {
    const topLine = buildTopLine(t.startAt, t.endAt);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => beginEdit(t)}
        onLongPress={() => beginEdit(t)}
        style={styles.taskCard}
      >
        {!!topLine && (
          <View style={styles.metaRow}>
            <Text style={styles.metaStrong}>{topLine.trim()}</Text>
            {t.priority && (
              <Image source={getPriorityFlag(t.priority)} style={styles.flagIcon} />
            )}
          </View>
        )}
        <View style={styles.taskRow}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              completeAndArchive(t.id);
            }}
            style={[styles.checkbox, styles.mr8]}
          >
            <Text style={styles.checkboxText}></Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.taskTitle}>{t.title}</Text>
            {!!t.description && (
              <Text style={styles.taskDesc} numberOfLines={2}>
                {t.description}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={() => deleteTask(t.id)} style={[styles.iconBtn, styles.ml8]}>
            <Ionicons name="trash-outline" size={16} color="#ffffffff" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [beginEdit, completeAndArchive, deleteTask, getPriorityFlag]);

  const renderArchivedItem = useCallback(({ item }: { item: any }) => {
    if ((item as any)._type === 'header') {
      const h = item as any;
      return <Text style={[styles.h2, { marginTop: 12 }]}>{h.label}</Text>;
    }
    const t = item as Task;
    const topLine = buildTopLine(t.startAt, t.endAt);
    return (
      <View style={[styles.taskCard, styles.archivedCard]}>
        {!!topLine && (
          <View style={styles.metaRow}>
            <Text style={styles.metaStrong}>{topLine.trim()}</Text>
            {t.priority && (
              <Image source={getPriorityFlag(t.priority)} style={styles.flagIcon} />
            )}
          </View>
        )}
        <View style={styles.taskRow}>
          <View style={[styles.checkbox, styles.mr8, styles.checkboxDone]}>
            <Text style={styles.checkboxText}>X</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.taskTitle, styles.through]}>{t.title}</Text>
            {!!t.description && (
              <Text style={[styles.taskDesc, styles.through]} numberOfLines={2}>
                {t.description}
              </Text>
            )}
            <TouchableOpacity onPress={() => restoreFromArchive(t.id)} style={[styles.btnLink, { paddingLeft: 0 }]}>
              <Text style={styles.btnLinkText}>Wiederherstellen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }, [getPriorityFlag, restoreFromArchive]);

  const renderProcessedItem = useCallback(({ item }: { item: any }) => {
    if (item && (item as any)._type === 'header') {
      const h = item as any;
      return <Text style={[styles.h2, { marginTop: 12 }]}>{h.label}</Text>;
    }
    if (statusFilter === 'done') {
      return renderArchivedItem({ item });
    }
    return renderTaskItem({ item } as any);
  }, [renderTaskItem, renderArchivedItem, statusFilter]);

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Aufgaben</Text>

      <View style={[styles.row, styles.headerRow]}>
        <View style={[styles.col, styles.mr8]}>
          <SimpleDropdown
            data={lists}
            selectedId={selectedListId}
            onChange={(val) => setSelectedListId(val)}
            placeholder="Liste waehlen"
            style={{ color: '#FFFFFF' }}
          />
        </View>
        <TouchableOpacity onPress={deleteCurrentList} style={styles.iconBtn}>
          <Text style={styles.iconBtnText}>Liste loeschen</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.row, styles.statusRow]}>
        {[
          { key: 'all', label: 'Alle' },
          { key: 'upcoming', label: 'Bevorstehend' },
          { key: 'overdue', label: 'Überfällig' },
          { key: 'done', label: 'Erledigt' },
        ].map((s) => (
          <TouchableOpacity
            key={s.key}
            onPress={() => setStatusFilter(s.key as StatusFilter)}
            style={[styles.filterChip, statusFilter === s.key && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, statusFilter === s.key && styles.filterChipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal
        visible={showAddList}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // Block closing via back if no lists exist
          if ((lists?.length ?? 0) > 0) setShowAddList(false);
        }}
      >
        <Pressable
          style={styles.dropdownOverlay}
          onPress={() => {
            // Block overlay dismiss if no lists exist
            if ((lists?.length ?? 0) > 0) setShowAddList(false);
          }}
        />
        <View pointerEvents="box-none" style={styles.dropdownCenterWrap}>
          <View style={styles.dropdownPanel}>
            <View style={{ padding: 12 }}>
              <Text style={styles.label}>Neue Liste</Text>
              <TextInput
                style={styles.input}
                placeholder="Name der Liste"
                placeholderTextColor={'#95959588'}
                value={addListName}
                onChangeText={setAddListName}
                autoFocus
              />
              <View style={styles.row}>
                <TouchableOpacity
                  onPress={() => {
                    const name = addListName.trim();
                    if (!name) return;
                    const newL: TaskList = { id: uid(), name, tasks: [], archived: [] };
                    setLists((prev) => [...prev, newL]);
                    setSelectedListId(newL.id);
                    setAddListName('');
                    setShowAddList(false);
                  }}
                  style={[styles.btnLink, styles.mr8]}
                >
                  <Text style={styles.btnLinkTextAdd}>Hinzufügen</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setAddListName('');
                    // Navigate to index tab explicitly
                    router.push('/');
                    // Close modal afterwards (in case we remain on this route briefly)
                    setShowAddList(false);
                  }}
                  style={styles.btnLink}
                >
                  <Text style={styles.btnLinkTextCancel}>Abbrechen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

            <TouchableOpacity onPress={() => setShowCreate((s) => !s)} style={styles.btnLink}>
        <Text style={styles.btnLinkTextAddTask}>+ Aufgabe hinzufügen</Text>
      </TouchableOpacity>

      

<Modal visible={!!editingId} transparent animationType="fade" onRequestClose={() => cancelEdit()}>
  <Pressable style={styles.modalOverlay} onPress={cancelEdit} />
  <View style={styles.modalCenterWrap}>
    <View style={styles.modalCard}>
      <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.h2}>Aufgabe bearbeiten</Text>
        {editingId ? (() => {
          const t = (drafts[editingId] ?? (currentList?.tasks.find(x => x.id === editingId))) as Task | undefined;
          if (!t) return null;
          return (
            <View>
              <TextInput style={styles.input} value={t.title} onChangeText={(v) => updateDraft({ title: v })} placeholder="Titel" placeholderTextColor={'#95959588'} />
              <TextInput style={[styles.input, { minHeight: 40 }]} value={t.description ?? ''} onChangeText={(v) => updateDraft({ description: v })} placeholder="Beschreibung" placeholderTextColor={'#95959588'} multiline />
              <PrioritySelector value={t.priority} onChange={(p) => updateDraft({ priority: p })} />
              <DateRangeInputs startAt={t.startAt} endAt={t.endAt} onChange={(patch) => updateDraft(patch)} />
              <View style={[styles.row, { marginTop: 8 }]}>
                <TouchableOpacity onPress={commitEdit} style={[styles.btnLink, styles.mr8]}><Text style={styles.btnLinkText}>Speichern</Text></TouchableOpacity>
                <TouchableOpacity onPress={cancelEdit} style={styles.btnLink}><Text style={styles.btnLinkTextMuted}>Abbrechen</Text></TouchableOpacity>
              </View>
            </View>
          );
        })() : null}
      </ScrollView>
    </View>
  </View>
</Modal>

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowCreate(false)} />
        <View style={styles.modalCenterWrap}>
          <View style={styles.modalCard}>
            <View style={{ padding: 12 }}>
              <Text style={styles.h2}>Aufgabe erstellen</Text>
              <TextInput placeholder="Titel" placeholderTextColor={'#9CA3AF'} value={taskTitle} onChangeText={setTaskTitle} style={styles.input} />
              <TextInput placeholder="Beschreibung" placeholderTextColor={'#9CA3AF'} value={taskDesc} onChangeText={setTaskDesc} style={[styles.input, { minHeight: 40 }]} multiline />
              <PrioritySelector value={taskPriority} onChange={setTaskPriority} />
              <DateRangeInputs
                startAt={taskStart}
                endAt={taskEnd}
                onChange={({ startAt, endAt }) => {
                  if (startAt !== undefined) setTaskStart(startAt);
                  if (endAt !== undefined) setTaskEnd(endAt);
                }}
              />
              <View style={[styles.row, { marginTop: 8 }]}>
                <TouchableOpacity onPress={addTask} style={[styles.btnLink, styles.mr8]}>
                  <Text style={styles.btnLinkText}>Speichern</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowCreate(false)} style={styles.btnLink}>
                  <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        data={processedTasks}
        keyExtractor={(item) => (item as any)._type === 'header' ? `h-${(item as any).key}` : (item as any).id}
        ListEmptyComponent={() => <Text style={styles.muted}>Keine Aufgaben in dieser Liste.</Text>}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 72 }}
        renderItem={renderProcessedItem}
      />
    </View>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.select({ ios: 28, android: 20, default: 16 }), paddingHorizontal: 12, backgroundColor: '#112a37' },
  headerRow: { marginTop: 10, alignItems: 'center' },
  statusRow: { marginTop: 12, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  flagIcon: { width: 14, height: 14, marginLeft: 6 },

  // Modal overlay for filter modal
  modalOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(7, 15, 23, 0.75)',
  },

  // Center modal content vertically and horizontally
  modalCenterWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  // Card style for modal content
  modalCard: {
    width: '92%',
    backgroundColor: '#0F2530',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3E48',
    maxHeight: 560,
    flexShrink: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },

  mr6: { marginRight: 6 },
  mr8: { marginRight: 8 },
  ml8: { marginLeft: 8 },

  h1: { fontSize: 22, fontWeight: '700', marginVertical: 12, color: '#FFFFFF' },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 8, marginBottom: 6, color: '#E5F4EF' },

  row: { flexDirection: 'row' },
  col: { flex: 1 },

  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(7, 15, 23, 0.7)',
  },
  dropdownCenterWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dropdownPanel: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F2530',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A3E48',
    maxHeight: 320,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F3642',
  },
  dropdownItemText: { color: '#E5F4EF' },
  dropdownClose: { padding: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#1F3642' },
  dropdownCloseText: { color: '#C7D2D6' },

  // Modal panel for iOS picker
  pickerPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingBottom: 8,
    // shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: '#2A3E48',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: '#112a37',
    color: '#E5F4EF',
  },
  inputText: { color: '#E5F4EF' },
  inputPlaceholder: { color: '#8EA3B2' },
  label: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },

  btnLink: { paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLinkTextAddTask: { color: '#9AD0C1', fontWeight: '700' },
  btnLinkText: { color: '#9AD0C1', fontWeight: '700' },
  btnLinkTextAdd: { color: '#9AD0C1', fontWeight: '700' },
  btnLinkTextCancel: { color: '#C7D2D6', fontWeight: '600' },
  btnLinkTextMuted: { color: '#C7D2D6', fontWeight: '600' },

  muted: { color: '#9CA3AF', marginVertical: 6, bottom: -20 },

  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#FFFFFF' },

  taskCard: {
    borderWidth: 1,
    borderColor: '#2A3E48',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#0F2530',
  },
  archivedCard: { backgroundColor: '#0C1F29', borderColor: '#2A3E48' },

  taskRow: { flexDirection: 'row' },

  taskTitle: { fontSize: 16, fontWeight: '700', color: '#ffffffff' },
  taskDesc: { fontSize: 13, color: '#C7D2D6', marginTop: 2 },

  meta: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  metaStrong: { fontSize: 12, color: '#ffffffff', marginBottom: 6, fontWeight: '600' },

  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
  checkboxText: { fontWeight: '800' },
  through: { textDecorationLine: 'line-through', color: '#9CA3AF' },

  iconBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  iconBtnText: { fontSize: 14, color: '#6B7280' },

  priorityRow: { flexDirection: 'row' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1' },
  chipActive: { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
  chipText: { fontSize: 12, fontWeight: '600' },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3E48',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#0F2530',
  },
  filterChipActive: { backgroundColor: '#6D28D9', borderColor: '#A78BFA' },
  filterChipText: { color: '#C7D2D6', fontWeight: '700' },
  filterChipTextActive: { color: '#FFFFFF' },
});
