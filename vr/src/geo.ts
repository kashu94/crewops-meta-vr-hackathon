// The network's stations, a simplified outline of India, and where both sit on the
// tabletop. A flat projection is enough at this scale: the table is about 60 cm across.

export const STATIONS: Record<string, { name: string; lat: number; lon: number }> = {
  BLR: { name: 'Bengaluru', lat: 13.2, lon: 77.71 },
  BOM: { name: 'Mumbai', lat: 19.09, lon: 72.87 },
  CCU: { name: 'Kolkata', lat: 22.65, lon: 88.45 },
  COK: { name: 'Kochi', lat: 10.15, lon: 76.4 },
  DEL: { name: 'Delhi', lat: 28.56, lon: 77.1 },
  GOI: { name: 'Goa', lat: 15.38, lon: 73.83 },
  HYD: { name: 'Hyderabad', lat: 17.24, lon: 78.43 },
  MAA: { name: 'Chennai', lat: 12.99, lon: 80.17 },
};

export const HUB = 'BLR';

/** India's outline as [lat, lon], simplified to a few dozen points: enough for the eye at
 * arm's length, not a survey. */
export const INDIA: [number, number][] = [
  [23.7, 68.2], [22.4, 68.95], [21.6, 69.6], [20.75, 70.9], [21.75, 72.25], [20.4, 72.82],
  [19.0, 72.8], [17.0, 73.3], [15.4, 73.8], [14.0, 74.45], [12.9, 74.82], [11.25, 75.75],
  [9.95, 76.25], [8.9, 76.55], [8.08, 77.55], [8.8, 78.15], [9.3, 79.05], [10.3, 79.85],
  [11.9, 79.82], [13.1, 80.3], [14.5, 80.15], [15.9, 81.1], [16.6, 82.3], [17.7, 83.3],
  [19.3, 84.9], [20.3, 86.65], [21.5, 87.05], [21.65, 88.2], [22.15, 88.95], [24.2, 88.7],
  [25.15, 88.55], [26.35, 88.35], [26.4, 89.85], [25.3, 89.9], [25.2, 92.0], [24.2, 91.95],
  [23.0, 91.45], [23.75, 92.2], [21.95, 92.6], [22.55, 93.25], [24.0, 93.95], [25.6, 94.7],
  [27.15, 96.15], [28.2, 97.35], [29.35, 96.1], [28.0, 93.9], [27.8, 91.9], [26.8, 91.9],
  [26.8, 89.8], [27.1, 88.85], [28.1, 88.8], [27.9, 88.1], [26.6, 88.05], [26.45, 86.0],
  [27.0, 84.0], [27.45, 83.3], [28.6, 81.05], [29.15, 80.2], [30.2, 81.0], [31.0, 79.0],
  [32.5, 79.3], [34.3, 78.85], [35.55, 77.85], [36.9, 76.3], [37.05, 74.6], [35.6, 74.4],
  [34.45, 73.55], [33.2, 73.9], [32.5, 75.0], [31.0, 74.6], [30.0, 73.4], [29.0, 72.0],
  [28.0, 70.6], [27.0, 70.0], [25.5, 70.3], [24.4, 71.0], [24.0, 68.8],
];

export const SEAS: { name: string; lat: number; lon: number }[] = [
  { name: 'ARABIAN SEA', lat: 15.5, lon: 66.8 },
  { name: 'BAY OF BENGAL', lat: 15.6, lon: 87.6 },
];

const CENTRE = { lat: 22.4, lon: 82.4 };
/** Metres of tabletop per degree. */
export const SCALE = 0.0185;

/** Table-local position of a station: x east, z south (towards the controller). */
export function project(code: string): [number, number] {
  const s = STATIONS[code];
  return s ? projectLatLon(s.lat, s.lon) : [0, 0];
}

export function projectLatLon(lat: number, lon: number): [number, number] {
  return [(lon - CENTRE.lon) * SCALE, -(lat - CENTRE.lat) * SCALE];
}

/** Every leg the network flies: the hub's spokes. */
export function networkLegs(): [string, string][] {
  return Object.keys(STATIONS)
    .filter((code) => code !== HUB)
    .map((code) => [HUB, code]);
}
