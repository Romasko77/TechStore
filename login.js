(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    // --- validators start ---
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const NAME_RE = /^\p{L}[\p{L}\s'’-]{1,49}$/u;

    const validators = {
        name(value) {
            const v = value.trim().replace(/\s+/g, ' ');
            if (!v) return 'Вкажіть ім’я';
            if (!NAME_RE.test(v)) return 'Ім’я може містити лише літери, пробіли, дефіс і апостроф (2–50 символів)';
            return '';
        },
        email(value) {
            const v = value.trim();
            if (!v) return 'Вкажіть електронну пошту';
            if (v.length > 255 || !EMAIL_RE.test(v)) return 'Введіть коректну пошту, наприклад example@mail.com';
            return '';
        },
        // Під час входу правила складності не показуємо, лише перевіряємо, що пароль введено
        passwordLogin(value) {
            if (!value) return 'Введіть пароль';
            return '';
        },
        password(value) {
            if (!value) return 'Введіть пароль';
            if (value.length < 8) return 'Пароль має містити щонайменше 8 символів';
            if (value.length > 128) return 'Пароль занадто довгий (максимум 128 символів)';
            if (!/\p{L}/u.test(value)) return 'Пароль має містити хоча б одну літеру';
            if (!/\d/.test(value)) return 'Пароль має містити хоча б одну цифру';
            return '';
        }
    };
    // --- validators end ---

    const forms = {
        login: {
            form: $('login-form'),
            endpoint: '/api/auth/login',
            fields: [
                { id: 'login-email', check: 'email' },
                { id: 'login-password', check: 'passwordLogin' }
            ],
            payload: () => ({ email: $('login-email').value.trim(), password: $('login-password').value })
        },
        register: {
            form: $('register-form'),
            endpoint: '/api/auth/register',
            fields: [
                { id: 'register-name', check: 'name' },
                { id: 'register-email', check: 'email' },
                { id: 'register-password', check: 'password' }
            ],
            payload: () => ({
                name: $('register-name').value.trim(),
                email: $('register-email').value.trim(),
                password: $('register-password').value
            })
        }
    };

    function showError(input, message) {
        const out = $(input.id + '-error');
        if (out) out.textContent = message;
        input.classList.toggle('invalid', Boolean(message));
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }

    function runCheck(field) {
        const input = $(field.id);
        const message = validators[field.check](input.value);
        showError(input, message);
        return message;
    }

    // Перевірка кожного поля: після виходу з поля, а далі - під час введення
    Object.values(forms).forEach((cfg) => {
        cfg.fields.forEach((field) => {
            const input = $(field.id);
            input.addEventListener('blur', () => {
                if (input.value === '' && !field.touched) return; // не лаяти за порожнє поле, поки його не заповнювали
                field.touched = true;
                runCheck(field);
            });
            input.addEventListener('input', () => {
                if (field.touched) runCheck(field);
            });
        });
    });

    // Підказки до пароля при реєстрації
    const regPassword = $('register-password');
    function updatePasswordRules() {
        const v = regPassword.value;
        const state = { length: v.length >= 8, letter: /\p{L}/u.test(v), digit: /\d/.test(v) };
        document.querySelectorAll('#password-rules li').forEach((li) => {
            li.classList.toggle('ok', state[li.dataset.rule]);
        });
    }
    regPassword.addEventListener('input', updatePasswordRules);

    // Кнопка "показати / сховати пароль"
    document.querySelectorAll('.password-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = $(btn.dataset.target);
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.setAttribute('aria-pressed', String(show));
            btn.setAttribute('aria-label', show ? 'Сховати пароль' : 'Показати пароль');
            btn.querySelector('i').className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
            input.focus();
        });
    });

    // Перемикання між входом і реєстрацією
    function setMode(mode) {
        const isLogin = mode === 'login';
        forms.login.form.classList.toggle('active', isLogin);
        forms.register.form.classList.toggle('active', !isLogin);
        $('tab-login').classList.toggle('active', isLogin);
        $('tab-register').classList.toggle('active', !isLogin);
        $('tab-login').setAttribute('aria-selected', String(isLogin));
        $('tab-register').setAttribute('aria-selected', String(!isLogin));
        const title = isLogin ? 'Вхід до кабінету' : 'Реєстрація';
        $('auth-title').textContent = title;
        $('crumb-current').textContent = title;
        try { history.replaceState(null, '', isLogin ? location.pathname : '#register'); } catch (e) {}
    }
    $('tab-login').addEventListener('click', () => setMode('login'));
    $('tab-register').addEventListener('click', () => setMode('register'));
    document.querySelectorAll('[data-switch]').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            setMode(link.dataset.switch);
        });
    });
    if (location.hash === '#register') setMode('register');

    // Відправка форм
    async function submitForm(kind, event) {
        event.preventDefault();
        const cfg = forms[kind];
        const message = $(kind + '-message');
        message.textContent = '';
        message.className = 'form-message';

        let firstInvalid = null;
        cfg.fields.forEach((field) => {
            field.touched = true;
            if (runCheck(field) && !firstInvalid) firstInvalid = $(field.id);
        });
        if (firstInvalid) {
            firstInvalid.focus();
            return;
        }

        const btn = cfg.form.querySelector('button[type="submit"]');
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Зачекайте...';

        try {
            const response = await fetch(cfg.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg.payload())
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                const text = data.error || 'Сталася помилка. Спробуйте ще раз';
                if (response.status === 409) {
                    showError($('register-email'), text);
                    $('register-email').focus();
                } else {
                    message.textContent = text;
                    message.classList.add('error');
                }
                return;
            }

            localStorage.setItem('techstore_token', data.token);
            localStorage.setItem('techstore_user', data.user.name);
            window.location.href = 'index.html';
        } catch (err) {
            message.textContent = 'Немає зв’язку із сервером. Спробуйте ще раз.';
            message.classList.add('error');
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    }
    forms.login.form.addEventListener('submit', (e) => submitForm('login', e));
    forms.register.form.addEventListener('submit', (e) => submitForm('register', e));
})();