(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root);
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const AUTH_URL = 'https://fsihlzzjewhxpogvjapu.supabase.co/auth/v1';
  // Public browser key, identical to the existing admin. Never a service-role key.
  const PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzaWhsenpqZXdoeHBvZ3ZqYXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyOTY2MzUsImV4cCI6MjA5MDg3MjYzNX0._hS7TA8EqIHgz7CH6XxGKuDdOnVBb6u40ntEtZ__MjU';
  const CALLBACK = 'https://ultera.in.ua/reset-password.html';
  const SESSION_KEY = 'ulhome_session';

  function recoveryFromHash(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (params.has('error') || params.has('error_code')) return { error: 'expired' };
    if (!params.size) return null;
    if (params.get('type') !== 'recovery' || !params.get('access_token')) {
      return { error: 'invalid' };
    }
    // Do not persist or expose the refresh token from the link.
    return { accessToken: params.get('access_token') };
  }

  function passwordProblem(password, confirmation) {
    if (typeof password !== 'string' || password.length < 12) {
      return 'Пароль має містити щонайменше 12 символів.';
    }
    if (password.length > 128) return 'Пароль має містити не більше 128 символів.';
    if (password !== confirmation) return 'Паролі не збігаються. Повторіть новий пароль.';
    return '';
  }

  function errorMessage(error) {
    if (error && (error.status === 429 || /rate_limit/.test(error.code || ''))) {
      return 'Забагато спроб. Зачекайте кілька хвилин і спробуйте ще раз.';
    }
    if (error && /email_address_not_authorized|email_not_allowed/.test(error.code || '')) {
      return 'Сервіс не може надіслати лист на цю адресу. Зверніться до адміністратора.';
    }
    if (error && /weak_password|same_password/.test(error.code || '')) {
      return 'Оберіть інший, надійніший пароль, який ви раніше не використовували.';
    }
    if (error && (error.status === 401 || /session_not_found|bad_jwt|otp_expired/.test(error.code || ''))) {
      return 'Посилання вже використане або застаріло. Запросіть новий лист відновлення.';
    }
    return 'Не вдалося виконати запит. Перевірте з’єднання та спробуйте ще раз.';
  }

  function createClient(fetcher) {
    async function request(path, method, body, accessToken) {
      const headers = { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
      const response = await fetcher(AUTH_URL + path, {
        method, headers, credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error('Auth request failed');
        error.status = response.status;
        error.code = payload && (payload.error_code || payload.code) || '';
        throw error;
      }
      return payload;
    }
    return {
      send(email) {
        const normalized = String(email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          return Promise.reject(new Error('Invalid email'));
        }
        return request('/recover?redirect_to=' + encodeURIComponent(CALLBACK), 'POST', { email: normalized });
      },
      user(accessToken) {
        if (!accessToken) return Promise.reject(new Error('Recovery session required'));
        return request('/user', 'GET', null, accessToken);
      },
      update(accessToken, password, confirmation) {
        if (!accessToken || passwordProblem(password, confirmation)) {
          return Promise.reject(new Error('Invalid password or recovery session'));
        }
        return request('/user', 'PUT', { password }, accessToken);
      },
      logout(accessToken) {
        if (!accessToken) return Promise.reject(new Error('Recovery session required'));
        return request('/logout?scope=global', 'POST', null, accessToken);
      }
    };
  }

  function mount(win) {
    const doc = win.document;
    let recovery = recoveryFromHash(win.location.hash);
    const query = new URLSearchParams(win.location.search);
    if (!recovery && (query.has('error') || query.has('code') || query.has('token_hash'))) {
      recovery = { error: 'invalid' };
    }
    // Strip callback credentials before any request. No analytics on this page.
    if (win.location.hash || win.location.search) {
      win.history.replaceState(null, '', win.location.pathname);
    }
    const client = createClient(win.fetch.bind(win));
    const requestForm = doc.getElementById('request-form');
    const passwordForm = doc.getElementById('password-form');
    const message = doc.getElementById('message');
    const email = doc.getElementById('email');
    const password = doc.getElementById('new-password');
    const confirmation = doc.getElementById('confirm-password');
    const sendButton = doc.getElementById('send-button');
    const saveButton = doc.getElementById('save-button');
    let accessToken = null;
    let requestBusy = false;
    let saveBusy = false;
    let sendAllowedAt = 0;

    function showMessage(text, isError) {
      message.textContent = text;
      message.className = 'message' + (isError ? ' error' : '');
      message.hidden = false;
    }
    function showRequest(error) {
      accessToken = null;
      requestForm.hidden = false;
      passwordForm.hidden = true;
      doc.getElementById('heading').textContent = 'Відновлення доступу';
      doc.getElementById('description').textContent = 'Введіть email адміністратора, щоб отримати нове посилання для зміни пароля.';
      if (error) showMessage(error, true);
    }
    requestForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (requestBusy || Date.now() < sendAllowedAt || !requestForm.reportValidity()) return;
      requestBusy = true;
      sendButton.disabled = true;
      sendButton.textContent = 'Надсилаю…';
      try {
        await client.send(email.value);
        sendAllowedAt = Date.now() + 60000;
        showMessage('Запит прийнято. Якщо ця адреса зареєстрована, на неї надійде лист відновлення. Перевірте також папку «Спам».', false);
        sendButton.textContent = 'Повторити через 60 с';
        win.setTimeout(function () {
          sendButton.disabled = false;
          sendButton.textContent = 'Надіслати ще раз';
        }, 60000);
      } catch (error) {
        showMessage(errorMessage(error), true);
        sendButton.disabled = false;
        sendButton.textContent = 'Надіслати посилання';
      } finally {
        requestBusy = false;
      }
    });
    passwordForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (saveBusy || !accessToken || !passwordForm.reportValidity()) return;
      const problem = passwordProblem(password.value, confirmation.value);
      if (problem) { showMessage(problem, true); return; }
      saveBusy = true;
      saveButton.disabled = true;
      saveButton.textContent = 'Зберігаю…';
      try {
        await client.update(accessToken, password.value, confirmation.value);
        password.value = '';
        confirmation.value = '';
        let signedOut = false;
        try { await client.logout(accessToken); signedOut = true; } catch (_) {}
        accessToken = null;
        try { win.localStorage.removeItem(SESSION_KEY); } catch (_) {}
        passwordForm.hidden = true;
        requestForm.hidden = true;
        doc.getElementById('heading').textContent = 'Пароль змінено';
        doc.getElementById('description').textContent = 'Тепер можна увійти в адмінку ULTERA з новим паролем.';
        showMessage(signedOut
          ? 'Новий пароль збережено. Перейдіть до входу нижче.'
          : 'Новий пароль збережено. Завершення інших сеансів не підтверджено. Перейдіть до входу нижче.', false);
      } catch (error) {
        showMessage(errorMessage(error), true);
        if (error.status === 401 || /session_not_found|bad_jwt|otp_expired/.test(error.code || '')) {
          showRequest(errorMessage(error));
        }
      } finally {
        password.value = '';
        confirmation.value = '';
        saveBusy = false;
        saveButton.disabled = false;
        saveButton.textContent = 'Зберегти новий пароль';
      }
    });

    if (!recovery) return;
    if (recovery.error) {
      showRequest('Посилання вже використане, застаріло або неповне. Запросіть новий лист відновлення.');
      return;
    }
    accessToken = recovery.accessToken;
    recovery = null;
    requestForm.hidden = true;
    showMessage('Перевіряємо посилання відновлення…', false);
    client.user(accessToken).then(function (user) {
      if (!user || !user.id || !user.email || !user.email_confirmed_at || user.is_anonymous) {
        throw new Error('Verified account required');
      }
      doc.getElementById('heading').textContent = 'Новий пароль';
      doc.getElementById('description').textContent = 'Встановіть новий пароль для ' + user.email + '.';
      email.value = user.email;
      message.hidden = true;
      passwordForm.hidden = false;
      password.focus();
    }).catch(function (error) {
      showRequest(error.status ? errorMessage(error) : 'Не вдалося підтвердити посилання. Запросіть новий лист відновлення.');
    });
  }
  return { recoveryFromHash, passwordProblem, errorMessage, createClient, mount };
});
