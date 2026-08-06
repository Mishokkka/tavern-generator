// Auto-split tavern data. Edit this file directly when changing TAVERN_OPTIONS.

export const TAVERN_OPTIONS = {
  "regions": {
    "common": "Нейтральная дорога",
    "novandia": "Нованд",
    "sangren": "Сангрен",
    "flechenrand": "Флеченранд",
    "horslia": "Хорслия",
    "ontakwa": "Онтаква",
    "yaknizem": "Якнизем",
    "tirabor": "Тиробор",
    "lezhnizem": "Лежнизем",
    "sirost": "Сиростьен",
    "sarroyo": "Сарройо",
    "royu_sageki": "Ройу Сагеки",
    "royu_mideki": "Ройу Мидеки",
    "naerder": "Наэрдер",
    "kaldvelg": "Кальдвельг",
    "izuaver": "Изуавер",
    "boltrask": "Болтраск",
    "dichtbeir": "Дихтбейр"
  },
  "qualities": {
    "poor": "Дешевая",
    "modest": "Обычная",
    "good": "Приличная",
    "fine": "Дорогая"
  },
  "sizes": {
    "tiny": "Придорожный дом",
    "small": "Малая таверна",
    "medium": "Обычная таверна",
    "large": "Большой постоялый двор"
  },
  "terrains": {
    "city": "Город",
    "town": "Городок",
    "road": "Дорога",
    "village": "Деревня",
    "port": "Порт",
    "mountain": "Горы",
    "wilderness": "Глушь"
  }
};

export const QUALITY_MODIFIERS = {
  "poor": {
    "price": 0.6,
    "menu": -2,
    "rooms": -1,
    "stock": 0.7,
    "occupied": 0.85
  },
  "modest": {
    "price": 0.9,
    "menu": 0,
    "rooms": 0,
    "stock": 1,
    "occupied": 0.65
  },
  "good": {
    "price": 1.35,
    "menu": 2,
    "rooms": 1,
    "stock": 1.15,
    "occupied": 0.55
  },
  "fine": {
    "price": 2.1,
    "menu": 3,
    "rooms": 2,
    "stock": 1.25,
    "occupied": 0.45
  }
};

export const SIZE_MODIFIERS = {
  "tiny": {
    "menu": 5,
    "rooms": 2,
    "roomStock": 3,
    "mealStock": 4,
    "localMax": 2
  },
  "small": {
    "menu": 7,
    "rooms": 3,
    "roomStock": 6,
    "mealStock": 7,
    "localMax": 3
  },
  "medium": {
    "menu": 9,
    "rooms": 4,
    "roomStock": 10,
    "mealStock": 11,
    "localMax": 4
  },
  "large": {
    "menu": 13,
    "rooms": 5,
    "roomStock": 18,
    "mealStock": 16,
    "localMax": 6
  }
};

export const TERRAIN_MODIFIERS = {
  "city": {
    "price": 1.2,
    "occupied": 0.75,
    "localChance": 0.85
  },
  "town": {
    "price": 1,
    "occupied": 0.6,
    "localChance": 0.75
  },
  "road": {
    "price": 1.1,
    "occupied": 0.7,
    "localChance": 0.55
  },
  "village": {
    "price": 0.85,
    "occupied": 0.45,
    "localChance": 0.7
  },
  "port": {
    "price": 1.25,
    "occupied": 0.8,
    "localChance": 0.9
  },
  "mountain": {
    "price": 1.35,
    "occupied": 0.5,
    "localChance": 0.7
  },
  "wilderness": {
    "price": 1.5,
    "occupied": 0.35,
    "localChance": 0.45
  }
};
