import { AssetType, defineAssets } from '@iwsdk/core';

// Evaluated by the app and by the IWSDK editor: keep it free of side effects.

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'desk-panel': {
    url: publicAssetUrl('ui/desk.uikitml'),
    type: AssetType.UIKitML,
    name: 'Desk panel',
  },
  'seat-panel': {
    url: publicAssetUrl('ui/seat.uikitml'),
    type: AssetType.UIKitML,
    name: 'Seat panel',
  },
  'agent-panel': {
    url: publicAssetUrl('ui/agent.uikitml'),
    type: AssetType.UIKitML,
    name: 'Agent panel',
  },
  'drill-panel': {
    url: publicAssetUrl('ui/drill.uikitml'),
    type: AssetType.UIKitML,
    name: 'Drill panel',
  },
});
