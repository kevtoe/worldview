/**
 * WorldView Backend Proxy Server
 *
 * Proxies external APIs (OpenSky, CelesTrak, USGS) to:
 * 1. Hide API credentials from the browser
 * 2. Cache responses to respect rate limits
 * 3. Push real-time updates via WebSocket
 *
 * Run: node server/index.js
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import NodeCache from 'node-cache';
import { createServer } from 'http';
import { SYDNEY_ROADS } from './data/sydneyRoads.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Cache ────────────────────────────────────────────────────
const cache = new NodeCache();

// ─── OpenSky OAuth2 Token Management ──────────────────────────
let openskyToken = null;
let openskyTokenExpiry = 0;

async function getOpenSkyToken() {
  if (openskyToken && Date.now() < openskyTokenExpiry) {
    return openskyToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('OpenSky credentials not configured');
  }

  const res = await fetch(
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!res.ok) throw new Error(`OpenSky token error: ${res.status}`);
  const data = await res.json();
  openskyToken = data.access_token;
  // Refresh 60s before expiry
  openskyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return openskyToken;
}

// ─── REST Endpoints ───────────────────────────────────────────

/** GET /api/earthquakes */
app.get('/api/earthquakes', async (_req, res) => {
  try {
    const cached = cache.get('earthquakes');
    if (cached) return res.json(cached);

    const apiRes = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
    );
    const data = await apiRes.json();

    cache.set('earthquakes', data, 60); // Cache 60 seconds
    res.json(data);
  } catch (err) {
    console.error('Earthquakes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/satellites?group=stations — returns TLE text (3-line format) */
app.get('/api/satellites', async (req, res) => {
  try {
    const group = req.query.group || 'stations';
    const cacheKey = `satellites-tle-${group}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.type('text/plain').send(cached);
      return;
    }

    // Primary: tle.ivanstanojevic.me (free, no auth required)
    const searchMap = {
      stations: 'ISS',
      active: '',
      starlink: 'STARLINK',
      'gps-ops': 'GPS',
      weather: 'NOAA',
    };
    const searchTerm = searchMap[group] ?? group;
    const pageSize = 100;

    let tleText = '';

    try {
      const apiRes = await fetch(
        `https://tle.ivanstanojevic.me/api/tle/?search=${encodeURIComponent(searchTerm)}&page_size=${pageSize}&sort=popularity&sort-dir=desc`
      );
      if (!apiRes.ok) throw new Error(`TLE API HTTP ${apiRes.status}`);
      const data = await apiRes.json();

      // Convert JSON to 3-line TLE text format for the frontend parser
      const lines = [];
      for (const sat of data.member || []) {
        if (sat.name && sat.line1 && sat.line2) {
          lines.push(sat.name, sat.line1, sat.line2);
        }
      }
      tleText = lines.join('\n');
      console.log(`[SAT] Fetched ${(data.member || []).length} satellites from tle.ivanstanojevic.me for "${searchTerm}"`);
    } catch (primaryErr) {
      console.warn('[SAT] Primary TLE API failed, trying CelesTrak fallback:', primaryErr.message);
      // Fallback: CelesTrak
      const celestrakRes = await fetch(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`,
        {
          headers: {
            'User-Agent': 'WorldView-Satellite-Tracker/1.0 (educational project)',
            'Accept': 'text/plain',
          },
        }
      );
      if (!celestrakRes.ok) throw new Error(`CelesTrak HTTP ${celestrakRes.status}`);
      tleText = await celestrakRes.text();
      console.log(`[SAT] Fetched TLE data from CelesTrak fallback for group: ${group}`);
    }

    cache.set(cacheKey, tleText, 7200); // Cache 2 hours
    res.type('text/plain').send(tleText);
  } catch (err) {
    console.error('Satellites error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/traffic/roads?south=X&west=Y&north=Z&east=W
 * Fetches road network from OpenStreetMap Overpass API within a bounding box.
 * Returns road geometries with metadata (name, class, speed limit).
 * Cached for 24 hours per bounding box.
 * Falls back to static Sydney CBD data if Overpass fails.
 */

// Static fallback road data loaded from ./data/sydneyRoads.js (353 roads, Sydney CBD)
const SYDNEY_BBOX = { south: -33.875, west: 151.195, north: -33.855, east: 151.220 };

/**
 * Check if a requested bbox overlaps with the static Sydney data bbox.
 */
function bboxOverlapsSydney(south, west, north, east) {
  return !(east < SYDNEY_BBOX.west || west > SYDNEY_BBOX.east ||
           north < SYDNEY_BBOX.south || south > SYDNEY_BBOX.north);
}

/**
 * Filter static roads that fall within a requested bbox.
 */
function filterRoadsByBbox(roads, south, west, north, east) {
  return roads.filter((road) => {
    // Check if any geometry point falls within the bbox
    return road.geometry.some(
      (pt) => pt.lat >= south && pt.lat <= north && pt.lon >= west && pt.lon <= east
    );
  });
}

app.get('/api/traffic/roads', async (req, res) => {
  try {
    const { south, west, north, east } = req.query;

    if (!south || !west || !north || !east) {
      return res.status(400).json({ error: 'Missing bbox params: south, west, north, east' });
    }

    const bbox = { south: parseFloat(south), west: parseFloat(west), north: parseFloat(north), east: parseFloat(east) };
    const cacheKey = `traffic-roads:${south},${west},${north},${east}`;

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[TRAFFIC] Cache hit for bbox: ${south},${west},${north},${east}`);
      return res.json({ roads: cached, cached: true, source: 'cache' });
    }

    // Attempt Overpass API fetch with a short timeout
    let roads = null;
    try {
      roads = await fetchFromOverpass(bbox);
      if (roads && roads.length > 0) {
        console.log(`[TRAFFIC] Fetched ${roads.length} road segments from Overpass for bbox: ${south},${west},${north},${east}`);
        cache.set(cacheKey, roads, 86400);
        return res.json({ roads, cached: false, source: 'overpass' });
      }
    } catch (overpassErr) {
      console.warn(`[TRAFFIC] Overpass failed, falling back to static data:`, overpassErr.message);
    }

    // Fallback: serve static data if bbox overlaps Sydney
    if (bboxOverlapsSydney(bbox.south, bbox.west, bbox.north, bbox.east)) {
      const filtered = filterRoadsByBbox(SYDNEY_ROADS, bbox.south, bbox.west, bbox.north, bbox.east);
      console.log(`[TRAFFIC] Serving ${filtered.length} static Sydney roads for bbox: ${south},${west},${north},${east}`);
      cache.set(cacheKey, filtered, 86400);
      return res.json({ roads: filtered, cached: false, source: 'static-sydney' });
    }

    // No Overpass data and not near Sydney — return empty
    console.log(`[TRAFFIC] No data available for bbox: ${south},${west},${north},${east}`);
    return res.json({ roads: [], cached: false, source: 'none' });

  } catch (err) {
    console.error('[TRAFFIC] Error fetching roads:', {
      message: err?.message,
      code: err?.code,
    });
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

/**
 * Fetch roads from Overpass API with failover between servers.
 * Returns parsed road array or throws on failure.
 */
async function fetchFromOverpass(bbox) {
  const query = `
[out:json][timeout:10];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"]
  (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out geom;
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout — fail fast, fallback handles rest

  const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let overpassData;
  let lastErr;
  for (const serverUrl of OVERPASS_SERVERS) {
    try {
      const overpassRes = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (overpassRes.status === 429) {
        console.warn(`[TRAFFIC] Rate limited by ${serverUrl}, trying next server...`);
        lastErr = new Error(`Overpass API HTTP 429 (${serverUrl})`);
        continue;
      }

      if (!overpassRes.ok) {
        lastErr = new Error(`Overpass API HTTP ${overpassRes.status} (${serverUrl})`);
        continue;
      }

      overpassData = await overpassRes.json();
      break;
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        throw new Error('Overpass API request timeout (15s)');
      }
      lastErr = fetchErr;
      console.warn(`[TRAFFIC] ${serverUrl} failed:`, fetchErr.message);
      continue;
    }
  }

  if (!overpassData) {
    throw lastErr || new Error('All Overpass servers failed');
  }

  return (overpassData.elements || [])
    .filter((el) => el.type === 'way' && el.geometry)
    .map((way) => ({
      id: `way:${way.id}`,
      name: way.tags?.name || 'Unnamed',
      highway: way.tags?.highway || 'unknown',
      maxspeed: parseInt(way.tags?.maxspeed || '50', 10),
      geometry: way.geometry.map((pt) => ({ lat: pt.lat, lon: pt.lon })),
      length_meters: calculateLineLength(way.geometry),
    }));
}

/**
 * Utility: Calculate line length in meters using Haversine formula.
 * Approximation for short segments is acceptable.
 */
function calculateLineLength(geometry) {
  if (!geometry || geometry.length < 2) return 0;

  const R = 6371000; // Earth radius in meters
  let distance = 0;

  for (let i = 0; i < geometry.length - 1; i++) {
    const lat1 = (geometry[i].lat * Math.PI) / 180;
    const lon1 = (geometry[i].lon * Math.PI) / 180;
    const lat2 = (geometry[i + 1].lat * Math.PI) / 180;
    const lon2 = (geometry[i + 1].lon * Math.PI) / 180;

    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distance += R * c;
  }

  return distance;
}

// ─── CCTV Camera Endpoints ────────────────────────────────────

/**
 * Source parsers: normalise each external API into unified CameraFeed objects.
 */
function parseTflCameras(data) {
  return data
    .filter((cam) => cam.placeType === 'JamCam')
    .map((cam) => {
      const props = {};
      (cam.additionalProperties || []).forEach((p) => { props[p.key] = p.value; });
      return {
        id: `tfl-${cam.id}`,
        name: cam.commonName || 'Unknown',
        source: 'tfl',
        country: 'GB',
        countryName: 'United Kingdom',
        region: 'London',
        latitude: cam.lat,
        longitude: cam.lon,
        imageUrl: props.imageUrl || '',
        videoUrl: props.videoUrl || '',
        available: props.available === 'true',
        viewDirection: props.view || '',
        lastUpdated: new Date().toISOString(),
      };
    })
    .filter((c) => c.latitude && c.longitude && c.imageUrl);
}

function parseAustinCameras(data) {
  return data
    .filter((cam) => cam.location && cam.camera_status === 'TURNED_ON')
    .map((cam) => ({
      id: `austin-${cam.camera_id}`,
      name: (cam.location_name || 'Unknown').trim(),
      source: 'austin',
      country: 'US',
      countryName: 'United States',
      region: 'Austin, TX',
      latitude: cam.location.coordinates[1],
      longitude: cam.location.coordinates[0],
      imageUrl: cam.screenshot_address || '',
      available: true,
      lastUpdated: cam.modified_date || new Date().toISOString(),
    }))
    .filter((c) => c.latitude && c.longitude && c.imageUrl);
}

function parseNswCameras(data) {
  return (data.features || []).map((f) => ({
    id: `nsw-${f.id}`,
    name: f.properties?.title || 'Unknown',
    source: 'tfnsw',
    country: 'AU',
    countryName: 'Australia',
    region: f.properties?.region || 'NSW',
    latitude: f.geometry?.coordinates?.[1],
    longitude: f.geometry?.coordinates?.[0],
    imageUrl: f.properties?.href || '',
    available: true,
    viewDirection: f.properties?.direction || '',
    lastUpdated: new Date().toISOString(),
  }));
}

/**
 * GET /api/cctv — Aggregated camera feeds from all sources.
 * Query params:
 *   ?country=GB  — ISO country code filter (optional)
 *   ?source=tfl  — specific source filter (optional)
 */
app.get('/api/cctv', async (req, res) => {
  try {
    const country = req.query.country?.toUpperCase();
    const sourceFilter = req.query.source;

    // Fetch each source in parallel, using cache when available
    const sources = [
      {
        key: 'cctv-tfl',
        source: 'tfl',
        country: 'GB',
        ttl: 300,
        fetch: async () => {
          const r = await fetch('https://api.tfl.gov.uk/Place/Type/JamCam');
          if (!r.ok) throw new Error(`TfL HTTP ${r.status}`);
          return parseTflCameras(await r.json());
        },
      },
      {
        key: 'cctv-austin',
        source: 'austin',
        country: 'US',
        ttl: 300,
        fetch: async () => {
          const r = await fetch('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=2000');
          if (!r.ok) throw new Error(`Austin HTTP ${r.status}`);
          return parseAustinCameras(await r.json());
        },
      },
      {
        key: 'cctv-nsw',
        source: 'tfnsw',
        country: 'AU',
        ttl: 300,
        fetch: async () => {
          const apiKey = process.env.NSW_TRANSPORT_API_KEY;
          if (!apiKey) throw new Error('NSW_TRANSPORT_API_KEY not configured');
          const r = await fetch('https://api.transport.nsw.gov.au/v1/live/cameras', {
            headers: { Authorization: `apikey ${apiKey}` },
          });
          if (!r.ok) throw new Error(`NSW HTTP ${r.status}`);
          return parseNswCameras(await r.json());
        },
      },
    ];

    // Filter sources by query params before fetching
    const activeSources = sources.filter((s) => {
      if (sourceFilter && s.source !== sourceFilter) return false;
      if (country && s.country !== country) return false;
      return true;
    });

    // Fetch all sources in parallel with graceful error handling
    const results = await Promise.allSettled(
      activeSources.map(async (s) => {
        const cached = cache.get(s.key);
        if (cached) return cached;

        const data = await s.fetch();
        cache.set(s.key, data, s.ttl);
        console.log(`[CCTV] Fetched ${data.length} cameras from ${s.source}`);
        return data;
      })
    );

    // Aggregate successful results
    let cameras = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        cameras = cameras.concat(result.value);
      } else {
        console.warn('[CCTV] Source failed:', result.reason?.message);
      }
    }

    const onlineCameras = cameras.filter((c) => c.available !== false);

    res.json({
      cameras,
      meta: {
        totalCameras: cameras.length,
        onlineCameras: onlineCameras.length,
        sources: [...new Set(cameras.map((c) => c.source))],
        countries: [...new Set(cameras.map((c) => c.country))],
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[CCTV] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cctv/image — Image proxy to avoid CORS issues.
 * Query params:
 *   ?url=<encoded_image_url>
 */
app.get('/api/cctv/image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ error: 'Missing url param' });

    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'WorldView-CCTV/1.0',
        Accept: 'image/*',
      },
    });

    if (!imgRes.ok) {
      return res.status(imgRes.status).json({ error: `Upstream HTTP ${imgRes.status}` });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    });

    // Stream the image through to the client
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('[CCTV-IMG] Proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/geolocation — IP-based location fallback via ip-api.com (free, no key) */
app.get('/api/geolocation', async (req, res) => {
  try {
    // Use client's real IP (forwarded by reverse proxy) or fall back to default
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
    // Detect localhost/loopback — let ip-api.com auto-detect the public IP
    const isLocal = /^(::1|127\.|::ffff:127\.|0\.0\.0\.0|localhost)/.test(rawIp);
    const ipParam = isLocal ? '' : rawIp;

    // ip-api.com — free for non-commercial/server-side, no key, returns lat/lon/city/country
    const apiRes = await fetch(`http://ip-api.com/json/${ipParam}`);
    const data = await apiRes.json();

    if (data.status !== 'success') {
      return res.status(502).json({ success: false, error: data.message || 'IP geolocation failed' });
    }

    res.json({
      success: true,
      latitude: data.lat,
      longitude: data.lon,
      city: data.city,
      country: data.country,
      countryCode: data.countryCode,
      region: data.regionName,
      ip: data.query,
    });
  } catch (err) {
    console.error('[GEO] IP geolocation error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Ship / AIS Tracking (AISStream.io) ──────────────────────

/**
 * Burst-WebSocket approach for Vercel compatibility:
 * Opens a WebSocket to AISStream.io for ~20 seconds, collects PositionReport
 * messages, deduplicates by MMSI (keeps latest), then closes.
 * Result is cached for 60 seconds so most requests are served instantly.
 *
 * 20s burst collects ~2,000-4,000 unique vessels globally.
 * This avoids the need for a persistent connection — each cache miss
 * triggers a short-lived burst that fits within Vercel's 30s timeout.
 */
async function collectAISBurst(apiKey, durationMs = 20000) {
  const { WebSocket: WsClient } = await import('ws');
  const vessels = new Map(); // MMSI → vessel data (dedup, keeps latest)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ok */ }
      resolve(Array.from(vessels.values()));
    }, durationMs);

    let ws;
    try {
      ws = new WsClient('wss://stream.aisstream.io/v0/stream');
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
      return;
    }

    ws.on('open', () => {
      console.log('[SHIPS] AISStream WebSocket connected, collecting for', durationMs, 'ms');
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const meta = msg.MetaData;
        if (!meta) return;
        const mmsi = String(meta.MMSI);

        if (msg.MessageType === 'PositionReport') {
          const pos = msg.Message?.PositionReport;
          if (!pos) return;
          // Merge with existing data (may have static data already)
          const existing = vessels.get(mmsi) || {};
          vessels.set(mmsi, {
            ...existing,
            mmsi,
            name: (meta.ShipName || existing.name || '').trim(),
            latitude: pos.Latitude,
            longitude: pos.Longitude,
            heading: pos.TrueHeading === 511 ? null : pos.TrueHeading,
            cog: pos.Cog >= 360 ? null : pos.Cog,
            sog: pos.Sog,
            navStatus: pos.NavigationalStatus ?? null,
            timestamp: meta.time_utc || new Date().toISOString(),
            shipType: existing.shipType ?? null,
            destination: existing.destination ?? null,
            imo: existing.imo ?? null,
            callSign: existing.callSign ?? null,
            length: existing.length ?? null,
            width: existing.width ?? null,
            country: meta.country ?? existing.country ?? null,
            countryCode: meta.country_code ?? existing.countryCode ?? null,
          });
        } else if (msg.MessageType === 'ShipStaticData') {
          const stat = msg.Message?.ShipStaticData;
          if (!stat) return;
          const existing = vessels.get(mmsi) || {};
          vessels.set(mmsi, {
            ...existing,
            mmsi,
            name: (meta.ShipName || stat.Name || existing.name || '').trim(),
            shipType: stat.Type ?? existing.shipType ?? null,
            destination: (stat.Destination || '').trim() || existing.destination || null,
            imo: stat.ImoNumber ?? existing.imo ?? null,
            callSign: (stat.CallSign || '').trim() || existing.callSign || null,
            length: stat.Dimension?.A && stat.Dimension?.B
              ? stat.Dimension.A + stat.Dimension.B : existing.length ?? null,
            width: stat.Dimension?.C && stat.Dimension?.D
              ? stat.Dimension.C + stat.Dimension.D : existing.width ?? null,
            country: meta.country ?? existing.country ?? null,
            countryCode: meta.country_code ?? existing.countryCode ?? null,
            // Keep position fields from PositionReport if already present
            latitude: existing.latitude,
            longitude: existing.longitude,
            heading: existing.heading,
            cog: existing.cog,
            sog: existing.sog,
            navStatus: existing.navStatus,
            timestamp: existing.timestamp,
          });
        }
      } catch { /* skip malformed messages */ }
    });

    ws.on('error', (err) => {
      console.error('[SHIPS] AISStream WebSocket error:', err.message);
      clearTimeout(timeout);
      // Resolve with whatever we have so far rather than rejecting
      resolve(Array.from(vessels.values()));
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      resolve(Array.from(vessels.values()));
    });
  });
}

/** GET /api/ships — returns array of vessel positions from AIS
 *  Query params:
 *    ?moving=1  — only vessels with SOG > 0.5 kt (excludes moored/anchored)
 */
app.get('/api/ships', async (req, res) => {
  try {
    const wantMoving = req.query.moving === '1';
    const cacheKey = wantMoving ? 'ships-moving' : 'ships-all';

    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[SHIPS] Cache hit (${cacheKey}) — ${cached.length} vessels`);
      return res.json(cached);
    }

    // Check if we already have the full dataset cached (avoid redundant burst)
    let allVessels = cache.get('ships-all');
    if (!allVessels) {
      const apiKey = process.env.AISSTREAM_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AISSTREAM_API_KEY not configured' });
      }

      console.log('[SHIPS] Cache miss — starting AIS burst collection (20s)...');
      const raw = await collectAISBurst(apiKey, 20000);

      // Filter out vessels without valid position
      allVessels = raw.filter(
        (v) => v.latitude != null && v.longitude != null &&
               v.latitude !== 0 && v.longitude !== 0 &&
               Math.abs(v.latitude) <= 90 && Math.abs(v.longitude) <= 180
      );

      console.log(`[SHIPS] Collected ${raw.length} raw → ${allVessels.length} with valid position`);
      cache.set('ships-all', allVessels, 60);
    }

    // Build moving-only subset
    // Stationary: navStatus 1 (anchor), 5 (moored), 6 (aground) OR SOG < 0.5 kt
    const STATIONARY_NAV = new Set([1, 5, 6]);
    const movingVessels = allVessels.filter(
      (v) => v.sog > 0.5 && !STATIONARY_NAV.has(v.navStatus)
    );
    cache.set('ships-moving', movingVessels, 60);

    const result = wantMoving ? movingVessels : allVessels;
    console.log(`[SHIPS] Returning ${result.length} vessels (moving=${wantMoving}, total=${allVessels.length}, underway=${movingVessels.length})`);
    res.json(result);
  } catch (err) {
    console.error('[SHIPS] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Health check */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cache: cache.getStats(),
  });
});

/**
 * GET /api/flights — returns global live aircraft via FlightRadar24 (primary) or adsb.fi (fallback).
 * No query params needed — returns worldwide data.
 *
 * FR24 response format: each aircraft is a 19-element array where:
 *   [0]=icao24, [1]=lat, [2]=lon, [3]=heading, [4]=alt_ft, [5]=speed_kts,
 *   [6]=squawk, [7]=radar, [8]=acType, [9]=registration, [10]=timestamp,
 *   [11]=originAirport, [12]=destAirport, [13]=callsign, [14]=unknown,
 *   [15]=vertRate, [16]=callsignCode, [17]=unknown, [18]=airline
 */
let lastFlightFetchTime = 0;
const FLIGHT_MIN_INTERVAL = 15_000; // 15s between upstream API calls

// Regional bounding boxes for global coverage (10 zones × up to 1500 each ≈ full global)
const FR24_ZONES = [
  { name: 'europe',        bounds: '72,35,-15,45' },
  { name: 'north_america', bounds: '72,15,-170,-50' },
  { name: 'south_america', bounds: '15,-60,-90,-30' },
  { name: 'middle_east',   bounds: '45,10,25,65' },
  { name: 'asia_east',     bounds: '55,5,65,150' },
  { name: 'oceania',       bounds: '5,-50,100,180' },
  { name: 'africa',        bounds: '38,-40,-20,55' },
];

/** Fetch a single FR24 zone */
async function fetchFR24Zone(bounds) {
  const url = `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=${bounds}&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=0&maxage=14400&gliders=0&stats=0&limit=1500`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WorldView/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`FR24 HTTP ${res.status}`);
  return res.json();
}

/** Parse FR24 array format into our unified flight object */
function parseFR24Aircraft(id, arr) {
  if (!Array.isArray(arr) || arr.length < 15) return null;
  const lat = arr[1];
  const lon = arr[2];
  if (lat == null || lon == null || lat === 0 || lon === 0) return null;

  // arr[0] is the real ICAO24 transponder hex; `id` is FR24's internal key —
  // only use the transponder hex so keys match adsb.fi for dedup
  const icao24 = (arr[0] || '').toLowerCase();
  if (!icao24) return null; // skip aircraft without a real transponder code

  const altFeet = arr[4] ?? 0;
  return {
    icao24,
    callsign: (arr[13] || '').trim(),
    registration: arr[9] || '',
    aircraftType: arr[8] || '',
    description: '',
    operator: arr[18] || '',
    country: '',
    latitude: lat,
    longitude: lon,
    altitude: altFeet * 0.3048,
    altitudeFeet: altFeet,
    onGround: altFeet <= 0,
    velocity: arr[5] != null ? arr[5] * 0.514444 : null,
    velocityKnots: arr[5] ?? null,
    heading: arr[3] ?? null,
    verticalRate: arr[15] != null ? arr[15] * 0.00508 : null,
    squawk: arr[6] || '',
    category: '',
    originAirport: arr[11] || '',
    destAirport: arr[12] || '',
    airline: arr[18] || '',
  };
}

app.get('/api/flights', async (_req, res) => {
  try {
    const cacheKey = 'flights-global';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Rate-limit upstream calls
    const now = Date.now();
    if (now - lastFlightFetchTime < FLIGHT_MIN_INTERVAL) {
      const stale = cache.get(cacheKey);
      return res.json(stale || []);
    }
    lastFlightFetchTime = now;

    let flights = [];

    // Primary: FlightRadar24 — global data with origin/destination airports
    try {
      const zoneResults = await Promise.allSettled(
        FR24_ZONES.map((z) => fetchFR24Zone(z.bounds))
      );

      const seen = new Set();
      for (const result of zoneResults) {
        if (result.status !== 'fulfilled') continue;
        const data = result.value;
        for (const [key, value] of Object.entries(data)) {
          if (key === 'full_count' || key === 'version' || key === 'stats') continue;
          if (seen.has(key)) continue; // deduplicate across zones
          seen.add(key);
          const flight = parseFR24Aircraft(key, value);
          if (flight && !flight.onGround) flights.push(flight);
        }
      }

      console.log(`[FLT] Fetched ${flights.length} airborne aircraft from FR24 (${FR24_ZONES.length} zones)`);
    } catch (fr24Err) {
      console.warn('[FLT] FR24 failed, trying adsb.fi fallback:', fr24Err.message);

      // Fallback: adsb.fi — limited to a region but still useful
      try {
        const adsbRes = await fetch('https://opendata.adsb.fi/api/v2/lat/0/lon/0/dist/250');
        if (!adsbRes.ok) throw new Error(`adsb.fi HTTP ${adsbRes.status}`);
        const adsbData = await adsbRes.json();

        flights = (adsbData.aircraft || [])
          .filter((a) => a.lat != null && a.lon != null)
          .map((a) => ({
            icao24: a.hex || '',
            callsign: (a.flight || '').trim(),
            registration: a.r || '',
            aircraftType: a.t || '',
            description: a.desc || '',
            operator: a.ownOp || '',
            country: '',
            latitude: a.lat,
            longitude: a.lon,
            altitude: a.alt_baro === 'ground' ? 0 : (a.alt_baro ?? 0) * 0.3048,
            altitudeFeet: a.alt_baro === 'ground' ? 0 : (a.alt_baro ?? 0),
            onGround: a.alt_baro === 'ground',
            velocity: a.gs != null ? a.gs * 0.514444 : null,
            velocityKnots: a.gs ?? null,
            heading: a.track ?? a.mag_heading ?? null,
            verticalRate: a.baro_rate != null ? a.baro_rate * 0.00508 : null,
            squawk: a.squawk || '',
            category: a.category || '',
            originAirport: '',
            destAirport: '',
            airline: '',
          }));
        console.log(`[FLT] Fetched ${flights.length} aircraft from adsb.fi fallback`);
      } catch (adsbErr) {
        console.error('[FLT] adsb.fi fallback also failed:', adsbErr.message);
      }
    }

    cache.set(cacheKey, flights, 30); // Cache 30 seconds (FR24 is now background enrichment)
    res.json(flights);
  } catch (err) {
    console.error('Flights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/flights/live?lat=X&lon=Y&dist=Z — high-frequency regional aircraft via adsb.fi.
 * Returns positions updated every ~1-2s by the adsb.fi network.
 * Frontend polls this every 5s for smooth real-time movement.
 *
 * adsb.fi aircraft fields:
 *   hex, flight, r (reg), t (type), desc, ownOp, lat, lon,
 *   alt_baro, gs (ground speed kts), track, baro_rate, squawk, category
 */
app.get('/api/flights/live', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 0;
    const lon = parseFloat(req.query.lon) || 0;
    const dist = Math.min(parseInt(req.query.dist) || 250, 250); // max 250nm

    const cacheKey = `flights-live-${lat.toFixed(1)}-${lon.toFixed(1)}-${dist}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const adsbUrl = `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${dist}`;
    const adsbRes = await fetch(adsbUrl, {
      headers: {
        'User-Agent': 'WorldView-Tracker/1.0 (educational project)',
        'Accept': 'application/json',
      },
    });

    if (!adsbRes.ok) throw new Error(`adsb.fi HTTP ${adsbRes.status}`);
    const adsbData = await adsbRes.json();

    // Also load the FR24 route registry for enrichment (origin/dest airports)
    const routeMap = cache.get('fr24-route-registry') || {};

    const flights = (adsbData.aircraft || [])
      .filter((a) => a.lat != null && a.lon != null && a.alt_baro !== 'ground')
      .map((a) => {
        const hex = (a.hex || '').toLowerCase();
        const fr24Info = routeMap[hex] || {};
        return {
          icao24: hex,
          callsign: (a.flight || '').trim(),
          registration: a.r || '',
          aircraftType: a.t || '',
          description: a.desc || '',
          operator: a.ownOp || '',
          country: '',
          latitude: a.lat,
          longitude: a.lon,
          altitude: (a.alt_baro ?? 0) * 0.3048,
          altitudeFeet: a.alt_baro ?? 0,
          onGround: a.alt_baro === 'ground' || a.alt_baro === 0,
          velocity: a.gs != null ? a.gs * 0.514444 : null,
          velocityKnots: a.gs ?? null,
          heading: a.track ?? a.mag_heading ?? null,
          verticalRate: a.baro_rate != null ? a.baro_rate * 0.00508 : null,
          squawk: a.squawk || '',
          category: a.category || '',
          // Enrich with FR24 route data if available
          originAirport: fr24Info.originAirport || '',
          destAirport: fr24Info.destAirport || '',
          airline: fr24Info.airline || '',
        };
      });

    console.log(`[FLT-LIVE] ${flights.length} aircraft from adsb.fi (${lat.toFixed(1)}, ${lon.toFixed(1)}, ${dist}nm)`);

    cache.set(cacheKey, flights, 4); // Cache 4 seconds
    res.json(flights);
  } catch (err) {
    console.warn('[FLT-LIVE] adsb.fi error (returning empty):', err.message);
    // Return empty array instead of 500 — frontend degrades gracefully to global FR24 data
    res.json([]);
  }
});

/**
 * Background task: build a route registry from FR24 global data.
 * Maps icao24 → { originAirport, destAirport, airline } for enriching adsb.fi data.
 * Runs every 60s to keep route info fresh without hammering FR24.
 */
async function refreshRouteRegistry() {
  try {
    const zoneResults = await Promise.allSettled(
      FR24_ZONES.map((z) => fetchFR24Zone(z.bounds))
    );

    const registry = {};
    let count = 0;
    for (const result of zoneResults) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      for (const [key, value] of Object.entries(data)) {
        if (key === 'full_count' || key === 'version' || key === 'stats') continue;
        if (!Array.isArray(value) || value.length < 15) continue;
        const icao = (value[0] || key || '').toLowerCase();
        if (icao && (value[11] || value[12])) {
          registry[icao] = {
            originAirport: value[11] || '',
            destAirport: value[12] || '',
            airline: value[18] || '',
          };
          count++;
        }
      }
    }

    cache.set('fr24-route-registry', registry, 90); // valid for 90s
    console.log(`[FLT-ROUTES] Route registry updated: ${count} aircraft with route data`);
  } catch (err) {
    console.warn('[FLT-ROUTES] Route registry refresh failed:', err.message);
  }
}

// Start route registry refresh loop (every 60s)
setInterval(refreshRouteRegistry, 60_000);
// Initial fetch after 5s (let server start up first)
setTimeout(refreshRouteRegistry, 5_000);

// ─── WebSocket for real-time flight push ──────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let flightPollingInterval = null;

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'subscribe-flights' && data.bbox) {
        // Start polling flights for this bounding box
        startFlightPolling(data.bbox);
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    if (wss.clients.size === 0 && flightPollingInterval) {
      clearInterval(flightPollingInterval);
      flightPollingInterval = null;
    }
  });
});

async function startFlightPolling(bbox) {
  if (flightPollingInterval) clearInterval(flightPollingInterval);

  const poll = async () => {
    try {
      const token = await getOpenSkyToken();
      const params = new URLSearchParams({
        lamin: String(bbox.south),
        lomin: String(bbox.west),
        lamax: String(bbox.north),
        lomax: String(bbox.east),
      });

      const apiRes = await fetch(
        `https://opensky-network.org/api/states/all?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!apiRes.ok) return;
      const data = await apiRes.json();

      const flights = (data.states || []).map((s) => ({
        icao24: s[0],
        callsign: (s[1] || '').trim(),
        country: s[2],
        longitude: s[5],
        latitude: s[6],
        altitude: s[7],
        onGround: s[8],
        velocity: s[9],
        heading: s[10],
        verticalRate: s[11],
      }));

      const payload = JSON.stringify({ type: 'flights', data: flights, time: Date.now() });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(payload);
      }
    } catch (err) {
      console.error('[WS] Flight poll error:', err.message);
    }
  };

  await poll();
  flightPollingInterval = setInterval(poll, 10_000); // Every 10s
}

// ─── Export for Vercel Serverless ──────────────────────────────
export { app };
export default app;

// ─── Start (standalone mode only) ─────────────────────────────
// When imported as a module by Vercel, this block is skipped.
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server/index.js') ||
  process.argv[1].endsWith('server\\index.js')
);

if (isDirectRun) {
  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   WORLDVIEW PROXY SERVER              ║
║   Port: ${PORT}                          ║
║   WebSocket: ws://localhost:${PORT}/ws    ║
╚═══════════════════════════════════════╝
    `);
  });
}
