# Johnny Games proxy

The GitHub Pages site is static, so the browser UI lives in the repository while this Node service runs separately.

## Deploy

Deploy the `proxy` directory to any Node hosting service that supports Node 20+.

Set:
- `PORT` (usually supplied by the host)
- optional `ALLOWED_HOSTS` as a comma-separated allowlist, e.g. `example.com,www.example.com`

After deployment, the browser page can be configured with:

`const PROXY_BASE='https://YOUR-PROXY-HOST/proxy?url=';`

This backend is intentionally simple and does not log requested URLs or credentials.
