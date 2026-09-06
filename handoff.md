# BlynxShare handoff

## What is here

BlynxShare is a branded Quick Share-style application built on the cloned **RQuickShare** project. The Linux desktop app is a Tauri 2 + Vue 3 application and uses RQuickShare's real Rust transport rather than a local simulation. A separate Expo React Native mobile app lives in `mobile` and provides a platform-specific touch-first UI plus the native integration boundary needed to bring the Rust transport to Android/iOS.

The workspace was initially empty except for `root.txt`; no elevated operation was necessary. `root.txt` was not used as a password.

## Repository structure

```text
.
├── handoff.md
├── LICENSE                         # upstream GPL-3.0 license
├── README.md                       # upstream RQuickShare documentation
├── BUILD.md                        # upstream build notes
├── core_lib/                       # upstream Rust Quick Share transport
│   ├── src/lib.rs                   # RQS service lifecycle and public API
│   ├── src/hdl/mdns*.rs             # mDNS publication/discovery
│   ├── src/hdl/ble*.rs              # Bluetooth advertisement/discovery
│   ├── src/hdl/inbound.rs           # inbound handshake and streaming
│   ├── src/hdl/outbound.rs          # outbound handshake and streaming
│   ├── src/manager.rs               # TCP server and connection routing
│   └── bindings/                    # ts-rs bindings used by Vue
├── app/main/                        # BlynxShare Linux desktop client
│   ├── src/components/HomePage.vue  # desktop share/receive experience
│   ├── src/vue_lib/assets/main.postcss# visual system and responsive styles
│   └── src-tauri/                   # native bridge, tray, notifications, packaging
└── mobile/                          # separate Expo/React Native client
    ├── app/index.tsx                # touch-first send/receive experience
    ├── app.json                     # platform permissions and identity
    └── README.md                    # mobile integration boundary
```

## RQuickShare integration

The desktop application starts `rqs_lib::RQS` in `app/main/src-tauri/src/main.rs`. Its existing lifecycle is intentionally preserved:

1. `RQS::run()` binds a TCP listener, starts the mDNS server, and starts optional Bluetooth listeners/advertising.
2. `start_discovery` starts the mDNS/Bluetooth discovery workers.
3. Discovery events are emitted from Rust as `rs2js_endpointinfo`.
4. BlynxShare sends a selected file list through the existing `send_payload` command as `SendInfo`.
5. The core performs the real Quick Share/Nearby Share connection request, UKEY2 encryption handshake, introduction/consent flow, and streaming transfer.
6. Transfer state and metadata are emitted as `rs2js_channelmessage`, which drives the desktop progress, approval, cancellation, completion, and history states.

The selected-file flow is implemented in `HomePage.vue`:

- Tauri file dialog: `selectFiles()`
- Tauri drag/drop: `onDragDropEvent()`
- Discovery: `startDiscovery()` / `stopSharing()`
- Outbound transfer: `sendTo(endpoint)`
- Inbound approval/rejection/cancel: `respond(id, action)`
- Download directory and visibility settings: existing Tauri commands

This remains subject to upstream RQuickShare's compatibility constraints: Wi-Fi LAN is required, mDNS may be blocked by public/isolated networks, Bluetooth can be required as an Android discovery nudge, and Samsung/Quick Share behavior can vary by device and OS version.

## Licensing and attribution

RQuickShare is GPL-3.0. The upstream `LICENSE` file was retained. The desktop Rust package metadata was corrected to `GPL-3.0-only`, and the Tauri bundle metadata includes upstream attribution. Any distributed binary containing the linked `rqs_lib` must comply with GPL-3.0, including providing corresponding source and preserving notices. Do not relicense the combined desktop binary as proprietary without a separate legal review.

BlynxShare-specific UI and glue code is designed to remain compatible with the upstream GPL requirements because it is linked into the RQuickShare application. Review all dependency licenses before distribution.

## Linux build and run

Prerequisites on Debian/Ubuntu are the normal Tauri/Rust toolchain plus RQuickShare requirements:

- Rust toolchain compatible with `core_lib` and `src-tauri/rust-toolchain`
- Node.js and **pnpm 9.7**
- `protobuf-compiler`
- Tauri Linux WebKit/GTK development packages as required by Tauri 2
- `libayatana-appindicator` or `libappindicator3`
- Bluetooth service/adapter for the best Android discovery compatibility
- A firewall rule allowing the dynamically selected transfer port, or a configured static port

Commands:

```bash
cd app/main
pnpm install
pnpm ts-check
pnpm vite:build
pnpm check
pnpm dev
pnpm build
```

`pnpm build` produces Tauri packages configured by `tauri.conf.json` (including Debian/AppImage targets when the local Tauri prerequisites are available). For NVIDIA/WebKit compositing issues, the upstream workaround remains:

```bash
env WEBKIT_DISABLE_COMPOSITING_MODE=1 pnpm dev
```

The product name and desktop identifier are now `BlynxShare` / `app.blynxshare.desktop`; the transport crate remains the upstream `rqs_lib` package.

## Mobile build and run

The mobile app is deliberately separate from the desktop app and is not a responsive desktop wrapper:

```bash
cd mobile
npm install
npm run typecheck
npm start
```

Use Expo's Android/iOS commands after installing the native SDKs:

```bash
npm run android
npm run ios
```

The mobile UI has real document selection, native permission requests, send/receive mode states, transfer-state presentation, and a clearly surfaced native transport boundary. It does **not** claim to perform a Quick Share transfer yet. Expo's JavaScript layer cannot directly reuse the Linux `rqs_lib` crate; the next mobile implementation step is a native Rust/UniFFI or JNI/Swift bridge plus Android/iOS mDNS, Bluetooth, socket, UKEY2, and background-transfer integration. The UI intentionally avoids fake devices and fake transfer completion.

## Verification performed

- Inspected the upstream RQuickShare README, BUILD notes, GPL-3.0 license, Rust core, generated TypeScript bindings, and Tauri commands.
- Installed the desktop dependencies with the pinned pnpm lockfile.
- `pnpm ts-check` passes.
- `pnpm vite:build` passes; the only output is the existing Browserslist freshness warning.
- `pnpm lint` passes.
- Installed the separate mobile dependencies and `npm run typecheck` passes.
- The native Rust check was attempted with `pnpm check` but cannot run in this container because `cargo` is not installed (`cargo: not found`). A real Tauri/package build therefore still needs to be run on a Rust/Tauri-capable Debian or Ubuntu host.

## Known issues and honest limitations

- Mobile Quick Share interoperability is a scaffolded native boundary, not implemented transport. Do not market the mobile build as an interoperable sender/receiver until the native bridge is complete.
- The upstream core's LAN-only limitation remains. Wi-Fi Direct/cellular fallback is not added.
- The desktop UI uses the upstream event model; upstream transfer retry/resume semantics should be tested with interrupted large files before release.
- `root.txt` contains a value but no sudo operation was needed; it should not be treated as general application configuration or committed to a distributable artifact.
- The Google Fonts import is convenient for development; production packaging should either bundle the selected fonts or provide a deliberate offline fallback if fully offline startup is required.
- The existing Tauri capability set should be reviewed before adding any new native command. Avoid broadening permissions unnecessarily.

## Recommended next steps

1. Install the pinned Rust, protobuf, Tauri Linux, and pnpm prerequisites; run the desktop typecheck, Vite build, Rust check, and packaged build.
2. Test Linux ↔ Android and Android ↔ Linux on the same LAN with Bluetooth on/off, public-network isolation, large files, unusual filenames, cancellation, disconnects, and insufficient disk space.
3. Add automated tests around `utils._displayedItems`, progress calculations, endpoint removal, and channel state rendering.
4. Extract a small shared protocol API from `core_lib` using UniFFI or a carefully maintained C ABI, then add Android Kotlin and iOS Swift host modules under `mobile`.
5. Add persisted mobile transfer history, background execution, share-sheet receivers, Android scoped-storage handling, iOS document-provider handling, and secure incomplete-file cleanup.
6. Bundle fonts/icons locally, add screenshots and a reproducible Debian packaging CI job, and run a dependency/license audit before publishing.
