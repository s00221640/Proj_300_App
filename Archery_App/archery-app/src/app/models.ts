export type BowType = 'recurve' | 'compound' | 'barebow' | 'longbow';

export interface ArcherProfile {
  id: string;
  name: string;
  bowType?: BowType;
  avatarUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Calibration {
  centerX: number;
  centerY: number;
  ringRadiusPx: number;
}

export interface SessionMeta {
  id: string;
  archerId: string;
  dateIso: string;
  roundName?: string;
  distanceMeters?: number;
  targetFace?: string;
  photoPath?: string;
  calibration?: Calibration;
  createdAt: number;
  updatedAt: number;
}

export interface Shot {
  id: string;
  sessionId: string;
  order?: number;
  x: number;
  y: number;
  score?: number;
  createdAt: number;
}

export interface Metrics {
  sessionId: string;
  meanRadialError: number;
  groupSizeR95: number;
  biasAngleDeg: number;
  biasDistance: number;
  computedAt: number;
}
