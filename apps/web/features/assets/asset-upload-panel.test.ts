import { describe, expect, it } from 'vitest';
import { DOCUMENT_UPLOAD_ACCEPT } from './asset-upload-panel';

describe('文档上传文件选择契约', () => {
  it.each(['.pdf', '.docx', '.pptx', '.xlsx', '.md', '.markdown', '.txt'])(
    '允许 ADR-0026 文档格式 %s',
    (extension) => {
      expect(`,${DOCUMENT_UPLOAD_ACCEPT},`).toContain(`,${extension},`);
    },
  );

  it('使用浏览器标准 OOXML MIME，服务端内部 MIME 归一化不泄漏到选择器', () => {
    expect(DOCUMENT_UPLOAD_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(DOCUMENT_UPLOAD_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(DOCUMENT_UPLOAD_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});
