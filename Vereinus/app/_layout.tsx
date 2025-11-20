import React, { useEffect, useState } from 'react';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { View, Platform, PlatformColor, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect, Slot, usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '../lib/supabase';

export default function RootLayout() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
	let mounted = true;

	supabase.auth.getSession().then(({ data }: { data: { session: any | null } }) => {
	  if (!mounted) return;
	  setAuthed(!!data.session);
	});

	const { data: subscription } = supabase.auth.onAuthStateChange((_e: string, s: any) => {
	  setAuthed(!!s?.user);
	});

	return () => {
	  // unsubscribe safely if present
	  subscription?.subscription?.unsubscribe?.();
	  mounted = false;
	};
  }, []);

  if (authed === null) return null;

  if (!authed) {
	// Allow the login route to render without tabs
	if (pathname === '/login') return <Slot />;
	return <Redirect href="/login" />;
  }

  // Ensure dark-aware colors for iOS liquid glass and stable colors elsewhere
  const tabBg = Platform.OS === 'ios' ? PlatformColor('systemBackground') : '#112a37';
  const tabFg = Platform.OS === 'ios' ? PlatformColor('label') : '#E5F4EF';

  return (
	<GestureHandlerRootView style={{ flex: 1 }}>
	  <SafeAreaProvider>
		<View style={{ flex: 1, backgroundColor: tabBg }}>
		  <NativeTabs>
			<NativeTabs.Trigger name="news">
			  <Icon sf="bell.fill" selectedColor={tabFg} />
			  <Label>Neuigkeiten</Label>
			</NativeTabs.Trigger>

			<NativeTabs.Trigger name="calender">
			  <Icon sf="calendar" selectedColor={tabFg} />
			  <Label>Kalender</Label>
			</NativeTabs.Trigger>

			<NativeTabs.Trigger name="index">
			  <Label>Verein</Label>
			  <Icon sf="house.fill" selectedColor={tabFg} />
			</NativeTabs.Trigger>

			<NativeTabs.Trigger name="tasklist">
			  <Icon sf="text.badge.checkmark" selectedColor={tabFg} />
			  <Label>Aufgaben</Label>
			</NativeTabs.Trigger>

			<NativeTabs.Trigger name="setting">
			  <Icon sf="gear" selectedColor={tabFg} />
			  <Label>Einstellung</Label>
			</NativeTabs.Trigger>
		  </NativeTabs>
		</View>
	  </SafeAreaProvider>
	</GestureHandlerRootView>
  );
}
