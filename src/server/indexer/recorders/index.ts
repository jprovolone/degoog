import { DEFAULT_RECORDER, type Recorder } from "./default";

const RECORDERS = new Map<string, Recorder>();

export const regRecorder = (engineType: string, recorder: Recorder): void => {
  RECORDERS.set(engineType, recorder);
};

export const recorderFor = (engineType: string): Recorder =>
  RECORDERS.get(engineType) ?? DEFAULT_RECORDER;

export type { Recorder, IndexRow } from "./default";
