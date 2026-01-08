// CommonJS – robust env loader without dotenv dependency.
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const CANDIDATES = [
  join(__dirname, '.env'),
  join(__dirname, 'vereins_app.env'),
  join(__dirname, 'verins_app.env'),
  join(__dirname, 'Vereinus', 'vereins_app.env'),
];

function loadEnvFile(filePath) {
  try {
    if (!existsSync(filePath)) return;
    const text = readFileSync(filePath, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = (raw || '').replace(/^\uFEFF/, '').trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      let key = line.slice(0, eq).trim();
      // Remove potential BOMs in key
      key = key.replace(/^\uFEFF/, '');
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    // ignore
  }
}

// Load the first existing env file from candidates
for (const p of CANDIDATES) {
  if (existsSync(p)) { loadEnvFile(p); break; }
}

module.exports = ({ config }) => {
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  const hasImagePicker = plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-image-picker');
  if (!hasImagePicker) {
    plugins.push([
      'expo-image-picker',
      {
        photosPermission: 'Allow access to your photos.',
        cameraPermission: 'Allow access to your camera.',
        microphonePermission: 'Allow access to your microphone.',
      },
    ]);
  }

  return {
    ...config,
    ios: {
      ...(config.ios || {}),
      infoPlist: {
        ...((config.ios && config.ios.infoPlist) || {}),
        NSCameraUsageDescription: 'Allow access to your camera.',
        NSPhotoLibraryUsageDescription: 'Allow access to your photos.',
        NSMicrophoneUsageDescription: 'Allow access to your microphone.',
      },
    },
    plugins,
    extra: {
      ...(config.extra || {}),
      // Hardcoded for now as requested
      EXPO_PUBLIC_SUPABASE_URL: 'https://jeruntnmpdiijlqkfpfr.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcnVudG5tcGRpaWpscWtmcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1MjAyOTUsImV4cCI6MjA3NjA5NjI5NX0.6s-8etdG2YALLnnq7ob8W0bw7sZj3_LsOU2UWXr4MyE',
    },
  };
};
