import { createComponent, Types } from '@iwsdk/core';

/** A crew card on the desk. `index` is its place in the desk's candidate list. */
export const CrewCard = createComponent(
  'CrewCard',
  {
    index: { type: Types.Int32, default: 0, label: 'Candidate index' },
  },
  'A crew member who could cover the open seat.',
);
