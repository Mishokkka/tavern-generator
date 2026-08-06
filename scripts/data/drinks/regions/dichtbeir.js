// Regional drink entries for dichtbeir.

export const DICHTBEIR_DRINK_TABLE = [
  {
    "name": "Колодезная вода Разбития",
    "type": "drink",
    "regions": ["dichtbeir"],
    "local": true,
    "min": 1,
    "max": 3,
    "weight": 10,
    "desc": "Обычная вода, поданная с таким видом, будто механизмов никогда не существовало.",
    "terrains": ["city", "town", "village", "road"]
  },
  {
    "name": "Багровый травный отвар",
    "type": "drink",
    "regions": ["dichtbeir"],
    "local": true,
    "min": 2,
    "max": 6,
    "weight": 8,
    "desc": "Горький отвар на травах, который пьют перед бдением и после доноса.",
    "terrains": ["city", "town", "road", "mountain"]
  },
  {
    "name": "Соляной настой Дритриха",
    "type": "drink",
    "regions": ["dichtbeir"],
    "local": true,
    "min": 2,
    "max": 5,
    "weight": 6,
    "desc": "Соленоватый настой паломников, неприятный, как правильная проповедь.",
    "terrains": ["wilderness", "road", "mountain"]
  }
];
