import {
  AdditiveBlending,
  CylinderGeometry,
  createSystem,
  DistanceGrabbable,
  DoubleSide,
  effect,
  Grabbed,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MovementMode,
  PlaneGeometry,
  RayInteractable,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { CrewCard } from './crew-card.js';
import type { Candidate, Check, Desk } from './desk.js';
import { MAP_CENTRE, TABLE_RADIUS } from './map.js';
import { COLOURS } from './palette.js';
import { cue } from './sound.js';
import { beamTexture, captionTexture, cardTexture, glowTexture, type CardVerdict } from './textures.js';
import type { Legality } from './types.js';

// Crew cards stand in a curved tray at the front of the desk. Pinch one (hand ray,
// controller trigger, or the mouse outside the headset) and bring it over the holotable or
// the seat hologram: the engine checks that person against every rule for the trip. Let
// go there and legal cover flies up into the seat; anything else glides back to the tray.
// The whole table is the drop zone, so a hand never has to hit a small target.

const CARD = { w: 0.07, h: 0.098 };
const TRAY_Z = 0.3;
const TRAY_Y = 0.07;
const TRAY_GAP = 0.08;
const TRAY_TILT = -0.9;
const SEAT = new Vector3(MAP_CENTRE.x, 0.215, MAP_CENTRE.z + 0.04);
/** How close (in angle from the eye) a held card must be to count as over the seat. Generous,
 * and wider still once a card is over it, so a hand never has to hold it pixel-still. */
const OVER_SEAT = 0.13;
const STAY_OVER_SEAT = 0.18;
const GLIDE_SECONDS = 0.32;
const HOVER_SCALE = 1.12;

type Glide = { from: Vector3; to: Vector3; t: number; tilt: number; yaw: number };

export class CardSystem extends createSystem({
  cards: { required: [CrewCard] },
  held: { required: [CrewCard, Grabbed] },
  hovered: { required: [CrewCard, Hovered] },
}) {
  private entities: Entity[] = [];
  private socket = new Group();
  private ring!: Mesh;
  private dashes!: Mesh;
  private fill!: Mesh;
  private column!: Mesh;
  private burst!: Mesh;
  private burstT = 1;
  private halo!: Sprite;
  private caption!: Sprite;
  private captionText = '';
  private over = new Set<Entity>();
  private glides = new Map<Entity, Glide>();
  private seated: Entity | null = null;
  private stamped = new Map<Entity, string>();
  private eye = new Vector3();
  private toCard = new Vector3();
  private toSeat = new Vector3();
  private seatWorld = new Vector3();
  private local = new Vector3();
  private eyeLocal = new Vector3();
  private clock = 0;

  init(): void {
    const desk = this.desk();
    this.buildSocket();
    this.queries.held.subscribe('qualify', () => cue.pick());
    this.queries.held.subscribe('disqualify', (entity) => this.release(entity));
    this.cleanupFuncs.push(
      effect(() => this.lay(desk.candidates.value)),
      effect(() => this.paintSocket(desk.offering.value ? desk.check.value : null, desk.chosen.value)),
      effect(() => this.stamp(desk.verdicts.value)),
      effect(() => this.seatChosen(desk.chosen.value)),
      effect(() => {
        const check = desk.check.value;
        if (check?.state === 'done') (check.result.legal ? cue.legal : cue.illegal)();
        if (check?.state === 'checking') cue.checking();
      }),
      effect(() => {
        const seat = desk.detail.value?.seats[0];
        this.setCaption(seat ? `${seat.pairing_id}  ·  ${seat.role.toUpperCase()} SEAT` : '');
      }),
    );
  }

  update(delta: number): void {
    this.clock += delta;
    const desk = this.desk();
    // the tracked head in a headset session, the browser camera outside one
    const eye = this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.camera : this.player.head;
    eye.getWorldPosition(this.eye);
    this.socket.getWorldPosition(this.seatWorld);
    this.toSeat.subVectors(this.seatWorld, this.eye).normalize();

    for (const entity of this.queries.held.entities) {
      const object = entity.object3D!;
      object.getWorldPosition(this.toCard);
      this.toCard.sub(this.eye).normalize();
      const limit = this.over.has(entity) ? STAY_OVER_SEAT : OVER_SEAT;
      const over = this.toCard.angleTo(this.toSeat) < limit || this.overTable(entity);
      if (over && !this.over.has(entity)) {
        this.over.add(entity);
        const candidate = this.candidate(entity);
        if (candidate) void desk.hover(candidate);
      } else if (!over && this.over.has(entity)) {
        this.over.delete(entity);
        if (!desk.chosen.peek()) desk.check.value = null;
      }
    }

    const offering = this.over.size > 0;
    if (desk.offering.peek() !== offering) desk.offering.value = offering;

    for (const [entity, glide] of this.glides) {
      glide.t = Math.min(1, glide.t + delta / GLIDE_SECONDS);
      const ease = 1 - (1 - Math.max(0, glide.t)) ** 3; // t < 0: still waiting its turn
      const object = entity.object3D!;
      object.position.lerpVectors(glide.from, glide.to, ease);
      object.rotation.set(glide.tilt, glide.yaw, 0, 'YXZ');
      if (glide.t >= 1) this.glides.delete(entity);
    }

    // cards under a pointer lean up towards the user
    for (const entity of this.entities) {
      const object = entity.object3D!;
      const target = this.queries.hovered.entities.has(entity) || this.queries.held.entities.has(entity) ? HOVER_SCALE : 1;
      const s = object.scale.x + (target - object.scale.x) * Math.min(1, delta * 14);
      object.scale.setScalar(s);
    }

    const idle = !offering && !desk.chosen.peek();
    this.ring.scale.setScalar(idle ? 1 + Math.sin(this.clock * 3) * 0.05 : 1);
    this.dashes.rotation.z += delta * (idle ? 0.5 : 1.6);
    (this.column.material as MeshBasicMaterial).opacity = 0.18 + Math.sin(this.clock * 2.2) * 0.05;
    if (this.burstT < 1) {
      this.burstT = Math.min(1, this.burstT + delta / 0.7);
      this.burst.visible = true;
      this.burst.scale.setScalar(1 + this.burstT * 2.4);
      (this.burst.material as MeshBasicMaterial).opacity = 0.9 * (1 - this.burstT);
    } else {
      this.burst.visible = false;
    }
  }

  /** Over the holotable as the user sees it: the line from the eye through the card meets
   * the table's surface inside its rim. A held card floats between the eye and the table,
   * so this, not the card's own position, is what "over the table" means. */
  private overTable(entity: Entity): boolean {
    const root = ((this.globals as Record<string, unknown>).workspace as Entity).object3D!;
    const object = entity.object3D!;
    const eye = root.worldToLocal(this.eyeLocal.copy(this.eye));
    const card = root.worldToLocal(object.getWorldPosition(this.local));
    const index = entity.getValue(CrewCard, 'index') as number;
    const slot = this.traySlot(index, this.entities.length).position;
    if (card.distanceTo(slot) < 0.05) return false; // still in the tray
    const dy = card.y - eye.y;
    if (dy >= -1e-3) return false; // looking level or up: not at the table
    const t = (MAP_CENTRE.y + 0.01 - eye.y) / dy;
    const x = eye.x + (card.x - eye.x) * t - MAP_CENTRE.x;
    const z = eye.z + (card.z - eye.z) * t - MAP_CENTRE.z;
    return x * x + z * z < (TABLE_RADIUS * 0.95) ** 2;
  }

  private release(entity: Entity): void {
    const desk = this.desk();
    const candidate = this.candidate(entity);
    const wasOver = this.over.delete(entity);
    if (candidate && wasOver && desk.place(candidate)) {
      if (this.seated && this.seated !== entity) this.home(this.seated);
      this.seated = entity;
      this.glide(entity, SEAT.clone().add(new Vector3(0, 0, 0.004)), -0.3, 0);
      this.burstT = 0;
      cue.placed();
      return;
    }
    if (this.seated === entity) {
      this.seated = null;
      desk.clearChoice();
    }
    this.home(entity);
  }

  private lay(candidates: Candidate[]): void {
    for (const entity of this.entities) entity.dispose();
    this.entities = [];
    this.over.clear();
    this.glides.clear();
    this.stamped.clear();
    this.seated = null;
    const root = (this.globals as Record<string, unknown>).workspace as Entity;
    const airline = this.airline();
    const geometry = new PlaneGeometry(CARD.w, CARD.h);
    candidates.forEach((candidate, index) => {
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ map: cardTexture(candidate, airline), transparent: true }),
      );
      mesh.name = `card-${candidate.crew_id}`;
      const slot = this.traySlot(index, candidates.length);
      mesh.position.copy(slot.position);
      mesh.rotation.set(TRAY_TILT, slot.yaw, 0, 'YXZ');
      const entity = this.world.createTransformEntity(mesh, { parent: root, persistent: true });
      entity.addComponent(CrewCard, { index });
      entity.addComponent(RayInteractable);
      entity.addComponent(DistanceGrabbable, {
        movementMode: MovementMode.MoveFromTarget,
        rotate: false,
        scale: false,
        translate: true,
        returnToOrigin: false,
      });
      // deal the cards in, one after another
      mesh.position.y -= 0.04;
      this.glides.set(entity, {
        from: mesh.position.clone(),
        to: slot.position,
        t: -index * 0.25,
        tilt: TRAY_TILT,
        yaw: slot.yaw,
      });
      this.entities.push(entity);
    });
  }

  /** Cover chosen elsewhere (an approver reviewing a plan) flies into the seat by itself. */
  private seatChosen(chosen: Candidate | null): void {
    if (!chosen) return;
    const entity = this.entities.find((e) => this.candidate(e)?.crew_id === chosen.crew_id);
    if (!entity || this.seated === entity) return;
    if (this.seated) this.home(this.seated);
    this.seated = entity;
    const glide = this.glides.get(entity);
    const delay = glide && glide.t < 0 ? glide.t : 0;
    this.glides.set(entity, {
      from: entity.object3D!.position.clone(),
      to: SEAT.clone().add(new Vector3(0, 0, 0.004)),
      t: delay - 0.6,
      tilt: -0.3,
      yaw: 0,
    });
  }

  /** Repaint the face of every card the engine has given a verdict on. */
  private stamp(verdicts: Record<string, Legality>): void {
    const airline = this.airline();
    for (const entity of this.entities) {
      const candidate = this.candidate(entity);
      const result = candidate ? verdicts[candidate.crew_id] : undefined;
      if (!candidate || !result) continue;
      const key = `${result.crew_id}:${result.legal}`;
      if (this.stamped.get(entity) === key) continue;
      this.stamped.set(entity, key);
      const material = (entity.object3D as Mesh).material as MeshBasicMaterial;
      material.map?.dispose();
      material.map = cardTexture(candidate, airline, verdictOf(result));
      material.needsUpdate = true;
    }
  }

  private buildSocket(): void {
    const root = (this.globals as Record<string, unknown>).workspace as Entity;
    this.socket.position.copy(SEAT);
    this.world.createTransformEntity(this.socket, { parent: root, persistent: true });

    // a light column rising from the table to the seat
    const height = SEAT.y - 0.01;
    this.column = new Mesh(
      new CylinderGeometry(0.03, 0.05, height, 48, 1, true),
      new MeshBasicMaterial({
        map: beamTexture(),
        color: COLOURS.accent,
        transparent: true,
        opacity: 0.2,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.column.position.y = -height / 2 - 0.02;
    this.socket.add(this.column);

    const face = new Group();
    face.rotation.x = -0.3;
    this.socket.add(face);
    const mat = (opacity: number) =>
      new MeshBasicMaterial({
        color: COLOURS.accent,
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
    this.fill = new Mesh(new RingGeometry(0, 0.046, 64), mat(0.07));
    this.ring = new Mesh(new RingGeometry(0.046, 0.0505, 96), mat(0.95));
    this.dashes = new Mesh(new RingGeometry(0.057, 0.0595, 96, 1, 0, Math.PI * 1.55), mat(0.55));
    this.burst = new Mesh(new RingGeometry(0.05, 0.054, 96), mat(0));
    this.burst.visible = false;
    this.halo = new Sprite(
      new SpriteMaterial({ map: glowTexture(), color: COLOURS.accent, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.halo.scale.setScalar(0.17);
    face.add(this.halo, this.fill, this.ring, this.dashes, this.burst);

    this.caption = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }));
    this.caption.scale.set(0.18, 0.026, 1);
    this.caption.position.set(0, 0.082, 0);
    this.socket.add(this.caption);
  }

  private paintSocket(check: Check | null, chosen: Candidate | null): void {
    let colour: string = COLOURS.accent;
    if (chosen) colour = COLOURS.ok;
    else if (check?.state === 'checking') colour = '#ffffff';
    else if (check?.state === 'done') colour = check.result.legal ? COLOURS.ok : COLOURS.bad;
    else if (check?.state === 'failed') colour = COLOURS.warn;
    for (const m of [this.ring, this.dashes, this.fill, this.burst, this.column]) {
      (m.material as MeshBasicMaterial).color.set(colour);
    }
    (this.halo.material as SpriteMaterial).color.set(colour);
    (this.fill.material as MeshBasicMaterial).opacity = chosen || check?.state === 'done' ? 0.2 : 0.07;
  }

  private setCaption(text: string): void {
    if (text === this.captionText) return;
    this.captionText = text;
    const material = this.caption.material as SpriteMaterial;
    material.map?.dispose();
    material.map = text ? captionTexture(text) : null;
    material.needsUpdate = true;
    this.caption.visible = Boolean(text);
  }

  private home(entity: Entity): void {
    const index = entity.getValue(CrewCard, 'index') as number;
    const slot = this.traySlot(index, this.entities.length);
    this.glide(entity, slot.position, TRAY_TILT, slot.yaw);
  }

  private glide(entity: Entity, to: Vector3, tilt: number, yaw: number): void {
    this.glides.set(entity, { from: entity.object3D!.position.clone(), to, t: 0, tilt, yaw });
  }

  /** Cards stand on a gentle curve around the controller, each turned to face them. */
  private traySlot(index: number, count: number): { position: Vector3; yaw: number } {
    const x = (index - (count - 1) / 2) * TRAY_GAP;
    const yaw = -x * 1.6;
    return { position: new Vector3(x, TRAY_Y, TRAY_Z - x * x * 0.9), yaw };
  }

  private candidate(entity: Entity): Candidate | undefined {
    const index = entity.getValue(CrewCard, 'index') as number;
    return this.desk().candidates.peek()[index];
  }

  private airline(): string | undefined {
    return this.desk().detail.peek()?.airlines?.[0]?.code;
  }

  private desk(): Desk {
    return (this.globals as Record<string, unknown>).desk as Desk;
  }
}

function verdictOf(result: Legality): CardVerdict {
  if (result.legal) {
    const rules = new Set(result.verdicts.map((v) => v.rule_id)).size;
    return { legal: true, note: `Passes all ${rules} rules` };
  }
  const first = result.blocking[0];
  return { legal: false, note: first ? `${first.rule_id}: ${first.detail}` : 'A rule fails' };
}
