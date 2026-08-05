import { getTableColumns } from 'drizzle-orm/utils';
import { describe, expect, it } from 'vitest';
import {
  audioConsentProofMethods,
  audioConsentPurposes,
  audioConsents,
  audioRetentions,
} from './schema/audio-consent';

describe('audio consent schema 静态形状', () => {
  it('三种 consent purpose 封闭且互不替代', () => {
    expect(audioConsentPurposes).toEqual([
      'voice_processing',
      'audio_retention',
      'cloud_transcription',
    ]);
  });

  it('授权证明方式封闭且区分开发声明与生产核验', () => {
    expect(audioConsentProofMethods).toEqual([
      'adult_self_attested',
      'adult_verified',
      'guardian_self_attested',
      'guardian_verified',
    ]);
  });

  it('audio_consents 包含同意事实必需列', () => {
    expect(Object.keys(getTableColumns(audioConsents))).toEqual(
      expect.arrayContaining([
        'id',
        'subjectUserId',
        'grantorUserId',
        'authorizationType',
        'proofMethod',
        'proofReference',
        'purpose',
        'consentVersion',
        'noticeVersion',
        'status',
        'grantedAt',
        'expiresAt',
        'revokedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('audio_consents 不包含证件图片、Prompt、Provider body 或 Secret 列', () => {
    const columns = Object.keys(getTableColumns(audioConsents)).join(',');
    expect(columns).not.toMatch(
      /identity|id_card|photo|prompt|provider|secret/i,
    );
  });

  it('audio_retentions 只含元数据，不包含 storageKey、音频字节或转录文本', () => {
    const columns = Object.keys(getTableColumns(audioRetentions));
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'subjectUserId',
        'consentId',
        'consentPurpose',
        'assetVersionId',
        'status',
        'createdAt',
        'expiresAt',
        'deletionRequestedAt',
      ]),
    );
    expect(columns).not.toContain('storageKey');
    expect(columns).not.toContain('audioBytes');
    expect(columns).not.toContain('pcmBytes');
    expect(columns).not.toContain('transcriptionText');
  });
});
