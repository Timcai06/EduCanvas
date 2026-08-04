/** Official sherpa-onnx profiles used by the bounded V02-S/V02-T studies. */

const PROFILES = Object.freeze({
  current: Object.freeze({
    architecture: 'transducer',
    id: 'current-bilingual-fp32',
    directory: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    encoder: 'encoder-epoch-99-avg-1.onnx',
    decoder: 'decoder-epoch-99-avg-1.onnx',
    joiner: 'joiner-epoch-99-avg-1.onnx',
    tokens: 'tokens.txt',
    bpeVocab: 'bpe.vocab',
    modelingUnit: 'cjkchar+bpe',
    languageScope: 'zh-en',
    license: 'Apache-2.0',
    modelBytes: 356862456,
    source:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2',
    archiveSha256:
      '27ffbd9ee24ad186d99acc2f6354d7992b27bcab490812510665fa8f9389c5f8',
    hashes: Object.freeze({
      encoder:
        '709f0ed53a734b7942f170127e7547b566cb29c4afc5e67719f314c3d63ccb10',
      decoder:
        '2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d',
      joiner:
        '5f2adc585dd1bec6421c8bb8660d2a73fc8b9ceb24491ef51399ba2a2f0fc31b',
      tokens:
        'a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3',
      bpeVocab:
        'd0b642f3a2eacd5fadefdeff9e0e1358cab729647cbb7fe58cf738e1f7407029',
      bpeModel:
        'bcae393dbc5611be5ffa4c7ae0841558978a5a4f484008cb9dff3a2cc97ebe01',
    }),
  }),
  'small-bilingual-fp32': Object.freeze({
    architecture: 'transducer',
    id: 'small-bilingual-fp32',
    directory:
      'sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16',
    encoder: 'encoder-epoch-99-avg-1.onnx',
    decoder: 'decoder-epoch-99-avg-1.onnx',
    joiner: 'joiner-epoch-99-avg-1.onnx',
    tokens: 'tokens.txt',
    bpeVocab: 'bpe.vocab',
    modelingUnit: 'cjkchar+bpe',
    languageScope: 'zh-en',
    license: 'Apache-2.0',
    modelBytes: 115256102,
    source:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16.tar.bz2',
    archiveSha256:
      '2b7c63322b32e5e0f2526043a1103366119ca58dd615cd7105a37c01db9553d7',
    hashes: Object.freeze({
      encoder:
        '21b820759ba8a2792838748cdc5a14690fe2010bcb6b370f62e71c87ffeefd84',
      decoder:
        '89be509a83175261695bdef5fd1c7b9ab1129a663d1284e7ba9f8507b21e0906',
      joiner:
        'bcbcf0cc1b449bc32b7777084ab5a65d1199b822e2aae149d3a43adc9f4b5775',
      tokens:
        'a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3',
      bpeVocab:
        'd0b642f3a2eacd5fadefdeff9e0e1358cab729647cbb7fe58cf738e1f7407029',
      bpeModel:
        'bcae393dbc5611be5ffa4c7ae0841558978a5a4f484008cb9dff3a2cc97ebe01',
    }),
  }),
  'paraformer-bilingual-int8': Object.freeze({
    architecture: 'paraformer',
    id: 'paraformer-bilingual-int8',
    directory: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en-int8',
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    tokens: 'tokens.txt',
    modelingUnit: null,
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    supportsHotwords: false,
    languageScope: 'zh-en',
    license: 'Apache-2.0',
    modelBytes: 237202501,
    source:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2',
    sourceRevision: 'asr-models',
    archiveSha256:
      '5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f',
    hashes: Object.freeze({
      encoder:
        '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a',
      decoder:
        'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f',
      tokens:
        '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6',
    }),
  }),
});

export function getModelProfile(name) {
  return PROFILES[name] ?? null;
}

export function listModelProfiles() {
  return Object.keys(PROFILES);
}

export function requiredModelFiles(profile) {
  return profile.architecture === 'paraformer'
    ? [profile.encoder, profile.decoder, profile.tokens]
    : [
        profile.encoder,
        profile.decoder,
        profile.joiner,
        profile.tokens,
        profile.bpeVocab,
      ];
}

export function expectedRequiredModelHashes(profile) {
  const hashes = {
    [profile.encoder]: profile.hashes.encoder,
    [profile.decoder]: profile.hashes.decoder,
    [profile.tokens]: profile.hashes.tokens,
  };
  if (profile.architecture !== 'paraformer') {
    hashes[profile.joiner] = profile.hashes.joiner;
    hashes[profile.bpeVocab] = profile.hashes.bpeVocab;
  }
  return Object.freeze(hashes);
}
