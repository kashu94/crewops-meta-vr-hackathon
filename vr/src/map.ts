import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  createSystem,
  CylinderGeometry,
  DoubleSide,
  effect,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  QuadraticBezierCurve3,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Entity,
} from '@iwsdk/core';
import type { Desk } from './desk.js';
import { networkLegs, project, STATIONS } from './geo.js';
import { COLOURS, SEVERITY } from './palette.js';
import { aircraftTexture, beamTexture, glowTexture, labelTexture, tableTexture } from './textures.js';
import type { SeatFlight } from './types.js';

// The holotable: India's network on a dark glass table. The trip that lost its crew
// member grows out of the hub leg by leg (the blast radius), its stations light up, an
// aircraft flies the trip and traffic pulses along the uncrewed legs. When legal cover is
// placed in the seat a shockwave crosses the table and the trip turns green.

export const MAP_CENTRE = new Vector3(0, 0, -0.07);
export const TABLE_RADIUS = 0.3;
const RADIUS = TABLE_RADIUS;
const TUBE_SEGMENTS = 64;
const TUBE_SIDES = 8;
const LEG_DELAY = 0.3;
const LEG_GROW = 0.6;
const PACKETS_PER_LEG = 3;
const AIRCRAFT_SPEED = 0.16;

type Leg = {
  core: Mesh;
  glow: Mesh;
  curve: QuadraticBezierCurve3;
  start: number;
  flight: SeatFlight;
  packets: Mesh[];
};

type Beacon = { group: Group; beam: Mesh[]; ripple: Mesh; halo: Sprite; phase: number };

const additive = (colour: string, opacity: number) =>
  new MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });

export class MapSystem extends createSystem({}) {
  private table = new Group();
  private trip = new Group();
  private pins = new Map<string, Mesh>();
  private legs: Leg[] = [];
  private beacons: Beacon[] = [];
  private aircraft!: Mesh;
  private shock!: Mesh;
  private shockT = 1;
  private rim!: Mesh;
  private clock = 0;
  private tripStarted = 0;
  private covered = false;
  private glow = glowTexture();
  private beam = beamTexture();
  private tmp = new Vector3();
  private ahead = new Vector3();

  init(): void {
    const desk = this.desk();
    const root = (this.globals as Record<string, unknown>).workspace as Entity;
    this.table.position.copy(MAP_CENTRE);
    this.world.createTransformEntity(this.table, { parent: root, persistent: true });
    this.buildTable();
    this.table.add(this.trip);

    this.cleanupFuncs.push(
      effect(() => {
        const detail = desk.detail.value;
        this.showTrip(detail?.seats[0]?.context?.flights ?? [], detail?.severity?.level ?? 'medium');
      }),
      effect(() => {
        const covered = desk.chosen.value !== null;
        if (covered && !this.covered) this.shockwave(COLOURS.ok);
        this.covered = covered;
        this.recolour();
      }),
      effect(() => {
        if (desk.sent.value > 0) this.shockwave(COLOURS.accent);
      }),
    );
  }

  update(delta: number): void {
    this.clock += delta;
    const since = this.clock - this.tripStarted;
    const perSegment = TUBE_SIDES * 6;

    for (const leg of this.legs) {
      const grown = Math.min(1, Math.max(0, (since - leg.start) / LEG_GROW));
      const count = Math.ceil(grown * TUBE_SEGMENTS) * perSegment;
      leg.core.geometry.setDrawRange(0, count);
      leg.glow.geometry.setDrawRange(0, count);
      const live = grown >= 1 && (!this.covered ? leg.flight.state !== 'crewed' : true);
      leg.packets.forEach((packet, i) => {
        packet.visible = live;
        if (!live) return;
        const speed = this.covered ? 0.18 : 0.42;
        leg.curve.getPoint((this.clock * speed + i / PACKETS_PER_LEG) % 1, packet.position);
      });
    }

    for (const b of this.beacons) {
      const t = (this.clock * 0.55 + b.phase) % 1;
      b.ripple.scale.setScalar(1 + t * 3.2);
      (b.ripple.material as MeshBasicMaterial).opacity = 0.7 * (1 - t);
      const flicker = 0.75 + Math.sin(this.clock * 4 + b.phase * 6) * 0.12;
      for (const m of b.beam) (m.material as MeshBasicMaterial).opacity = 0.55 * flicker;
    }

    this.flyAircraft(since);

    if (this.shockT < 1) {
      this.shockT = Math.min(1, this.shockT + delta / 1.1);
      const ease = 1 - (1 - this.shockT) ** 2;
      this.shock.visible = true;
      this.shock.scale.setScalar(0.05 + ease * 1.05);
      (this.shock.material as MeshBasicMaterial).opacity = 0.85 * (1 - this.shockT);
    } else {
      this.shock.visible = false;
    }
    (this.rim.material as MeshBasicMaterial).opacity = 0.55 + Math.sin(this.clock * 1.6) * 0.15;
  }

  private buildTable(): void {
    const base = new Mesh(
      new CylinderGeometry(RADIUS + 0.012, RADIUS + 0.02, 0.022, 96, 1, false),
      new MeshStandardMaterial({ color: '#0a1324', metalness: 0.85, roughness: 0.32 }),
    );
    base.position.y = -0.0125;
    this.table.add(base);

    this.rim = new Mesh(new TorusGeometry(RADIUS + 0.012, 0.0016, 8, 160), additive(COLOURS.accent, 0.6));
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = -0.0015;
    this.table.add(this.rim);
    const underglow = new Mesh(new TorusGeometry(RADIUS + 0.02, 0.0012, 8, 160), additive(COLOURS.accent, 0.35));
    underglow.rotation.x = Math.PI / 2;
    underglow.position.y = -0.0235;
    this.table.add(underglow);

    const surface = new Mesh(
      new CircleGeometry(RADIUS, 96),
      new MeshBasicMaterial({ map: tableTexture(RADIUS * 2), transparent: true, depthWrite: false }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.0005;
    this.table.add(surface);

    const spoke = new LineBasicMaterial({ color: COLOURS.accent, transparent: true, opacity: 0.18 });
    for (const [a, b] of networkLegs()) {
      const curve = arc(a, b, 0);
      this.table.add(new Line(new BufferGeometry().setFromPoints(curve.getPoints(40)), spoke));
    }

    const pinGeometry = new SphereGeometry(0.0042, 16, 12);
    for (const [code, station] of Object.entries(STATIONS)) {
      const [x, z] = project(code);
      const pin = new Mesh(pinGeometry, new MeshBasicMaterial({ color: '#7dd3fc' }));
      pin.position.set(x, 0.004, z);
      this.table.add(pin);
      this.pins.set(code, pin);
      const label = new Sprite(
        new SpriteMaterial({ map: labelTexture(code, station.name), transparent: true, depthWrite: false }),
      );
      label.scale.set(0.044, 0.022, 1);
      label.position.set(x, 0.026, z);
      label.renderOrder = 2;
      this.table.add(label);
    }

    this.aircraft = new Mesh(
      new PlaneGeometry(0.024, 0.024).rotateX(Math.PI / 2),
      new MeshBasicMaterial({ map: aircraftTexture(), transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.aircraft.visible = false;
    this.table.add(this.aircraft);

    this.shock = new Mesh(new RingGeometry(RADIUS * 0.96, RADIUS, 96), additive(COLOURS.ok, 0));
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.003;
    this.shock.visible = false;
    this.table.add(this.shock);
  }

  private showTrip(flights: SeatFlight[], level: string): void {
    this.trip.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial).dispose();
      }
    });
    this.trip.clear();
    this.legs = [];
    this.beacons = [];
    for (const pin of this.pins.values()) {
      (pin.material as MeshBasicMaterial).color.set('#7dd3fc');
      pin.scale.setScalar(1);
    }
    const colour = SEVERITY[level] ?? COLOURS.warn;
    const packetGeometry = new SphereGeometry(0.0032, 10, 8);

    flights.forEach((flight, i) => {
      // A leg and its return share a route: bow them apart so both show.
      const curve = arc(flight.from, flight.to, i % 2 === 0 ? 1 : -1);
      const tint = legColour(flight, colour);
      const core = new Mesh(
        new TubeGeometry(curve, TUBE_SEGMENTS, 0.0017, TUBE_SIDES, false),
        new MeshBasicMaterial({ color: tint }),
      );
      const glow = new Mesh(new TubeGeometry(curve, TUBE_SEGMENTS, 0.0055, TUBE_SIDES, false), additive(tint, 0.28));
      core.geometry.setDrawRange(0, 0);
      glow.geometry.setDrawRange(0, 0);
      const packets = Array.from({ length: PACKETS_PER_LEG }, () => {
        const p = new Mesh(packetGeometry, additive('#ffffff', 0.95));
        p.visible = false;
        this.trip.add(p);
        return p;
      });
      this.trip.add(core, glow);
      this.legs.push({ core, glow, curve, start: i * LEG_DELAY, flight, packets });
    });

    const stations = [...new Set(flights.flatMap((f) => [f.from, f.to]))];
    stations.forEach((code, i) => {
      const pin = this.pins.get(code);
      if (pin) {
        (pin.material as MeshBasicMaterial).color.set(colour);
        pin.scale.setScalar(1.5);
      }
      this.beacons.push(this.beacon(code, colour, i * 0.23));
    });
    this.tripStarted = this.clock;
    this.recolour();
  }

  private beacon(code: string, colour: string, phase: number): Beacon {
    const [x, z] = project(code);
    const group = new Group();
    group.position.set(x, 0, z);
    const beam = [0, Math.PI / 2].map((turn) => {
      const m = new Mesh(
        new PlaneGeometry(0.01, 0.075),
        new MeshBasicMaterial({
          map: this.beam,
          color: colour,
          transparent: true,
          opacity: 0.55,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      m.position.y = 0.0375;
      m.rotation.y = turn;
      group.add(m);
      return m;
    });
    const ripple = new Mesh(new RingGeometry(0.006, 0.0075, 48), additive(colour, 0.7));
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.0015;
    const halo = new Sprite(
      new SpriteMaterial({ map: this.glow, color: colour, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    halo.scale.setScalar(0.03);
    halo.position.y = 0.004;
    group.add(ripple, halo);
    this.trip.add(group);
    return { group, beam, ripple, halo, phase };
  }

  /** The aircraft flies the trip leg by leg, then starts again. */
  private flyAircraft(since: number): void {
    const legs = this.legs;
    const grownAll = legs.length > 0 && since > (legs.length - 1) * LEG_DELAY + LEG_GROW;
    this.aircraft.visible = grownAll;
    if (!grownAll) return;
    const total = legs.length;
    const run = (this.clock * AIRCRAFT_SPEED) % total;
    const leg = legs[Math.floor(run)];
    const t = run % 1;
    leg.curve.getPoint(t, this.tmp);
    leg.curve.getPoint(Math.min(1, t + 0.02), this.ahead);
    if (this.ahead.distanceToSquared(this.tmp) < 1e-10) leg.curve.getPoint(Math.max(0, t - 0.02), this.ahead);
    this.aircraft.position.copy(this.tmp);
    this.aircraft.position.y += 0.002;
    // aim the nose along the leg, in the table's frame
    this.ahead.sub(this.tmp).add(this.aircraft.position);
    this.table.localToWorld(this.ahead);
    this.aircraft.lookAt(this.ahead);
  }

  private recolour(): void {
    const level = this.desk().detail.peek()?.severity?.level ?? 'medium';
    const colour = SEVERITY[level] ?? COLOURS.warn;
    for (const leg of this.legs) {
      const tint = this.covered ? COLOURS.ok : legColour(leg.flight, colour);
      (leg.core.material as MeshBasicMaterial).color.set(tint);
      (leg.glow.material as MeshBasicMaterial).color.set(tint);
    }
    for (const b of this.beacons) {
      const tint = this.covered ? COLOURS.ok : colour;
      for (const m of b.beam) (m.material as MeshBasicMaterial).color.set(tint);
      (b.ripple.material as MeshBasicMaterial).color.set(tint);
      (b.halo.material as SpriteMaterial).color.set(tint);
    }
  }

  private shockwave(colour: string): void {
    (this.shock.material as MeshBasicMaterial).color.set(colour);
    this.shockT = 0;
  }

  private desk(): Desk {
    return (this.globals as Record<string, unknown>).desk as Desk;
  }
}

function legColour(flight: SeatFlight, uncrewed: string): string {
  if (flight.state === 'crewed') return COLOURS.crewed;
  if (flight.state === 'at_risk') return COLOURS.warn;
  return uncrewed;
}

/** A raised arc between two stations; `side` bows it left or right of the straight line. */
function arc(from: string, to: string, side: number): QuadraticBezierCurve3 {
  const [ax, az] = project(from);
  const [bx, bz] = project(to);
  const a = new Vector3(ax, 0.005, az);
  const b = new Vector3(bx, 0.005, bz);
  const length = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  if (side !== 0) mid.add(new Vector3(-(bz - az), 0, bx - ax).normalize().multiplyScalar(0.011 * side));
  mid.y = 0.018 + length * 0.42;
  return new QuadraticBezierCurve3(a, mid, b);
}
