// background.js (MV3 service worker)

let authToken = null;
let exportTabId = null;

// 1) Ловим AuthorizeV3 и сразу уведомляем контент
function captureTokens(details) {
  const hdrs = details.requestHeaders;
  const auth = hdrs.find(h => h.name.toLowerCase() === 'authorizev3')?.value;
  if (auth) {
    authToken = auth;
    chrome.webRequest.onBeforeSendHeaders.removeListener(captureTokens);
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  captureTokens,
  { urls: ["https://discounts-prices.wildberries.ru/*"] },
  ["requestHeaders"]
);

// 2) Собираем cookies для запросов
function buildCookieHeader() {
  return new Promise(resolve => {
    chrome.cookies.getAll({ domain: '.wildberries.ru' }, cookies => {
      const header = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      resolve(header);
    });
  });
}

// 3) Обработка команды из content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'export-spp') return;
  if (!authToken) {
    sendResponse({ ok: false, error: 'Токен AuthorizeV3 ещё не пойман — обновите страницу.' });
    return;
  }

  exportTabId = sender.tab.id;

  exportAll(exportTabId)
    .then(() => sendResponse({ ok: true }))
    .catch(e => sendResponse({ ok: false, error: e.message }));

  return true; // ждём асинхронный ответ
});

// 4) Основная логика экспорта с отправкой статусов
async function exportAll(tabId) {
  const api = 'https://discounts-prices.wildberries.ru/ns/dp-api/discounts-prices/' +
              'suppliers/api/v1/list/goods/filter';

  // Шаг 1: cookies
  chrome.tabs.sendMessage(tabId, {
    action: 'export-status',
    step: 'cookies',
    status: 'start',
    message: 'Сбор Cookie...Если процесс длится больше 5 секунд - перезагрузите страницу!'
  });

  const cookieHeader = await buildCookieHeader();
  chrome.tabs.sendMessage(tabId, {
    action: 'export-status',
    step: 'cookies',
    status: 'done',
    message: 'Cookie готовы'
  });

  // Шаг 2: запрос данных
  chrome.tabs.sendMessage(tabId, {
    action: 'export-status',
    step: 'fetch',
    status: 'start',
    message: 'Начат сбор данных...'
  });

  let offset = 0;
  const rows = [];
  let isDone = false;

  for (; !isDone; offset += 50) {
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      const res = await fetch(api, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'AuthorizeV3': authToken,
          'Cookie': cookieHeader
        },
        credentials: 'include',
        body: JSON.stringify({
          limit: 50,
          offset,
          facets: [],
          filterWithoutPrice: false,
          filterWithLeftovers: false,
          sort: 'price',
          sortOrder: 0
        })
      });

      if (res.status === 429) {
        chrome.tabs.sendMessage(tabId, {
          action: 'export-status',
          step: 'fetch',
          status: 'progress',
          processed: rows.length,
          message: `Много запросов (${retries + 1}/${maxRetries}). Ждём 30 секунд...`
        });
        retries++;
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ошибка: ${res.status}`);

      const payload = await res.json();
      const items = Array.isArray(payload.data?.items)
        ? payload.data.items
        : Array.isArray(payload.data?.listGoods)
          ? payload.data.listGoods
          : [];

      items.forEach(item => {
        rows.push(`${item.nmID};${item.discountOnSite ?? ''}`);
      });

      chrome.tabs.sendMessage(tabId, {
        action: 'export-status',
        step: 'fetch',
        status: 'progress',
        processed: rows.length,
        message: 'Идет сбор данных...'
      });

      if (items.length < 50) {
        isDone = true;
        break; // последняя страница
      }

      await new Promise(r => setTimeout(r, 300));
      break; // успешный запрос, выходим из retry-цикла
    }

    if (retries === maxRetries) {
      chrome.tabs.sendMessage(tabId, {
        action: 'export-status',
        step: 'fetch',
        status: 'progress',
        processed: rows.length,
        message: 'Слишком много ошибок от WB. Повторите выгрузку через 10 минут.'
      });
      throw new Error('Слишком много попыток 429. Прекращаем.');
    }
  }

  chrome.tabs.sendMessage(tabId, {
    action: 'export-status',
    step: 'fetch',
    status: 'done',
    message: 'Сбор данных завершен!'
  });

  // Шаг 3: генерация CSV
  chrome.tabs.sendMessage(tabId, {
    action: 'export-status',
    step: 'csv',
    status: 'start',
    message: 'Генерируем CSV...'
  });

  const csv = ['sku;SPP', ...rows].join('\n');
  const uri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);

  chrome.tabs.sendMessage(tabId, {
    action: 'export-status',
    step: 'csv',
    status: 'done',
    message: 'Файл готов, можно скачивать!',
    uri
  });
}
