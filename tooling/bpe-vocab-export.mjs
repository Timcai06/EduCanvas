#!/usr/bin/env node
/**
 * sentencepiece bpe.model → bpe.vocab 纯 JS 导出器。
 *
 * sherpa-onnx 的热词功能（modified_beam_search + modelingUnit=cjkchar+bpe）
 * 需要 bpe.vocab 而不是 bpe.model：sherpa-onnx 不引入 sentencepiece C++
 * 依赖，只接受官方 `scripts/export_bpe_vocab.py` 产出的 `piece\t<score>`
 * 每行格式（见 https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html）。
 *
 * 本模块用确定性输出复刻该导出，使模型安装脚本无需 Python/sentencepiece
 * 即可生成热词所需词表，并让 model-gateway 的 fail-closed 闸门可以用冻结的
 * SHA-256 校验 bpe.vocab。输出只依赖 bpe.model 字节，同一输入恒得同一输出。
 *
 * 解析依据：sentencepiece ModelProto 中 `repeated SentencePiece pieces = 1`，
 * 每个 SentencePiece 为 `piece = 1(string)`、`score = 2(float32)`、
 * `type = 3(varint)`；未知字段按 wire type 跳过，不做 schema 外的假设。
 */

/** 解析 protobuf varint；返回 [值, 新偏移]。 */
function readVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, offset];
    shift += 7;
    if (shift > 63) throw new Error('varint_too_long');
  }
  throw new Error('truncated_varint');
}

/** 解析一个 SentencePiece 子消息（field 1=piece, 2=score, 3=type）。 */
function parseSentencePiece(buffer) {
  let piece = '';
  let score = 0;
  let type = 0;
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, next] = readVarint(buffer, offset);
    offset = next;
    const field = tag >> 3;
    const wireType = tag & 0x07;
    if (field === 1 && wireType === 2) {
      const [len, after] = readVarint(buffer, offset);
      offset = after;
      piece = buffer.toString('utf8', offset, offset + len);
      offset += len;
    } else if (field === 2 && wireType === 5) {
      score = buffer.readFloatLE(offset);
      offset += 4;
    } else if (field === 3 && wireType === 0) {
      const [value, after] = readVarint(buffer, offset);
      offset = after;
      type = value;
    } else if (wireType === 0) {
      const [, after] = readVarint(buffer, offset);
      offset = after;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const [len, after] = readVarint(buffer, offset);
      offset = after + len;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      throw new Error(`unsupported_wire_type_${wireType}`);
    }
  }
  return { piece, score, type };
}

/** 解析 bpe.model（ModelProto），返回按文件顺序的 SentencePiece 数组。 */
export function parseBpeModel(buffer) {
  const pieces = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, next] = readVarint(buffer, offset);
    offset = next;
    const field = tag >> 3;
    const wireType = tag & 0x07;
    if (field === 1 && wireType === 2) {
      const [len, after] = readVarint(buffer, offset);
      offset = after;
      pieces.push(parseSentencePiece(buffer.subarray(offset, offset + len)));
      offset += len;
    } else if (wireType === 0) {
      const [, after] = readVarint(buffer, offset);
      offset = after;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const [len, after] = readVarint(buffer, offset);
      offset = after + len;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      throw new Error(`unsupported_wire_type_${wireType}`);
    }
  }
  return pieces;
}

/**
 * 浮点 score 输出为 Python `str(float)` 风格（整数附加 `.0`），与官方
 * `export_bpe_vocab.py` 的 f-string 一致；消费端按浮点解析，格式差异无影响。
 */
export function pyFloatRepr(value) {
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** 由 bpe.model 字节生成 bpe.vocab 文本（每行 `piece\t<score>`）。 */
export function bpeModelToVocab(buffer) {
  const lines = parseBpeModel(buffer).map(
    ({ piece, score }) => `${piece}\t${pyFloatRepr(score)}`,
  );
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
