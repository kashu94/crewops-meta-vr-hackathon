import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { Backend } from './backend.js';
import { CardSystem } from './cards.js';
import { Desk } from './desk.js';
import { MapSystem } from './map.js';
import { PanelSystem } from './panels.js';
import { StatsEndSystem, StatsStartSystem, statsEnabled } from './stats.js';
import { TimelineSystem } from './timeline.js';
import { createWorkspaceRoot, WorkspaceSystem } from './workspace.js';

// CrewOps VR: a crew controller's desk in passthrough. The world and its XR features come
// from iwsdk.config.json; everything on the desk is built by the systems below.

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(
  (world) => {
    const desk = new Desk(Backend.fromLocation());
    const globals = world.globals as Record<string, unknown>;
    globals.desk = desk;
    globals.workspace = createWorkspaceRoot(world);

    world
      .registerSystem(WorkspaceSystem)
      .registerSystem(MapSystem)
      .registerSystem(CardSystem)
      .registerSystem(TimelineSystem)
      .registerSystem(PanelSystem);
    if (statsEnabled()) {
      world.registerSystem(StatsStartSystem, { priority: -100 }).registerSystem(StatsEndSystem, { priority: 1000 });
      // for profiling and test scripts
      Object.assign(window as unknown as Record<string, unknown>, { crewopsWorld: world, crewopsDesk: desk });
    }

    void desk.start();
  },
);
