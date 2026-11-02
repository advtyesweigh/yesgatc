export type CapturedDeviceLocation = {
  latitude: string;
  longitude: string;
  accuracyMeters?: number;
};

const LAST_GPS_STORAGE_KEY = 'yeslab.lastGps';

/** Same cache the photo stamp reads, so a checklist capture can stamp the next photo. */
function rememberDeviceFix(fix: CapturedDeviceLocation): void {
  if (typeof localStorage === 'undefined') return;
  const latitude = Number(fix.latitude);
  const longitude = Number(fix.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  try {
    localStorage.setItem(
      LAST_GPS_STORAGE_KEY,
      JSON.stringify({
        latitude,
        longitude,
        accuracyMeters: fix.accuracyMeters,
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* storage full / unavailable */
  }
}

export function geolocationErrorMessage(code: number | undefined): string | null {
  if (code === 1) {
    return 'Location blocked. Allow location for this site in the browser, then tap Capture again.';
  }
  if (code === 2) {
    return 'Location is off. Turn on device location and tap Capture again.';
  }
  if (code === 3) {
    return 'Location timed out. Stay on this screen with location on, then tap Capture again.';
  }
  return null;
}

export function formatGeolocationError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') {
      const mapped = geolocationErrorMessage(code);
      if (mapped) return mapped;
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Could not detect location.';
}

function toCaptured(pos: GeolocationPosition): CapturedDeviceLocation {
  return {
    latitude: pos.coords.latitude.toFixed(6),
    longitude: pos.coords.longitude.toFixed(6),
    accuracyMeters: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
  };
}

/**
 * Phone GPS for party coordinates.
 * Must be called in the same turn as a tap so the browser can show the permission prompt.
 * Accepts a network fix. A satellite-only request (`maximumAge: 0`) times out indoors on Android Chrome.
 */
export function captureDeviceLocation(timeoutMs = 12_000): Promise<CapturedDeviceLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported in this browser.'));
      return;
    }

    let watchId: number | null = null;
    let settled = false;
    let best: GeolocationPosition | null = null;

    const stop = () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      window.clearTimeout(giveUpTimer);
      window.clearTimeout(acceptTimer);
    };

    const succeed = (pos: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      stop();
      const fix = toCaptured(pos);
      rememberDeviceFix(fix);
      resolve(fix);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error(formatGeolocationError(error)));
    };

    const note = (pos: GeolocationPosition) => {
      const acc = pos.coords.accuracy ?? Number.POSITIVE_INFINITY;
      const bestAcc = best?.coords.accuracy ?? Number.POSITIVE_INFINITY;
      if (!best || acc < bestAcc) best = pos;
      if (acc <= 80) succeed(pos);
    };

    const giveUpTimer = window.setTimeout(() => {
      if (best) {
        succeed(best);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        succeed,
        error => fail(error),
        { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 8_000 },
      );
    }, timeoutMs);

    // Take whatever fix we have after a short wait so a shop visit does not sit on Pending.
    const acceptTimer = window.setTimeout(() => {
      if (best) succeed(best);
    }, 2_500);

    watchId = navigator.geolocation.watchPosition(
      note,
      error => {
        if (error.code === error.PERMISSION_DENIED) fail(error);
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: timeoutMs },
    );

    navigator.geolocation.getCurrentPosition(
      note,
      error => {
        if (error.code === error.PERMISSION_DENIED) fail(error);
      },
      { enableHighAccuracy: false, maximumAge: 2 * 60 * 1000, timeout: 8_000 },
    );
  });
}
