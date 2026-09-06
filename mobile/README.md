# BlynxShare Mobile

This is a separate Expo/React Native application, intentionally designed for touch instead of reusing the Linux desktop web UI.

## Current scope

- Share/Receive two-mode mobile interaction
- Touch-first file selection through the native document picker
- Native notification permission request
- Mobile-specific discovery, empty, scanning, selected-file, and transfer-state surfaces
- No fake Quick Share device or fake completed transfer

## Transport boundary

The current upstream `core_lib` is a Rust library coupled to the Linux/macOS system environment (Tokio sockets, mDNS, optional BlueZ/Bluetooth, filesystem downloads, and platform discovery). It is not directly importable by Expo JavaScript and the current mobile app therefore stops at an explicit native transport boundary.

To finish interoperability, add a native module that exposes:

```text
startService(visibility, downloadDirectory)
discover() -> Device[]
send(deviceId, files) -> TransferHandle
accept(transferId)
reject(transferId)
cancel(transferId)
subscribeEvents() -> Device / state / progress / error events
```

The preferred implementation is a shared Rust protocol crate extracted from `core_lib`, exposed through UniFFI (or a small JNI/Swift FFI layer). Android should use NSD/mDNS, Bluetooth LE advertisements, foreground/background transfer services, scoped storage, and runtime nearby-device permissions. iOS needs local-network/Bonjour permissions, Multipeer/background constraints, document-provider URLs, and user-visible transfer lifetimes.

## Run

```bash
npm install
npm run typecheck
npm start
npm run android
npm run ios
```

Android and iOS SDKs are required for device builds. Expo Go can render the UI, but Quick Share transport requires the custom native build once the bridge is added.
