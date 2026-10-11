# Johnny Games Browser proxy

This service uses the proxy setup from the supplied Frogies Arcade v3 source:
Ultraviolet 1.0.11, the Bare Server Node routing, Base64 URL encoding, and the
`/frog/ixl/` service-worker scope. It serves the Ultraviolet runtime under
`/frog/` and the Johnny Games browser screen at `/`.

Only the proxy server and its required Ultraviolet files are included. Frogies
Arcade's home page, game catalog, logins, analytics, ads, and other site assets
are not served here.

## Deploy

The Render service `johnny-games-proxy` uses this `proxy/` directory, runs
`npm install` and `npm start`, and deploys automatically from `main`. The
service is public and accepts requests for public HTTP and HTTPS websites.
Bare Server Node's default local-network blocking must remain enabled.

## Credits and licenses

- Frogies Arcade v3 source, licensed under AGPL-3.0; its license is in
  [`LICENSE`](LICENSE).
- 55gms, credited by Frogies Arcade v3 for part of its proxy.
- Titanium Network's Ultraviolet runtime, MIT licensed; see
  [`THIRD_PARTY_LICENSES/ultraviolet-MIT.txt`](THIRD_PARTY_LICENSES/ultraviolet-MIT.txt).
- TOMP Development's Bare Server Node and the Express server dependency.

The Johnny Games browser screen is a separate wrapper. Its service and
Ultraviolet assets are served from this Render service so the browser and proxy
share the same origin.
