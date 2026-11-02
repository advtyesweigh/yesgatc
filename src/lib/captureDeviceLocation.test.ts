import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { geolocationErrorMessage } from './captureDeviceLocation.ts';

describe('geolocation errors', () => {
  it('maps browser codes to a field message', () => {
    assert.match(geolocationErrorMessage(1) ?? '', /Allow location/);
    assert.match(geolocationErrorMessage(2) ?? '', /Turn on device location/);
    assert.match(geolocationErrorMessage(3) ?? '', /timed out/);
    assert.equal(geolocationErrorMessage(0), null);
  });
});
