import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../../overlays/worldOverlay.js';

/**
 * @module cyclones/labels
 * @description Storm cards and lead-hour labels on the shared world-overlay
 * host. The renderer supplies the anchors its points are drawn and
 * horizon-culled at, plus the selection; the host owns projection, the same
 * ellipsoid horizon test, collisions, fades and paint.
 */

export const CYCLONE_OVERLAY_SOURCE_ID = 'weather-cyclones';
/** Lead-hour labels show within 4,000 km of the camera. */
export const CYCLONE_LEAD_LABEL_MAX_DISTANCE_M = 4_000_000;
/** Ambient ceiling: every storm plus the selected storm's forecast points. */
export const CYCLONE_OVERLAY_COHORT_LIMIT = 64;
/** Advisory centre and forecast track; single source for points and cards. */
export const CYCLONE_ACCENT = '#7fe6ed';
/** Selected advisory centre. */
export const CYCLONE_SELECTED_ACCENT = '#ffe19a';
/** Point sizes the cards keep clear of. */
export const CYCLONE_MARKER_PX = Object.freeze({
  storm: 9,
  selected: 12,
  forecast: 5,
});

const STORM_PRIORITY = 1000;
const LEAD_PRIORITY = 500;

/** Same names the advisory list uses. Unknown codes stay unchanged. */
const CYCLONE_CLASSIFICATION_NAMES = Object.freeze({
  PTC: '潜在热带气旋',
  HU: '飓风',
  TS: '热带风暴',
  TD: '热带低压',
  SS: '亚热带风暴',
  SD: '亚热带低压',
  STS: '强热带风暴',
  TY: '台风',
  STY: '强台风',
  SuperTY: '超强台风',
  TC: '热带气旋',
});

/** Display name for an advisory classification code. */
export function cycloneClassificationName(code) {
  return Object.hasOwn(CYCLONE_CLASSIFICATION_NAMES, code)
    ? CYCLONE_CLASSIFICATION_NAMES[code]
    : code;
}

const CYCLONE_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** Fire-card anchor clearance: the gap and leader start follow the marker. */
function markerClearance(markerPx) {
  const gapPx = Math.max(12, markerPx + 8);
  return {
    gapPx,
    leaderOffsetPx: Math.max(2, gapPx - 6),
    verticalOnly: true,
    viewportMargin: 4,
  };
}

const SHARED_CARD = Object.freeze({
  cardStyle: 'tactical',
  collisionGroup: 'ambient-card',
  edgeFade: 'keyhole',
  horizonCull: true,
  terrainOcclusion: false,
  // A click on a card selects its storm.
  interactive: true,
});

/**
 * One card per storm: name, then the classification in Chinese.
 * @param {{id:string,name:string,classification?:string,windKt?:?number,position:object}} storm
 * @param {boolean} selected
 * @returns {object}
 */
export function cycloneStormEntry(storm, selected) {
  return {
    ...SHARED_CARD,
    ...markerClearance(
      selected ? CYCLONE_MARKER_PX.selected : CYCLONE_MARKER_PX.storm,
    ),
    id: `storm:${storm.id}`,
    position: storm.position,
    variant: selected ? 'selected' : 'card',
    title: storm.name,
    details: storm.classification
      ? [cycloneClassificationName(storm.classification)]
      : [],
    accent: selected ? CYCLONE_SELECTED_ACCENT : CYCLONE_ACCENT,
    selected,
    protected: selected,
    priority: selected
      ? Number.MAX_SAFE_INTEGER
      : STORM_PRIORITY + (Number(storm.windKt) || 0),
    maxDistance: Number.POSITIVE_INFINITY,
  };
}

/**
 * Lead-hour label at one forecast point of the selected storm. Earlier lead
 * times win collisions.
 * @param {string} stormId
 * @param {{tauHours:number,position:object}} point
 * @returns {object}
 */
export function cycloneLeadEntry(stormId, point) {
  return {
    ...SHARED_CARD,
    ...markerClearance(CYCLONE_MARKER_PX.forecast),
    id: `lead:${stormId}:${point.tauHours}`,
    position: point.position,
    variant: 'card',
    title: `${point.tauHours} h`,
    details: [],
    accent: CYCLONE_ACCENT,
    selected: false,
    protected: false,
    priority: LEAD_PRIORITY - point.tauHours,
    maxDistance: CYCLONE_LEAD_LABEL_MAX_DISTANCE_M,
    // Hard cutoff at the limit, without a fade.
    distanceFadeStartRatio: 1,
  };
}

/**
 * Storm cards for every storm and lead-hour labels for the selected one.
 * @param {Array<object>} storms Renderer anchors with `forecasts`.
 * @param {?string} selectedId
 * @returns {Array<object>}
 */
export function cycloneOverlayEntries(storms, selectedId) {
  const entries = [];
  for (const storm of storms) {
    const selected = storm.id === selectedId;
    entries.push(cycloneStormEntry(storm, selected));
    if (!selected) continue;
    for (const point of storm.forecasts || [])
      entries.push(cycloneLeadEntry(storm.id, point));
  }
  return entries;
}

/** Storm id behind a published card or lead-hour label id, else null. */
export function cycloneStormIdFromEntryId(entryId) {
  const match = /^(?:storm|lead):([^:]+)(?::|$)/.exec(String(entryId ?? ''));
  return match ? match[1] : null;
}

/**
 * Publish the renderer's committed anchors and selection to the overlay host.
 * @param {{host?:{setEntries:Function,setVisible:Function,clearSource:Function}}} [options]
 */
export function createCycloneLabels({ host = CYCLONE_OVERLAY_HOST } = {}) {
  let storms = [];
  let selectedId = null;
  let published = false;
  function publish() {
    const entries = cycloneOverlayEntries(storms, selectedId);
    let ambient = 0;
    for (const entry of entries) if (!entry.protected) ambient++;
    host.setVisible(CYCLONE_OVERLAY_SOURCE_ID, true);
    host.setEntries(CYCLONE_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: CYCLONE_OVERLAY_COHORT_LIMIT,
      collisionCapacity: Math.min(CYCLONE_OVERLAY_COHORT_LIMIT, ambient),
      moving: false,
    });
    published = true;
  }
  return {
    /** Replace every anchor after a snapshot commits. */
    setSnapshot(nextStorms, nextSelectedId = selectedId) {
      storms = nextStorms;
      selectedId = nextSelectedId;
      publish();
    },
    /** Republish only when the selection changes a published snapshot. */
    setSelection(id) {
      if (id === selectedId) return;
      selectedId = id;
      if (published) publish();
    },
    clear() {
      storms = [];
      selectedId = null;
      if (!published) return;
      published = false;
      host.clearSource(CYCLONE_OVERLAY_SOURCE_ID);
      host.setVisible(CYCLONE_OVERLAY_SOURCE_ID, false);
    },
  };
}
