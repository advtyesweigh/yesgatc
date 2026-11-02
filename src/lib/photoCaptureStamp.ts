export type PhotoCaptureStamp = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  placeName?: string;
  addressLine?: string;
  capturedAt: Date;
  /** Ambient conditions burned into the banner (govt requirement). Raw form strings. */
  ambientTemperature?: string;
  relativeHumidity?: string;
};

/** Ambient readings threaded from the verification session into the photo stamp. */
export type StampWeather = {
  ambientTemperature?: string;
  relativeHumidity?: string;
};

/** `Temp 27 ┬░C   RH 65 %` ΓÇö omits either half when missing; null when both absent. */
function formatStampWeather(stamp: PhotoCaptureStamp): string | null {
  const t = stamp.ambientTemperature?.trim();
  const h = stamp.relativeHumidity?.trim();
  const parts: string[] = [];
  if (t) parts.push(`Temp ${/[┬░Γäâ]/.test(t) ? t : `${t} ┬░C`}`);
  if (h) parts.push(`RH ${h.endsWith('%') ? h : `${h} %`}`);
  return parts.length ? parts.join('   ') : null;
}

type GeoPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

const STAMP_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MAP_ZOOM = 18;
const TILE_SIZE = 256;
/** Above this, village-level labels are often misleading vs true position. */
const POOR_ACCURACY_METERS = 80;
/** Visual scale for stamp text and map inset on the photo. */
const STAMP_LAYOUT_MULTIPLIER = 2;
const GEOCODE_REUSE_MAX_METERS = 120;
/** Cap the map-tile fetch so a slow network never blocks the stamped photo. */
const SATELLITE_TILE_TIMEOUT_MS = 3500;
/** Cap reverse geocode so a slow lookup never blocks the stamped photo. */
const GEOCODE_TIMEOUT_MS = 3500;
const LAST_GPS_STORAGE_KEY = 'yeslab.lastGps';
const LAST_GPS_MAX_AGE_MS = 30 * 60 * 1000;

type CachedGeoPosition = GeoPosition & { savedAt: number };

/** Persist the freshest fix so a cold camera open can stamp instantly on slow GPS. */
function saveLastKnownPosition(pos: GeoPosition): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: CachedGeoPosition = { ...pos, savedAt: Date.now() };
    localStorage.setItem(LAST_GPS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / unavailable */
  }
}

function readLastKnownPosition(): GeoPosition | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_GPS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGeoPosition;
    if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;
    if (Date.now() - parsed.savedAt > LAST_GPS_MAX_AGE_MS) return null;
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracyMeters: parsed.accuracyMeters,
    };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      value => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

function latLonToWorldPx(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function tileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const world = latLonToWorldPx(lat, lon, zoom);
  return {
    x: Math.floor(world.x / TILE_SIZE),
    y: Math.floor(world.y / TILE_SIZE),
  };
}

/** Pixel offset (0ΓÇô256) of lat/lon within its slippy-map tile. */
function pixelInTile(lat: number, lon: number, zoom: number): { px: number; py: number } {
  const world = latLonToWorldPx(lat, lon, zoom);
  const tile = tileXY(lat, lon, zoom);
  return {
    px: world.x - tile.x * TILE_SIZE,
    py: world.y - tile.y * TILE_SIZE,
  };
}

/**
 * Prefer a fresh, high-accuracy fix. Uses watchPosition briefly, then keeps the best reading.
 * Never rejects ΓÇö resolves the best fix, the cached last-known fix, or null. The shutter must
 * not wait on GPS, so callers should treat this as best-effort.
 */
function getBestCurrentPosition(timeoutMs = 14_000): Promise<GeoPosition | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve(readLastKnownPosition());
      return;
    }

    let best: GeoPosition | null = null;
    let settled = false;
    let watchId: number | null = null;

    const consider = (pos: GeolocationPosition) => {
      const candidate: GeoPosition = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
      };
      const bestAcc = best?.accuracyMeters ?? Number.POSITIVE_INFINITY;
      const candAcc = candidate.accuracyMeters ?? Number.POSITIVE_INFINITY;
      if (!best || candAcc < bestAcc) best = candidate;
      if (candAcc <= 20) settleOk();
    };

    const settleOk = () => {
      if (settled || !best) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      saveLastKnownPosition(best);
      resolve(best);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (best) {
        saveLastKnownPosition(best);
        resolve(best);
      } else {
        resolve(readLastKnownPosition());
      }
    }, timeoutMs);

    const geoOpts: PositionOptions = {
      enableHighAccuracy: true,
      // A zero maximumAge waits for a new satellite fix and times out indoors.
      maximumAge: 60_000,
      timeout: timeoutMs,
    };

    watchId = navigator.geolocation.watchPosition(consider, () => {}, geoOpts);

    navigator.geolocation.getCurrentPosition(consider, () => {}, geoOpts);
    navigator.geolocation.getCurrentPosition(consider, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 2 * 60 * 1000,
      timeout: 8_000,
    });
  });
}

import { reverseGeocodeForStamp } from './reverseGeocode';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function loadSatelliteTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  return new Promise(resolve => {
    let settled = false;
    const done = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => done(null), SATELLITE_TILE_TIMEOUT_MS);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      done(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    img.src = url;
  });
}

function formatStampDateTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'shortOffset',
    }).format(date);
  } catch {
    return date.toLocaleString('en-GB');
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Prefetch while the camera is open (GPS + geocode). */
export async function loadPhotoCaptureStamp(): Promise<PhotoCaptureStamp | null> {
  return buildPhotoCaptureStamp(new Date(), null);
}

/** Fixed centre coordinates ΓÇö RC desktop file uploads (same visual as mobile stamp). */
export async function buildPhotoCaptureStampFromCoords(
  latitude: number,
  longitude: number,
  capturedAt = new Date(),
  weather?: StampWeather,
): Promise<PhotoCaptureStamp> {
  const geo = await withTimeout(
    reverseGeocodeForStamp(latitude, longitude),
    GEOCODE_TIMEOUT_MS,
    null,
  );
  return {
    latitude,
    longitude,
    capturedAt,
    placeName: geo?.placeName,
    addressLine: geo?.addressLine,
    ambientTemperature: weather?.ambientTemperature,
    relativeHumidity: weather?.relativeHumidity,
  };
}

async function buildPhotoCaptureStamp(
  capturedAt: Date,
  prefetched: PhotoCaptureStamp | null,
): Promise<PhotoCaptureStamp | null> {
  const pos = await getBestCurrentPosition(prefetched ? 5000 : 14_000);

  if (!pos) {
    // No live fix and no cache ΓÇö reuse prefetched labels/coords if we have them.
    return prefetched ? { ...prefetched, capturedAt } : null;
  }

  const moved =
    !prefetched ||
    haversineMeters(
      prefetched.latitude,
      prefetched.longitude,
      pos.latitude,
      pos.longitude,
    ) > GEOCODE_REUSE_MAX_METERS;

  let placeName = prefetched?.placeName;
  let addressLine = prefetched?.addressLine;

  if (moved) {
    const geo = await withTimeout(
      reverseGeocodeForStamp(pos.latitude, pos.longitude),
      GEOCODE_TIMEOUT_MS,
      null,
    );
    if (geo) {
      placeName = geo.placeName;
      addressLine = geo.addressLine;
    }
  }

  return {
    latitude: pos.latitude,
    longitude: pos.longitude,
    accuracyMeters: pos.accuracyMeters,
    placeName,
    addressLine,
    capturedAt,
  };
}

/**
 * Build stamp at shutter time ΓÇö reuses prefetched geocode when position is stable.
 */
export async function stampForCapture(
  capturedAt: Date,
  prefetched: PhotoCaptureStamp | null,
): Promise<PhotoCaptureStamp | null> {
  if (!prefetched) return buildPhotoCaptureStamp(capturedAt, null);
  return buildPhotoCaptureStamp(capturedAt, prefetched);
}

function drawMapPin(
  ctx: CanvasRenderingContext2D,
  pinX: number,
  pinY: number,
  scale: number,
  mapSize: number,
) {
  const pinR = Math.max(mapSize * 0.08, 5 * scale);
  ctx.fillStyle = '#3b82f6';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, scale * 1.5);
  ctx.beginPath();
  ctx.arc(pinX, pinY, pinR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(pinX, pinY, pinR * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/** Burn GPS, time, and satellite inset into the bottom of a canvas. */
export async function drawPhotoCaptureStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stamp: PhotoCaptureStamp,
): Promise<void> {
  const scale = Math.max(width / 1080, 0.55) * STAMP_LAYOUT_MULTIPLIER;
  const pad = Math.round(12 * scale);
  const mapSize = Math.round(Math.min(width * 0.22, height * 0.2, 140 * scale));
  const fontSm = Math.round(11 * scale);
  const fontMd = Math.round(13 * scale);
  const fontLg = Math.round(15 * scale);
  const lineGap = Math.round(4 * scale);

  const latStr = `Lat ${stamp.latitude.toFixed(6)}┬░`;
  const lonStr = `Long ${stamp.longitude.toFixed(6)}┬░`;
  const timeStr = formatStampDateTime(stamp.capturedAt);
  const accuracyNote =
    stamp.accuracyMeters != null && stamp.accuracyMeters > POOR_ACCURACY_METERS
      ? `GPS accuracy ┬▒${Math.round(stamp.accuracyMeters)}m ΓÇö using coordinates`
      : stamp.accuracyMeters != null && stamp.accuracyMeters > 25
        ? `GPS ┬▒${Math.round(stamp.accuracyMeters)}m`
        : null;

  const weatherStr = formatStampWeather(stamp);

  const textLines: string[] = [];
  if (accuracyNote) textLines.push(accuracyNote);
  if (stamp.placeName) textLines.push(stamp.placeName);
  if (stamp.addressLine && stamp.addressLine !== stamp.placeName) {
    textLines.push(...wrapText(ctx, stamp.addressLine, width * 0.62));
  }
  textLines.push(`${latStr}  ${lonStr}`);
  if (weatherStr) textLines.push(weatherStr);
  textLines.push(timeStr);

  ctx.font = `${fontMd}px ${STAMP_FONT_FAMILY}`;
  const textBlockHeight = textLines.length * (fontMd + lineGap) + pad * 2;
  const barHeight = Math.max(textBlockHeight, mapSize + pad * 2);
  const barTop = height - barHeight;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, barTop, width, barHeight);

  const { x: tileX, y: tileY } = tileXY(stamp.latitude, stamp.longitude, MAP_ZOOM);
  const { px, py } = pixelInTile(stamp.latitude, stamp.longitude, MAP_ZOOM);
  const mapImg = await loadSatelliteTile(MAP_ZOOM, tileX, tileY);
  const textLeft = mapImg ? pad + mapSize + pad : pad;

  if (mapImg) {
    const mapX = pad;
    const mapY = barTop + (barHeight - mapSize) / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, scale);
    ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);

    const pinX = mapX + (px / TILE_SIZE) * mapSize;
    const pinY = mapY + (py / TILE_SIZE) * mapSize;
    drawMapPin(ctx, pinX, pinY, scale, mapSize);
  }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  let y = barTop + pad;

  const titleLine = stamp.placeName;
  if (titleLine) {
    ctx.font = `600 ${fontLg}px ${STAMP_FONT_FAMILY}`;
    ctx.fillText(titleLine, textLeft, y);
    y += fontLg + lineGap;
  }

  for (const line of textLines) {
    if (line === titleLine) continue;
    const isCoords = line.startsWith('Lat ');
    const isTime = line === timeStr;
    const isAccuracy = line.startsWith('GPS');
    const isWeather = weatherStr != null && line === weatherStr;
    const compact = isCoords || isTime || isWeather;
    ctx.font = `${isCoords || isTime || isAccuracy || isWeather ? 500 : 400} ${
      compact ? fontSm : fontMd
    }px ${STAMP_FONT_FAMILY}`;
    ctx.fillStyle =
      isAccuracy ? 'rgba(251, 191, 36, 0.95)' : compact ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.88)';
    const maxW = width - textLeft - pad;
    for (const wrapped of compact || isAccuracy ? [line] : wrapText(ctx, line, maxW)) {
      ctx.fillText(wrapped, textLeft, y);
      y += (compact ? fontSm : fontMd) + lineGap;
    }
  }

  ctx.restore();
}
