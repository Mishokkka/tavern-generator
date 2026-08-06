// Service entries. Cleanliness service prices are intentionally preserved as configured.

export const SERVICE_TABLE = [
  {
    "name": "Умывание горячей водой",
    "type": "service",
    "min": 4,
    "max": 6,
    "terrains": [
      "city",
      "town",
      "village",
      "road",
      "port",
      "mountain"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ],
    "weight": 9,
    "cleanliness": {
      "level": 1,
      "state": "Помытый",
      "label": "Помытый"
    },
    "desc": "Таз горячей воды, грубое полотенце и место для умывания."
  },
  {
    "name": "Бритье и умывание",
    "type": "service",
    "min": 5,
    "max": 8,
    "terrains": [
      "city",
      "town",
      "port",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 5,
    "cleanliness": {
      "level": 1,
      "state": "Помытый",
      "label": "Помытый"
    },
    "desc": "Бритье, умывание горячей водой и полотенце."
  },
  {
    "name": "Горячая ванна",
    "type": "service",
    "min": 7,
    "max": 12,
    "terrains": [
      "city",
      "town",
      "port",
      "mountain"
    ],
    "quality": [
      "good",
      "fine"
    ],
    "weight": 5,
    "cleanliness": {
      "level": 2,
      "state": "Хорошенько помытый",
      "label": "Хорошенько помытый"
    },
    "desc": "Корыто с горячей водой. Мыло не входит в стоимость."
  },
  {
    "name": "Парная баня",
    "type": "service",
    "min": 65,
    "max": 105,
    "terrains": [
      "city",
      "town",
      "village"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 3,
    "cleanliness": {
      "level": 3,
      "state": "Я в раю",
      "label": "Я в раю"
    },
    "desc": "Парная, горячая вода, мыло и место для отдыха после мытья."
  },
  {
    "name": "Ванна с мылом",
    "type": "service",
    "min": 70,
    "max": 115,
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "quality": [
      "good",
      "fine"
    ],
    "weight": 4,
    "cleanliness": {
      "level": 3,
      "state": "Я в раю",
      "label": "Я в раю"
    },
    "desc": "Горячая ванна, мыло, чистое полотенце и отдельное место для мытья."
  },
  {
    "name": "Стирка одежды",
    "type": "service",
    "min": 2,
    "max": 2,
    "terrains": [
      "city",
      "town",
      "village",
      "port",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 6,
    "desc": "Стирка и сушка одного комплекта одежды."
  },
  {
    "name": "Полная чистка дорожной одежды",
    "type": "service",
    "min": 6,
    "max": 12,
    "terrains": [
      "city",
      "town",
      "port",
      "mountain"
    ],
    "quality": [
      "good",
      "fine"
    ],
    "weight": 3,
    "desc": "Чистка верхней одежды от грязи и дорожной пыли."
  },
  {
    "name": "Чистая сменная рубаха",
    "type": "service",
    "min": 6,
    "max": 14,
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 4,
    "desc": "Простая чистая рубаха из запасов заведения."
  },
  {
    "name": "Уход за лошадью",
    "type": "service",
    "min": 4,
    "max": 10,
    "terrains": [
      "road",
      "village",
      "town",
      "city",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 6,
    "desc": "Корм, вода и чистка верхового животного."
  },
  {
    "name": "Корм для верхового животного",
    "type": "service",
    "min": 2,
    "max": 6,
    "terrains": [
      "road",
      "village",
      "town",
      "city",
      "wilderness",
      "mountain"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ],
    "weight": 8,
    "desc": "Порция сена, зерна или другого доступного корма."
  },
  {
    "name": "Место в стойле",
    "type": "service",
    "min": 3,
    "max": 8,
    "terrains": [
      "road",
      "village",
      "town",
      "city",
      "mountain"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ],
    "weight": 7,
    "desc": "Одно стойло для животного на ночь."
  },
  {
    "name": "Запертый чулан под вещи",
    "type": "service",
    "min": 5,
    "max": 12,
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 4,
    "desc": "Запираемое помещение для временного хранения вещей."
  },
  {
    "name": "Чистка оружия",
    "type": "service",
    "min": 4,
    "max": 10,
    "terrains": [
      "city",
      "town",
      "road",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ],
    "weight": 4,
    "desc": "Быстрая чистка одного оружия без ремонта."
  },
  {
    "name": "Смена постельного белья",
    "type": "service",
    "min": 3,
    "max": 8,
    "terrains": [
      "city",
      "town",
      "port",
      "mountain"
    ],
    "quality": [
      "good",
      "fine"
    ],
    "weight": 3,
    "desc": "Замена белья в снятой комнате."
  },
  {
    "name": "Путевой паек на день",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 6,
    "max": 14,
    "weight": 9,
    "desc": "Хлеб, сыр, солонина или рыба, завернутые в ткань.",
    "terrains": [
      "city",
      "town",
      "road",
      "village",
      "port",
      "mountain",
      "wilderness"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Сушка сапог у печи",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 4,
    "weight": 8,
    "desc": "Сапоги оставляют у печи до утра. Без обещаний, что они станут лучше.",
    "terrains": [
      "road",
      "village",
      "town",
      "mountain",
      "wilderness"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Мелкий ремонт обуви",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 4,
    "max": 10,
    "weight": 6,
    "desc": "Подбить гвозди, заменить шнурок, прошить разошедшийся край.",
    "terrains": [
      "city",
      "town",
      "road",
      "village",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Починка упряжи",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 5,
    "max": 12,
    "weight": 6,
    "desc": "Быстрый ремонт ремней, пряжек и постромок.",
    "terrains": [
      "road",
      "village",
      "town",
      "city",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Ночной сторож для повозки",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 8,
    "max": 18,
    "weight": 5,
    "desc": "Работник заведения присматривает за повозкой до рассвета.",
    "terrains": [
      "city",
      "town",
      "port",
      "road"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Укрытие повозки в сарае",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 4,
    "max": 10,
    "weight": 6,
    "desc": "Место под крышей для повозки или груза.",
    "terrains": [
      "road",
      "village",
      "town",
      "mountain"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Аренда фонаря на вечер",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 6,
    "weight": 6,
    "desc": "Масляный фонарь до полуночи. За потерю спросят отдельно.",
    "terrains": [
      "city",
      "town",
      "port",
      "road"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Теплая грелка в постель",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 5,
    "weight": 5,
    "desc": "Глиняная грелка с горячей водой для комнаты.",
    "terrains": [
      "city",
      "town",
      "road",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Корм для собаки",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 1,
    "max": 3,
    "weight": 7,
    "desc": "Миска объедков, костей и похлебки для пса.",
    "terrains": [
      "city",
      "town",
      "road",
      "village",
      "port",
      "mountain",
      "wilderness"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Записка с посыльным по городу",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 3,
    "max": 8,
    "weight": 5,
    "desc": "Местный мальчишка или слуга относит короткую записку.",
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Заверка дорожного письма",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 8,
    "max": 18,
    "weight": 3,
    "desc": "Хозяин ставит печать заведения и ручается, что видел путника.",
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "quality": [
      "good",
      "fine"
    ]
  },
  {
    "name": "Чистка доспеха от дорожной грязи",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 5,
    "max": 12,
    "weight": 4,
    "desc": "Доспех протирают, сушат ремни и снимают свежую грязь.",
    "terrains": [
      "city",
      "town",
      "road",
      "mountain"
    ],
    "quality": [
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Аренда носильщика на час",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 4,
    "max": 10,
    "weight": 5,
    "desc": "Работник помогает донести багаж, ящики или мешки.",
    "terrains": [
      "city",
      "town",
      "port"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ]
  },
  {
    "name": "Соль для сохранения припасов",
    "type": "service",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 6,
    "weight": 5,
    "desc": "Малый мешочек грубой соли для мяса или рыбы.",
    "terrains": [
      "city",
      "town",
      "port",
      "road",
      "village"
    ],
    "quality": [
      "poor",
      "modest",
      "good",
      "fine"
    ]
  }
];
