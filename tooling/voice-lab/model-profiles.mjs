/** Official sherpa-onnx transducer profiles used by the bounded V02-S study. */

const PROFILES = Object.freeze({
  current: Object.freeze({
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
});

export function getModelProfile(name) {
  return PROFILES[name] ?? null;
}

export function listModelProfiles() {
  return Object.keys(PROFILES);
}

export function requiredModelFiles(profile) {
  return [
    profile.encoder,
    profile.decoder,
    profile.joiner,
    profile.tokens,
    profile.bpeVocab,
  ];
}

export function expectedRequiredModelHashes(profile) {
  return Object.freeze({
    [profile.encoder]: profile.hashes.encoder,
    [profile.decoder]: profile.hashes.decoder,
    [profile.joiner]: profile.hashes.joiner,
    [profile.tokens]: profile.hashes.tokens,
    [profile.bpeVocab]: profile.hashes.bpeVocab,
  });
}
