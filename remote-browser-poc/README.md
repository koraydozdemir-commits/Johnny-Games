# Johnny Games remote browser prototype

This isolated prototype streams a real Chromium window into a web page using noVNC. Chromium opens the target as a top-level page inside its own container, so the target is not embedded in an iframe and its JavaScript, cookies, forms, and history are handled by Chromium.

## Run locally

Requirements: Docker Engine with Docker Compose.

1. Copy `.env.example` to `.env`.
2. Replace `POC_ACCESS_TOKEN` with at least 32 random characters.
3. Run `docker compose up --build`.
4. Open `http://127.0.0.1:3000` and enter the same token.
5. Use Chromium’s own address bar to visit `https://example.com`, then a page that blocks iframe embedding. Use Chromium’s browser controls to verify Back and Forward.

The container publishes its port only on the local machine. The VNC server listens on loopback inside the container, and the WebSocket bridge requires a short-lived, one-use ticket issued only after the access token is checked. The access token is not written to browser storage or logged.

## Scope and limits

This is a single-browser, single-container experiment, not production hosting. It does not isolate multiple users, provide durable profiles, or add Johnny Games’ custom address bar. Do not expose it to the public internet. Before any hosted deployment, each user would need a separate isolated browser environment, controlled network egress, authenticated transport, resource limits, session cleanup, and a persistent-session policy.

The test is meant to answer whether real Chromium streaming can make ordinary navigation and an iframe-blocking site usable. It does not promise access to sites that reject the host’s IP, require device permissions, or impose anti-automation checks.
