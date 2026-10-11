# Johnny Games Browser proxy

This Node service replaces the former URL-rewriting proxy with Ultraviolet and
the Bare protocol. The static Johnny Games site opens this browser in the same
tab; the proxy UI keeps navigation controls around a same-origin frame.

## Deploy

The Render service `johnny-games-proxy` already points to this `proxy/`
directory, runs `npm install` and `npm start`, and receives its listening port
from `PORT`. Merging this change into `main` will trigger its existing automatic
deployment.

The service is public and lets visitors request ordinary public HTTP and HTTPS
websites. Bare's default `blockLocal` protection rejects private and
non-routable IP addresses, including private DNS resolutions. Keep this
protection enabled. The proxy is not an access-control or anonymity service.

## Components and license

- Ultraviolet 2.0.0, MIT licensed, by Titanium Network.
- Bare Server Node 2.0.0-beta, GPL-3.0, by TOMP Development.
- The service application follows the supplied Frogies Arcade v3 AGPL-3.0
  license; the complete source is included here.

The provided Frogies Arcade homepage, ads, tracking scripts, and branded assets
are not served by this Johnny Games integration.
