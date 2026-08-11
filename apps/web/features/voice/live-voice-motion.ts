export type LiveVoiceVisualPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'error';

export const ORB_SHAPES = {
  calm: 'M160 101C160 134 135 160 101 160C67 160 40 135 40 101C40 67 65 40 99 40C134 40 160 67 160 101Z',
  open: 'M163 94C168 127 143 157 110 163C77 169 45 147 38 114C31 81 51 48 83 39C115 30 150 48 160 79C162 84 163 89 163 94Z',
  lean: 'M157 82C169 112 151 146 122 159C92 173 58 157 42 129C26 101 37 65 64 47C92 29 130 40 150 65C153 70 155 76 157 82Z',
  lift: 'M153 69C173 96 161 133 136 153C111 174 73 166 51 142C28 118 31 80 52 55C74 29 112 30 139 49C145 54 150 61 153 69Z',
  swell:
    'M166 108C163 141 132 166 99 164C65 162 35 137 36 103C36 70 63 35 97 36C130 37 164 62 166 96C167 100 167 104 166 108Z',
} as const;

interface PhaseMotion {
  readonly morphDuration: number;
  readonly lightDuration: number;
  readonly scale: number;
  readonly energy: number;
  readonly shapes: readonly string[];
}

export const PHASE_MOTION: Record<LiveVoiceVisualPhase, PhaseMotion> = {
  idle: {
    morphDuration: 3.4,
    lightDuration: 7.5,
    scale: 1.01,
    energy: 0.62,
    shapes: [ORB_SHAPES.open, ORB_SHAPES.swell, ORB_SHAPES.calm],
  },
  connecting: {
    morphDuration: 2.5,
    lightDuration: 4.8,
    scale: 1.025,
    energy: 0.72,
    shapes: [ORB_SHAPES.lean, ORB_SHAPES.swell, ORB_SHAPES.calm],
  },
  listening: {
    morphDuration: 1.25,
    lightDuration: 3.4,
    scale: 1.065,
    energy: 0.88,
    shapes: [ORB_SHAPES.swell, ORB_SHAPES.open, ORB_SHAPES.lean],
  },
  thinking: {
    morphDuration: 1.7,
    lightDuration: 2.6,
    scale: 1.035,
    energy: 0.82,
    shapes: [ORB_SHAPES.lift, ORB_SHAPES.swell, ORB_SHAPES.lean],
  },
  speaking: {
    morphDuration: 0.72,
    lightDuration: 1.85,
    scale: 1.1,
    energy: 1,
    shapes: [ORB_SHAPES.swell, ORB_SHAPES.lift, ORB_SHAPES.open],
  },
  muted: {
    morphDuration: 4,
    lightDuration: 8,
    scale: 0.96,
    energy: 0.34,
    shapes: [ORB_SHAPES.calm],
  },
  error: {
    morphDuration: 4,
    lightDuration: 8,
    scale: 0.97,
    energy: 0.42,
    shapes: [ORB_SHAPES.calm],
  },
};
