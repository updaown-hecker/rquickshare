import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as Notifications from 'expo-notifications'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Mode = 'send' | 'receive'
type Transfer = { name: string; size?: number; state: 'waiting' | 'sending' | 'complete' }

const lime = '#c8f36d'

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`
}

export default function HomeScreen() {
  const [mode, setMode] = useState<Mode>('send')
  const [selected, setSelected] = useState<Transfer[]>([])
  const [scanning, setScanning] = useState(false)
  const [permissionNote, setPermissionNote] = useState(false)

  const status = useMemo(() => {
    if (selected.length) return scanning ? 'Looking for nearby devices…' : 'Native transport bridge ready'
    return mode === 'send' ? 'Choose something to send' : 'Visible to nearby devices'
  }, [mode, scanning, selected.length])

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false })
    if (result.canceled) return
    setSelected(result.assets.map((asset) => ({ name: asset.name, size: asset.size, state: 'waiting' })))
    setMode('send')
    setScanning(true)
    setTimeout(() => setScanning(false), 1200)
  }

  async function requestAccess() {
    const response = await Notifications.requestPermissionsAsync()
    setPermissionNote(response.status !== 'granted')
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.mark}>
              <View style={styles.barShort} />
              <View style={styles.bar} />
              <View style={styles.barMid} />
            </View>
            <View>
              <Text style={styles.kicker}>NEARBY TRANSFER</Text>
              <Text style={styles.brandText}>BlynxShare</Text>
            </View>
          </View>
          <View style={styles.status}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>Discoverable</Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.kicker}>{mode === 'send' ? 'SEND SOMETHING' : 'READY TO RECEIVE'}</Text>
          <Text style={styles.title}>{mode === 'send' ? 'Share without the friction.' : 'Your drop zone is ready.'}</Text>
          <Text style={styles.subtitle}>{mode === 'send' ? 'Fast, private transfers to devices nearby.' : 'Keep BlynxShare open while someone sends to you.'}</Text>
        </View>

        <View style={styles.tabs}>
          <Pressable onPress={() => setMode('send')} style={[styles.tab, mode === 'send' && styles.tabActive]}>
            <Text style={[styles.tabText, mode === 'send' && styles.tabTextActive]}>Send</Text>
          </Pressable>
          <Pressable onPress={() => setMode('receive')} style={[styles.tab, mode === 'receive' && styles.tabActive]}>
            <Text style={[styles.tabText, mode === 'receive' && styles.tabTextActive]}>Receive</Text>
          </Pressable>
        </View>

        {mode === 'send' && selected.length === 0 ? (
          <Pressable onPress={pickFiles} style={styles.dropCard}>
            <View style={styles.upload}>
              <Ionicons name="arrow-up" size={28} color="#151b14" />
            </View>
            <Text style={styles.cardTitle}>Choose files to share</Text>
            <Text style={styles.cardText}>Photos, documents, folders, and archives</Text>
            <View style={styles.choose}>
              <Ionicons name="add" size={16} color="#151b14" style={{ marginRight: 4 }} />
              <Text style={styles.chooseText}>Choose from device</Text>
            </View>
          </Pressable>
        ) : null}

        {mode === 'receive' ? (
          <View style={styles.receiveCard}>
            <View style={styles.radar}>
              <View style={styles.radarCore}>
                <Ionicons name="arrow-down" size={22} color="#151b14" />
              </View>
            </View>
            <Text style={styles.cardTitle}>Ready when you are.</Text>
            <Text style={styles.cardText}>Nearby transfers over Wi-Fi will appear here.</Text>
            <Pressable onPress={() => setScanning(true)} style={styles.secondary}>
              <Text style={styles.secondaryText}>{scanning ? 'Scanning…' : 'Start scanning'}</Text>
            </Pressable>
          </View>
        ) : null}

        {selected.length > 0 ? (
          <View style={styles.filesCard}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.kicker}>READY TO SHARE</Text>
                <Text style={styles.cardTitle}>{selected.length} {selected.length === 1 ? 'item' : 'items'} selected</Text>
              </View>
              <Pressable onPress={() => setSelected([])} hitSlop={10}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            </View>

            {selected.map((file) => (
              <View style={styles.file} key={file.name}>
                <View style={styles.fileIcon}>
                  <Ionicons name="document-text-outline" size={18} color={lime} />
                </View>
                <View style={styles.fileCopy}>
                  <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.fileState}>
                    {file.size ? `${formatBytes(file.size)} · ` : ''}
                    {file.state === 'complete' ? 'Sent successfully' : file.state === 'sending' ? 'Sending…' : 'Ready to share'}
                  </Text>
                </View>
                <Ionicons
                  name={file.state === 'complete' ? 'checkmark-circle' : 'ellipsis-horizontal-circle'}
                  size={20}
                  color={file.state === 'complete' ? lime : '#747b84'}
                />
              </View>
            ))}

            <View style={styles.scanLine}>
              <View style={styles.dot} />
              <Text style={styles.scanText}>{status}</Text>
            </View>
          </View>
        ) : null}

        {mode === 'send' && selected.length > 0 ? (
          <View style={styles.nearby}>
            <Text style={styles.kicker}>NATIVE TRANSPORT</Text>
            <Text style={styles.muted}>
              File selection is verified and ready. Quick Share discovery and encrypted transfer require the platform bridge described in mobile/README.md; no fake device or transfer is shown.
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Private by design · Same Wi-Fi network</Text>
          <Pressable onPress={requestAccess}>
            <Text style={styles.footerLink}>Permissions</Text>
          </Pressable>
        </View>

        {permissionNote ? (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={lime} />
            <Text style={styles.noticeText}>Local network and notification access help BlynxShare discover and notify you about transfers.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0e1014' },
  page: { padding: 22, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 30 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  mark: { width: 28, height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3.5, transform: [{ rotate: '-24deg' }] },
  barShort: { width: 5, height: 13, borderRadius: 4, backgroundColor: lime, opacity: 0.55 },
  bar: { width: 5, height: 24, borderRadius: 4, backgroundColor: lime },
  barMid: { width: 5, height: 16, borderRadius: 4, backgroundColor: lime, opacity: 0.75 },
  kicker: { color: '#68707b', fontSize: 9, letterSpacing: 1.4, fontWeight: '700' },
  brandText: { color: '#f5f6f8', fontSize: 18, fontWeight: '700', marginTop: 1, letterSpacing: -0.3 },
  status: { flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: lime },
  statusText: { color: '#9ba1ab', fontSize: 11, fontWeight: '500' },
  intro: { paddingBottom: 20 },
  title: { color: '#f5f6f8', fontSize: 28, fontWeight: '700', letterSpacing: -1, marginTop: 8, lineHeight: 34 },
  subtitle: { color: '#969da8', fontSize: 13, marginTop: 6, lineHeight: 18 },
  tabs: { borderBottomColor: '#20242b', borderBottomWidth: 1, flexDirection: 'row', gap: 24, marginBottom: 18 },
  tab: { paddingBottom: 11 },
  tabActive: { borderBottomColor: lime, borderBottomWidth: 2 },
  tabText: { color: '#6e7580', fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#f5f6f8', fontWeight: '600' },
  dropCard: { minHeight: 250, borderColor: 'rgba(198,243,110,.25)', borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.02)', padding: 20 },
  upload: { width: 54, height: 54, borderRadius: 15, backgroundColor: 'rgba(198,243,110,.14)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#f5f6f8', fontSize: 18, fontWeight: '700', marginTop: 13, letterSpacing: -0.3 },
  cardText: { color: '#8d949e', fontSize: 12, marginTop: 4, textAlign: 'center' },
  choose: { backgroundColor: lime, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 16, marginTop: 18, flexDirection: 'row', alignItems: 'center' },
  chooseText: { color: '#101510', fontSize: 12, fontWeight: '700' },
  receiveCard: { padding: 26, minHeight: 230, borderRadius: 16, backgroundColor: '#16181e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  radar: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', borderRadius: 45, borderColor: 'rgba(198,243,110,.28)', borderWidth: 1 },
  radarCore: { width: 38, height: 38, borderRadius: 20, backgroundColor: lime, alignItems: 'center', justifyContent: 'center' },
  secondary: { marginTop: 18, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  secondaryText: { color: '#f5f6f8', fontSize: 12, fontWeight: '600' },
  filesCard: { padding: 18, borderRadius: 16, backgroundColor: '#16181e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  clear: { color: '#a3a9b3', fontSize: 12, fontWeight: '500' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopColor: '#20242b', borderTopWidth: 1 },
  fileIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(198,243,110,.1)' },
  fileCopy: { flex: 1 },
  fileName: { color: '#e6e8eb', fontSize: 12, fontWeight: '500' },
  fileState: { color: '#777f89', fontSize: 11, marginTop: 2 },
  scanLine: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 14, borderTopColor: '#20242b', borderTopWidth: 1, marginTop: 4 },
  scanText: { color: '#969da8', fontSize: 11 },
  nearby: { marginTop: 24, padding: 16, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  muted: { color: '#8a929d', fontSize: 12, marginTop: 8, lineHeight: 17 },
  footer: { marginTop: 32, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerText: { color: '#626a75', fontSize: 11 },
  footerLink: { color: lime, fontSize: 11, fontWeight: '600' },
  notice: { marginTop: 16, flexDirection: 'row', gap: 9, padding: 12, borderRadius: 10, backgroundColor: 'rgba(198,243,110,.08)', borderWidth: 1, borderColor: 'rgba(198,243,110,0.15)' },
  noticeText: { flex: 1, color: '#aeb5bd', fontSize: 11, lineHeight: 16 }
})
