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
  readonly shape: string;
}

export const PHASE_MOTION: Record<LiveVoiceVisualPhase, PhaseMotion> = {
  idle: {
    morphDuration: 2.8,
    lightDuration: 7.2,
    scale: 1,
    energy: 0.62,
    shape: ORB_SHAPES.open,
  },
  connecting: {
    morphDuration: 2.4,
    lightDuration: 5.8,
    scale: 1.015,
    energy: 0.72,
    shape: ORB_SHAPES.lean,
  },
  listening: {
    morphDuration: 1.6,
    lightDuration: 4.6,
    scale: 1.035,
    energy: 0.84,
    shape: ORB_SHAPES.swell,
  },
  thinking: {
    morphDuration: 1.9,
    lightDuration: 4.2,
    scale: 1.025,
    energy: 0.82,
    shape: ORB_SHAPES.lift,
  },
  speaking: {
    morphDuration: 1.15,
    lightDuration: 3.2,
    scale: 1.065,
    energy: 1,
    shape: ORB_SHAPES.swell,
  },
  muted: {
    morphDuration: 4,
    lightDuration: 8,
    scale: 0.96,
    energy: 0.34,
    shape: ORB_SHAPES.calm,
  },
  error: {
    morphDuration: 4,
    lightDuration: 8,
    scale: 0.97,
    energy: 0.42,
    shape: ORB_SHAPES.calm,
  },
};
