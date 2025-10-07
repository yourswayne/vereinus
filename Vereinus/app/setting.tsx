import { View, Text, StyleSheet } from 'react-native';

export default function Setting() {
  return (
    <View style={styles.container}>
      <Text>Hier kommt die Einstellungen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});