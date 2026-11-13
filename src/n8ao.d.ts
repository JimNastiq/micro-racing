declare module 'n8ao' {
  import { Pass } from 'postprocessing';
  import { Scene, Camera } from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: Record<string, any>;
    setQualityMode(mode: string): void;
    setSize(w: number, h: number): void;
  }
}
