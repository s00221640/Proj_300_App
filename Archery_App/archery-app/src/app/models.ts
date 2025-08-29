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
  createdAt: number;
  updatedAt: number;
  photoPath?: string;
  calibration?: {
    centerX: number;
    centerY: number;
    ringRadiusPx: number;
  };
  arrowsPerEnd?: number; // <-- add this
}

export interface Shot {
  id: string;
  sessionId: string;
  x: number;
  y: number;
  order?: number;
  score?: number;
  createdAt: number;
  endIndex?: number; // <-- add this
}

export interface Metrics {
  sessionId: string;
  meanRadialError: number;
  groupSizeR95: number;
  biasAngleDeg: number;
  biasDistance: number;
  computedAt: number;
}
