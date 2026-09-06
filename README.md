# BlynxShare

<p align="center">
  <strong>Fast, private nearby transfers for Linux and mobile</strong><br>
  <sub>A polished BlynxShare interface powered by the real RQuickShare Rust transport.</sub>
</p>

BlynxShare is an open-source Quick Share alternative with a Linux desktop application and a separate mobile application. The Linux client uses the upstream [RQuickShare](https://github.com/Martichou/rquickshare) implementation for discovery, pairing, encryption, and streaming instead of simulating transfers or reimplementing the protocol from scratch.

> **Status:** Linux desktop transport integration is implemented. The mobile UI and project are implemented as a separate Expo/React Native client, but its native Quick Share transport bridge is still planned. See [Mobile status](#mobile-status).

## Highlights

- Real RQuickShare interoperability on Linux
- Quick Share/Nearby Share-compatible mDNS discovery
- Optional Bluetooth discovery assistance for Android visibility
- Encrypted UKEY2 connection handshake from the upstream core
- Streaming transfers that do not load entire files into memory
- Multi-file selection and desktop drag-and-drop
- Incoming transfer approval, rejection, cancellation, and progress states
- Configurable download location
- Linux tray/background operation and desktop notifications
- Visibility controls for discoverability
- Separate touch-first mobile experience
- GPL-3.0 licensing with upstream attribution preserved

## Repository layout

```text
.
├── app/main/                 # Tauri 2 + Vue 3 Linux desktop app
│   ├── src/                  # BlynxShare desktop UI and state handling
│   └── src-tauri/            # Native Tauri bridge, tray, notifications, packaging
├── core_lib/                 # RQuickShare Rust transport core
│   ├── src/hdl/              # mDNS, Bluetooth, handshake, inbound/outbound transfer
│   └── bindings/             # Generated TypeScript bindings
├── mobile/                   # Separate Expo/React Native mobile app
├── handoff.md                # Detailed architecture and continuation notes
├── LICENSE                   # GPL-3.0 license and upstream RQuickShare notice
└── NOTICE.md                 # BlynxShare/RQuickShare attribution summary
```

## Linux desktop

### Requirements

On Debian or Ubuntu, install:

- Rust and Cargo compatible with the repository toolchain
- Node.js 18 or newer
- pnpm 9.7
- `protobuf-compiler`
- Tauri 2 Linux WebKit/GTK development dependencies
- `libayatana-appindicator` or `libappindicator3`
- A working Bluetooth adapter/service for the best Android discovery compatibility

RQuickShare is LAN-based. Both devices must normally be on the same Wi-Fi/network, and the network must allow mDNS and the selected TCP transfer port.

### Install dependencies

```bash
cd app/main
corepack enable
pnpm install --frozen-lockfile
```

If Corepack is not available, the repository's package manager can also be invoked without a global install:

```bash
npx --yes pnpm@9.7.0 install --frozen-lockfile
```

### Run in development

```bash
cd app/main
pnpm dev
```

For systems with WebKit/NVIDIA compositing problems:

```bash
env WEBKIT_DISABLE_COMPOSITING_MODE=1 pnpm dev
```

### Validate the desktop frontend

```bash
cd app/main
pnpm ts-check
pnpm vite:build
pnpm lint
```

### Build Linux packages

A complete Tauri build compiles both the frontend and the Rust native application and creates configured bundles such as `.deb` and AppImage when the host has the required Rust/Tauri system dependencies:

```bash
cd app/main
pnpm build
```

Debug packaging is available with:

```bash
pnpm build:debug
```

Build output is written under `app/main/src-tauri/target/release/bundle/` and is ignored by Git.

## Mobile

The mobile app is intentionally a separate Expo/React Native project rather than a responsive desktop wrapper.

```bash
cd mobile
npm install
npm run typecheck
npm start
```

For native development builds, install the Android SDK or Xcode and run:

```bash
npm run android
npm run ios
```

### Mobile status

The mobile project currently provides:

- Touch-first Send and Receive screens
- Native document picker integration
- Permission request flow
- Mobile transfer and scanning states
- Android/iOS app identity and local-network/Bluetooth permission declarations
- A documented native transport API boundary

The current Expo JavaScript app does **not** claim to transfer files over Quick Share yet. The upstream `core_lib` is coupled to desktop system services such as BlueZ and desktop filesystem paths. Completing mobile interoperability requires extracting a mobile-safe Rust protocol layer and exposing it through JNI/Swift/UniFFI, then adding Android and iOS background transfer behavior. The UI deliberately avoids fake devices and fake success states.

## How the desktop transport works

1. Tauri starts `rqs_lib::RQS`.
2. RQuickShare opens a TCP listener and publishes the local endpoint through mDNS.
3. Optional Bluetooth advertising/listening helps Android devices reveal their mDNS service.
4. The UI starts discovery through the existing `start_discovery` command.
5. Selected paths are sent to the Rust core through `SendInfo` and `send_payload`.
6. RQuickShare performs the Quick Share/Nearby Share handshake and UKEY2 encryption.
7. File metadata and payload bytes stream through the encrypted connection.
8. Rust emits endpoint, transfer-state, approval, cancellation, and progress events back to Vue.

Important native commands and events are documented in `handoff.md`.

## Compatibility and limitations

- **Network:** Wi-Fi/LAN is required; Wi-Fi Direct and cellular fallback are not implemented by the upstream core.
- **Discovery:** Public or client-isolated networks may block mDNS. Bluetooth can improve Android discovery but is not a replacement for network connectivity.
- **Android/Samsung:** Quick Share behavior varies by Android version, manufacturer, visibility setting, Bluetooth state, and Google/Samsung services.
- **Firewall:** Permit local traffic to BlynxShare's dynamically selected TCP port, or configure a static port using the upstream settings mechanism.
- **Transfers:** Large-file, interruption, retry/resume, unusual filename, and low-disk-space behavior should be tested on the target distribution before production release.
- **Mobile:** The native mobile transport bridge is not complete yet.

## Troubleshooting

### A phone does not appear

1. Put both devices on the same Wi-Fi network.
2. Disable client isolation/VPN restrictions temporarily.
3. Enable Bluetooth on the Linux computer and phone.
4. Make the phone visible in Quick Share.
5. Check that the firewall allows local mDNS and the transfer port.
6. Try the Android Files/Nearby Share workaround described in the retained upstream `BUILD.md`/history if the phone does not publish its service.

### The window is blank on Linux

Try:

```bash
env WEBKIT_DISABLE_COMPOSITING_MODE=1 pnpm dev
```

### Where are received files saved?

BlynxShare defaults to the operating system Downloads directory. The desktop Settings dialog can change the destination.

## License and attribution

BlynxShare is distributed under **GNU GPL-3.0-only**. The complete desktop application links the GPL-3.0 RQuickShare core, so the combined desktop distribution must remain GPL-compatible. The full license text is in `LICENSE`, and project-specific attribution is in `NOTICE.md`.

RQuickShare attribution:

- Project: [Martichou/rquickshare](https://github.com/Martichou/rquickshare)
- Copyright: Martin Andre, 2024
- License: GNU GPL-3.0 or later in the upstream source; this distribution uses GPL-3.0-only metadata for the combined BlynxShare package while retaining the upstream license text and notices.

When distributing binaries, provide the corresponding source and preserve the license and attribution notices as required by GPL-3.0.

## Development notes

- `handoff.md` contains the detailed architecture, known issues, commands, and next steps.
- `root.txt` is intentionally ignored and must never be packaged or committed.
- Do not rename or remove upstream protocol/license notices when updating the UI.
- Run the frontend typecheck and lint before submitting changes.
