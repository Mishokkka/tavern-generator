// Aggregates drink data. Add new regional files under ./regions and include them here.

import { COMMON_DRINK_TABLE } from './common.js';
import { BOLTRASK_DRINK_TABLE } from './regions/boltrask.js';
import { DICHTBEIR_DRINK_TABLE } from './regions/dichtbeir.js';
import { FLECHENRAND_DRINK_TABLE } from './regions/flechenrand.js';
import { HORSLIA_DRINK_TABLE } from './regions/horslia.js';
import { KALDVELG_DRINK_TABLE } from './regions/kaldvelg.js';
import { LEZHNIZEM_DRINK_TABLE } from './regions/lezhnizem.js';
import { NAERDER_DRINK_TABLE } from './regions/naerder.js';
import { NOVANDIA_DRINK_TABLE } from './regions/novandia.js';
import { ONTAKWA_DRINK_TABLE } from './regions/ontakwa.js';
import { ROYU_MIDEKI_DRINK_TABLE } from './regions/royu_mideki.js';
import { ROYU_SAGEKI_DRINK_TABLE } from './regions/royu_sageki.js';
import { SANGREN_DRINK_TABLE } from './regions/sangren.js';
import { SARROYO_DRINK_TABLE } from './regions/sarroyo.js';
import { SIROST_DRINK_TABLE } from './regions/sirost.js';
import { TIRABOR_DRINK_TABLE } from './regions/tirabor.js';
import { YAKNIZEM_DRINK_TABLE } from './regions/yaknizem.js';
import { SHARED_DRINK_TABLE } from './regions/shared.js';

export { COMMON_DRINK_TABLE };
export const REGIONAL_DRINK_TABLE = [
  ...BOLTRASK_DRINK_TABLE,
  ...DICHTBEIR_DRINK_TABLE,
  ...FLECHENRAND_DRINK_TABLE,
  ...HORSLIA_DRINK_TABLE,
  ...KALDVELG_DRINK_TABLE,
  ...LEZHNIZEM_DRINK_TABLE,
  ...NAERDER_DRINK_TABLE,
  ...NOVANDIA_DRINK_TABLE,
  ...ONTAKWA_DRINK_TABLE,
  ...ROYU_MIDEKI_DRINK_TABLE,
  ...ROYU_SAGEKI_DRINK_TABLE,
  ...SANGREN_DRINK_TABLE,
  ...SARROYO_DRINK_TABLE,
  ...SIROST_DRINK_TABLE,
  ...TIRABOR_DRINK_TABLE,
  ...YAKNIZEM_DRINK_TABLE,
  ...SHARED_DRINK_TABLE,

];
export const DRINK_TABLE = [...COMMON_DRINK_TABLE, ...REGIONAL_DRINK_TABLE];
