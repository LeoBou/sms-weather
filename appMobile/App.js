import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, ScrollView, TouchableOpacity, 
  SafeAreaView, AppState, Alert 
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';

// --- BASE64 POLYFILL ---
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const atob = (input = '') => {
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) throw new Error("Invalid Base64 string");
  for (let bc = 0, bs, buffer, i = 0; (buffer = str.charAt(i++)); ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4) ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
};

// --- THE DECOMPRESSOR LOGIC ---
function decompressWeather(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    let p = 0;

    const ut = (v) => v - 40;
    const uw = (v) => v * 5;
    const upop = (v) => Math.round((v / 15) * 100);
    const uprec = (v) => {
        if (v === 0) return "None";
        const amts = [0, 0.5, 1, 2, 5, 8, 12, 25];
        return `${amts[v % 8]}mm ${v >= 8 ? 'Snow' : 'Rain'}`;
    };

    const data = { current: {}, hourly: [], daily: [] };

    // 1. CURRENT
    const day = view.getUint8(p++);
    const month = view.getUint8(p++);
    const startHour = view.getUint8(p++);

    data.current = {
        date: `${day}/${month}`,
        temp: ut(view.getUint8(p++)),
        feels: ut(view.getUint8(p++)),
        sunrise: `${view.getUint8(p++)}:${view.getUint8(p++).toString().padStart(2,'0')}`,
        sunset: `${view.getUint8(p++)}:${view.getUint8(p++).toString().padStart(2,'0')}`,
        wind: view.getUint8(p++),
        gust: view.getUint8(p++)
    };

    // 2. HOURLY
    for (let i = 0; i < 16; i++) {
        const tv = ut(view.getUint8(p++)),
            fv = ut(view.getUint8(p++));
        const bW = view.getUint8(p++),
            bP = view.getUint8(p++);

        // Calculate the actual clock hour
        const currentHour = (startHour + (i * 2)) % 24;

        data.hourly.push({
            time: `${currentHour}:00`,
            temp: tv,
            feels: fv,
            wind: uw(bW >> 4),
            gust: uw(bW & 0x0F),
            pop: upop(bP >> 4),
            precip: uprec(bP & 0x0F)
        });
    }

    // 3. DAILY
    let dateTracker = new Date();
    dateTracker.setMonth(month - 1);
    dateTracker.setDate(day);

    for (let i = 0; i < 7; i++) {
        const temps = { morn: ut(view.getUint8(p++)), day: ut(view.getUint8(p++)), eve: ut(view.getUint8(p++)), night: ut(view.getUint8(p++)) };
        const bMisc = view.getUint8(p++),
            bPrec = view.getUint8(p++);

        data.daily.push({
            date: `${dateTracker.getDate()}/${dateTracker.getMonth() + 1}`,
            ...temps,
            wind: uw(bMisc >> 4),
            pop: upop(bMisc & 0x0F),
            precip: uprec(bPrec)
        });
        dateTracker.setDate(dateTracker.getDate() + 1);
    }

    return data;
}


export default function App() {
  const [weather, setWeather] = useState(null);
  const [status, setStatus] = useState('Copy weather SMS then open app');

  const checkClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (text && text.includes('WX:')) {
      const base64 = text.split('WX:')[1].trim();
      const result = decompressWeather(base64);
      if (result) { setWeather(result); setStatus('Updated: ' + new Date().toLocaleTimeString()); }
    }
  };

  useEffect(() => {
    checkClipboard();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && checkClipboard());
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>Weather Dashboard</Text>
        <Text style={styles.status}>{status}</Text>
      </View>

      <TouchableOpacity style={styles.btn} onPress={checkClipboard}>
        <Text style={styles.btnText}>MANUAL REFRESH</Text>
      </TouchableOpacity>

      {weather ? (
        <ScrollView style={{padding: 15}} showsVerticalScrollIndicator={false}>
          {/* CURRENT SECTION */}
          <View style={styles.card}>
            <Text style={styles.label}>RIGHT NOW ({weather.current.date})</Text>
            <View style={styles.mainRow}>
              <Text style={styles.mainTemp}>{weather.current.temp}°</Text>
              <View>
                <Text style={styles.feelsLike}>Feels {weather.current.feels}°</Text>
                <Text style={styles.popText}>💧 Pop: {weather.current.pop}%</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.stat}><Text style={styles.statLabel}>WIND</Text><Text>{weather.current.wind}km/h</Text></View>
              <View style={styles.stat}><Text style={styles.statLabel}>GUST</Text><Text>{weather.current.gust}km/h</Text></View>
              <View style={styles.stat}><Text style={styles.statLabel}>PRECIP</Text><Text>{weather.current.precip}</Text></View>
            </View>
            <View style={[styles.statsRow, {marginTop: 15, borderTopWidth:0.5, borderColor:'#eee', paddingTop:10}]}>
              <Text style={styles.sun}>🌅 Sunrise: {weather.current.sunrise}</Text>
              <Text style={styles.sun}>🌇 Sunset: {weather.current.sunset}</Text>
            </View>
          </View>

          {/* HOURLY SECTION */}
          <Text style={styles.secTitle}>HOURLY FORECAST (32H)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
            {weather.hourly.map((h, i) => (
              <View key={i} style={styles.hCard}>
                <Text style={styles.hTime}>{h.time}</Text>
                <Text style={styles.hTemp}>{h.temp}°</Text>
                <Text style={styles.hFeels}>FL {h.feels}°</Text>
                <Text style={styles.hPop}>💧{h.pop}%</Text>
                <Text style={styles.hWind}>🌬️{h.wind}G{h.gust}</Text>
              </View>
            ))}
          </ScrollView>

          {/* DAILY SECTION */}
          <Text style={styles.secTitle}>7 DAY OUTLOOK</Text>
          {weather.daily.map((d, i) => (
            <View key={i} style={styles.dCard}>
              <View style={styles.dHeader}>
                <Text style={styles.dDate}>{d.date}</Text>
                <Text style={styles.dPrecip}>{d.precip} ({d.pop}%)</Text>
              </View>
              <View style={styles.dGrid}>
                <View style={styles.dGridItem}><Text style={styles.dGridLabel}>MORN</Text><Text style={styles.dGridTemp}>{d.morn}°</Text></View>
                <View style={styles.dGridItem}><Text style={styles.dGridLabel}>DAY</Text><Text style={styles.dGridTemp}>{d.day}°</Text></View>
                <View style={styles.dGridItem}><Text style={styles.dGridLabel}>EVE</Text><Text style={styles.dGridTemp}>{d.eve}°</Text></View>
                <View style={styles.dGridItem}><Text style={styles.dGridLabel}>NIGHT</Text><Text style={styles.dGridTemp}>{d.night}°</Text></View>
                <View style={[styles.dGridItem, {borderLeftWidth:1, borderColor:'#eee'}]}><Text style={styles.dGridLabel}>WIND</Text><Text style={styles.dGridTemp}>{d.wind}</Text></View>
              </View>
            </View>
          ))}
          <View style={{height: 40}} />
        </ScrollView>
      ) : (
        <View style={styles.empty}><Text>No data. Copy SMS and return here.</Text></View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f7' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1a1a1a' },
  status: { fontSize: 12, color: '#007AFF', marginTop: 4 },
  btn: { backgroundColor: '#007AFF', margin: 15, padding: 15, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 16, elevation: 4, shadowOpacity: 0.1, shadowRadius: 8 },
  label: { fontSize: 12, fontWeight: 'bold', color: '#999', marginBottom: 10 },
  mainRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  mainTemp: { fontSize: 68, fontWeight: '200', marginRight: 20, color: '#1a1a1a' },
  feelsLike: { fontSize: 20, color: '#444' },
  popText: { fontSize: 14, color: '#007AFF', marginTop: 5 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center' },
  statLabel: { fontSize: 10, fontWeight: 'bold', color: '#aaa', marginBottom: 2 },
  sun: { fontSize: 12, color: '#666' },
  secTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 25, marginBottom: 12, color: '#444', marginLeft: 5 },
  hScroll: { marginBottom: 10 },
  hCard: { backgroundColor: '#fff', padding: 12, borderRadius: 12, marginRight: 8, alignItems: 'center', width: 90 },
  hTime: { fontSize: 12, fontWeight: 'bold', color: '#888' },
  hTemp: { fontSize: 22, fontWeight: 'bold', marginVertical: 4 },
  hFeels: { fontSize: 11, color: '#666' },
  hPop: { fontSize: 11, color: '#007AFF', marginVertical: 2 },
  hWind: { fontSize: 10, color: '#d9534f' },
  dCard: { backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10 },
  dHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderColor: '#f9f9f9', paddingBottom: 5 },
  dDate: { fontWeight: 'bold', fontSize: 16 },
  dPrecip: { color: '#007AFF', fontWeight: '500' },
  dGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  dGridItem: { alignItems: 'center', flex: 1 },
  dGridLabel: { fontSize: 9, color: '#aaa', fontWeight: 'bold' },
  dGridTemp: { fontSize: 15, fontWeight: 'bold', marginTop: 2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
