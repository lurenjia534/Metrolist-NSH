# Spotish attribution and integration

The Spotify workspace imports code and demo assets from
[huacnlee/spotish](https://github.com/huacnlee/spotish), commit
[`63d320103cf87e3731844b54e71df7f786724a90`](https://github.com/huacnlee/spotish/tree/63d320103cf87e3731844b54e71df7f786724a90).

Copyright 2026 Jason Lee <https://github.com/huacnlee>.
The upstream work is licensed under Apache-2.0. Its full
[license](LICENSE-APACHE) and [notice](NOTICE.md) are preserved here.
The notice also identifies Tabler Icons 3.19.0, Copyright (c) 2020–2024
Paweł Kuna, licensed under MIT. Spotify names, music and artwork retain
their respective owners' rights.

## Imported source

- `src/spotish/`: TSX screens, navigation, state, platform integrations,
  music-light shaders, the browser bridge and fictional demo catalog.
- `native/src/spotish/`: Rust engine, browser/CDP session, audio meter,
  media controls, theme support, typed TSX exports and fixtures.
- `tests/spotify-ui.test.tsx` and `tests/spotify-bench.test.tsx`:
  upstream UI behavior and opt-in performance scenarios adapted to the
  Metrolist fixture and storage namespace.

Metrolist adaptations introduce a mountable workspace, independently
namespaced storage and browser profile, shared application switching,
workspace-scoped platform integrations and platform-specific build
configuration. Modified files carry an adaptation notice. Original
copyright and license notices are retained.

Metrolist NSH as a whole remains GPL-3.0-only; these notices preserve the
upstream terms for the imported work. The special grant in Spotish's
original notice applies to the original author's work and does not
extend to the rest of Metrolist NSH.
