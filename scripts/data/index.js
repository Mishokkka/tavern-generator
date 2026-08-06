// Public tavern data aggregation layer.
// Service code should import from this file rather than from individual data packs.

export { TAVERN_OPTIONS, QUALITY_MODIFIERS, SIZE_MODIFIERS, TERRAIN_MODIFIERS } from './options.js';
export { NAME_TABLE } from './names/index.js';
export { COMMON_FOOD_TABLE, REGIONAL_FOOD_TABLE, FOOD_TABLE } from './food/index.js';
export { COMMON_DRINK_TABLE, REGIONAL_DRINK_TABLE, DRINK_TABLE } from './drinks/index.js';
export { ROOM_TABLE } from './lodging.js';
export { SERVICE_TABLE } from './services.js';
export { TAVERN_MOOD_TABLE, TAVERN_RUMOR_TABLE, TAVERN_REGULAR_TABLE, TAVERN_INCIDENT_TABLE } from './atmosphere.js';

import { FOOD_TABLE } from './food/index.js';
import { DRINK_TABLE } from './drinks/index.js';

export const MENU_TABLE = [...FOOD_TABLE, ...DRINK_TABLE];
