# BlynxShare

A polished Linux desktop and separate mobile client for fast, private nearby transfers.

BlynxShare uses the real open-source [RQuickShare](https://github.com/Martichou/rquickshare) Rust core for Linux Quick Share interoperability. The upstream GPL-3.0 source, license, and historical documentation remain in this repository; see `LICENSE`, `BUILD.md`, and `core_lib/`.

## Project layout

- `app/main/` — Tauri 2 + Vue 3 Linux desktop application
- `core_lib/` — RQuickShare Rust discovery, handshake, and streaming transport
- `mobile/` — separate Expo/React Native mobile application and native transport boundary
- `handoff.md` — architecture, licensing, build instructions, limitations, and next steps

## Linux desktop

Prerequisites include Rust/Cargo, Node.js, pnpm 9.7, `protobuf-compiler`, Tauri 2 Linux WebKit/GTK packages, and `libayatana-appindicator` or `libappindicator3`.

```bash
cd app/main
pnpm install
pnpm ts-check
pnpm vite:build
pnpm dev
```

Build distributable packages with:

```bash
pnpm build
```

BlynxShare requires devices to be on the same Wi-Fi/LAN. Bluetooth improves discovery compatibility with some Android devices.

## Mobile

```bash
cd mobile
npm install
npm run typecheck
npm start
```

The mobile UI is separate and touch-first. Native Quick Share interoperability still requires the Rust protocol bridge described in `mobile/README.md`; the current client does not fake device discovery or transfer completion.

## License

BlynxShare is built around the GPL-3.0 RQuickShare core. Review `LICENSE` and `handoff.md` before redistributing binaries or modified source.
