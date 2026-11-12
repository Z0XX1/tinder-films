/* Весь интерфейс использует только четыре функции из api.js. */
(() => {
  const $ = id => document.getElementById(id);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const sameId = (a, b) => String(a) === String(b);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const card = $("movie-card");
  let movies = [];
  let favorites = [];
  const MAX_MOVIES = 500;
  let hasMore = true;
  let currentIndex = 0;
  let currentScreen = "discover";
  let busy = false;
  let loaded = false;
  let toastTimer;
  let drag = null;

  function showToast(message, kind = "success") {
    clearTimeout(toastTimer);
    $("toast-message").textContent = message;
    $("toast-icon").setAttribute("href", kind === "error" ? "#i-x" : "#i-check");
    $("toast").dataset.kind = kind;
    $("toast").classList.add("is-visible");
    toastTimer = setTimeout(() => $("toast").classList.remove("is-visible"), kind === "error" ? 6000 : 2800);
  }

  function setBusy(value) {
    busy = value;
    $("like-button").disabled = value;
    $("skip-button").disabled = value;
    $("card-stage").setAttribute("aria-busy", String(value));
  }

  function updateCounts() {
    $("favorite-count").textContent = favorites.length;
    $("collection-count").textContent = favorites.length;
  }

  function setScreen(screen) {
    currentScreen = screen === "favorites" ? "favorites" : "discover";
    $("discover-screen").hidden = currentScreen !== "discover";
    $("favorites-screen").hidden = currentScreen !== "favorites";
    document.querySelectorAll(".nav-button").forEach(button => {
      const active = button.dataset.screen === currentScreen;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (currentScreen === "favorites") renderFavorites();
  }

  // Hash-навигация поддерживает обновление страницы и кнопки назад/вперёд.
  document.querySelectorAll("[data-screen]").forEach(button => {
    button.addEventListener("click", () => { window.location.hash = button.dataset.screen; });
  });
  window.addEventListener("hashchange", () => setScreen(window.location.hash.slice(1)));

  function stateButton(text, iconName, className, action) {
    const button = document.createElement("button");
    button.className = className;
    button.innerHTML = `${icon(iconName)}<span></span>`;
    button.querySelector("span").textContent = text;
    button.addEventListener("click", action);
    return button;
  }

  function showState(title, description, buttons = []) {
    card.hidden = true;
    $("decision-area").hidden = true;
    $("discovery-state").hidden = false;
    $("state-title").textContent = title;
    $("state-description").textContent = description;
    $("state-actions").replaceChildren(...buttons);
  }

  function renderProgress() {
    const total = hasMore ? MAX_MOVIES : movies.length;
    const position = movies.length ? Math.min(currentIndex + 1, movies.length) : 0;
    $("movie-position").textContent = `${String(position).padStart(2, "0")} / ${total}`;
    // Десять делений вместо сотен DOM-элементов.
    const segments = Math.min(total, 10);
    const active = Math.min(segments - 1, Math.floor(currentIndex / Math.max(total, 1) * segments));
    $("progress-dots").replaceChildren(...Array.from({ length: segments }, (_, index) => {
      const dot = document.createElement("span");
      dot.className = `progress-dot${index < active ? " is-past" : index === active ? " is-current" : ""}`;
      return dot;
    }));
  }

  function renderMovie() {
    renderProgress();
    if (!movies.length) {
      showState("Здесь скоро появится кино", "Подборка пока пуста. Попробуй обновить её чуть позже.", [
        stateButton("Обновить подборку", "refresh", "primary-button", loadData)
      ]);
      return;
    }
    if (currentIndex >= movies.length && hasMore) {
      showState("Продолжим знакомство с кино?", "Следующая порция фильмов уже ждёт в API.", [
        stateButton("Загрузить ещё", "refresh", "primary-button", loadMoreMovies)
      ]);
      return;
    }
    if (currentIndex >= movies.length) {
      showState("На сегодня вы познакомились со всеми", "Самое время заглянуть в избранное. Или дать подборке ещё один шанс!", [
        stateButton("Моё избранное", "heart", "primary-button", () => { window.location.hash = "favorites"; }),
        stateButton("Посмотреть ещё раз", "refresh", "secondary-button", () => { currentIndex = 0; renderMovie(); })
      ]);
      return;
    }
    const movie = movies[currentIndex];
    $("movie-title").textContent = movie.title;
    $("movie-year").textContent = movie.year;
    $("movie-description").textContent = movie.description;
    $("movie-rating").textContent = formatRating(movie.rating);
    $("movie-poster").src = movie.poster;
    $("movie-poster").alt = `Постер фильма «${movie.title}»`;
    $("movie-genres").replaceChildren(...movie.genres.map(genre => {
      const tag = document.createElement("span");
      tag.className = "genre-tag";
      tag.textContent = genre;
      return tag;
    }));
    const saved = favorites.some(favorite => sameId(favorite.id, movie.id));
    $("like-button").setAttribute("aria-label", saved ? "Уже в избранном — следующий фильм" : "Нравится — добавить в избранное");
    $("like-button").title = saved ? "Уже сохранён. Нажми, чтобы перейти дальше." : "Добавить в избранное";
    $("discovery-state").hidden = true;
    card.hidden = false;
    card.classList.add("is-draggable");
    $("decision-area").hidden = false;
  }

  function formatRating(rating) {
    return Number.isFinite(Number(rating)) && rating !== null ? Number(rating).toFixed(1) : "—";
  }

  async function loadData() {
    if (busy) return;
    setBusy(true);
    showState("Ищем твою следующую историю…", "Кино уже на подходе.");
    try {
      const [movieData, favoriteData] = await Promise.all([getMovies(), getFavorites()]);
      if (!Array.isArray(movieData) || !Array.isArray(favoriteData)) {
        throw new Error("Неожиданный формат ответа сервера. Ожидается массив фильмов.");
      }
      movies = movieData;
      hasMore = movies.length < MAX_MOVIES;
      favorites = favoriteData;
      currentIndex = 0;
      loaded = true;
      updateCounts();
      renderMovie();
      renderFavorites();
    } catch (error) {
      loaded = false;
      showState("Не получилось загрузить фильмы", error.message, [
        stateButton("Попробовать ещё раз", "refresh", "primary-button", loadData)
      ]);
      // Ошибка видна и при прямом открытии вкладки избранного.
      if (currentScreen === "favorites") window.location.hash = "discover";
    } finally {
      setBusy(false);
    }
  }

  async function fetchMoreAndRender() {
    showState("Загружаем следующие фильмы…", "Новые истории скоро появятся на экране.");
    try {
      const batch = await getMovies(true);
      if (!batch || !Array.isArray(batch.movies) || typeof batch.has_more !== "boolean") {
        throw new Error("Неожиданный формат следующей порции фильмов.");
      }
      const known = new Set(movies.map(movie => String(movie.id)));
      batch.movies.forEach(movie => {
        if (!known.has(String(movie.id))) {
          known.add(String(movie.id));
          movies.push(movie);
        }
      });
      hasMore = batch.has_more;
      renderMovie();
    } catch (error) {
      showState("Не получилось загрузить следующую порцию", error.message, [
        stateButton("Попробовать ещё раз", "refresh", "primary-button", loadMoreMovies),
        stateButton("Моё избранное", "heart", "secondary-button", () => { window.location.hash = "favorites"; })
      ]);
    }
  }

  async function loadMoreMovies() {
    if (busy) return;
    setBusy(true);
    try { await fetchMoreAndRender(); }
    finally { setBusy(false); }
  }

  async function animateCard(keyframes, duration) {
    if (reducedMotion.matches) return;
    const animation = card.animate(keyframes, { duration, easing: "cubic-bezier(.2,.7,.3,1)" });
    let timer;
    try {
      // В фоновой вкладке браузер может приостановить анимацию.
      await Promise.race([
        animation.finished,
        new Promise(resolve => { timer = setTimeout(resolve, duration + 150); })
      ]);
    } finally {
      clearTimeout(timer);
      animation.cancel();
    }
  }

  async function chooseMovie(like) {
    if (busy || !loaded || currentIndex >= movies.length || currentScreen !== "discover") return;
    setBusy(true);
    const movie = movies[currentIndex];
    try {
      if (like) {
        const saved = favorites.some(favorite => sameId(favorite.id, movie.id));
        if (!saved) {
          await addFavorite(movie.id);
          favorites.push(movie);
          updateCounts();
          if (currentScreen === "favorites") renderFavorites();
        }
        showToast(saved ? "Этот фильм уже ждёт тебя в избранном" : "Мэтч! Фильм добавлен в избранное");
      }
      const direction = like ? 1 : -1;
      await animateCard([
        { opacity: 1, transform: card.style.transform || "translateX(0) rotate(0)" },
        { opacity: 0, transform: `translateX(${direction * 65}px) rotate(${direction * 3}deg)` }
      ], 220);
      currentIndex++;
      resetDrag();
      if (currentIndex >= movies.length && hasMore) await fetchMoreAndRender();
      else renderMovie();
      if (!card.hidden) await animateCard([
        { opacity: 0, transform: `translateX(${-direction * 25}px) scale(.99)` },
        { opacity: 1, transform: "translateX(0) scale(1)" }
      ], 260);
    } catch (error) {
      resetDrag();
      showToast(error.message || "Не удалось сохранить фильм. Попробуй ещё раз.", "error");
    } finally {
      setBusy(false);
    }
  }

  $("like-button").addEventListener("click", () => chooseMovie(true));
  $("skip-button").addEventListener("click", () => chooseMovie(false));
  window.addEventListener("keydown", event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || drag) return;
    if (event.target.closest("input, textarea, select, [contenteditable]")) return;
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && currentScreen === "discover") {
      event.preventDefault();
      chooseMovie(event.key === "ArrowRight");
    }
  });

  function renderFavorites() {
    updateCounts();
    $("favorites-empty").hidden = favorites.length > 0;
    $("favorites-grid").replaceChildren(...favorites.map(movie => {
      const article = document.createElement("article");
      article.className = "favorite-card";
      article.innerHTML = `<div class="favorite-poster-wrap"><img class="favorite-poster" loading="lazy"><span class="favorite-rating">${icon("star")}<span></span></span><button class="remove-favorite">${icon("trash")}</button></div><div class="favorite-info"><h3></h3><p></p></div>`;
      // Данные API вставляются как текст, а не как HTML.
      const image = article.querySelector("img");
      image.src = movie.poster;
      image.alt = `Постер фильма «${movie.title}»`;
      article.querySelector("h3").textContent = movie.title;
      article.querySelector(".favorite-info p").textContent = `${movie.year} · ${movie.genres.join(", ")}`;
      article.querySelector(".favorite-rating span").textContent = formatRating(movie.rating);
      const removeButton = article.querySelector("button");
      removeButton.setAttribute("aria-label", `Удалить «${movie.title}» из избранного`);
      removeButton.title = "Удалить из избранного";
      removeButton.addEventListener("click", async () => {
        removeButton.disabled = true;
        try {
          await removeFavorite(movie.id);
          favorites = favorites.filter(favorite => !sameId(favorite.id, movie.id));
          renderFavorites();
          if (loaded) renderMovie();
          showToast("Фильм удалён из избранного");
        } catch (error) {
          removeButton.disabled = false;
          showToast(error.message, "error");
        }
      });
      return article;
    }));
  }

  // Pointer Events дают простой свайп и мышью, и пальцем.
  function resetDrag() {
    drag = null;
    card.style.transform = "";
    card.classList.remove("is-dragging");
    $("swipe-label").style.opacity = "0";
  }

  card.addEventListener("pointerdown", event => {
    if (busy || event.button !== 0 || event.isPrimary === false) return;
    drag = { x: event.clientX, y: event.clientY, dx: 0 };
    card.setPointerCapture(event.pointerId);
  });
  card.addEventListener("pointermove", event => {
    if (!drag || busy) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { resetDrag(); return; }
    drag.dx = dx;
    if (Math.abs(dx) < 8) return;
    card.classList.add("is-dragging");
    if (!reducedMotion.matches) card.style.transform = `translateX(${dx * .35}px) rotate(${dx * .008}deg)`;
    $("swipe-label").dataset.direction = dx > 0 ? "like" : "skip";
    $("swipe-label").textContent = dx > 0 ? "НРАВИТСЯ ♡" : "В ДРУГОЙ РАЗ";
    $("swipe-label").style.opacity = String(Math.min(Math.abs(dx) / 180, .9));
  });
  card.addEventListener("pointerup", () => {
    if (!drag) return;
    const dx = drag.dx;
    if (Math.abs(dx) > 90) {
      drag = null;
      chooseMovie(dx > 0);
    } else {
      const from = card.style.transform || "none";
      resetDrag();
      animateCard([{ transform: from }, { transform: "none" }], 200);
    }
  });
  card.addEventListener("pointercancel", resetDrag);
  card.addEventListener("lostpointercapture", () => { if (!busy) resetDrag(); });

  setScreen(window.location.hash.slice(1));
  loadData();
})();
