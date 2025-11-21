import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Image,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
  Modal,
  Pressable,
  useColorScheme,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

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

const formatDate = (s?: string) => (s ? s : '');
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
    placeholder = 'Liste wählen…',
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
        <Text>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)} />

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
                <Text numberOfLines={1}>{item.name}</Text>
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
                <Text numberOfLines={1}>+ Liste hinzufügen...</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity onPress={() => setOpen(false)} style={styles.dropdownClose}>
            <Text style={{ color: '#6B7280' }}>Schließen</Text>
          </TouchableOpacity>
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

  // iOS: direkte kompakte Picker ohne zusätzliche Inputs
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
                <Text style={styles.btnLinkText}>Uhrzeit hinzufügen</Text>
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

  const startDateLabel = startAt?.split(' ')[0] ?? 'Datum wählen…';
  const startTimeLabel = startAt?.split(' ')[1] ?? 'Uhrzeit hinzufügen (optional)';
  const endDateLabel = endAt?.split(' ')[0] ?? 'Datum wählen…';
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
  const [taskPriority, setTaskPriority] = useState<Priority | undefined>(undefined);
  const [taskStart, setTaskStart] = useState<string>('');
  const [taskEnd, setTaskEnd] = useState<string>('');

  const [showAddList, setShowAddList] = useState(false);
  const [addListName, setAddListName] = useState('');
  const [query, setQuery] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  type SortBy = 'created' | 'datetime' | 'priority';
  type SortDir = 'asc' | 'desc';
  type GroupBy = 'none' | 'created' | 'datetime' | 'priority';
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  const currentList = useMemo(() => lists.find((l) => l.id === selectedListId), [lists, selectedListId]);

  // Persistence
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STORAGE_KEY = '@vereinus/tasklists';
  const STORAGE_SEL = '@vereinus/selectedListId';
  const lastSelectedIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const [rawLists, rawSel] = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(STORAGE_SEL)]);
        if (rawLists) {
          const parsed: TaskList[] = JSON.parse(rawLists);
          setLists(parsed);
          if (rawSel) setSelectedListId(rawSel);
          else if (parsed[0]) setSelectedListId(parsed[0].id);
        } else {
          setSelectedListId((prev) => prev ?? lists[0]?.id);
        }
      } catch { }
    })();
  }, []);

  // Show or hide the add-list popup based on focus and current list count.
  useFocusEffect(
    useCallback(() => {
      if ((lists?.length ?? 0) === 0) setShowAddList(true);
      else setShowAddList(false);
      return () => setShowAddList(false);
    }, [lists])
  );

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lists)).catch(() => { });
      if (selectedListId) AsyncStorage.setItem(STORAGE_SEL, selectedListId).catch(() => { });
    }, 200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [lists, selectedListId]);
  // Remove one-time gating: focus effect controls showing the add-list popup

  // Intercept special dropdown selection to add new list
  useEffect(() => {
    if (selectedListId === '__add__') {
      setShowAddList(true);
      // revert back to previous selection (if any)
      setSelectedListId(lastSelectedIdRef.current ?? lists[0]?.id);
    } else {
      lastSelectedIdRef.current = selectedListId;
    }
  }, [selectedListId, lists]);

  const deleteCurrentList = () => {
    if (!currentList) return;
    Alert.alert('Liste löschen?', 'Diese Liste und alle Aufgaben werden gelöscht.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () =>
          setLists((prev) => {
            const next = prev.filter((l) => l.id !== currentList.id);
            setSelectedListId(next[0]?.id);
            return next;
          }),
      },
    ]);
  };

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

  const completeAndArchive = (taskId: string) => {
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
  };

  const restoreFromArchive = (taskId: string) => {
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
  };

  // Draft editing
  const beginEdit = (task: Task) => {
    setEditingId(task.id);
    setDrafts((d) => ({ ...d, [task.id]: JSON.parse(JSON.stringify(task)) }));
  };
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

  const deleteTask = (taskId: string) => {
    if (!currentList) return;
    setLists((prev) => prev.map((l) => (l.id === currentList.id ? { ...l, tasks: l.tasks.filter((t) => t.id !== taskId) } : l)));
  };
  const renderProcessedItem = ({ item }: { item: any }) => {
    if (item && (item as any)._type === 'header') {
      const h = item as any;
      return <Text style={[styles.h2, { marginTop: 12 }]}>{h.label}</Text>;
    }
    return renderTaskItem({ item } as any);
  };

  type ListEntry = any;
  const processTasks = (tasks: Task[], q: string): ListEntry[] => {
    const queryLc = q.trim().toLowerCase();
    let items = tasks.filter((t) => !queryLc || t.title.toLowerCase().includes(queryLc));
    const prioRank = (p?: Priority) => (!p ? 0 : p === 'low' ? 1 : p === 'medium' ? 2 : 3);
    items = items.slice().sort((a, b) => {
      let ka = 0, kb = 0;
      if (sortBy === 'created') {
        ka = parseDateTime(a.createdAt ?? '')?.getTime?.() ?? 0;
        kb = parseDateTime(b.createdAt ?? '')?.getTime?.() ?? 0;
      } else if (sortBy === 'datetime') {
        ka = parseDateTime(a.startAt ?? a.endAt ?? '')?.getTime?.() ?? 0;
        kb = parseDateTime(b.startAt ?? b.endAt ?? '')?.getTime?.() ?? 0;
      } else if (sortBy === 'priority') {
        ka = prioRank(a.priority);
        kb = prioRank(b.priority);
      }
      const diff = ka - kb;
      return sortDir === 'asc' ? diff : -diff;
    });
    if (groupBy === 'none') return items;
    const groups = new Map<string, { key: string; label: string; items: Task[] }>();
    const labelFor = (t: Task) => {
      if (groupBy === 'priority') {
        if (!t.priority) return 'Priorität: Keine';
        return t.priority === 'low' ? 'Priorität: Niedrig' : t.priority === 'medium' ? 'Priorität: Mittel' : 'Priorität: Hoch';
      }
      const d = groupBy === 'created' ? parseDateTime(t.createdAt) : parseDateTime(t.startAt ?? t.endAt);
      if (!d) return 'Ohne Datum';
      return toDateStringDE(d);
    };
    for (const t of items) {
      const label = labelFor(t);
      if (!groups.has(label)) groups.set(label, { key: label, label, items: [] });
      groups.get(label)!.items.push(t);
    }
    const out: ListEntry[] = [];
    for (const g of groups.values()) {
      out.push({ _type: 'header', key: g.key, label: g.label });
      out.push(...g.items);
    }
    return out;
  };
  // --- Render ---
  const getPriorityFlag = (prio: Priority) => {
    try {
      if (prio === 'low') return require('../assets/images/flagg.png');
      if (prio === 'medium') return require('../assets/images/flago.png');
      if (prio === 'high') return require('../assets/images/flagr.png');
      return undefined as any;
    } catch {
      return undefined as any;
    }
  };

  const renderTaskItem = ({ item: t }: { item: Task }) => {
    const topLine = buildTopLine(t.startAt, t.endAt);
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={() => beginEdit(t)} style={styles.taskCard}>
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
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Aufgaben</Text>

      <View style={styles.row }>
        <View style={[styles.col, styles.mr8]}>
          <SimpleDropdown data={lists} selectedId={selectedListId} onChange={(val) => setSelectedListId(val)} placeholder="Liste wählen…" style={{ color: '#FFFFFF' }} />
        </View>
        <TouchableOpacity onPress={deleteCurrentList} style={styles.iconBtn}>
          <Text style={styles.iconBtnText}>🗑️ Liste</Text>
        </TouchableOpacity>
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
      </Modal>

      <View style={[styles.row, { alignItems: 'center' }]}>
        <Ionicons name="search" size={20} color="#6B7280" style={{ marginRight: 8 }} />
        <TextInput
          placeholder="Suchen…"
          placeholderTextColor={'#95959588'}
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          multiline={false}
          clearButtonMode="while-editing"
        />
        <TouchableOpacity onPress={() => setShowFilter(true)} style={[styles.iconBtn, styles.ml8]}>
          <Ionicons name="options-outline" size={22} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => setShowCreate((s) => !s)} style={styles.btnLink}>
        <Text style={styles.btnLinkTextAddTask}>+ Aufgabe hinzufügen</Text>
      </TouchableOpacity>

      <Modal visible={showFilter} transparent animationType="fade" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFilter(false)} />
        <View style={styles.modalCenterWrap}>
          <View style={styles.modalCard}>
            <View style={{ padding: 12 }}>
              <Text style={styles.h2}>Filtern, Sortieren, Gruppieren</Text>
              <View style={styles.row}>
                <View style={[styles.col, styles.mr8]}>
                  <Text style={styles.label}>Sortieren nach</Text>
                  <SimpleDropdown
                    data={[
                      { id: "created", name: "Hinzugefügt am" },
                      { id: "datetime", name: "Datum & Uhrzeit" },
                      { id: "priority", name: "Priorität" },
                    ]}
                    selectedId={sortBy}
                    onChange={(id) => setSortBy(id as any)}
                    placeholder="Sortieren nach"
                  />
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Richtung</Text>
                  <View style={{ flexDirection: "column", gap: 5 }}>
                    <TouchableOpacity onPress={() => setSortDir("asc")} style={[styles.chip, styles.mr6, sortDir === "asc" && styles.chipActive]}>
                      <Text style={styles.chipText}>Aufsteigend</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setSortDir("desc")} style={[styles.chip, sortDir === "desc" && styles.chipActive]}>
                      <Text style={styles.chipText}>Absteigend</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <Text style={styles.label}>Gruppieren nach</Text>
                <SimpleDropdown
                  data={[
                    { id: "none", name: "Keine" },
                    { id: "created", name: "Hinzugefügt am" },
                    { id: "datetime", name: "Datum & Uhrzeit" },
                    { id: "priority", name: "Priorität" },
                  ]}
                  selectedId={groupBy}
                  onChange={(id) => setGroupBy(id as any)}
                  placeholder="Gruppieren nach"
                />
              </View>
              <View style={[styles.row, { marginTop: 8 }]}>
                <TouchableOpacity onPress={() => setShowFilter(false)} style={[styles.btnLink, styles.mr8]}>
                  <Text style={styles.btnLinkText}>Übernehmen</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setGroupBy("none"); setSortBy("created"); setSortDir("desc"); }} style={styles.btnLink}>
                  <Text style={styles.btnLinkTextMuted}>Zurücksetzen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

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
        data={processTasks(currentList?.tasks ?? [], query)}
        keyExtractor={(item) => (item as any)._type === 'header' ? `h-${(item as any).key}` : (item as any).id}
        ListEmptyComponent={() => <Text style={styles.muted}>Keine Aufgaben in dieser Liste.</Text>}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={renderProcessedItem}
      />

      {!!(currentList?.archived?.length ?? 0) && (
        <>
          <Text style={styles.h2}>Archiviert</Text>
          <FlatList
            data={processTasks(currentList?.archived ?? [], query)}
            keyExtractor={(item) => (item as any)._type === 'header' ? `h-${(item as any).key}` : (item as any).id}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => {
              if ((item as any)._type === 'header') {
                const h = item as any;
                return <Text style={[styles.h2, { marginTop: 12 }]}>{h.label}</Text>;
              }
              const t = item as any as Task;
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
                      <Text style={styles.checkboxText}>✓</Text>
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
            }}
          />
        </>
      )}
    </View>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.select({ ios: 12, android: 8 }), paddingHorizontal: 12, backgroundColor: '#112a37' },
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

  h1: { fontSize: 22, fontWeight: '700', marginVertical: 20, bottom: -10, color: '#FFFFFF' },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 8, marginBottom: 6, color: '#E5F4EF' },

  row: { flexDirection: 'row' },
  col: { flex: 1 },

  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  dropdownPanel: {
    position: 'absolute',
    top: 200,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 300,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownClose: { padding: 10, alignItems: 'center' },

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
  btnLinkTextAddTask: { color: '#9AD0C1', fontWeight: '700', bottom: -10 },
  btnLinkText: { color: '#9AD0C1', fontWeight: '700' },
  btnLinkTextAdd: { color: '#9AD0C1', fontWeight: '700', top: -10 },
  btnLinkTextCancel: { color: '#C7D2D6', fontWeight: '600', top: -10 },
  btnLinkTextMuted: { color: '#C7D2D6', fontWeight: '600' },

  muted: { color: '#9CA3AF', marginVertical: 6, bottom: -20 },

  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#FFFFFF' },

  taskCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    bottom: -20,
  },
  archivedCard: { backgroundColor: '#F3F4F6' },

  taskRow: { flexDirection: 'row' },

  taskTitle: { fontSize: 16, fontWeight: '700', color: '#ffffffff' },
  taskDesc: { fontSize: 13, color: '#374151', marginTop: 2 },

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
});
