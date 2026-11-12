// Все данные приходят от Flask. Ключ ПоискКино API находится только на сервере.
const API_BASE = "/api";

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("Нет связи с сервером. Запусти Flask и попробуй ещё раз.");
  }
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error("Сервер вернул некорректный ответ. Открой приложение через Flask.");
  }
  if (!response.ok) {
    throw new Error(data?.error || "Сервер не смог выполнить запрос. Попробуй ещё раз.");
  }
  return data;
}

async function getMovies() {
  return request("/movies");
}

async function getFavorites() {
  return request("/favorites");
}

async function addFavorite(id) {
  return request("/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ movie_id: id })
  });
}

async function removeFavorite(id) {
  return request(`/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
}
