// Common food entries shared by all regions.

export const COMMON_FOOD_TABLE = [
{
    "name": "Ржаная похлебка с луком",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "village",
      "road",
      "town",
      "wilderness"
    ],
    "min": 1,
    "max": 3,
    "weight": 13,
    "desc": "Густая похлебка из ржаной крупы, лука и соли."
  },
{
    "name": "Каша с салом",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 5,
    "weight": 12,
    "desc": "Горячая крупяная каша с растопленным салом."
  },
{
    "name": "Черный хлеб, сыр и соленья",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 5,
    "weight": 12,
    "desc": "Холодная тарелка из хлеба, местного сыра и соленых овощей."
  },
{
    "name": "Пирог с потрохами",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 4,
    "max": 9,
    "weight": 8,
    "desc": "Закрытый пирог с рублеными потрохами и луком."
  },
{
    "name": "Овощное рагу",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 3,
    "max": 7,
    "weight": 10,
    "desc": "Тушеные коренья, капуста и крупа в общем котле.",
    "seasonal": { "seasons": ["Зарость"], "inSeason": 0.85, "outOfSeason": 1.25 }
  },
{
    "name": "Гороховая похлебка",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "village",
      "town",
      "wilderness"
    ],
    "min": 2,
    "max": 6,
    "weight": 10,
    "desc": "Плотная похлебка из дробленого гороха с луком."
  },
{
    "name": "Жареная мелкая рыба",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "port",
      "city",
      "town",
      "village"
    ],
    "min": 4,
    "max": 10,
    "weight": 7,
    "desc": "Небольшая рыба, обжаренная в жире и посыпанная солью.",
    "seasonal": { "seasons": ["Зарость"], "inSeason": 0.9, "outOfSeason": 1.2 }
  },
{
    "name": "Соленая рыба с хлебом",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "port",
      "road",
      "wilderness"
    ],
    "min": 3,
    "max": 8,
    "weight": 7,
    "desc": "Соленая рыба, черный хлеб и лук."
  },
{
    "name": "Тушеная козлятина",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village",
      "mountain"
    ],
    "min": 8,
    "max": 17,
    "weight": 5,
    "desc": "Козлятина, долго тушенная с чесноком и кореньями."
  },
{
    "name": "Похлебка из чечевицы",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "port",
      "road"
    ],
    "min": 4,
    "max": 9,
    "weight": 8,
    "desc": "Чечевица, лук, масло и местные травы."
  },
{
    "name": "Холодная мясная доска",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 10,
    "max": 24,
    "weight": 5,
    "desc": "Нарезка из копченостей, сыра и хлеба."
  },
{
    "name": "Курица с кореньями",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village"
    ],
    "min": 10,
    "max": 22,
    "weight": 5,
    "desc": "Курица, тушенная с морковью, репой и луком."
  },
{
    "name": "Ячменная лепешка с сыром",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "village",
      "town"
    ],
    "min": 2,
    "max": 6,
    "weight": 8,
    "desc": "Плоская лепешка из ячменной муки с мягким сыром."
  },
{
    "name": "Похлебка с сушеным мясом",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "wilderness",
      "mountain"
    ],
    "min": 5,
    "max": 12,
    "weight": 7,
    "desc": "Горячая похлебка из крупы и сушеного мяса."
  },
{
    "name": "Пшеничная похлебка с яйцом",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village"
    ],
    "min": 3,
    "max": 7,
    "weight": 8,
    "desc": "Пшеничная крупа, яйцо, лук и соль.",
    "seasonal": { "seasons": ["Зарость"], "inSeason": 0.9, "outOfSeason": 1.15 }
  },
{
  "name": "Репа, тушенная в жире",
  "type": "food",
  "regions": [
    "common"
  ],
  "terrains": [
    "village",
    "road",
    "town",
    "wilderness"
  ],
  "min": 1,
  "max": 6,
  "weight": 10,
  "desc": "Репа и лук, долго тушенные в масле или животном жире с солью."
},
{
    "name": "Свиные ребра с капустой",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 9,
    "max": 20,
    "weight": 5,
    "desc": "Свиные ребра, капуста и пряная соль."
  },
{
    "name": "Кровяная колбаса с кашей",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road"
    ],
    "min": 5,
    "max": 12,
    "weight": 7,
    "desc": "Кровяная колбаса, крупяная каша и лук."
  },
{
    "name": "Похлебка из сушеных грибов",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "village",
      "road",
      "wilderness",
      "mountain"
    ],
    "min": 3,
    "max": 8,
    "weight": 8,
    "desc": "Грибы, крупа, лук и горячий бульон."
  },
{
    "name": "Жареная печень с луком",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 6,
    "max": 14,
    "weight": 6,
    "desc": "Печень, обжаренная с луком и солью."
  },
{
    "name": "Оладьи из крупы",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village",
      "road"
    ],
    "min": 2,
    "max": 6,
    "weight": 8,
    "desc": "Небольшие жареные оладьи из каши и муки."
  },
{
  "name": "Суп из костного бульона",
  "type": "food",
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
  "max": 6,
  "weight": 9,
  "desc": "Дешевый горячий суп из костного бульона, крупы и кореньев."
},
{
    "name": "Тушеная капуста с копченостями",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village",
      "road"
    ],
    "min": 5,
    "max": 12,
    "weight": 7,
    "desc": "Капуста, копченое мясо и лук."
  },
{
    "name": "Запеченная луковица с хлебом",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "village",
      "wilderness"
    ],
    "min": 1,
    "max": 3,
    "weight": 9,
    "desc": "Печеный лук, хлеб и соль."
  },
{
    "name": "Мясной пирожок",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road",
      "port"
    ],
    "min": 4,
    "max": 9,
    "weight": 8,
    "desc": "Небольшой пирожок с рубленым мясом и луком."
  },
{
    "name": "Пирог с рыбой",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "port",
      "city",
      "town",
      "road"
    ],
    "min": 5,
    "max": 12,
    "weight": 7,
    "desc": "Закрытый пирог с рыбой и крупой."
  },
{
    "name": "Сухари с сыром",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "wilderness",
      "mountain"
    ],
    "min": 2,
    "max": 5,
    "weight": 8,
    "desc": "Сухой хлеб, твердый сыр и немного соли."
  },
{
    "name": "Куриный бульон с лапшой",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town"
    ],
    "min": 6,
    "max": 14,
    "weight": 6,
    "desc": "Куриный бульон, лапша и зелень."
  },
{
    "name": "Пшеничная лапша с жиром",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 4,
    "max": 10,
    "weight": 7,
    "desc": "Лапша с горячим жиром и луком."
  },
{
    "name": "Козий сыр с медом",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village",
      "mountain"
    ],
    "min": 6,
    "max": 14,
    "weight": 5,
    "desc": "Козий сыр, хлеб и небольшая порция меда."
  },
{
    "name": "Пшенная каша с тыквой",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "village",
      "town",
      "road"
    ],
    "min": 3,
    "max": 7,
    "weight": 8,
    "desc": "Пшено, тыква, соль и масло."
  },
{
    "name": "Соленая свинина с горохом",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "town",
      "port"
    ],
    "min": 6,
    "max": 13,
    "weight": 7,
    "desc": "Соленая свинина и разваренный горох."
  },
{
  "name": "Печеная картошка с маслом",
  "type": "food",
  "regions": [
    "common"
  ],
  "terrains": [
    "city",
    "town",
    "village",
    "road",
    "wilderness"
  ],
  "min": 2,
  "max": 6,
  "weight": 9,
  "desc": "Картофель, печенный в золе, с крупной солью, маслом или жиром."
},
{
    "name": "Рыбная похлебка",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "port",
      "city",
      "town",
      "village"
    ],
    "min": 4,
    "max": 10,
    "weight": 8,
    "desc": "Рыба, лук, крупа и горячий бульон."
  },
{
    "name": "Сладкая каша с сухофруктами",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town"
    ],
    "min": 5,
    "max": 12,
    "weight": 5,
    "desc": "Каша с сушеными фруктами и медом."
  },
{
    "name": "Жареные коренья с мясной подливой",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "road"
    ],
    "min": 5,
    "max": 11,
    "weight": 7,
    "desc": "Морковь, репа и лук под мясной подливой."
  },
{
    "name": "Похлебка из фасоли и сала",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "town",
      "village",
      "road"
    ],
    "min": 4,
    "max": 9,
    "weight": 8,
    "desc": "Фасоль, сало, лук и соль."
  },
{
    "name": "Жаркое из мелкой птицы",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "city",
      "town",
      "village"
    ],
    "min": 11,
    "max": 24,
    "weight": 4,
    "desc": "Мелкая птица, запеченная с кореньями."
  },
{
    "name": "Хлебная тюря",
    "type": "food",
    "regions": [
      "common"
    ],
    "terrains": [
      "road",
      "village",
      "wilderness"
    ],
    "min": 1,
    "max": 3,
    "weight": 9,
    "desc": "Размоченный хлеб с луком и солью."
  },
{
    "name": "Жареный лук с хлебной крошкой",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 5,
    "weight": 9,
    "desc": "Лук, обжаренный в жире, с черствой хлебной крошкой.",
    "terrains": [
      "road",
      "village",
      "town"
    ]
  },
{
    "name": "Перловая каша с грибной подливой",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 3,
    "max": 8,
    "weight": 9,
    "desc": "Перловка с густой подливой из сушеных грибов.",
    "terrains": [
      "town",
      "village",
      "road",
      "wilderness",
      "mountain"
    ]
  },
{
    "name": "Солонина с горчицей",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 7,
    "max": 16,
    "weight": 6,
    "desc": "Ломти солонины, грубая горчица и черный хлеб.",
    "terrains": [
      "city",
      "town",
      "road",
      "port"
    ]
  },
{
    "name": "Пирог с капустой",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 3,
    "max": 7,
    "weight": 8,
    "desc": "Простой закрытый пирог с капустой и луком.",
    "terrains": [
      "town",
      "village",
      "road"
    ]
  },
{
    "name": "Яичница с травами",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 4,
    "max": 9,
    "weight": 7,
    "desc": "Яйца, жаренные с луком и зелеными травами.",
    "terrains": [
      "city",
      "town",
      "village"
    ]
  },
{
    "name": "Сушеные яблоки и орехи",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 3,
    "max": 8,
    "weight": 6,
    "desc": "Горсть сушеных яблок, лесные орехи и кусок хлеба.",
    "terrains": [
      "road",
      "village",
      "wilderness",
      "mountain"
    ]
  },
{
    "name": "Похлебка из брюквы",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 2,
    "max": 6,
    "weight": 8,
    "desc": "Брюква, крупа и лук в густой дешевой похлебке.",
    "terrains": [
      "village",
      "road",
      "town",
      "wilderness"
    ]
  },
{
    "name": "Копченая грудинка с хлебом",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 8,
    "max": 18,
    "weight": 5,
    "desc": "Копченая свиная грудинка, хлеб и кислые овощи.",
    "terrains": [
      "city",
      "town",
      "road"
    ]
  },
{
    "name": "Овсяные лепешки с творогом",
    "type": "food",
    "regions": [
      "common"
    ],
    "min": 3,
    "max": 7,
    "weight": 7,
    "desc": "Плотные овсяные лепешки с кислым творогом.",
    "terrains": [
      "village",
      "road",
      "mountain",
      "wilderness"
    ]
  },
{
    "name": "Суп-наварка",
    "type": "food",
    "min": 2,
    "max": 5,
    "weight": 12,
    "desc": "Общий котел бедного дома: овощи, остатки зерна и все, что успели подкинуть за день.",
    "terrains": [
      "village",
      "road",
      "town",
      "wilderness"
    ]
  },
{
    "name": "Разведенный мясной бульон",
    "type": "food",
    "min": 2,
    "max": 6,
    "weight": 10,
    "desc": "Тонкий горячий бульон на костях, растянутый водой до последней возможности.",
    "terrains": [
      "city",
      "town",
      "road",
      "village",
      "port"
    ]
  },
{
    "name": "Хлеб с рыночным сыром",
    "type": "food",
    "min": 4,
    "max": 9,
    "weight": 9,
    "desc": "Свежий или вчерашний хлеб с недорогим сыром с городского рынка.",
    "terrains": [
      "city",
      "town",
      "road",
      "village"
    ]
  }
];
