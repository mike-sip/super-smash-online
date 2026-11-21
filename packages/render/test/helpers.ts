import type { Camera, Scene } from 'three';
import type { DrawBackend } from '../src/renderer.ts';

/** Backend sans GPU : retient la dernière scène dessinée pour que les tests l'inspectent. */
export interface FakeBackend extends DrawBackend {
  scene: Scene | undefined;
  camera: Camera | undefined;
  draws: number;
  disposed: boolean;
}

export function fakeBackend(): FakeBackend {
  const backend: FakeBackend = {
    scene: undefined,
    camera: undefined,
    draws: 0,
    disposed: false,
    render(scene, camera) {
      backend.scene = scene;
      backend.camera = camera;
      backend.draws++;
    },
    drawCalls: () => 0,
    setSize() {},
    dispose() {
      backend.disposed = true;
    },
  };
  return backend;
}
