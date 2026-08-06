// Aggregates food data. Add new regional files under ./regions and include them here.

import { COMMON_FOOD_TABLE } from './common.js';
import { BOLTRASK_FOOD_TABLE } from './regions/boltrask.js';
import { DICHTBEIR_FOOD_TABLE } from './regions/dichtbeir.js';
import { FLECHENRAND_FOOD_TABLE } from './regions/flechenrand.js';
import { HORSLIA_FOOD_TABLE } from './regions/horslia.js';
import { KALDVELG_FOOD_TABLE } from './regions/kaldvelg.js';
import { LEZHNIZEM_FOOD_TABLE } from './regions/lezhnizem.js';
import { NAERDER_FOOD_TABLE } from './regions/naerder.js';
import { NOVANDIA_FOOD_TABLE } from './regions/novandia.js';
import { ONTAKWA_FOOD_TABLE } from './regions/ontakwa.js';
import { ROYU_MIDEKI_FOOD_TABLE } from './regions/royu_mideki.js';
import { ROYU_SAGEKI_FOOD_TABLE } from './regions/royu_sageki.js';
import { SANGREN_FOOD_TABLE } from './regions/sangren.js';
import { SARROYO_FOOD_TABLE } from './regions/sarroyo.js';
import { SIROST_FOOD_TABLE } from './regions/sirost.js';
import { TIRABOR_FOOD_TABLE } from './regions/tirabor.js';
import { YAKNIZEM_FOOD_TABLE } from './regions/yaknizem.js';
import { SHARED_FOOD_TABLE } from './regions/shared.js';

export { COMMON_FOOD_TABLE };
export const REGIONAL_FOOD_TABLE = [
  ...BOLTRASK_FOOD_TABLE,
  ...DICHTBEIR_FOOD_TABLE,
  ...FLECHENRAND_FOOD_TABLE,
  ...HORSLIA_FOOD_TABLE,
  ...KALDVELG_FOOD_TABLE,
  ...LEZHNIZEM_FOOD_TABLE,
  ...NAERDER_FOOD_TABLE,
  ...NOVANDIA_FOOD_TABLE,
  ...ONTAKWA_FOOD_TABLE,
  ...ROYU_MIDEKI_FOOD_TABLE,
  ...ROYU_SAGEKI_FOOD_TABLE,
  ...SANGREN_FOOD_TABLE,
  ...SARROYO_FOOD_TABLE,
  ...SIROST_FOOD_TABLE,
  ...TIRABOR_FOOD_TABLE,
  ...YAKNIZEM_FOOD_TABLE,
  ...SHARED_FOOD_TABLE,

];
export const FOOD_TABLE = [...COMMON_FOOD_TABLE, ...REGIONAL_FOOD_TABLE];
