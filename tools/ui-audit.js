// Ревизор вёрстки: находит огрехи оформления РАЗОМ, а не по одному на скриншот.
//
// Огрехи копились потому, что искались глазами: пользователь присылал кадр, я
// чинил ровно то, что на кадре, а соседние окна с той же болезнью оставались.
// Здесь болезнь описана как ПРАВИЛО, и правило прогоняется по всему живому DOM.
//
// Запуск в консоли страницы:  __uiAudit()            — активное состояние
//                             __uiAudit(".modal")    — только внутри окна
// Возвращает массив находок; печатает таблицу.
//
// Что ищет:
//  1. вылет — элемент выходит за границы родителя, который его обрезает;
//  2. обрез — текст не помещается и обрублен без многоточия;
//  3. наезд — два текстовых блока перекрываются (не родственники);
//  4. каша — горизонтальная прокрутка там, где её не должно быть;
//  5. двойник — в одном окне две кнопки закрытия или два одинаковых заголовка;
//  6. крошка — интерактивный элемент мельче 24 px (мимо пальца и мимо курсора).
(function (root) {
  const ПОРОГ_ВЫЛЕТА = 1.5;          // допуск на субпиксельные округления
  const МИН_КЛИК = 24;

  const видим = el => {
    // .sr-only — подпись для чтеца, нарочно свёрнутая в 1×1 и обрезанная:
    // ревизору там ловить нечего, иначе каждая такая подпись даёт две ложные
    // тревоги («текст шире поля»), и настоящие находки тонут.
    if (el.closest(".sr-only")) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const режет = el => {
    const s = getComputedStyle(el);
    return /hidden|clip|auto|scroll/.test(s.overflowX) || /hidden|clip|auto|scroll/.test(s.overflowY);
  };
  const путь = el => {
    const части = [];
    for (let n = el; n && n.nodeType === 1 && части.length < 4; n = n.parentElement) {
      let ч = n.tagName.toLowerCase();
      if (n.id) { части.unshift(ч + "#" + n.id); break; }
      const кл = String(n.className || "").trim().split(/\s+/).filter(Boolean)[0];
      if (кл) ч += "." + кл;
      части.unshift(ч);
    }
    return части.join(" > ");
  };
  const текст = el => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
  // Что от элемента ВИДНО на самом деле: его прямоугольник, обрезанный всеми
  // предками, которые режут. Без этого длинный список внутри прокрутки «наезжал»
  // на кнопки под собой — на экране ничего подобного нет, браузер его обрезает.
  const виднаЧасть = el => {
    let { top, right, bottom, left } = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const pr = p.getBoundingClientRect();
      if (s.overflowX !== "visible") { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
      if (s.overflowY !== "visible") { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
    }
    return { top, right, bottom, left, width: right - left, height: bottom - top };
  };
  // «своя» текстовая строка: есть текст и нет детей-блоков с тем же текстом
  const листТекста = el => {
    if (!el.childNodes.length) return false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  };

  function ревизия(корень) {
    // Вырожденный вьюпорт — не повод выдавать находки. Скрытая вкладка даёт
    // innerWidth 0, и ТОГДА за края «выходит» всё подряд: один прогон выдал
    // 80 мнимых вылетов. Инструмент, который врёт в неподходящих условиях,
    // хуже отсутствующего — он съедает доверие к настоящим находкам.
    if (innerWidth < 320 || innerHeight < 240)
      throw new Error(`ревизор не мерит при вьюпорте ${innerWidth}×${innerHeight}: ` +
        "разверните окно (или resize_window) — иначе за края выходит всё подряд");
    const область = typeof корень === "string" ? document.querySelector(корень) : (корень || document.body);
    if (!область) return [];
    const все = [область, ...область.querySelectorAll("*")].filter(el => el.nodeType === 1 && видим(el));
    const находки = [];
    const добавить = (вид, el, что) => находки.push({ вид, где: путь(el), что, текст: текст(el), el });

    for (const el of все) {
      const r = el.getBoundingClientRect();

      // 1. вылет за обрезающего предка
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!режет(p)) continue;
        const pr = p.getBoundingClientRect();
        const сп = getComputedStyle(p);
        const вправо = r.right - pr.right, влево = pr.left - r.left;
        const прокрутка = p.scrollWidth > p.clientWidth + 1 && /auto|scroll/.test(сп.overflowX);
        if (!прокрутка && Math.max(вправо, влево) > ПОРОГ_ВЫЛЕТА)
          добавить("вылет", el, `выходит за ${путь(p)} на ${Math.round(Math.max(вправо, влево))} px`);
        break;                                    // достаточно ближайшего обрезающего
      }

      // 2. обрубленный текст без многоточия
      if (листТекста(el)) {
        const с = getComputedStyle(el);
        const обрублен = el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(с.overflowX);
        if (обрублен && с.textOverflow !== "ellipsis")
          добавить("обрез", el, `текст шире поля на ${el.scrollWidth - el.clientWidth} px, без многоточия`);
        if (el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(с.overflowY) && с.webkitLineClamp === "none")
          добавить("обрез", el, `текст выше поля на ${el.scrollHeight - el.clientHeight} px`);
      }

      // 4. Прокрутка вбок со СПРЯТАННОЙ полосой. У таблицы данных прокрутка
      // нормальна: полоса видна, и понятно, что справа ещё колонки. Беда —
      // когда полосу убрали стилем: содержимое уехало, а признака этого на
      // экране не осталось. Так прятались вкладки источников, фильтры слоёв
      // и темы каталога — половина их просто не существовала для глаза.
      // Место под полосу не мерим: в системах с накладными полосами (Chrome
      // по умолчанию) его нет и у обычной прокрутки — правило било бы всех.
      const прокрутка = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + ПОРОГ_ВЫЛЕТА && el.clientWidth > 60
          && /auto|scroll/.test(прокрутка.overflowX) && прокрутка.scrollbarWidth === "none")
        добавить("каша", el, `прокрутка вбок при спрятанной полосе: ${el.scrollWidth} при ширине ${el.clientWidth}`);

      // 6. Мелкая цель клика. Флажок внутри <label> не в счёт: жмут по всей
      // строке, и она крупная — придираться к самому квадратику значит
      // засорить отчёт там, где нажать нечем промахнуться.
      if (el.matches("button, a, input[type=checkbox], input[type=radio], [role=button]")
          && (r.width < МИН_КЛИК || r.height < МИН_КЛИК)) {
        const обёртка = el.closest("label");
        const крупная = обёртка && обёртка !== el
          && обёртка.getBoundingClientRect().height >= МИН_КЛИК - 1;   // 23.99 — та же строка
        if (!крупная) добавить("крошка", el, `цель ${Math.round(r.width)}×${Math.round(r.height)} px, меньше ${МИН_КЛИК}`);
      }
    }

    // 3. наезд текстовых блоков друг на друга.
    // Сравнение «каждый с каждым» на каталоге портала в 671 строку вешало
    // вкладку намертво. Идём заметающей прямой сверху вниз: строки отсортованы
    // по верхней кромке, и каждая сверяется только с теми, что ещё не кончились
    // выше её низа. На обычной вёрстке это почти линейно.
    const строки = все.filter(el => листТекста(el))
      .map(el => ({ el, r: виднаЧасть(el) }))
      .filter(o => o.r.width > 12 && o.r.height > 0)
      .sort((p, q) => p.r.top - q.r.top);
    const живые = [];
    for (let i = 0; i < строки.length; i++) {
      const { el: a, r: ra } = строки[i];
      for (let k = живые.length - 1; k >= 0; k--) {
        if (живые[k].r.bottom <= ra.top) { живые.splice(k, 1); continue; }
        const { el: b, r: rb } = живые[k];
        if (a.contains(b) || b.contains(a)) continue;
        const пх = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const пy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (пх > 2 && пy > 2) {
          // Наложение бывает нарочным: подсказка, всплывающее меню, шторка,
          // липкая полоса поверх прокручиваемого списка. Такое пропускаем —
          // ревизор ищет вёрстку, которая наехала САМА, без чужого слоя.
          const плавает = [a, b].some(n => {
            for (let p = n; p; p = p.parentElement) {
              const s = getComputedStyle(p);
              if (s.position === "fixed" || s.position === "absolute" || s.position === "sticky") return true;
            }
            return false;
          });
          if (!плавает) добавить("наезд", a, `перекрывает ${путь(b)} («${текст(b)}») на ${Math.round(пх)}×${Math.round(пy)} px`);
        }
      }
      живые.push(строки[i]);
    }

    // 5. двойники в пределах одного окна
    for (const окно of область.querySelectorAll(".modal, .pop, .menu")) {
      const закрыть = [...окно.querySelectorAll("button")].filter(b =>
        /закрыть/i.test(b.getAttribute("aria-label") || "") || b.classList.contains("modal-x"));
      if (закрыть.length > 1) добавить("двойник", окно, `${закрыть.length} кнопки закрытия в одном окне`);
      const заголовки = [...окно.querySelectorAll("h1,h2,h3,.modal-kicker,[id$=-title]")]
        .map(h => текст(h).toLowerCase()).filter(Boolean);
      const повтор = заголовки.find((t, i) => t && заголовки.indexOf(t) !== i);
      if (повтор) добавить("двойник", окно, `заголовок «${повтор}» повторяется`);
    }

    return находки;
  }

  root.__ревизия = ревизия;   // для отладки самого ревизора
  root.__uiAudit = function (корень) {
    const н = ревизия(корень);
    if (!н.length) { console.log("ревизор: чисто"); return н; }
    console.log(`ревизор: находок ${н.length}`);
    console.table(н.map(({ вид, где, что, текст }) => ({ вид, где, что, текст })));
    return н;
  };
  if (typeof module === "object" && module.exports) module.exports = { ревизия };
})(typeof window === "object" ? window : globalThis);
