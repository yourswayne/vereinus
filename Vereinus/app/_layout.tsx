import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect, Slot, usePathname } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function RootLayout() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthed(!!s?.user);
    });
    return () => { sub.subscription.unsubscribe(); mounted = false; };
  }, []);

  if (authed === null) return null;
  if (!authed) {
    // Allow the login route to render without tabs
    if (pathname === '/login') return <Slot />;
    return <Redirect href="/login" />;
  }

  return (
   <SafeAreaProvider>
   <NativeTabs>
        <NativeTabs.Trigger name="news">
        <Icon sf="bell.fill" />
        <Label >Neuigkeiten</Label>
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
   </SafeAreaProvider>
  );


}
