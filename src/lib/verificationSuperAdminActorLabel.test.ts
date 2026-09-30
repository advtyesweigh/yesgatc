import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  rcAdminPersonName,
  verificationSuperAdminActorLabel,
} from './verificationSuperAdminActorLabel.ts';

describe('rcAdminPersonName', () => {
  it('prefers contactPerson over company / username-as-company', () => {
    assert.equal(
      rcAdminPersonName({
        contactPerson: 'Riyas',
        username: 'Meezan electronic scales pvt ltd',
        companyName: 'Meezan electronic scales pvt ltd',
      }),
      'Riyas',
    );
  });

  it('uses username when it is a person, not the company', () => {
    assert.equal(
      rcAdminPersonName({
        username: 'Riyas',
        companyName: 'Meezan electronic scales pvt ltd',
      }),
      'Riyas',
    );
  });

  it('does not fall back to companyName', () => {
    assert.equal(
      rcAdminPersonName({
        username: 'Meezan electronic scales pvt ltd',
        companyName: 'Meezan electronic scales pvt ltd',
      }),
      '',
    );
  });
});

describe('verificationSuperAdminActorLabel', () => {
  it('replaces third-party verifier with RC admin person, not company', () => {
    assert.equal(
      verificationSuperAdminActorLabel(
        {
          performedBy: 'verifier',
          requestSource: 'verifier_manual',
          vctName: 'G.K ELECTRONICS',
          vctId: 'gk-1',
        },
        {
          rcContactPerson: 'Riyas',
          rcCenterName: 'Meezan electronic scales pvt ltd',
        },
      ),
      'Riyas',
    );
  });

  it('does not show company when contactPerson missing and username is company', () => {
    assert.equal(
      verificationSuperAdminActorLabel(
        {
          performedBy: 'verifier',
          requestSource: 'verifier_manual',
          vctName: 'G.K ELECTRONICS',
        },
        {
          rcAdminUsername: 'Meezan electronic scales pvt ltd',
          rcCenterName: 'Meezan electronic scales pvt ltd',
        },
      ),
      '—',
    );
  });

  it('keeps VCT name on Super Admin', () => {
    assert.equal(
      verificationSuperAdminActorLabel(
        {
          performedBy: 'vct',
          vctName: 'LINESH T R',
          vctId: 'vct-1',
        },
        { rcContactPerson: 'Riyas', rcCenterName: 'Meezan RC' },
      ),
      'LINESH T R',
    );
  });

  it('keeps RC self / contact person', () => {
    assert.equal(
      verificationSuperAdminActorLabel(
        { performedBy: 'rc', requestSource: 'rc_direct' },
        { rcContactPerson: 'Hafiz', rcCenterName: 'Meezan RC' },
      ),
      'Hafiz',
    );
  });
});
