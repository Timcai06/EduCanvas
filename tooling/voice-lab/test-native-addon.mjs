/**
 * V01: 原生 addon 最小可复现验证
 *
 * 使用 16kHz 单声道 WAV 测试 sherpa-onnx 原生 addon 的流式识别能力。
 * 测试 models/.../test_wavs/ 下的 0.wav、1.wav、2.wav、3.wav。
 *
 * 注意：模型文件不提交到仓库；路径始终相对本脚本解析，不绑定开发者目录。
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));

// 模型路径配置（相对脚本解析，不提交到仓库）
const MODEL_DIR = join(
  __dirname,
  'models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
);
const TEST_WAVS = ['0.wav', '1.wav', '2.wav', '3.wav'];
const TAIL_PADDING_SECONDS = 0.4;

// 延迟加载 sherpa-onnx-node（C++ addon）
let sherpa;
try {
  sherpa = require('sherpa-onnx-node');
} catch (err) {
  console.error('无法加载 sherpa-onnx-node:', err.message);
  console.error('请确保已安装: npm install sherpa-onnx-node');
  process.exit(1);
}

/**
 * 测试原生 addon 流式识别
 */
async function testNativeAddon() {
  console.log('=== V01: 原生 addon 最小可复现验证 ===\n');

  // 环境信息
  console.log('环境信息:');
  console.log(`  sherpa-onnx-node 版本: ${JSON.stringify(sherpa.version)}`);
  console.log(`  Git SHA: ${sherpa.gitSha1}`);
  console.log(`  Git Date: ${sherpa.gitDate}`);
  console.log(`  Node.js 版本: ${process.version}`);
  console.log(`  架构: ${process.arch}`);
  console.log(`  平台: ${process.platform}`);
  console.log('');

  // 保持与 sherpa-onnx nodejs-addon 文件识别示例相同的最小配置。
  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      transducer: {
        encoder: join(MODEL_DIR, 'encoder-epoch-99-avg-1.onnx'),
        decoder: join(MODEL_DIR, 'decoder-epoch-99-avg-1.onnx'),
        joiner: join(MODEL_DIR, 'joiner-epoch-99-avg-1.onnx'),
      },
      tokens: join(MODEL_DIR, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  };

  console.log('模型配置:');
  console.log(`  编码器: ${config.modelConfig.transducer.encoder}`);
  console.log(`  解码器: ${config.modelConfig.transducer.decoder}`);
  console.log(`  连接器: ${config.modelConfig.transducer.joiner}`);
  console.log(`  词表: ${config.modelConfig.tokens}`);
  console.log('');

  // 创建识别器
  console.log('创建 OnlineRecognizer...');
  const startTime = performance.now();

  const recognizer = new sherpa.OnlineRecognizer(config);

  const initTime = performance.now() - startTime;
  console.log(`  初始化时间: ${initTime.toFixed(2)}ms`);
  console.log('');

  // 测试所有 WAV 文件
  const failedWavs = [];
  for (const wavFile of TEST_WAVS) {
    const wavPath = join(MODEL_DIR, 'test_wavs', wavFile);
    console.log(`测试 ${wavFile}...`);

    const stream = recognizer.createStream();
    const wave = sherpa.readWave(wavPath);

    console.log(`  采样率: ${wave.sampleRate}Hz`);
    console.log(`  样本数: ${wave.samples.length}`);
    console.log(
      `  时长: ${(wave.samples.length / wave.sampleRate).toFixed(2)}s`,
    );

    const feedStart = performance.now();
    stream.acceptWaveform({
      samples: wave.samples,
      sampleRate: wave.sampleRate,
    });
    stream.acceptWaveform({
      samples: new Float32Array(wave.sampleRate * TAIL_PADDING_SECONDS),
      sampleRate: wave.sampleRate,
    });

    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }

    const result = recognizer.getResult(stream);
    const totalTime = performance.now() - feedStart;
    const audioDuration = wave.samples.length / wave.sampleRate;
    const rtf = totalTime / (audioDuration * 1000);

    console.log(`  文本: "${result.text}"`);
    console.log(`  RTF: ${rtf.toFixed(4)}`);

    const hasNonEmptyText = result.text.trim().length > 0;
    if (!hasNonEmptyText) {
      console.log('  结果: 空文本');
      failedWavs.push(wavFile);
    } else {
      console.log('  结果: 通过');
    }
    console.log('');
  }

  // 总结
  console.log('=== 验证结果 ===');
  if (failedWavs.length === 0) {
    console.log('V01 原生 addon 验证通过!');
  } else {
    console.error(
      `V01 原生 addon 验证失败: ${failedWavs.join(', ')} 返回空文本`,
    );
    process.exit(1);
  }
}

// 运行测试
testNativeAddon().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
