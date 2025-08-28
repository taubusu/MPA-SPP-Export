// content.js

// 1. Подключаем стили и создаём модальное окно
(function initModal() {
  const style = document.createElement('style');
  style.textContent = `
    #spp-modal-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }
    #spp-modal {
      background: #fff;
      border-radius: 8px;
      padding: 20px;
      width: 320px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      font-family: sans-serif;
    }
    #spp-modal h2 {
      margin: 0 0 12px;
      font-size: 18px;
    }
    #spp-steps li[data-step="message"] .status {
      width: 100%;
      text-align: left;
      font-size: 13px;
      color: #333;
      word-break: break-word;
      line-height: 1.4;
    }
    #spp-steps li[data-step="message"] .status {
      background: #f9f9f9;
      padding: 6px;
      border-radius: 4px;
      white-space: pre-line;
    }
    #spp-steps {
      list-style: none;
      padding: 0; margin: 0 0 20px;
    }
    #spp-steps li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 14px;
    }
    #spp-steps li .status {
      width: 16px;
      height: 16px;
      display: inline-block;
    }
    .spinner {
      border: 2px solid #ccc;
      border-top-color: #8224e3;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    #spp-download-btn {
      display: block;
      margin: 0 auto;
      padding: 8px 14px;
      background: #8224e3;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    #spp-steps li .status {
      min-width: 50px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'spp-modal-overlay';
  overlay.innerHTML = `
    <div id="spp-modal">
      <h2>Экспорт СПП</h2>
      <ul id="spp-steps">
        <li data-step="cookies"><span>Сбор cookies</span><span class="status"></span></li>
        <li data-step="fetch"><span>Запрос данных</span><span class="status"></span></li>
        <li data-step="csv"><span>Генерация CSV</span><span class="status"></span></li>
        <li data-step="message"><span>Сообщения о работе: </span><span class="status"></span></li>
      </ul>
    </div>
  `;
  document.body.appendChild(overlay);
})();

// 1. Утилита: ждем появления элемента в DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (timeout) {
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Элемент ${selector} не найден за ${timeout}мс`));
      }, timeout);
    }
  });
}

// 2. Вставляем кнопку рядом с «Редактировать»
function insertExportButton(original) {
  // защищаемся от дублирования
  if (original.nextSibling?.id === 'wb-spp-export') return;

  const btn = document.createElement('button');
  btn.id = 'wb-spp-export';
  btn.className = original.className;
  btn.textContent = 'Выгрузить СПП';
  btn.style.marginLeft = '8px';

  original.parentNode.insertBefore(btn, original.nextSibling);

  btn.addEventListener('click', () => {
    openModal();
    chrome.runtime.sendMessage({ action: 'export-spp' });
  });
}

// 3. Управление модалкой и статусами
function openModal() {
  const overlay = document.getElementById('spp-modal-overlay');
  overlay.style.display = 'flex';
  resetSteps();
}

function closeModal() {
  const overlay = document.getElementById('spp-modal-overlay');
  overlay.style.display = 'none';
  // удалить кнопку скачивания, если она есть
  const dl = document.getElementById('spp-download-btn');
  if (dl) dl.remove();
}

function resetSteps() {
  const lis = document.querySelectorAll('#spp-steps li');
  lis.forEach(li => {
    li.classList.remove('active', 'done');
    li.querySelector('.status').textContent = '';
  });
}

function markStep(step, status, data) {
  if (data && data.message) {
    const el = document.querySelector('#spp-steps li[data-step="message"] .status');
    el.textContent = data.message;
  }

  const li = document.querySelector(`#spp-steps li[data-step="${step}"]`);
  if (!li) return;
  const st = li.querySelector('.status');

  if (status === 'start') {
    document.querySelectorAll('#spp-steps li').forEach(x => x.classList.remove('active'));
    li.classList.add('active');
    st.innerHTML = '<div class="spinner"></div>';
    return;
  }

  // Ветка прогресса: выводим число строк
  if (status === 'progress' && step === 'fetch') {
    st.textContent = data.processed || '0';
    return;
  }

  if (status === 'done') {
    li.classList.remove('active');
    li.classList.add('done');
    st.textContent = '✓';

    if (step === 'csv' && data && data.uri) {
      const modal = document.getElementById('spp-modal');
      const downloadBtn = document.createElement('button');
      downloadBtn.id = 'spp-download-btn';
      downloadBtn.textContent = 'Скачать файл';
      downloadBtn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = data.uri;
        a.download = `spp_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        closeModal();
      });
      modal.appendChild(downloadBtn);
    }
  }
}

// 4. Слушаем сообщения от background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'export-status') return;
  // Передаём весь msg, чтобы в data.processed тоже был доступ
  markStep(msg.step, msg.status, msg);
});


// 5. Инициализируем наблюдение за появлением кнопки «Редактировать»
const EDIT_BTN_SELECTOR = 'button[data-testid="editing-test-id-button-primary"]';

// при первой загрузке страницы
waitForElement(EDIT_BTN_SELECTOR)
  .then(el => insertExportButton(el))
  .catch(console.warn);

// отслеживаем клиентские маршруты (SPA → pushState/popstate)
(function hookHistory() {
  const origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    // подождать, пока React DOM обновится
    setTimeout(() => {
      waitForElement(EDIT_BTN_SELECTOR)
        .then(el => insertExportButton(el))
        .catch(() => {});
    }, 500);
  };
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      waitForElement(EDIT_BTN_SELECTOR)
        .then(el => insertExportButton(el))
        .catch(() => {});
    }, 500);
  });
})();