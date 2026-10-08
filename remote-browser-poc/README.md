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

## Connect it to the Johnny Games Browser page

After deploying this as a public HTTPS web service that supports WebSockets:

1. Set `POC_ACCESS_TOKEN` to a random secret of at least 32 characters.
2. Set `ALLOWED_PARENT_ORIGINS` to `https://www.johnnystudy.online`.
3. Set the service health check path to `/health`.
4. Open the Johnny Games Browser page, choose **Real**, and enter the service's HTTPS URL in settings.
5. The remote browser page will ask for the access token before opening the Chromium stream.

On Render, create a Docker web service from the repository with the root directory `remote-browser-poc`. The service must have enough memory for Chromium and Xvfb; the current Render free plan provides 512 MB, while the 1 CPU / 2 GB plan is $25/month. Confirm the plan and account billing before creating the service. Render web services support public URLs and WebSockets. The service URL and token are not included in the static website, so they are configured by the user in the Browser page.

## Scope and limits

This is currently one Chromium process shared by anyone who knows the service token; use it only as a private, single-user experiment. It does not isolate multiple users, provide durable profiles, or add Johnny Games’ custom address bar. It does not promise access to sites that reject the host’s IP, require device permissions, or impose anti-automation checks. A public multi-user launch needs separate browser isolation, controlled network egress, session/resource limits, and cleanup.
