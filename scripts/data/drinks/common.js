// Common drink entries shared by all regions.

export const COMMON_DRINK_TABLE = [
  {
    "name": "Малое пиво",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 3,
    "weight": 14,
    "desc": "Слабое пиво для повседневного питья."
  },
  {
    "name": "Темное пиво",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 3,
    "max": 7,
    "weight": 10,
    "desc": "Плотное темное пиво местной варки."
  },
  {
    "name": "Дешевое красное вино",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road",
      "port"
    ],
    "min": 3,
    "max": 8,
    "weight": 9,
    "desc": "Простое красное вино из ближайших поставок."
  },
  {
    "name": "Яблочный сидр",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road"
    ],
    "min": 2,
    "max": 6,
    "weight": 8,
    "desc": "Слабоалкогольный напиток из перебродившего яблочного сока."
  },
  {
    "name": "Горячий травяной настой",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "wilderness",
      "road",
      "village",
      "mountain"
    ],
    "min": 1,
    "max": 4,
    "weight": 8,
    "desc": "Кипяток с сушеными травами."
  },
  {
    "name": "Крепкий зерновой спирт",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road",
      "village"
    ],
    "min": 5,
    "max": 12,
    "weight": 5,
    "desc": "Крепкий спиртной напиток из зерна."
  },
  {
    "name": "Кувшин кислого молока",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "village",
      "road",
      "mountain"
    ],
    "min": 1,
    "max": 4,
    "weight": 7,
    "desc": "Кисломолочный напиток из ближайшего хозяйства.",
    "seasonal": { "seasons": ["Зарость"], "inSeason": 0.85, "outOfSeason": 1.2 }
  },
  {
    "name": "Горячая вода с медом",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road",
      "village"
    ],
    "min": 2,
    "max": 5,
    "weight": 7,
    "desc": "Горячая вода с небольшой порцией меда."
  },
  {
    "name": "Ягодный морс",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road",
      "wilderness"
    ],
    "min": 2,
    "max": 5,
    "weight": 7,
    "desc": "Напиток из кислых ягод и воды.",
    "seasonal": { "seasons": ["Зарость"], "inSeason": 0.75, "outOfSeason": 1.35 }
  },
  {
    "name": "Слабая медовуха",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road"
    ],
    "min": 3,
    "max": 8,
    "weight": 6,
    "desc": "Слабоалкогольный медовый напиток."
  },
  {
    "name": "Крепкая медовуха",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 5,
    "max": 12,
    "weight": 5,
    "desc": "Крепкий медовый напиток."
  },
  {
    "name": "Дешевое белое вино",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "min": 3,
    "max": 8,
    "weight": 7,
    "desc": "Простое белое вино из ближайших поставок."
  },
  {
    "name": "Разбавленное вино",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road",
      "port"
    ],
    "min": 2,
    "max": 5,
    "weight": 8,
    "desc": "Вино, разбавленное водой."
  },
  {
    "name": "Кислый квас",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road"
    ],
    "min": 1,
    "max": 4,
    "weight": 8,
    "desc": "Кислый хлебный напиток слабого брожения."
  },
  {
    "name": "Горячий чай",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "min": 3,
    "max": 8,
    "weight": 5,
    "desc": "Горячий настой чайного листа."
  },
  {
    "name": "Черный кофе",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "port"
    ],
    "min": 5,
    "max": 12,
    "weight": 4,
    "desc": "Крепкий кофе без молока."
  },
  {
    "name": "Пряная настойка",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 5,
    "max": 13,
    "weight": 5,
    "desc": "Крепкий напиток на сухих пряностях."
  },
  {
    "name": "Сливовая брага",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road"
    ],
    "min": 3,
    "max": 8,
    "weight": 6,
    "desc": "Слабоочищенный фруктовый напиток брожения."
  },
  {
    "name": "Соленый молочный напиток",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "village",
      "mountain",
      "wilderness"
    ],
    "min": 2,
    "max": 5,
    "weight": 6,
    "desc": "Молочный напиток с солью."
  },
  {
    "name": "Портовая ромовая порция",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "port"
    ],
    "min": 5,
    "max": 14,
    "weight": 5,
    "desc": "Небольшая порция крепкого тростникового спирта."
  },
  {
    "name": "Горячее вино с пряностями",
    "type": "drink",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "mountain"
    ],
    "min": 6,
    "max": 15,
    "weight": 5,
    "desc": "Подогретое вино с пряностями."
  },
  {
    "name": "Горячий ячменный отвар",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 4,
    "weight": 8,
    "desc": "Горячий мутный отвар из ячменя и соли.",
    "terrains": [
      "road",
      "village",
      "town",
      "mountain"
    ]
  },
  {
    "name": "Отвар шиповника",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 5,
    "weight": 7,
    "desc": "Кислый горячий отвар из сушеного шиповника.",
    "terrains": [
      "town",
      "village",
      "road",
      "wilderness"
    ]
  },
  {
    "name": "Молочная сыворотка",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 3,
    "weight": 7,
    "desc": "Кислая сыворотка из сырной кухни.",
    "terrains": [
      "village",
      "road",
      "mountain"
    ]
  },
  {
    "name": "Соленый бульон в кружке",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 4,
    "weight": 6,
    "desc": "Горячий соленый бульон для промерзших путников.",
    "terrains": [
      "road",
      "mountain",
      "wilderness",
      "port"
    ]
  },
  {
    "name": "Рябиновый кислый настой",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 6,
    "weight": 6,
    "desc": "Холодный настой из рябины и воды.",
    "terrains": [
      "town",
      "village",
      "road",
      "wilderness"
    ]
  },
  {
    "name": "Простая брага",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 6,
    "weight": 7,
    "desc": "Дешевый мутный напиток домашнего брожения.",
    "terrains": [
      "village",
      "road",
      "wilderness"
    ]
  },
  {
    "name": "Крепкая рябиновая настойка",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 5,
    "max": 12,
    "weight": 5,
    "desc": "Жгучая настойка на рябине.",
    "terrains": [
      "town",
      "village",
      "road",
      "mountain"
    ]
  },
  {
    "name": "Вода с уксусом и медом",
    "type": "drink",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 4,
    "weight": 7,
    "desc": "Вода, подкисленная уксусом и подслащенная медом.",
    "terrains": [
      "city",
      "town",
      "road",
      "port"
    ]
  }
];
