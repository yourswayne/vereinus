import { View, Text, StyleSheet, Button, BackHandler, TouchableOpacity } from 'react-native';
import { useEffect, useState } from 'react';

type Screen = 'home' | 'ankuendigung' | 'chat' | 'uebungen' | 'aufgaben';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');

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


  if (screen === 'ankuendigung') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>📢 Ankündigungen</Text>
        <Text style={styles.text}>Hier könnten Infos und Nachrichten für den Verein stehen.</Text>
        <Button title="Zurück" onPress={() => setScreen('home')} />
      </View>
    );
  }

  if (screen === 'chat') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>💬 Chat</Text>
        <Text style={styles.text}>Hier ist der Platzhalter für die Chat-Funktion.</Text>
        <Button title="Zurück" onPress={() => setScreen('home')} />
      </View>
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
    <View style={styles.container}>
      
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

    </View >
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 20 },
  text: { fontSize: 16, textAlign: 'center', marginBottom: 20 },

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
});

