import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_VERIFIER_LOCATION,
  parseVerifierLatLng,
  validateVerifierLocation,
  verifierLocationFromUser,
  verifierLocationPersistFields,
  verifierOwnGpsWrite,
} from './verifierProfileFields.ts';

describe('verifier location persist', () => {
  it('requires PIN district state; GPS optional', () => {
    assert.equal(validateVerifierLocation(EMPTY_VERIFIER_LOCATION), 'Address is required.');
    assert.equal(
      validateVerifierLocation({
        ...EMPTY_VERIFIER_LOCATION,
        address: 'Street',
        pincode: '682001',
        district: 'Ernakulam',
        state: 'Kerala',
      }),
      null,
    );
    assert.equal(parseVerifierLatLng(EMPTY_VERIFIER_LOCATION), undefined);
    assert.deepEqual(
      verifierLocationPersistFields({
        ...EMPTY_VERIFIER_LOCATION,
        address: 'Street',
        pincode: '682001',
        district: 'Ernakulam',
        state: 'Kerala',
      }),
      {
        address: 'Street',
        pincode: '682001',
        state: 'Kerala',
        district: 'Ernakulam',
      },
    );
  });

  it('writes { lat, lng } on the verifier user doc when GPS present', () => {
    const location = {
      address: 'Street, locality',
      pincode: '682001',
      district: 'Ernakulam',
      state: 'Kerala',
      latitude: '10.015',
      longitude: '76.341',
    };
    assert.equal(validateVerifierLocation(location), null);
    assert.deepEqual(verifierLocationPersistFields(location), {
      address: 'Street, locality',
      pincode: '682001',
      state: 'Kerala',
      district: 'Ernakulam',
      location: { lat: 10.015, lng: 76.341 },
    });
  });

  it('round-trips stored verifier GPS', () => {
    const fromUser = verifierLocationFromUser({
      address: 'Street',
      pincode: '682001',
      state: 'Kerala',
      district: 'Ernakulam',
      location: { lat: 10.015, lng: 76.341 },
    });
    assert.equal(fromUser.latitude, '10.015');
    assert.equal(fromUser.longitude, '76.341');
    assert.deepEqual(parseVerifierLatLng(fromUser), { lat: 10.015, lng: 76.341 });
  });

  it('own GPS write is location only', () => {
    assert.deepEqual(verifierOwnGpsWrite(10.015, 76.341), {
      location: { lat: 10.015, lng: 76.341 },
    });
    assert.equal(verifierOwnGpsWrite(91, 76), null);
  });
});
