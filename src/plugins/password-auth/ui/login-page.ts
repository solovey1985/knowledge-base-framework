export function loginPage(nonce: string): string {
  // The login page must work before private framework assets become accessible.
  return /* HTML */ `
    <!doctype html>
    <html lang="uk">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Вхід</title>
        <style nonce="${nonce}">
          body {
            margin: 0;
            background: #f8fafc;
            color: #0f172a;
            font: 16px system-ui;
          }
          main {
            min-height: 100vh;
            display: grid;
            place-items: center;
          }
          section {
            box-sizing: border-box;
            width: min(92vw, 420px);
            padding: 32px;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 24px;
            box-shadow: 0 20px 50px #cbd5e144;
          }
          h1 {
            margin-top: 0;
          }
          label {
            display: block;
            margin-bottom: 8px;
          }
          input,
          button {
            box-sizing: border-box;
            width: 100%;
            padding: 12px;
            font: inherit;
            border-radius: 12px;
            border: 1px solid #94a3b8;
          }
          button {
            margin-top: 16px;
            background: #0369a1;
            color: white;
            cursor: pointer;
          }
          button:disabled {
            opacity: 0.6;
          }
          a {
            color: #0369a1;
          }
          #message {
            min-height: 24px;
          }
          input:focus-visible,
          button:focus-visible,
          a:focus-visible {
            outline: 3px solid #38bdf8;
            outline-offset: 3px;
          }
        </style>
      </head>
      <body>
        <main>
          <section>
            <form id="login">
              <label for="password">Пароль</label>
              <input
                id="password"
                type="password"
                autocomplete="current-password"
                required
                autofocus
              />
              <button id="submit">Увійти</button>
            </form>
            <p id="message" role="status" aria-live="polite"></p>
            <div id="session" hidden>
              <a href="/">Продовжити</a>
              <button id="logout">Вийти</button>
            </div>
          </section>
        </main>
        <script nonce="${nonce}">
          const form = document.getElementById('login');
          const message = document.getElementById('message');
          const button = document.getElementById('submit');
          let csrf = '';
          // Keep the CSRF token in page memory; the session cookie remains HttpOnly.
          async function loadSession() {
            try {
              const response = await fetch('/auth/session', {
                cache: 'no-store',
              });
              if (response.ok) {
                const session = await response.json();
                csrf = session.csrfToken;
                form.hidden = true;
                document.getElementById('session').hidden = false;
              }
            } catch {
              message.textContent = 'Не вдалося виконати запит.';
            }
          }
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            button.disabled = true;
            message.textContent = 'Вхід…';
            try {
              const response = await fetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  password: document.getElementById('password').value,
                }),
              });
              document.getElementById('password').value = '';
              if (response.ok) {
                location.assign('/');
                return;
              }
              message.textContent = 'Не вдалося виконати запит.';
            } catch {
              message.textContent = 'Не вдалося виконати запит.';
            } finally {
              button.disabled = false;
            }
          });
          document
            .getElementById('logout')
            .addEventListener('click', async () => {
              try {
                const response = await fetch('/logout', {
                  method: 'POST',
                  headers: { 'X-CSRF-Token': csrf },
                });
                if (response.ok || response.status === 401) location.reload();
                else message.textContent = 'Не вдалося виконати запит.';
              } catch {
                message.textContent = 'Не вдалося виконати запит.';
              }
            });
          loadSession();
        </script>
      </body>
    </html>
  `;
}
