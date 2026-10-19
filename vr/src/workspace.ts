import { createSystem, Group, Vector3, VisibilityState, type Entity } from '@iwsdk/core';

// Everything on the desk hangs off one root: the map, the cards and both panels. Outside
// the headset it sits where the browser camera looks. When a headset session starts (and
// on "Recenter") it moves in front of the seated user, just below eye level, facing them.

const FORWARD = 0.52;
const BELOW_EYES = 0.42;
const BROWSER_SPOT = new Vector3(0, 0.78, -0.42);

export function createWorkspaceRoot(world: {
  createTransformEntity: (o: Group, opts: { persistent: boolean }) => Entity;
}): Entity {
  const root = world.createTransformEntity(new Group(), { persistent: true });
  root.object3D!.name = 'workspace';
  root.object3D!.position.copy(BROWSER_SPOT);
  return root;
}

export class WorkspaceSystem extends createSystem({}) {
  private pending = false;
  /** 0 to 1: the desk scales and rises into place when it appears. */
  private intro = 0;
  private head = new Vector3();
  private ahead = new Vector3();

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const root = this.root();
        if (state === VisibilityState.NonImmersive) {
          root.position.copy(BROWSER_SPOT);
          root.rotation.set(0, 0, 0);
        } else {
          this.pending = true;
        }
      }),
    );
    (this.globals as Record<string, unknown>).recenter = () => {
      if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.pending = true;
    };
  }

  update(delta: number): void {
    if (this.intro < 1) {
      this.intro = Math.min(1, this.intro + delta / 0.9);
      const ease = 1 - (1 - this.intro) ** 3;
      this.root().scale.setScalar(0.82 + 0.18 * ease);
    }
    if (!this.pending) return;
    this.player.head.getWorldPosition(this.head);
    if (this.head.y < 0.3) return; // no head pose yet
    this.player.head.getWorldDirection(this.ahead);
    // getWorldDirection gives the head's +Z; the user looks down -Z.
    this.ahead.set(-this.ahead.x, 0, -this.ahead.z);
    if (this.ahead.lengthSq() < 1e-4) return;
    this.ahead.normalize();
    const root = this.root();
    root.position.set(
      this.head.x + this.ahead.x * FORWARD,
      this.head.y - BELOW_EYES,
      this.head.z + this.ahead.z * FORWARD,
    );
    root.rotation.set(0, Math.atan2(-this.ahead.x, -this.ahead.z), 0);
    this.pending = false;
    this.intro = 0;
  }

  private root() {
    return ((this.globals as Record<string, unknown>).workspace as Entity).object3D!;
  }
}
