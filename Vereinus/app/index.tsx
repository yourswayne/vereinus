import { View, Text, StyleSheet, Button, BackHandler, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Modal, Pressable } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type Screen = 'home' | 'ankuendigung' | 'chat' | 'uebungen' | 'aufgaben';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const navigation = useNavigation<BottomTabNavigationProp<any>>();
  const insets = useSafeAreaInsets();
  const containerPaddings = { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 };
  // Chat state (template)
  const [messages, setMessages] = useState(
    [
      { id: 'm1', text: 'Hallo zusammen! 👋', from: 'other' as const, at: '09:30' },
      { id: 'm2', text: 'Hi! Training heute 18:00 Uhr?', from: 'me' as const, at: '09:31' },
      { id: 'm3', text: 'Ja, Treffpunkt in der Halle A.', from: 'other' as const, at: '09:32' },
    ]
  );
  const [draft, setDraft] = useState('');

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
        </View>
        <FlatList
          data={announcements}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24, width: '100%', maxWidth: 360 }}
          renderItem={({ item }) => (
            <View style={styles.card}> 
              <Text style={styles.annTitle}>{item.title}</Text>
              <Text style={styles.annMeta}>{formatDateDE(item.date)}</Text>
              <Text style={styles.annBody}>{item.body}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.text}>Keine Ankündigungen vorhanden.</Text>}
        />

        <TouchableOpacity style={[styles.button, { marginTop: 8 }]} onPress={() => setShowNewAnnouncement(true)}>
          <Text style={styles.buttonText}>+ Neue Ankündigung</Text>
        </TouchableOpacity>


        <Modal visible={showNewAnnouncement} transparent animationType="fade" onRequestClose={() => setShowNewAnnouncement(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowNewAnnouncement(false)} />
          <View style={styles.modalCenterWrap}>
            <View style={styles.modalCard}>
              <View style={{ padding: 12 }}>
                <Text style={[styles.sectionTitle,  ]}>Neue Ankündigung</Text>
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
                    onPress={() => {
                      const t = newTitle.trim();
                      const b = newBody.trim();
                      if (!t) return;
                      const today = new Date();
                      const date = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
                      setAnnouncements((prev) => [{ id: Math.random().toString(36).slice(2,10), title: t, body: b, date }, ...prev]);
                      setNewTitle('');
                      setNewBody('');
                      setShowNewAnnouncement(false);
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
      </SafeAreaView>
    );
  }

  if (screen === 'chat') {
    const renderItem = ({ item }: { item: typeof messages[number] }) => (
      <View style={[styles.bubbleRow, item.from === 'me' ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[styles.bubble, item.from === 'me' ? styles.bubbleMe : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, item.from === 'me' && { color: '#fff' }]}>{item.text}</Text>
          <Text style={styles.bubbleTime}>{item.at}</Text>
        </View>
      </View>
    );

    return (
      <KeyboardAvoidingView style={[styles.container, containerPaddings]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={() => setScreen('home')} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={22} color="#194055" />
          </TouchableOpacity>
          <Text style={[styles.title, { marginBottom: 0, left: 12 }]}>💬 Chat</Text>
          <View style={{ width: 60 }} />
        </View>
        <FlatList
          style={{ width: '100%' }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 12, width: '100%', maxWidth: 720 }}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
        />
        <View style={[styles.inputRow, { marginBottom: insets.bottom + 8}]}>
          <TextInput
            style={[styles.input, styles.inputMultiline, { flex: 1, marginBottom: 0, bottom: 60 }]}
            placeholder="Nachricht schreiben…"
            placeholderTextColor={'#95959588'}
            value={draft}
            onChangeText={setDraft}
            multiline
            scrollEnabled
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={[styles.sendBtn,]}
            onPress={() => {
              const txt = draft.trim();
              if (!txt) return;
              const now = new Date();
              const at = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
              setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2,10), text: txt, from: 'me', at }]);
              setDraft('');
            }}
          >
            <Ionicons name="mail-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (screen === 'uebungen') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>🏋️ Übungen</Text>
        <Text style={styles.text}>Hier könntest du Übungen, Trainingspläne oder Tipps darstellen.</Text>
        <Button title="Zurück" onPress={() => setScreen('home')} />
      </View>
    );
  }

  if (screen === 'aufgaben') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>📝 Aufgaben</Text>
        <Text style={styles.text}>Hier kommen To-Dos, Checklisten oder Aufgabenlisten hin.</Text>
        <Button title="Zurück" onPress={() => setScreen('home')} />
      </View>
    );
  }

  // --- Home-Screen mit Buttons ---
  return (
    <SafeAreaView style={[styles.container, containerPaddings]}>
      
      <Text style={styles.title}>Vereins Übersicht</Text>

      <TouchableOpacity style={styles.button} onPress={() => setScreen('ankuendigung')}>
        <Text style={styles.buttonText}>Ankündigungen</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => setScreen('chat')} >
        <Text style={styles.buttonText}>Chat</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => setScreen('uebungen')} >
        <Text style={styles.buttonText}>Übungen</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => setScreen('aufgaben')} >
        <Text style={styles.buttonText}>Aufgaben</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 20 },
  text: { fontSize: 16, textAlign: 'center', marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },

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
  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#FFFFFF', width: '100%' },
  annTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  annMeta: { fontSize: 12, color: '#6B7280', marginBottom: 6 },
  annBody: { fontSize: 14, color: '#111827' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  inputMultiline: { height: 44 },
  textarea: { height: 120 },

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
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', width: '100%', maxWidth: 720, marginTop: 6 },
  sendBtn: { paddingVertical: 10, paddingHorizontal: 14, marginLeft: 8, backgroundColor: '#194055', borderRadius: 12, alignItems: 'center', justifyContent: 'center', bottom: 60  },
  chatHeader: { width: '100%', maxWidth: 720, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerBack: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 4 },
  headerBackText: { color: '#194055', fontWeight: '600', marginLeft: 2 },
});

// Small helpers used above
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const formatDateDE = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
