import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bpeModelToVocab,
  parseBpeModel,
  pyFloatRepr,
} from './bpe-vocab-export.mjs';

/** 手工构造一个最小 ModelProto：三个 SentencePiece（pieces=field 1）。 */
function buildFixtureBpeModel() {
  const piece = (text, score, type) => {
    const pieceBytes = Buffer.from(text, 'utf8');
    const chunks = [];
    // field 1 (piece, wireType 2)
    chunks.push(0x0a, pieceBytes.length, ...pieceBytes);
    // field 2 (score, wireType 5, float32 LE)
    const scoreBuf = Buffer.alloc(4);
    scoreBuf.writeFloatLE(score, 0);
    chunks.push(0x15, ...scoreBuf);
    // field 3 (type, wireType 0)
    chunks.push(0x18, type);
    const body = Buffer.from(chunks);
    return [0x0a, body.length, ...body];
  };
  return Buffer.from([
    ...piece('<unk>', 0, 2), // UNKNOWN
    ...piece('<s>', -1.5, 3), // CONTROL
    ...piece('▁贝', 0.123456, 1), // NORMAL
  ]);
}

test('parseBpeModel 读取 piece/score/type 三元组', () => {
  const pieces = parseBpeModel(buildFixtureBpeModel());
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces[0], { piece: '<unk>', score: 0, type: 2 });
  assert.deepEqual(pieces[1], { piece: '<s>', score: -1.5, type: 3 });
  assert.deepEqual(pieces[2], {
    piece: '▁贝',
    score: 0.12345600128173828,
    type: 1,
  });
});

test('bpeModelToVocab 输出 piece\\t<score> 每行', () => {
  const vocab = bpeModelToVocab(buildFixtureBpeModel());
  assert.equal(
    vocab,
    // score 是 float32 读出的精确值，与 Python sentencepiece 的 get_score 一致。
    '<unk>\t0.0\n<s>\t-1.5\n▁贝\t0.12345600128173828\n',
  );
});

test('pyFloatRepr 与 Python str(float) 风格一致', () => {
  assert.equal(pyFloatRepr(0), '0.0');
  assert.equal(pyFloatRepr(-0), '-0.0');
  assert.equal(pyFloatRepr(1.5), '1.5');
  assert.equal(pyFloatRepr(0.123456), '0.123456');
  assert.equal(pyFloatRepr(-2), '-2.0');
});

test('空模型输出空文本', () => {
  assert.equal(bpeModelToVocab(Buffer.alloc(0)), '');
});
