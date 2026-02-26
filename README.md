<p align="center">
  <img src="https://img.shields.io/badge/WORLDVIEW-Tactical%20Intelligence-00D4FF?style=for-the-badge&labelColor=0A0A0A" alt="WorldView" />
</p>

<h1 align="center">🌍 WORLDVIEW — Tactical Intelligence Platform</h1>

<p align="center">
  A real-time global intelligence dashboard rendered on a 3D CesiumJS globe.<br/>
  Track flights, satellites, earthquakes, traffic, and CCTV cameras — all in one tactical interface.
</p>

<p align="center">
  <a href="https://worldview.kt-o.com"><strong>🔗 Live Demo — worldview.kt-o.com</strong></a>
</p>

https://github.com/user-attachments/assets/b2bd05d2-f7be-49c8-a8c6-452b6b60cb34

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/CesiumJS-1.138-6CADDF?logo=cesium&logoColor=white" alt="CesiumJS" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white" alt="Tailwind 4" />
  <img src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white" alt="Express 5" />
</p>

---

## Overview

WorldView is a full-stack tactical intelligence platform that aggregates multiple real-time data sources onto an interactive 3D globe. Inspired by military command-and-control interfaces, it features a dark tactical UI with optional post-processing effects (CRT scanlines, night vision, thermal imaging).

### Key Capabilities

| Layer | Source | Update Rate | Description |
|---|---|---|---|
| ✈️ **Flights** | FlightRadar24 + adsb.fi | 5–20 s | ~27,000 global aircraft with altitude bands, route arcs, dead-reckoning |
| 🛰️ **Satellites** | CelesTrak TLE + SGP4 | 2 s propagation | Real-time orbital position, orbit paths, ground tracks, nadir lines |
| 🌋 **Earthquakes** | USGS GeoJSON | 60 s | Past 24 hours, magnitude-scaled pulsing markers with colour coding |
| 🚗 **Traffic** | OpenStreetMap Overpass | On-demand | Road network overlay with animated vehicle particle simulation |
| 📹 **CCTV** | TfL, Austin TX, Transport NSW | 5 min | Live camera feeds from London, Austin, and New South Wales |

---

## Screenshots

> *Boot sequence → 3D globe with tactical overlays → CCTV surveillance panel*

The interface features:
- **Splash screen** — Military-style boot sequence with typewriter animation
- **Operations panel** (left) — Layer toggles, shader modes, altitude filters
- **Intel feed** (right) — Real-time event stream from all data sources
- **Status bar** (bottom) — Camera coordinates (DMS), UTC clock, entity counts
- **Tracked entity panel** — Lock-on detail view (ESC to unlock)
- **Crosshair overlay** — Centre-screen targeting reticle

---

## Tech Stack

### Frontend
- **React 19** — Functional components with hooks
- **TypeScript 5.9** — Strict mode, bundler module resolution
- **CesiumJS 1.138** via **Resium** — 3D globe rendering
- **Tailwind CSS v4** — Utility-first styling with custom tactical colour tokens
- **Vite 7** — Dev server with HMR, Cesium plugin, API proxy
- **satellite.js** — SGP4/SDP4 satellite orbit propagation

### Backend
- **Express 5** — API proxy server
- **node-cache** — In-memory response caching with TTL
- **WebSocket (ws)** — Real-time flight data push channel
- **dotenv** — Environment variable management

### Rendering Techniques
- **Imperative Cesium primitives** — `BillboardCollection`, `PointPrimitiveCollection`, `PolylineCollection`, `LabelCollection` for high-performance rendering of 27K+ entities
- **Dead-reckoning** — Aircraft positions extrapolated between API updates at 60 fps
- **GLSL post-processing** — CRT scanlines, night-vision green phosphor, FLIR thermal palette via `PostProcessStage`
- **CallbackProperty** — Smooth entity tracking without React re-renders

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd worldview

# Install dependencies
npm install
```

### Environment Setup

> **⚠️ This repo does NOT ship any API keys. You must obtain your own.**

Copy the example files and fill in your credentials:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Then edit each file with your own API keys (see [Obtaining API Keys](#obtaining-api-keys) below).

**`.env`** — Client-side (Vite injects `VITE_*` variables at build time):

| Variable | Required? | Purpose |
|---|---|---|
| `VITE_GOOGLE_API_KEY` | Optional | Google Maps 3D Photorealistic Tiles (falls back to OpenStreetMap) |
| `VITE_CESIUM_ION_TOKEN` | Optional | Cesium Ion terrain/imagery services |
| `WINDY_API_KEY` | Optional | Windy webcam API (reserved, not yet active) |
| `NSW_TRANSPORT_API_KEY` | Optional | Transport for NSW CCTV cameras |

**`server/.env`** — Server-side (loaded by `dotenv`):

| Variable | Required? | Purpose |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Optional | Server-side Google Maps (currently unused) |
| `OPENSKY_CLIENT_ID` | Optional | OpenSky Network OAuth2 credentials |
| `OPENSKY_CLIENT_SECRET` | Optional | OpenSky Network OAuth2 credentials |

> **All layers degrade gracefully** when keys are missing — the globe falls back to OpenStreetMap, CCTV sources without keys are simply skipped, and external APIs that don't require auth (USGS, CelesTrak, adsb.fi) work without any credentials.

---

## Obtaining API Keys

### 🗺️ Google Maps API Key (for 3D Photorealistic Tiles)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Enable the **Map Tiles API**
5. Go to **APIs & Services → Credentials → Create Credentials → API Key**
6. **IMPORTANT — Restrict your key immediately** (see [Securing Your Google API Key](#securing-your-google-api-key) below)
7. Copy the key into `VITE_GOOGLE_API_KEY` in your `.env` file

> Google offers a **US$200/month free tier** which covers approximately 25,000 3D Tiles loads. For personal/demo usage this is typically more than enough — but set a budget alert just in case.

### 🛰️ Cesium Ion Token (optional)

1. Sign up for a free account at [cesium.com/ion](https://ion.cesium.com/tokens)
2. Go to **Access Tokens** → copy your default token
3. Paste into `VITE_CESIUM_ION_TOKEN` in your `.env`

### 📹 Transport for NSW API Key (for Australian CCTV cameras)

1. Register at [opendata.transport.nsw.gov.au](https://opendata.transport.nsw.gov.au/)
2. Go to **My Applications** → **Create Application**
3. Subscribe to the **Traffic & Cameras** API
4. Copy your API key into `NSW_TRANSPORT_API_KEY` in your `.env`

### ✈️ OpenSky Network (optional, for WebSocket flight data)

1. Register at [opensky-network.org](https://opensky-network.org/)
2. Log in → go to **OAuth** → **Create Client**
3. Copy the client ID and secret into `server/.env`

---


---

### Running the Application

```bash
# Start the backend proxy server (port 3001)
npm run dev:server

# In a separate terminal, start the Vite dev server (port 5173)
npm run dev

# Or start both at once
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Note:** The backend proxy server must be running for data layers to function. Vite's dev server proxies all `/api/*` requests to `localhost:3001`.

### Production Build

```bash
npm run build
npm run preview
```

---

## Deploying to Vercel

This project is pre-configured for [Vercel](https://vercel.com/) via `vercel.json`. The Express backend runs as a Vercel Serverless Function.

### 1. Import the Project

1. Push your repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
3. Select your repo → Vercel auto-detects the Vite framework from `vercel.json`
4. Click **Deploy**

### 2. Set Environment Variables

In your Vercel project dashboard:

1. Go to **Settings → Environment Variables**
2. Add each key from both `.env` files:

| Variable | Environment |
|---|---|
| `VITE_GOOGLE_API_KEY` | Production, Preview |
| `VITE_CESIUM_ION_TOKEN` | Production, Preview |
| `WINDY_API_KEY` | Production, Preview |
| `NSW_TRANSPORT_API_KEY` | Production, Preview |
| `GOOGLE_MAPS_API_KEY` | Production, Preview |
| `OPENSKY_CLIENT_ID` | Production, Preview |
| `OPENSKY_CLIENT_SECRET` | Production, Preview |

> **Note:** `VITE_*` variables are embedded in the client bundle at build time. Server-side variables are available to the serverless function at runtime.


---

## Architecture

### System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Browser (Vite Dev)                     │
│                                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ React Hooks  │  │  App.tsx    │  │   UI Components  │  │
│  │ (data fetch) │──│ (state mgr) │──│  OperationsPanel │  │
│  │              │  │             │  │  IntelFeed       │  │
│  └──────┬───────┘  └──────┬──────┘  │  StatusBar       │  │
│         │                 │         │  CCTVPanel        │  │
│         │          ┌──────┴──────┐  │  TrackedEntity    │  │
│         │          │ GlobeViewer │  └──────────────────┘  │
│         │          │  (Cesium)   │                         │
│         │          │ ┌─────────┐ │                         │
│         │          │ │ Layers  │ │                         │
│         │          │ │ Flight  │ │                         │
│         │          │ │ Sats    │ │                         │
│         │          │ │ Quakes  │ │                         │
│         │          │ │ Traffic │ │                         │
│         │          │ │ CCTV    │ │                         │
│         │          │ └─────────┘ │                         │
│         │          └─────────────┘                         │
└─────────┼──────────────────────────────────────────────────┘
          │  /api/* proxy
┌─────────▼──────────────────────────────────────────────────┐
│              Express Proxy Server (:3001)                    │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐ │
│  │ node-cache│  │ WebSocket │  │      REST Endpoints      │ │
│  │  (TTL)   │  │   (ws)    │  │  /api/flights            │ │
│  └──────────┘  └───────────┘  │  /api/flights/live        │ │
│                               │  /api/satellites          │ │
│                               │  /api/earthquakes         │ │
│                               │  /api/traffic/roads       │ │
│                               │  /api/cctv               │ │
│                               │  /api/cctv/image (proxy) │ │
│                               │  /api/health             │ │
│                               └──────────────────────────┘ │
└─────────────────────────┬──────────────────────────────────┘
                          │
          ┌───────────────┼───────────────────┐
          ▼               ▼                   ▼
   ┌─────────────┐ ┌─────────────┐  ┌──────────────┐
   │ FlightRadar │ │ USGS        │  │ TfL / Austin │
   │ adsb.fi     │ │ CelesTrak   │  │ NSW Transport│
   │ OpenSky     │ │ Overpass API│  │              │
   └─────────────┘ └─────────────┘  └──────────────┘
```

### Data Flow

1. **React hooks** poll the Express proxy server at layer-specific intervals
2. **Express** caches upstream API responses, manages OAuth2 tokens, and hides credentials
3. **App.tsx** manages global state — layer visibility, camera position, tracked entity, shader mode
4. **Layer components** receive data via props and render imperatively into the Cesium scene
5. **UI components** display controls, feeds, and status information as React DOM overlays

### Dual Flight Data Strategy

WorldView merges two aircraft data sources for optimal coverage:

| Source | Coverage | Update Rate | Data Richness |
|---|---|---|---|
| FlightRadar24 | Global (7 zones) | 20 s | Origin/destination airports, airline |
| adsb.fi | Regional (250 NM radius) | 5 s | High-frequency position updates |

- When zoomed out: FR24 global data only
- When zoomed in: adsb.fi replaces FR24 for nearby aircraft (deduplicated by ICAO24)
- Route info from FR24 is cross-referenced to enrich adsb.fi data

---

## Project Structure

```
worldview/
├── server/                        # Backend proxy (Node.js ESM)
│   ├── index.js                   # All routes, WebSocket, caching (909 lines)
│   ├── .env                       # Server secrets
│   └── data/
│       └── sydneyRoads.js         # Static fallback road geometry
├── src/
│   ├── App.tsx                    # Root component — state, hooks, composition
│   ├── main.tsx                   # ReactDOM entrypoint
│   ├── index.css                  # Tailwind v4 + tactical theme + Cesium overrides
│   ├── components/
│   │   ├── globe/
│   │   │   ├── GlobeViewer.tsx    # Cesium Viewer (3D tiles, OSM, shader mgmt)
│   │   │   └── EntityClickHandler.tsx  # Click-to-track, ESC unlock
│   │   ├── layers/
│   │   │   ├── FlightLayer.tsx    # 27K aircraft (imperative, dead-reckoning)
│   │   │   ├── SatelliteLayer.tsx # SGP4 orbit propagation
│   │   │   ├── EarthquakeLayer.tsx # Pulsing seismic markers
│   │   │   ├── TrafficLayer.tsx   # Roads + animated vehicles
│   │   │   └── CCTVLayer.tsx      # Camera markers (imperative)
│   │   └── ui/
│   │       ├── OperationsPanel.tsx # Layer/shader/filter controls
│   │       ├── IntelFeed.tsx      # Real-time event feed
│   │       ├── CCTVPanel.tsx      # Camera grid + preview
│   │       ├── StatusBar.tsx      # Coords, clock, data counts
│   │       ├── SplashScreen.tsx   # Boot sequence
│   │       ├── TrackedEntityPanel.tsx # Lock-on detail
│   │       └── Crosshair.tsx      # SVG targeting reticle
│   ├── data/
│   │   └── airports.ts           # IATA → coordinates lookup
│   ├── hooks/
│   │   ├── useFlights.ts         # Global FR24 polling
│   │   ├── useFlightsLive.ts     # Regional adsb.fi polling
│   │   ├── useSatellites.ts      # TLE fetch + SGP4 pipeline
│   │   ├── useEarthquakes.ts     # USGS polling
│   │   ├── useTraffic.ts         # Road fetch + vehicle simulation
│   │   └── useCameras.ts         # CCTV aggregation
│   ├── shaders/
│   │   └── postprocess.ts        # GLSL: CRT, NVG, FLIR
│   └── types/
│       └── camera.ts             # CameraFeed, CameraSource types
├── .env                           # Client-side env vars
├── package.json
├── vite.config.ts                 # Vite + React + Cesium + Tailwind + proxy
├── tsconfig.json                  # Project references
├── tsconfig.app.json              # Strict TS for src/
└── eslint.config.js
```

---

## Features in Detail

### 🎯 Entity Tracking

Click any entity on the globe to lock the camera onto it. The view follows the entity in real-time with an appropriate offset:
- **Aircraft** — 50 km trailing offset with heading alignment
- **Satellites** — 200 km offset for orbital viewing
- **Earthquakes** — 100 km overhead view of the epicentre
- **CCTV cameras** — 2 km offset at 45° viewing angle

Press **ESC** to unlock tracking without moving the camera.

### 🔭 Optics Modes (Post-Processing)

| Mode | Effect |
|---|---|
| **Standard** | No post-processing |
| **CRT** | Scanlines, chromatic aberration, barrel distortion, vignette |
| **NVG** | Green phosphor, noise grain, bloom, vignette |
| **FLIR** | White-hot thermal palette, Sobel edge detection, high contrast |

### 🗺️ Map Tiles

| Mode | Description |
|---|---|
| **Google 3D** | Google Photorealistic 3D Tiles (requires API key) |
| **OSM** | OpenStreetMap 2D imagery (no key required — default fallback) |

### ✈️ Flight Layer Details

- **Altitude band filtering:** Cruise (>35K ft), High (25–35K), Mid (10–25K), Low (1–10K), Ground (<1K)
- **Route arcs:** Great-circle paths between origin/destination airports with altitude curves
- **Dead-reckoning:** Smooth position interpolation at 60 fps between data updates
- **Colour coding:** Cyan (cruise) → Green (high) → Amber (mid) → Orange (low)

### 🛰️ Satellite Layer Details

- **SGP4 propagation:** Real-time position from TLE orbital elements, updated every 2 seconds
- **Orbit paths:** 90-point polylines showing 90 minutes of predicted trajectory
- **Ground tracks:** Surface projection of the orbit path
- **Nadir lines:** Vertical lines from satellite to ground directly beneath
- **ISS highlighting:** Distinct styling for the International Space Station

### 📹 CCTV System

- **Multi-source aggregation:** London (TfL JamCams), Austin TX (Open Data), NSW Australia (Transport API)
- **Country filtering:** Toggle cameras by country (GB, US, AU)
- **Image proxy:** Backend proxies camera images to avoid CORS issues
- **Thumbnail grid:** Paginated camera grid (30 per page) with lazy-loaded previews
- **Fly-to:** Click any camera to lock the globe view onto its location

---

## API Endpoints (Backend Proxy)

| Method | Endpoint | Cache TTL | Description |
|---|---|---|---|
| `GET` | `/api/flights` | 30 s | Global aircraft (FR24 → adsb.fi fallback) |
| `GET` | `/api/flights/live?lat=X&lon=Y&dist=Z` | 4 s | Regional high-freq aircraft (adsb.fi) |
| `GET` | `/api/satellites?group=stations` | 2 hr | TLE text data (3-line format) |
| `GET` | `/api/earthquakes` | 60 s | USGS GeoJSON feed (past 24 hours) |
| `GET` | `/api/traffic/roads?south=X&west=Y&north=Z&east=W` | 24 hr | Road network from Overpass API |
| `GET` | `/api/cctv?country=XX&source=YY` | 5 min | Aggregated CCTV camera feeds |
| `GET` | `/api/cctv/image?url=ENCODED_URL` | 60 s | CORS image proxy |
| `GET` | `/api/health` | — | Server health + cache stats |
| `WS` | `/ws` | — | Real-time flight push (subscribe via JSON) |

---

## Design System

### Colour Palette

| Token | Hex | Usage |
|---|---|---|
| `wv-black` | `#0A0A0A` | Background |
| `wv-dark` | `#111111` | Panel backgrounds |
| `wv-panel` | `#1A1A1A` | Elevated surfaces |
| `wv-border` | `#2A2A2A` | Borders, dividers |
| `wv-muted` | `#666666` | Disabled/secondary text |
| `wv-text` | `#CCCCCC` | Primary text |
| `wv-cyan` | `#00D4FF` | Primary accent, flights |
| `wv-green` | `#39FF14` | Satellites, success states |
| `wv-amber` | `#FF9500` | Warnings, earthquakes |
| `wv-red` | `#FF3B30` | Errors, CCTV, alerts |
| `wv-teal` | `#00BFA5` | Secondary accent |

### Typography

Monospace font stack: `JetBrains Mono`, `Fira Code`, `SF Mono`, `monospace`

### UI Effects

- **Panel glass** — `backdrop-blur(12px)` with 85% black background
- **Scanline overlay** — 8-second animated sweep from top to bottom
- **Glow classes** — `.glow-cyan`, `.glow-green`, `.glow-amber` text-shadow effects

---

## Development

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run dev:server` | Start Express proxy (port 3001) |
| `npm run dev:all` | Start both servers concurrently |
| `npm run build` | TypeScript compilation + Vite production build |
| `npm run lint` | ESLint across all `.ts`/`.tsx` files |
| `npm run preview` | Serve production build locally |

### Adding a New Data Layer

1. **Create a hook** in `src/hooks/` — fetch data from the backend, return typed state
2. **Create a layer component** in `src/components/layers/` — render Cesium primitives
3. **Add a proxy endpoint** in `server/index.js` — cache upstream API, hide credentials
4. **Wire into App.tsx** — add layer toggle state, invoke hook, pass data to layer component
5. **Update OperationsPanel** — add toggle control for the new layer
6. **Update StatusBar** — add entity count display

### Performance Guidelines

- Use **imperative Cesium primitives** (`BillboardCollection`, `PointPrimitiveCollection`) for layers with >100 entities
- Avoid creating **Resium `<Entity>`** elements in loops for large datasets
- Use `useCallback` and `useMemo` liberally — the Cesium render loop is sensitive to reference changes
- Prefer `CallbackProperty` over React state for Cesium entity positions
- Implement **dead-reckoning** for moving entities to maintain 60 fps between data updates

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Blank globe / no tiles | Check `VITE_GOOGLE_API_KEY` is valid with Maps JavaScript API enabled; the app falls back to OSM automatically |
| No flight/satellite/earthquake data | Ensure the backend proxy is running (`npm run dev:server`) |
| CCTV images not loading | Backend must be running to proxy images through `/api/cctv/image` |
| "429 Too Many Requests" in console | Upstream API rate limit hit; the cache layer reduces frequency, wait for TTL to expire |
| Overpass API timeout | Traffic layer falls back to static Sydney CBD road data |
| Satellites not appearing | TLE API may be temporarily down; CelesTrak is used as automatic fallback |
| Google 3D tiles error | API key may be invalid or quota exceeded; OSM is applied automatically |

---

## Acknowledgements

### Data Sources
- [FlightRadar24](https://www.flightradar24.com/) — Global flight tracking
- [adsb.fi](https://adsb.fi/) — Open ADS-B aircraft data
- [OpenSky Network](https://opensky-network.org/) — Open aircraft surveillance data
- [USGS Earthquake Hazards](https://earthquake.usgs.gov/) — Real-time earthquake feeds
- [CelesTrak](https://celestrak.org/) — Satellite TLE orbital data
- [TLE API](https://tle.ivanstanojevic.me/) — Satellite TLE data service
- [OpenStreetMap / Overpass API](https://overpass-api.de/) — Road network data
- [Transport for London](https://api.tfl.gov.uk/) — London traffic cameras
- [City of Austin Open Data](https://data.austintexas.gov/) — Austin traffic cameras
- [Transport for NSW](https://opendata.transport.nsw.gov.au/) — NSW traffic cameras

### Technologies
- [CesiumJS](https://cesium.com/) + [Resium](https://resium.reearth.io/) — 3D globe rendering
- [satellite.js](https://github.com/shashwatak/satellite-js) — SGP4/SDP4 orbit propagation
- [Turf.js](https://turfjs.org/) — Geospatial analysis utilities

---

## Security

> **No API keys, tokens, or credentials are included in this repository.**

All sensitive values are loaded from `.env` files which are excluded via `.gitignore`. If you fork or clone this repo, you must supply your own API keys.

If you discover a credential leak or security issue, please open an issue immediately.

### Quick Checklist Before Pushing

- [ ] `.env` and `server/.env` are in `.gitignore` (they are by default)
- [ ] No API keys hardcoded in source files
- [ ] Google API key has HTTP referrer restrictions applied
- [ ] Google API key is restricted to Map Tiles API only
- [ ] Budget alerts configured in Google Cloud Console

---

## Licence

This project is for **educational and demonstration purposes only**. External API usage is subject to each provider's terms of service and rate limits. No commercial use is intended.

**You are responsible for securing your own API keys and managing your own API usage costs.** The authors accept no liability for charges incurred through misconfigured or unrestricted API credentials.
