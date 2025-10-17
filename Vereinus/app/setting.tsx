import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';

export default function Setting() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Einstellungen</Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={async () => {
          await supabase.auth.signOut();
          // RootLayout leitet automatisch zu /login um
        }}
      >
        <Text style={styles.btnText}>Abmelden</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  btn: { backgroundColor: '#A93226', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
});
