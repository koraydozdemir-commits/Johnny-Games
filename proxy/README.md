# Johnny Games Browser proxy

This service uses the proxy setup from the supplied Frogies Arcade v3 source:
Ultraviolet 1.0.11, the Bare Server Node routing, Base64 URL encoding, and the
`/frog/ixl/` service-worker scope. It serves the Ultraviolet runtime under
`/frog/` and the Johnny Games browser screen at `/`.

## Deploy

The Render service `johnny-games-proxy` uses this `proxy/` directory, runs
`npm install` and `npm start`, and deploys automatically from `main`. The
service is public and accepts requests for public HTTP and HTTPS websites.
Bare Server Node's default local-network blocking must remain enabled.

## Protected Firebase analytics

The games page sends favorite and play events to `/api/analytics` on this
Render service. The service writes through the Firebase Admin SDK using an
auth override identity. Firebase rules should grant that identity write access
only to individual analytics records; do not add public `.write: true` rules.

1. Create a dedicated Firebase service account for this service and keep its
   private key out of GitHub and the website source.
2. In Render, add the private service account JSON as the secret environment
   variable `FIREBASE_SERVICE_ACCOUNT_JSON`. Set
   `FIREBASE_DATABASE_URL` to the Realtime Database URL if it differs from the
   default in `server.js`.
4. Add these two branches inside the existing top-level `rules` object in
   Firebase Realtime Database Rules, preserving the current `chat` rules, then
   publish:

```json
"favoriteAnalytics": {
  ".read": true,
  "$game": {
    "$visitor": {
      ".write": "auth != null && auth.uid === 'johnny-analytics-worker'",
      ".validate": "newData.val() === true"
    }
  }
},
"playAnalytics": {
  ".read": true,
  "$game": {
    "$event": {
      ".write": "auth != null && auth.uid === 'johnny-analytics-worker'",
      ".validate": "newData.hasChildren(['at']) && newData.child('at').isNumber()"
    }
  }
}
```

Writes are scoped to a single favorite or play record and validated before
Firebase accepts them. The public site can read aggregate source data, but
visitors cannot write directly to Firebase. The API also restricts browser
origins to Johnny Games and applies an in-memory rate limit. Since the site
itself is public, determined callers can still submit fabricated events
through the API; the rate limit reduces casual abuse but is not bot-proof.

The `/health` endpoint reports whether Firebase credentials are configured
without exposing any credential details. It should return
`"analytics": true` after Render restarts with the secret configured.

## Credits and licenses

- Frogies Arcade v3 source, licensed under AGPL-3.0; its license is in
  [`LICENSE`](LICENSE).
- 55gms, credited by Frogies Arcade v3 for part of its proxy.
- Titanium Network's Ultraviolet runtime, MIT licensed; see
  [`THIRD_PARTY_LICENSES/ultraviolet-MIT.txt`](THIRD_PARTY_LICENSES/ultraviolet-MIT.txt).
- TOMP Development's Bare Server Node and the Express server dependency.

The Johnny Games browser screen is a separate wrapper. Its service and
Ultraviolet assets are served from this Render service so the browser and
proxy share the same origin.


## Protected admin writes and chat expiry

The browser no longer writes ad configuration or deletes chat messages directly to Firebase. Those operations go through authenticated `/api/ads` and `/api/chat/:key` endpoints. The proxy verifies the supplied password against the `ADMIN_PASSWORD_SHA256` Render secret before allowing writes. Public ad reads use `/api/ads`. Chat messages are pruned by the proxy every five minutes after the six-hour retention period, so cleanup continues even when nobody has the chat open. The client only polls the newest 100 messages.

The proxy requires both `FIREBASE_SERVICE_ACCOUNT_JSON` and `ADMIN_PASSWORD_SHA256` for these functions. Analytics continues to use a Firebase auth override restricted to the analytics branches; chat and ads use a separate server-only Admin SDK connection without that override, so the existing narrow analytics rules do not block the protected operations. Keep the service-account JSON and password digest only in Render secrets. Until both secrets are configured in Render, protected admin operations will return an explicit configuration error rather than attempting browser-side Firebase writes.
