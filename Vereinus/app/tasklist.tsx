import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
  Modal,
  Pressable,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';

// --- Types ---
type Priority = 'low' | 'medium' | 'high';

type BaseTask = {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  startAt?: string; // "YYYY-MM-DD HH:mm"
  endAt?: string; // "YYYY-MM-DD HH:mm"
  done?: boolean;
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

function SimpleDropdown<T extends { id: string; name: string }>(
  {
    data,
    selectedId,
    onChange,
    placeholder = 'Liste wählen…',
  }: {
    data: T[];
    selectedId?: string;
    onChange: (id: string) => void;
    placeholder?: string;
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
        <Text numberOfLines={1}>{selected?.name ?? placeholder}</Text>
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
          />
          <TouchableOpacity onPress={() => setOpen(false)} style={styles.dropdownClose}>
            <Text style={{ color: '#6B7280' }}>Schließen</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const PrioritySelector = ({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) => (
  <View style={styles.priorityRow}>
    {(['low', 'medium', 'high'] as Priority[]).map((p, i) => (
      <TouchableOpacity key={p} onPress={() => onChange(p)} style={[styles.chip, i !== 2 && styles.mr6, value === p && styles.chipActive]}>
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
            <TextInput value={startDate} placeholder="YYYY-MM-DD" placeholderTextColor={'#95959588'} onChangeText={(v) => onChange({ startAt: v ? v + (startTime ? ` ${startTime}` : '') : undefined })} style={styles.input} />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Von (Uhrzeit, optional)</Text>
            <TextInput value={startTime} placeholder="HH:mm" placeholderTextColor={'#95959588'} onChangeText={(v) => onChange({ startAt: startDate ? startDate + (v ? ` ${v}` : '') : undefined })} style={styles.input} />
          </View>
        </View>
        <View style={styles.row}>
          <View style={[styles.col, styles.mr8]}>
            <Text style={styles.label}>Bis (Datum)</Text>
            <TextInput value={endDate} placeholder="YYYY-MM-DD" placeholderTextColor={'#95959588'} onChangeText={(v) => onChange({ endAt: v ? v + (endTime ? ` ${endTime}` : '') : undefined })} style={styles.input} />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Bis (Uhrzeit, optional)</Text>
            <TextInput value={endTime} placeholder="HH:mm" placeholderTextColor={'#95959588'} onChangeText={(v) => onChange({ endAt: endDate ? endDate + (v ? ` ${v}` : '') : undefined })} style={styles.input} />
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
            <Text>{startDateLabel}</Text>
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
            <Text style={{ color: startAt ? '#111827' : '#6B7280' }}>{startTimeLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.col, styles.mr8]}>
          <Text style={styles.label}>Bis Datum</Text>
          <TouchableOpacity onPress={() => openDate('end')} style={styles.input}>
            <Text>{endDateLabel}</Text>
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
            <Text style={{ color: endAt ? '#111827' : '#6B7280' }}>{endTimeLabel}</Text>
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
  const [lists, setLists] = useState<TaskList[]>([
    { id: uid(), name: 'Schule', tasks: [], archived: [] },
    { id: uid(), name: 'Familie', tasks: [], archived: [] },
  ]);
  const [selectedListId, setSelectedListId] = useState<string | undefined>(undefined);

  // Draft editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Task>>({});

  // Form state
  const [showCreate, setShowCreate] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState<Priority>('medium');
  const [taskStart, setTaskStart] = useState<string>('');
  const [taskEnd, setTaskEnd] = useState<string>('');

  const [newListName, setNewListName] = useState('');

  const currentList = useMemo(() => lists.find((l) => l.id === selectedListId), [lists, selectedListId]);

  // Persistence
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STORAGE_KEY = '@vereinus/tasklists';
  const STORAGE_SEL = '@vereinus/selectedListId';

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
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lists)).catch(() => {});
      if (selectedListId) AsyncStorage.setItem(STORAGE_SEL, selectedListId).catch(() => {});
    }, 200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [lists, selectedListId]);

  // --- Listen ---
  const addList = () => {
    const name = newListName.trim();
    if (!name) return;
    const newL: TaskList = { id: uid(), name, tasks: [], archived: [] };
    setLists((prev) => [...prev, newL]);
    setNewListName('');
    setSelectedListId(newL.id);
  };
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

  // --- Render ---
  const renderTaskItem = ({ item: t }: { item: Task }) => {
    const mins = getDurationMinutes(t.startAt, t.endAt);
    const topLine = t.startAt || t.endAt ? `${formatDate(t.startAt)}${t.startAt && t.endAt ? ' – ' : ''}${formatDate(t.endAt)} ${durationLabel(mins)}` : '';
    const isEditing = editingId === t.id;
    const draft = drafts[t.id] ?? t;

    if (!isEditing) {
      return (
        <TouchableOpacity activeOpacity={0.7} onPress={() => beginEdit(t)} style={styles.taskCard}>
          {!!topLine && <Text style={styles.metaStrong}>{topLine.trim()}</Text>}
          <View style={styles.taskRow}>
            <Pressable
              onPress={(e) => {
                // prevent card onPress
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
              <Text style={styles.iconBtnText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.taskCard}>
        {!!topLine && <Text style={styles.metaStrong}>{topLine.trim()}</Text>}
        <View style={styles.taskRow}>
          <TouchableOpacity disabled style={[styles.checkbox, styles.mr8]}>
            <Text style={styles.checkboxText}></Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TextInput style={styles.input} value={draft.title} onChangeText={(v) => updateDraft({ title: v })} placeholder="Titel" placeholderTextColor={'#95959588'} />
            <TextInput style={[styles.input, { minHeight: 40 }]} value={draft.description ?? ''} onChangeText={(v) => updateDraft({ description: v })} placeholder="Beschreibung" placeholderTextColor={'#95959588'} multiline />
            <PrioritySelector value={draft.priority} onChange={(p) => updateDraft({ priority: p })} />
            <DateRangeInputs startAt={draft.startAt} endAt={draft.endAt} onChange={(patch) => updateDraft(patch)}/>
            <View style={styles.row}>
              <TouchableOpacity onPress={commitEdit} style={[styles.btnLink, styles.mr8]}>
                <Text style={styles.btnLinkText}>Speichern</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelEdit} style={styles.btnLink}>
                <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Aufgaben</Text>

      <View style={styles.row}>
        <View style={[styles.col, styles.mr8]}>
          <SimpleDropdown data={lists} selectedId={selectedListId} onChange={(val) => setSelectedListId(val)} placeholder="Liste wählen…" />
        </View>
        <TouchableOpacity onPress={deleteCurrentList} style={styles.iconBtn}>
          <Text style={styles.iconBtnText}>🗑️ Liste</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.row, { alignItems: 'center' }]}>
        <TextInput placeholder="Neue Liste (z. B. Einkauf)" placeholderTextColor={'#95959588'} value={newListName} onChangeText={setNewListName} style={[styles.input, styles.mr8, { flex: 1 }]} />
        <TouchableOpacity onPress={addList} style={styles.btnLink}>
          <Text style={styles.btnLinkText}>+ Liste</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => setShowCreate((s) => !s)} style={styles.btnLink}>
        <Text style={styles.btnLinkText}>+ Aufgabe hinzufügen</Text>
      </TouchableOpacity>

      {showCreate && (
        <View style={styles.card}>
          <TextInput placeholder="Titel" placeholderTextColor={'#95959588'} value={taskTitle} onChangeText={setTaskTitle} style={styles.input} />
          <TextInput placeholder="Beschreibung" placeholderTextColor={'#95959588'} value={taskDesc} onChangeText={setTaskDesc} style={[styles.input, { minHeight: 40 }]} multiline />
          <PrioritySelector value={taskPriority} onChange={setTaskPriority} />
          <DateRangeInputs
            startAt={taskStart}
            endAt={taskEnd}
            onChange={({ startAt, endAt }) => {
              if (startAt !== undefined) setTaskStart(startAt);
              if (endAt !== undefined) setTaskEnd(endAt);
            }}
          />
          <View style={styles.row}>
            <TouchableOpacity onPress={addTask} style={[styles.btnLink, styles.mr8]}>
              <Text style={styles.btnLinkText}>Speichern</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCreate(false)} style={styles.btnLink}>
              <Text style={styles.btnLinkTextMuted}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList data={currentList?.tasks ?? []} keyExtractor={(t) => t.id} ListEmptyComponent={() => <Text style={styles.muted}>Keine Aufgaben in dieser Liste.</Text>} contentContainerStyle={{ paddingBottom: 24 }} renderItem={renderTaskItem} />

      {!!(currentList?.archived?.length ?? 0) && (
        <>
          <Text style={styles.h2}>Archiviert</Text>
          <FlatList
            data={currentList?.archived ?? []}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item: t }) => {
              const mins = getDurationMinutes(t.startAt, t.endAt);
              const topLine = t.startAt || t.endAt ? `${formatDate(t.startAt)}${t.startAt && t.endAt ? ' – ' : ''}${formatDate(t.endAt)} ${durationLabel(mins)}` : '';
              return (
                <View style={[styles.taskCard, styles.archivedCard]}>
                  {!!topLine && <Text style={styles.metaStrong}>{topLine.trim()}</Text>}
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
  container: { flex: 1, paddingTop: Platform.select({ ios: 12, android: 8 }), paddingHorizontal: 12 },

  mr6: { marginRight: 6 },
  mr8: { marginRight: 8 },
  ml8: { marginLeft: 8 },

  h1: { fontSize: 22, fontWeight: '700', marginVertical: 20, bottom: -10 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 8, marginBottom: 6 },

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
    top: 120,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 300,
    overflow: 'hidden',
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
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  label: { fontSize: 12, color: '#6B7280', marginBottom: 4 },

  btnLink: { paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLinkText: { color: '#2563EB', fontWeight: '700' },
  btnLinkTextMuted: { color: '#6B7280', fontWeight: '600' },

  muted: { color: '#6B7280', marginVertical: 6 },

  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10 },

  taskCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  archivedCard: { backgroundColor: '#F3F4F6' },

  taskRow: { flexDirection: 'row', alignItems: 'flex-start' },

  taskTitle: { fontSize: 16, fontWeight: '700' },
  taskDesc: { fontSize: 13, color: '#374151', marginTop: 2 },

  meta: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  metaStrong: { fontSize: 12, color: '#111827', marginBottom: 6, fontWeight: '600' },

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

  priorityRow: { flexDirection: 'row', marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1' },
  chipActive: { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
  chipText: { fontSize: 12, fontWeight: '600' },
});
