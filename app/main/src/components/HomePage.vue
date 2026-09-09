<script setup lang="ts">
/* eslint-disable indent, vue/script-indent, vue/html-indent, vue/singleline-html-element-content-newline, vue/html-self-closing, vue/max-attributes-per-line */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getStore, type Store } from '@tauri-apps/plugin-store'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { disable, enable } from '@tauri-apps/plugin-autostart'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openPath } from '@tauri-apps/plugin-shell'

import type { ChannelMessage } from '@martichou/core_lib/bindings/ChannelMessage'
import type { EndpointInfo } from '@martichou/core_lib/bindings/EndpointInfo'
import type { OutboundPayload } from '@martichou/core_lib/bindings/OutboundPayload'
import type { Visibility } from '@martichou/core_lib/bindings/Visibility'
import type { State } from '@martichou/core_lib/bindings/State'
import { autostartKey, downloadPathKey, numberToVisibility, realcloseKey, visibilityKey, visibilityToNumber } from '../vue_lib/types'

interface ToastItem {
  id: number
  message: string
}

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
const toasts = ref<ToastItem[]>([])
const unlisten: UnlistenFn[] = []

// Performance & Throughput metrics
const transferSpeed = ref<string>('')
const transferEta = ref<string>('')
let lastTransferBytes = 0
let lastTransferTimestamp = 0
let rafScheduled = false
let pendingMessage: ChannelMessage | null = null

const activeTransfer = computed(() => requests.value.find((request) =>
  ['SentIntroduction', 'SendingFiles', 'ReceivingFiles', 'WaitingForUserConsent'].includes(request.state ?? 'Initial')
))

const completedTransfers = computed(() => requests.value.filter((request) => request.state === 'Finished'))
const currentFiles = computed(() => outbound.value?.Files ?? [])
const displayName = computed(() => hostname.value || 'This Linux computer')
const nearbyCount = computed(() => endpoints.value.length)

const transferProgress = computed(() => {
  const meta = activeTransfer.value?.meta
  if (!meta || !meta.total_bytes) return 0
  return Math.min(100, Math.round((Number(meta.ack_bytes ?? 0) / Number(meta.total_bytes)) * 100))
})

function showToast(message: string) {
  const id = Date.now() + Math.random()
  toasts.value.push({ id, message })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 2800)
}

function fileName(path: string) {
  return path.split('/').pop() || path
}

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`
}

function stateLabel(state?: State | null) {
  const labels: Record<string, string> = {
    WaitingForUserConsent: 'Waiting for approval',
    SentIntroduction: 'Connecting…',
    SendingFiles: 'Sending files…',
    ReceivingFiles: 'Receiving files…',
    Finished: 'Transfer complete',
    Cancelled: 'Transfer canceled',
    Rejected: 'Transfer declined',
    Disconnected: 'Connection lost',
  }
  return labels[state ?? ''] ?? 'Ready'
}

function updateTransferMetrics(ackBytes: number, totalBytes: number) {
  const now = performance.now()
  if (lastTransferTimestamp > 0 && now > lastTransferTimestamp) {
    const elapsedSeconds = (now - lastTransferTimestamp) / 1000
    const bytesDelta = ackBytes - lastTransferBytes
    if (bytesDelta > 0 && elapsedSeconds > 0) {
      const bytesPerSec = bytesDelta / elapsedSeconds
      transferSpeed.value = `${formatBytes(bytesPerSec)}/s`
      const remainingBytes = Math.max(0, totalBytes - ackBytes)
      if (remainingBytes > 0 && bytesPerSec > 0) {
        const secondsLeft = Math.round(remainingBytes / bytesPerSec)
        transferEta.value = secondsLeft < 60 ? `${secondsLeft}s remaining` : `${Math.ceil(secondsLeft / 60)}m remaining`
      } else {
        transferEta.value = ''
      }
    }
  }
  lastTransferBytes = ackBytes
  lastTransferTimestamp = now
}

async function copyPin(pin?: string) {
  if (!pin) return
  try {
    await writeText(pin)
    showToast(`PIN ${pin} copied to clipboard`)
  } catch (err) {
    console.error('Failed to copy PIN', err)
  }
}

async function openDownloads() {
  const target = downloadPath.value || '/home'
  try {
    await openPath(target)
  } catch (err) {
    console.error('Failed to open directory', err)
    showToast(`Path: ${target}`)
  }
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
  lastTransferBytes = 0
  lastTransferTimestamp = performance.now()
  transferSpeed.value = ''
  transferEta.value = ''
  await invoke('send_payload', {
    message: { id: endpoint.id, name: endpoint.name ?? 'Nearby device', addr: `${endpoint.ip}:${endpoint.port}`, ob: outbound.value },
  })
}

async function respond(id: string, action: 'AcceptTransfer' | 'RejectTransfer' | 'CancelTransfer') {
  await invoke('send_to_rs', { message: { id, direction: 'FrontToLib', action, meta: null, state: null, rtype: null } })
  if (action === 'CancelTransfer') {
    transferSpeed.value = ''
    transferEta.value = ''
  }
}

async function chooseDownloadFolder() {
  const selected = await openDialog({ title: 'Choose download folder', directory: true, multiple: false })
  if (!selected || Array.isArray(selected)) return
  await invoke('change_download_path', { message: selected })
  downloadPath.value = selected
  await store.value?.set(downloadPathKey, selected)
  await store.value?.save()
  showToast('Download folder updated')
}

async function setVisibility(next: Visibility) {
  visibility.value = next
  await invoke('change_visibility', { message: next })
  await store.value?.set(visibilityKey, visibilityToNumber[next])
  await store.value?.save()
  showToast(next === 'Visible' ? 'Device is now discoverable' : 'Device is now hidden')
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
  showToast(autoStart.value ? 'Launch at startup enabled' : 'Launch at startup disabled')
}

async function toggleKeepRunning() {
  keepRunning.value = !keepRunning.value
  await store.value?.set(realcloseKey, !keepRunning.value)
  await store.value?.save()
  showToast(keepRunning.value ? 'Background tray mode enabled' : 'Background tray mode disabled')
}

async function hydrate() {
  store.value = await getStore('.settings.json')
  hostname.value = String(await invoke('get_hostname') || 'This Linux computer')
  version.value = await getVersion()
  visibility.value = numberToVisibility[Number(await store.value?.get(visibilityKey) ?? 0)] ?? 'Visible'
  downloadPath.value = await store.value?.get(downloadPathKey) ?? undefined
  autoStart.value = await store.value?.get(autostartKey) ?? true

  const realclose = await store.value?.get<boolean>(realcloseKey)
  keepRunning.value = realclose !== undefined ? !realclose : true

  if (!await isPermissionGranted()) await requestPermission()
}

function processMessage(message: ChannelMessage) {
  const index = requests.value.findIndex((item) => item.id === message.id)
  if (index >= 0) {
    requests.value.splice(index, 1, { ...requests.value[index], ...message, meta: message.meta ?? requests.value[index].meta })
  } else {
    requests.value.unshift(message)
  }

  if (message.meta && message.meta.ack_bytes !== undefined && message.meta.total_bytes) {
    updateTransferMetrics(Number(message.meta.ack_bytes), Number(message.meta.total_bytes))
  }
}

function mergeRequestThrottled(message: ChannelMessage) {
  pendingMessage = message
  if (!rafScheduled) {
    rafScheduled = true
    requestAnimationFrame(() => {
      if (pendingMessage) {
        processMessage(pendingMessage)
        pendingMessage = null
      }
      rafScheduled = false
    })
  }
}

function mergeEndpoint(endpoint: EndpointInfo) {
  const index = endpoints.value.findIndex((item) => item.id === endpoint.id)
  if (endpoint.present === false) {
    if (index >= 0) endpoints.value.splice(index, 1)
  } else if (index >= 0) {
    endpoints.value.splice(index, 1, endpoint)
  } else {
    endpoints.value.push(endpoint)
  }
}

onMounted(async () => {
  await hydrate()
  unlisten.push(await listen<ChannelMessage>('rs2js_channelmessage', (event) => mergeRequestThrottled(event.payload)))
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

onUnmounted(() => {
  unlisten.forEach((stop) => stop())
})
</script>

<template>
  <main class="shell" :class="{ 'is-dragging': isDragHovering }">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <div class="eyebrow">NEARBY TRANSFER</div>
          <div class="brand-name">BlynxShare</div>
        </div>
      </div>
      <div class="topbar-actions">
        <button class="connection-pill" @click="toggleVisibility" :title="`Visibility: ${visibility}`">
          <span class="live-dot" :class="{ muted: visibility === 'Invisible' }"></span>
          {{ visibility === 'Invisible' ? 'Hidden' : 'Discoverable' }}
        </button>
        <button class="icon-button" :class="{ active: historyOpen }" title="Transfer history" @click="historyOpen = !historyOpen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
        <button class="avatar" title="Settings" @click="settingsOpen = true">{{ displayName.slice(0, 1).toUpperCase() }}</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="rail">
        <button class="rail-item" :class="{ active: mode === 'send' }" @click="mode = 'send'">
          <span class="rail-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </span>
          <span>Share</span>
        </button>
        <button class="rail-item" :class="{ active: mode === 'receive' }" @click="mode = 'receive'; startDiscovery()">
          <span class="rail-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="17" y1="7" x2="7" y2="17" />
              <polyline points="17 17 7 17 7 7" />
            </svg>
          </span>
          <span>Receive</span>
        </button>
        <button class="rail-item" :class="{ active: historyOpen }" @click="historyOpen = true">
          <span class="rail-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <span>Activity</span>
        </button>

        <div class="rail-spacer"></div>

        <div v-if="downloadPath" class="rail-info" title="Current download location">
          <div class="rail-info-label">Downloads</div>
          <div class="rail-info-value" @click="openDownloads" style="cursor: pointer; text-decoration: underline;">
            {{ fileName(downloadPath) }}
          </div>
        </div>

        <button class="rail-item" @click="settingsOpen = true">
          <span class="rail-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <span>Settings</span>
        </button>
        <div class="version">v{{ version }}</div>
      </aside>

      <section class="content-panel">
        <div class="content-header">
          <div>
            <div class="eyebrow">{{ mode === 'send' ? 'SEND SOMETHING' : 'READY TO RECEIVE' }}</div>
            <h1>{{ mode === 'send' ? 'Share without the friction.' : 'Your drop zone is ready.' }}</h1>
            <p>{{ mode === 'send' ? 'Fast, private transfers to devices nearby.' : 'Keep this window open while someone sends to you.' }}</p>
          </div>
          <div class="device-chip">
            <span class="chip-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
            <span>
              <small>THIS DEVICE</small>
              <strong>{{ displayName }}</strong>
            </span>
          </div>
        </div>

        <div class="mode-switcher">
          <button :class="{ selected: mode === 'send' }" @click="mode = 'send'">Send</button>
          <button :class="{ selected: mode === 'receive' }" @click="mode = 'receive'; startDiscovery()">Receive</button>
        </div>

        <!-- Mode: Send (Empty State) -->
        <div v-if="mode === 'send' && !outbound && !activeTransfer" class="hero-card" :class="{ hovering: isDragHovering }" @click="selectFiles">
          <div class="hero-orbit orbit-one"></div>
          <div class="hero-orbit orbit-two"></div>
          <div class="hero-orbit orbit-three"></div>
          <div class="upload-glyph">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </div>
          <h2>Drop files here</h2>
          <p>or choose documents, photos, and archives from your computer</p>
          <button class="primary-button" @click.stop="selectFiles">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Choose files
          </button>
          <div class="hint">
            <kbd>Drag & Drop</kbd>
            <span>supported anywhere inside this window</span>
          </div>
        </div>

        <!-- Mode: Send (Files Selected) -->
        <div v-else-if="mode === 'send' && outbound && !activeTransfer" class="selected-card">
          <div class="selected-header">
            <div>
              <div class="eyebrow">READY TO SHARE</div>
              <h2>{{ currentFiles.length }} {{ currentFiles.length === 1 ? 'item' : 'items' }} selected</h2>
            </div>
            <button class="text-button" @click="stopSharing">Clear selection</button>
          </div>

          <div class="file-list">
            <div v-for="file in currentFiles" :key="file" class="file-row">
              <div class="file-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
              </div>
              <div class="file-info">
                <strong>{{ fileName(file) }}</strong>
                <span>{{ file }}</span>
              </div>
              <div class="file-check">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
          </div>

          <div class="share-next">
            <span class="pulse-ring"></span>
            <span>Looking for nearby Quick Share devices on Wi-Fi</span>
            <span class="scan-count">{{ nearbyCount }} found</span>
          </div>
        </div>

        <!-- Mode: Receive -->
        <div v-else-if="mode === 'receive' && !activeTransfer" class="receive-card">
          <div class="receive-radar">
            <span></span><span></span><span></span>
            <div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </div>
          </div>
          <div>
            <div class="eyebrow">LISTENING FOR DEVICES</div>
            <h2>Ready when you are.</h2>
            <p>Nearby Android and PC devices will appear here when they send to you.</p>
          </div>
          <button class="secondary-button" @click="startDiscovery">
            {{ isScanning ? 'Scanning…' : 'Scan for senders' }}
          </button>
        </div>

        <!-- Discovered Devices Grid -->
        <div v-if="mode === 'send' && outbound && !activeTransfer && endpoints.length" class="device-section">
          <div class="section-heading">
            <span>NEARBY DEVICES</span>
            <small>{{ endpoints.length }} available</small>
          </div>
          <div class="device-grid">
            <button v-for="endpoint in endpoints" :key="endpoint.id" class="nearby-device" @click="sendTo(endpoint)">
              <span class="device-glyph">
                <!-- Phone Icon -->
                <svg v-if="endpoint.rtype === 'Phone'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <!-- Tablet Icon -->
                <svg v-else-if="endpoint.rtype === 'Tablet'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <!-- Laptop Icon -->
                <svg v-else-if="endpoint.rtype === 'Laptop'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <line x1="2" y1="20" x2="22" y2="20" />
                </svg>
                <!-- Default Device Icon -->
                <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </span>
              <span>
                <strong>{{ endpoint.name || 'Nearby device' }}</strong>
                <small>{{ endpoint.rtype || 'Device' }} · {{ endpoint.ip }}</small>
              </span>
              <span class="device-arrow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </button>
          </div>
        </div>

        <!-- Active Transfer Card -->
        <div v-if="activeTransfer" class="transfer-card">
          <div class="transfer-top">
            <div class="transfer-state">
              <span class="transfer-spinner"></span>
              <div>
                <div class="eyebrow">{{ stateLabel(activeTransfer.state) }}</div>
                <h2>{{ activeTransfer.meta?.source?.name || 'Nearby device' }}</h2>
              </div>
            </div>
            <strong class="progress-number">{{ transferProgress }}%</strong>
          </div>

          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${transferProgress}%` }"></div>
          </div>

          <div class="transfer-bottom">
            <span>
              {{ formatBytes(Number(activeTransfer.meta?.ack_bytes ?? 0)) }} of {{ formatBytes(Number(activeTransfer.meta?.total_bytes ?? 0)) }}
            </span>
            <span v-if="transferSpeed" class="speed-badge">
              {{ transferSpeed }} <template v-if="transferEta">· {{ transferEta }}</template>
            </span>
            <button class="text-button danger" @click="respond(activeTransfer.id, 'CancelTransfer')">Cancel transfer</button>
          </div>

          <!-- PIN Code Display for UKEY2 Handshake Verification -->
          <div v-if="activeTransfer.meta?.pin_code" class="pin-code-badge">
            <span>Verification PIN:</span>
            <strong>{{ activeTransfer.meta.pin_code }}</strong>
            <button class="text-button" @click="copyPin(activeTransfer.meta?.pin_code)" title="Copy PIN">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>

          <div v-if="activeTransfer.state === 'WaitingForUserConsent'" class="consent-actions">
            <button class="secondary-button" @click="respond(activeTransfer.id, 'RejectTransfer')">Decline</button>
            <button class="primary-button" @click="respond(activeTransfer.id, 'AcceptTransfer')">Accept transfer</button>
          </div>
        </div>

        <!-- Recent Completed Transfers -->
        <div v-if="completedTransfers.length" class="recent-section">
          <div class="section-heading">
            <span>RECENT TRANSFERS</span>
            <div style="display: flex; gap: 8px;">
              <button class="text-button" @click="openDownloads">Open folder</button>
              <button class="text-button" @click="historyOpen = true">View all →</button>
            </div>
          </div>
          <div v-for="item in completedTransfers.slice(0, 2)" :key="item.id" class="recent-row">
            <div class="success-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <strong>{{ item.meta?.files?.[0] || item.meta?.text_description || 'Transfer complete' }}</strong>
              <span>Received from {{ item.meta?.source?.name || 'nearby device' }}</span>
            </div>
            <small>Complete</small>
          </div>
        </div>
      </section>
    </section>

    <!-- Settings Modal -->
    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
      <section class="modal">
        <div class="modal-heading">
          <div>
            <div class="eyebrow">BLYNXSHARE</div>
            <h2>Settings</h2>
          </div>
          <button class="icon-button" @click="settingsOpen = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="settings-list">
          <button class="setting-row" @click="toggleVisibility">
            <span>
              <strong>Visibility</strong>
              <small>{{ visibility === 'Visible' ? 'Discoverable to nearby devices' : 'Hidden from nearby devices' }}</small>
            </span>
            <b>{{ visibility === 'Visible' ? 'On' : 'Off' }}</b>
          </button>

          <button class="setting-row" @click="toggleAutoStart">
            <span>
              <strong>Launch at startup</strong>
              <small>Start BlynxShare automatically on login</small>
            </span>
            <b>{{ autoStart ? 'On' : 'Off' }}</b>
          </button>

          <button class="setting-row" @click="toggleKeepRunning">
            <span>
              <strong>Keep running when closed</strong>
              <small>Minimize to system tray to continue receiving transfers</small>
            </span>
            <b>{{ keepRunning ? 'On' : 'Off' }}</b>
          </button>

          <button class="setting-row" @click="chooseDownloadFolder">
            <span>
              <strong>Download location</strong>
              <small>{{ downloadPath || 'System Downloads folder' }}</small>
            </span>
            <b>Change</b>
          </button>
        </div>

        <div class="modal-footnote">
          Built on the GPL-3.0 RQuickShare core.<br>
          Quick Share transfers operate over local Wi-Fi LAN with zero telemetry.
        </div>
      </section>
    </div>

    <!-- Activity History Modal -->
    <div v-if="historyOpen" class="modal-backdrop" @click.self="historyOpen = false">
      <section class="modal">
        <div class="modal-heading">
          <div>
            <div class="eyebrow">ACTIVITY</div>
            <h2>Transfer history</h2>
          </div>
          <button class="icon-button" @click="historyOpen = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div v-if="completedTransfers.length" class="history-list">
          <div v-for="item in completedTransfers" :key="item.id" class="recent-row">
            <div class="success-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <strong>{{ item.meta?.files?.join(', ') || item.meta?.text_payload || 'Transfer complete' }}</strong>
              <span>{{ item.meta?.destination || downloadPath || 'Downloads folder' }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-history">
          Your completed transfers will appear here.
        </div>
      </section>
    </div>

    <!-- Toast Notifications -->
    <div class="toast-container">
      <div v-for="toast in toasts" :key="toast.id" class="toast">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--lime);">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>{{ toast.message }}</span>
      </div>
    </div>
  </main>
</template>
