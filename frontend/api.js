// Для подключения Flask поменяйте на false и отдавайте frontend с того же домена.
// Ключ Kinopoisk API хранится только на бэкенде.
const USE_MOCK = true;
const API_BASE = "/api";
const FAVORITES_KEY = "kinotinder.favorites.v1";

// Единый формат фильма используется и в mock-режиме, и в ответах Flask.
const mockMovies = [
  {
    id: 1,
    title: "Интерстеллар",
    year: 2014,
    genres: ["Фантастика", "Драма", "Приключения"],
    rating: 8.6,
    poster: "assets/interstellar.jpg",
    description: "Когда Земля становится непригодной для жизни, команда исследователей отправляется сквозь червоточину на поиски нового дома для человечества. Путешествие за пределы пространства и времени — и история о любви, которая сильнее их обоих."
  },
  {
    id: 2,
    title: "Ла-Ла Ленд",
    year: 2016,
    genres: ["Мюзикл", "Мелодрама", "Драма"],
    rating: 8.0,
    poster: "assets/la-la-land.jpg",
    description: "Начинающая актриса и джазовый музыкант встречаются в Лос-Анджелесе. Между прослушиваниями, мелодиями и огнями большого города рождается любовь. Но что, если мечты однажды поведут их в разные стороны?"
  },
  {
    id: 3,
    title: "Отель «Гранд Будапешт»",
    year: 2014,
    genres: ["Комедия", "Приключения", "Детектив"],
    rating: 8.0,
    poster: "assets/grand-budapest.jpg",
    description: "Легендарный консьерж Густав и юный портье Зеро оказываются в центре невероятной истории с похищенной картиной, огромным наследством и погонями. Изящное, ироничное приключение в пастельных декорациях Уэса Андерсона."
  },
  {
    id: 4,
    title: "Прибытие",
    year: 2016,
    genres: ["Фантастика", "Драма", "Детектив"],
    rating: 8.0,
    poster: "assets/arrival.jpg",
    description: "Над Землёй появляются загадочные космические корабли. Лингвист Луиза Бэнкс пытается понять язык их обитателей — и постепенно открывает нечто, что навсегда изменит её представление о времени, выборе и собственной жизни."
  },
  {
    id: 5,
    title: "Душа",
    year: 2020,
    genres: ["Мультфильм", "Фэнтези", "Комедия"],
    rating: 8.4,
    poster: "assets/soul.jpg",
    description: "Джазовый пианист Джо Гарднер получает шанс всей жизни, но случайно попадает в мир, где рождаются души. Вместе с упрямой душой по имени 22 ему предстоит выяснить, ради чего стоит жить. Тёплая история о радости самых простых вещей."
  }
];

// GET /movies и GET /favorites возвращают массивы объектов фильма.
// POST и DELETE могут вернуть JSON или пустой ответ (например, 204).
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error("Сервер не смог выполнить запрос. Попробуй ещё раз.");
  }
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function readFavoriteIds() {
  let saved;
  try {
    saved = localStorage.getItem(FAVORITES_KEY);
  } catch {
    throw new Error("Разреши сохранение данных в браузере, чтобы пользоваться избранным.");
  }
  // Повреждённые тестовые данные не должны мешать открытию приложения.
  try {
    const ids = JSON.parse(saved || "[]");
    return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === "number" || typeof id === "string").map(String))] : [];
  } catch {
    return [];
  }
}

function writeFavoriteIds(ids) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    throw new Error("Не удалось сохранить избранное. Проверь доступ к хранилищу браузера.");
  }
}

async function getMovies() {
  return USE_MOCK ? mockMovies.slice() : request("/movies");
}

async function getFavorites() {
  if (!USE_MOCK) return request("/favorites");
  return readFavoriteIds().map(id => mockMovies.find(movie => String(movie.id) === id)).filter(Boolean);
}

async function addFavorite(id) {
  if (!USE_MOCK) {
    return request("/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movie_id: id })
    });
  }
  const movie = mockMovies.find(movie => String(movie.id) === String(id));
  if (!movie) throw new Error("Фильм не найден.");
  const ids = readFavoriteIds();
  if (!ids.includes(String(id))) writeFavoriteIds([...ids, String(id)]);
  return movie;
}

async function removeFavorite(id) {
  if (!USE_MOCK) return request(`/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
  writeFavoriteIds(readFavoriteIds().filter(savedId => savedId !== String(id)));
}
