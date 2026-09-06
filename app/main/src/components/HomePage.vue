<script setup lang="ts">
/* The existing project enforces tabs and multiline templates; this screen is intentionally authored as a compact component. */
/* eslint-disable indent, vue/script-indent, vue/html-indent, vue/singleline-html-element-content-newline, vue/html-self-closing */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getStore, type Store } from '@tauri-apps/plugin-store'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { disable, enable } from '@tauri-apps/plugin-autostart'

import type { ChannelMessage } from '@martichou/core_lib/bindings/ChannelMessage'
import type { EndpointInfo } from '@martichou/core_lib/bindings/EndpointInfo'
import type { OutboundPayload } from '@martichou/core_lib/bindings/OutboundPayload'
import type { DeviceType } from '@martichou/core_lib/bindings/DeviceType'
import type { Visibility } from '@martichou/core_lib/bindings/Visibility'
import type { State } from '@martichou/core_lib/bindings/State'
import { autostartKey, downloadPathKey, numberToVisibility, visibilityKey, visibilityToNumber } from '../vue_lib/types'

const store = ref<Store | null>(null)
const mode = ref<'send' | 'receive'>('send')
const requests = ref<ChannelMessage[]>([])
const endpoints = ref<EndpointInfo[]>([])
const outbound = ref<OutboundPayload>()
const isScanning = ref(false)
const isDragHovering = ref(false)
const settingsOpen = ref(false)
const historyOpen = ref(false)
const visibility = ref<Visibility>('Visible')
const hostname = ref('This Linux computer')
const version = ref('0.11.5')
const downloadPath = ref<string>()
const autoStart = ref(true)
const keepRunning = ref(true)
const unlisten: UnlistenFn[] = []

const activeTransfer = computed(() => requests.value.find((request) => ['SentIntroduction', 'SendingFiles', 'ReceivingFiles', 'WaitingForUserConsent'].includes(request.state ?? 'Initial')))
const completedTransfers = computed(() => requests.value.filter((request) => request.state === 'Finished'))
const currentFiles = computed(() => outbound.value?.Files ?? [])
const displayName = computed(() => hostname.value || 'This Linux computer')
const nearbyCount = computed(() => endpoints.value.length)
const transferProgress = computed(() => {
  const meta = activeTransfer.value?.meta
  if (!meta || !meta.total_bytes) return 0
  return Math.min(100, Math.round((Number(meta.ack_bytes ?? 0) / Number(meta.total_bytes)) * 100))
})

function iconFor(type?: DeviceType | null) {
  if (type === 'Phone') return '▯'
  if (type === 'Tablet') return '▤'
  if (type === 'Laptop') return '▰'
  return '◌'
}

function fileName(path: string) {
  return path.split('/').pop() || path
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`
}

function stateLabel(state?: State | null) {
  const labels: Record<string, string> = {
    WaitingForUserConsent: 'Waiting for approval',
    SentIntroduction: 'Connecting',
    SendingFiles: 'Sending',
    ReceivingFiles: 'Receiving',
    Finished: 'Complete',
    Cancelled: 'Canceled',
    Rejected: 'Declined',
    Disconnected: 'Connection lost',
  }
  return labels[state ?? ''] ?? 'Ready'
}

async function selectFiles() {
  const selected = await openDialog({ title: 'Choose files to share', multiple: true, directory: false })
  if (!selected) return
  const files = Array.isArray(selected) ? selected : [selected]
  outbound.value = { Files: files }
  mode.value = 'send'
  await startDiscovery()
}

async function startDiscovery() {
  if (isScanning.value) return
  isScanning.value = true
  try {
    await invoke('start_discovery')
  } catch (error) {
    console.error('Unable to start discovery', error)
    isScanning.value = false
  }
}

async function stopSharing() {
  await invoke('stop_discovery')
  outbound.value = undefined
  endpoints.value = []
  isScanning.value = false
}

async function sendTo(endpoint: EndpointInfo) {
  if (!outbound.value || !endpoint.ip || !endpoint.port) return
  await invoke('send_payload', {
    message: { id: endpoint.id, name: endpoint.name ?? 'Nearby device', addr: `${endpoint.ip}:${endpoint.port}`, ob: outbound.value },
  })
}

async function respond(id: string, action: 'AcceptTransfer' | 'RejectTransfer' | 'CancelTransfer') {
  await invoke('send_to_rs', { message: { id, direction: 'FrontToLib', action, meta: null, state: null, rtype: null } })
}

async function chooseDownloadFolder() {
  const selected = await openDialog({ title: 'Choose download folder', directory: true, multiple: false })
  if (!selected || Array.isArray(selected)) return
  await invoke('change_download_path', { message: selected })
  downloadPath.value = selected
  await store.value?.set(downloadPathKey, selected)
  await store.value?.save()
}

async function setVisibility(next: Visibility) {
  visibility.value = next
  await invoke('change_visibility', { message: next })
  await store.value?.set(visibilityKey, visibilityToNumber[next])
  await store.value?.save()
}

async function toggleVisibility() {
  await setVisibility(visibility.value === 'Visible' ? 'Invisible' : 'Visible')
}

async function toggleAutoStart() {
  autoStart.value = !autoStart.value
  if (autoStart.value) await enable()
  else await disable()
  await store.value?.set(autostartKey, autoStart.value)
  await store.value?.save()
}

async function hydrate() {
  store.value = await getStore('.settings.json')
  hostname.value = String(await invoke('get_hostname') || 'This Linux computer')
  version.value = await getVersion()
  visibility.value = numberToVisibility[Number(await store.value?.get(visibilityKey) ?? 0)] ?? 'Visible'
  downloadPath.value = await store.value?.get(downloadPathKey) ?? undefined
  autoStart.value = await store.value?.get(autostartKey) ?? true
  if (!await isPermissionGranted()) await requestPermission()
}

function mergeRequest(message: ChannelMessage) {
  const index = requests.value.findIndex((item) => item.id === message.id)
  if (index >= 0) requests.value.splice(index, 1, { ...requests.value[index], ...message, meta: message.meta ?? requests.value[index].meta })
  else requests.value.unshift(message)
}

function mergeEndpoint(endpoint: EndpointInfo) {
  const index = endpoints.value.findIndex((item) => item.id === endpoint.id)
  if (endpoint.present === false) {
    if (index >= 0) endpoints.value.splice(index, 1)
  } else if (index >= 0) endpoints.value.splice(index, 1, endpoint)
  else endpoints.value.push(endpoint)
}

onMounted(async () => {
  await hydrate()
  unlisten.push(await listen<ChannelMessage>('rs2js_channelmessage', (event) => mergeRequest(event.payload)))
  unlisten.push(await listen<EndpointInfo>('rs2js_endpointinfo', (event) => mergeEndpoint(event.payload)))
  unlisten.push(await listen('visibility_updated', () => hydrate()))
  unlisten.push(await getCurrentWindow().onDragDropEvent(async (event) => {
    if (event.payload.type === 'over') isDragHovering.value = true
    if (event.payload.type === 'leave') isDragHovering.value = false
    if (event.payload.type === 'drop') {
      isDragHovering.value = false
      outbound.value = { Files: event.payload.paths }
      mode.value = 'send'
      await startDiscovery()
    }
  }))
  await nextTick()
})

onUnmounted(() => unlisten.forEach((stop) => stop()))
</script>

<template>
  <main class="shell" :class="{ 'is-dragging': isDragHovering }">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div><div class="eyebrow">NEARBY TRANSFER</div><div class="brand-name">BlynxShare</div></div>
      </div>
      <div class="topbar-actions">
        <button class="connection-pill" @click="toggleVisibility" :title="`Visibility: ${visibility}`">
          <span class="live-dot" :class="{ muted: visibility === 'Invisible' }"></span>{{ visibility === 'Invisible' ? 'Hidden' : 'Discoverable' }}
        </button>
        <button class="icon-button" title="Transfer history" @click="historyOpen = !historyOpen">◷</button>
        <button class="avatar" title="Settings" @click="settingsOpen = true">{{ displayName.slice(0, 1).toUpperCase() }}</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="rail">
        <button class="rail-item active"><span class="rail-icon">↗</span><span>Share</span></button>
        <button class="rail-item" @click="mode = 'receive'; startDiscovery()"><span class="rail-icon">↙</span><span>Receive</span></button>
        <div class="rail-spacer"></div>
        <button class="rail-item" @click="settingsOpen = true"><span class="rail-icon">⚙</span><span>Settings</span></button>
        <div class="version">v{{ version }}</div>
      </aside>

      <section class="content-panel">
        <div class="content-header">
          <div><div class="eyebrow">{{ mode === 'send' ? 'SEND SOMETHING' : 'READY TO RECEIVE' }}</div><h1>{{ mode === 'send' ? 'Share without the friction.' : 'Your drop zone is ready.' }}</h1><p>{{ mode === 'send' ? 'Fast, private transfers to devices nearby.' : 'Keep this window open while someone sends to you.' }}</p></div>
          <div class="device-chip"><span class="chip-icon">▰</span><span><small>THIS DEVICE</small><strong>{{ displayName }}</strong></span></div>
        </div>

        <div class="mode-switcher"><button :class="{ selected: mode === 'send' }" @click="mode = 'send'">Send</button><button :class="{ selected: mode === 'receive' }" @click="mode = 'receive'; startDiscovery()">Receive</button></div>

        <div v-if="mode === 'send' && !outbound && !activeTransfer" class="hero-card" :class="{ hovering: isDragHovering }" @click="selectFiles">
          <div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-orbit orbit-three"></div>
          <div class="upload-glyph">↑</div><h2>Drop files here</h2><p>or choose anything from your computer</p><button class="primary-button" @click.stop="selectFiles"><span>＋</span> Choose files</button><div class="hint"><kbd>⌘</kbd><span>Drag & drop is supported</span></div>
        </div>

        <div v-else-if="mode === 'send' && outbound && !activeTransfer" class="selected-card">
          <div class="selected-header"><div><div class="eyebrow">READY TO SHARE</div><h2>{{ currentFiles.length }} {{ currentFiles.length === 1 ? 'item' : 'items' }} selected</h2></div><button class="text-button" @click="stopSharing">Clear</button></div>
          <div class="file-list"><div v-for="file in currentFiles" :key="file" class="file-row"><div class="file-icon">▧</div><div class="file-info"><strong>{{ fileName(file) }}</strong><span>{{ file }}</span></div><div class="file-check">✓</div></div></div>
          <div class="share-next"><span class="pulse-ring"></span><span>Looking for nearby devices</span><span class="scan-count">{{ nearbyCount }} found</span></div>
        </div>

        <div v-else class="receive-card"><div class="receive-radar"><span></span><span></span><span></span><div>↙</div></div><div><div class="eyebrow">LISTENING FOR DEVICES</div><h2>Ready when you are.</h2><p>Nearby devices will appear here when they start a transfer.</p></div><button class="secondary-button" @click="startDiscovery">{{ isScanning ? 'Scanning…' : 'Start scanning' }}</button></div>

        <div v-if="mode === 'send' && outbound && !activeTransfer && endpoints.length" class="device-section"><div class="section-heading"><span>NEARBY DEVICES</span><small>{{ endpoints.length }} available</small></div><div class="device-grid"><button v-for="endpoint in endpoints" :key="endpoint.id" class="nearby-device" @click="sendTo(endpoint)"><span class="device-glyph">{{ iconFor(endpoint.rtype) }}</span><span><strong>{{ endpoint.name || 'Nearby device' }}</strong><small>{{ endpoint.rtype || 'Device' }}</small></span><span class="device-arrow">→</span></button></div></div>

        <div v-if="activeTransfer" class="transfer-card"><div class="transfer-top"><div class="transfer-state"><span class="transfer-spinner"></span><div><div class="eyebrow">{{ stateLabel(activeTransfer.state) }}</div><h2>{{ activeTransfer.meta?.source?.name || 'Nearby device' }}</h2></div></div><strong class="progress-number">{{ transferProgress }}%</strong></div><div class="progress-track"><div class="progress-fill" :style="{ width: `${transferProgress}%` }"></div></div><div class="transfer-bottom"><span>{{ formatBytes(Number(activeTransfer.meta?.ack_bytes ?? 0)) }} of {{ formatBytes(Number(activeTransfer.meta?.total_bytes ?? 0)) }}</span><button class="text-button danger" @click="respond(activeTransfer.id, 'CancelTransfer')">Cancel transfer</button></div><div v-if="activeTransfer.state === 'WaitingForUserConsent'" class="consent-actions"><button class="secondary-button" @click="respond(activeTransfer.id, 'RejectTransfer')">Decline</button><button class="primary-button" @click="respond(activeTransfer.id, 'AcceptTransfer')">Accept transfer</button></div></div>

        <div v-if="completedTransfers.length" class="recent-section"><div class="section-heading"><span>RECENT TRANSFERS</span><button class="text-button" @click="historyOpen = true">View all →</button></div><div class="recent-row" v-for="item in completedTransfers.slice(0, 2)" :key="item.id"><div class="success-icon">✓</div><div><strong>{{ item.meta?.files?.[0] || item.meta?.text_description || 'Transfer complete' }}</strong><span>Received from {{ item.meta?.source?.name || 'nearby device' }}</span></div><small>Complete</small></div></div>
      </section>
    </section>

    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false"><section class="modal"><div class="modal-heading"><div><div class="eyebrow">BLYNXSHARE</div><h2>Settings</h2></div><button class="icon-button" @click="settingsOpen = false">×</button></div><div class="settings-list"><button class="setting-row" @click="toggleVisibility"><span><strong>Visibility</strong><small>{{ visibility === 'Visible' ? 'Visible to nearby devices' : 'Hidden from nearby devices' }}</small></span><b>{{ visibility === 'Visible' ? 'On' : 'Off' }}</b></button><button class="setting-row" @click="toggleAutoStart"><span><strong>Launch at startup</strong><small>Keep BlynxShare ready in the background</small></span><b>{{ autoStart ? 'On' : 'Off' }}</b></button><button class="setting-row" @click="keepRunning = !keepRunning"><span><strong>Keep running when closed</strong><small>Receive transfers from the system tray</small></span><b>{{ keepRunning ? 'On' : 'Off' }}</b></button><button class="setting-row" @click="chooseDownloadFolder"><span><strong>Download location</strong><small>{{ downloadPath || 'System Downloads folder' }}</small></span><b>Change</b></button></div><div class="modal-footnote">Built on the GPL-3.0 RQuickShare core.<br>Quick Share interoperability works over the same Wi-Fi network.</div></section></div>
    <div v-if="historyOpen" class="modal-backdrop" @click.self="historyOpen = false"><section class="modal"><div class="modal-heading"><div><div class="eyebrow">ACTIVITY</div><h2>Transfer history</h2></div><button class="icon-button" @click="historyOpen = false">×</button></div><div v-if="completedTransfers.length" class="history-list"><div v-for="item in completedTransfers" :key="item.id" class="recent-row"><div class="success-icon">✓</div><div><strong>{{ item.meta?.files?.join(', ') || item.meta?.text_payload || 'Transfer complete' }}</strong><span>{{ item.meta?.destination || 'Saved to Downloads' }}</span></div></div></div><div v-else class="empty-history">Your completed transfers will appear here.</div></section></div>
  </main>
</template>
