import { View, Text, StyleSheet } from 'react-native';

export default function Tab() {
  return (
    <View style={styles.container}>
      <Text>Hier kommt die Aufgaben-Liste</Text>
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