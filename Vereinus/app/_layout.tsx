import { Stack } from "expo-router";
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

export default function RootLayout() {
  return (

   <NativeTabs>
        <NativeTabs.Trigger name="news">
        <Icon sf="bell.fill" />
        <Label>Neuigkeiten</Label>
      </NativeTabs.Trigger>
    <NativeTabs.Trigger name="calender">
        <Icon sf="calendar" />
        <Label>Kalender</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <Label>Verein</Label>
        <Icon sf="house.fill"  />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasklist">
        <Icon sf="text.badge.checkmark" />
        <Label>Aufgaben</Label>
      </NativeTabs.Trigger>
            <NativeTabs.Trigger name="setting">
        <Icon sf="gear" />
        <Label>Einstellung</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
