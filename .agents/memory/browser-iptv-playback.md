---
name: Browser IPTV playback
description: Durable constraints for playing IPTV streams from the StreamGuard web app
---

Browser media requests cannot reliably override the User-Agent or Referer headers. HLS.js request hooks do not bypass those browser restrictions, and direct HLS playback also requires the upstream server to permit browser CORS.

**Why:** IPTV playlists commonly include per-channel headers, while browser security controls both forbidden headers and cross-origin media requests.

**How to apply:** Use direct playback only for browser-compatible streams. For channels with stored headers or direct CORS/network failures, route playback through a same-origin server relay that applies the headers and rewrites every relative/absolute HLS manifest, segment, key, and nested-playlist URI back through the relay.