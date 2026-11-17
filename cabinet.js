(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const token = localStorage.getItem('techstore_token');
    if (!token) {
        window.location.replace('login.html');
        return;
    }

    const STATUSES = { new: 'Нове', processing: 'В обробці', shipped: 'Відправлено', completed: 'Виконано', cancelled: 'Скасовано' };
    const FLOW = ['new', 'processing', 'shipped', 'completed'];
    const FLOW_ICONS = { new: 'fa-file-circle-check', processing: 'fa-gears', shipped: 'fa-truck-fast', completed: 'fa-check' };
    const DELIVERY = { 'nova-poshta': 'Нова Пошта (відділення)', courier: 'Кур’єрська доставка', pickup: 'Самовивіз з магазину' };
    const PAYMENT = { card: 'Карткою на сайті', postpaid: 'При отриманні' };
    const NAME_RE = /^\p{L}[\p{L}\s'’-]{1,49}$/u;
    const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#f3f5f4"/><text x="30" y="36" font-size="22" text-anchor="middle" fill="#bbb">?</text></svg>'
    );

    let orders = [];
    let profile = null;

    // ---------- Допоміжне ----------
    // Елементи створюються без innerHTML: усі дані вставляються як текст
    function el(tag, props, ...children) {
        const node = Object.assign(document.createElement(tag), props || {});
        node.append(...children);
        return node;
    }
    const icon = (cls) => el('i', { className: 'fa-solid ' + cls });
    const money = (n) => Number(n).toLocaleString('uk-UA') + ' ₴';
    const when = (iso) => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    const day = (iso) => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    };
    const safeImg = (url) => (/^https?:\/\//i.test(url || '') ? url : PLACEHOLDER);

    let toastTimer;
    function toast(message, ok = true) {
        let t = $('cab-toast');
        if (!t) {
            t = el('div', { id: 'cab-toast', role: 'status' });
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;color:#fff;padding:12px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:14px;font-weight:500;z-index:10000;transition:all .3s ease;max-width:calc(100vw - 40px)';
            document.body.appendChild(t);
        }
        t.style.background = ok ? '#2ecc71' : '#e74c3c';
        t.textContent = message;
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(20px)'; }, 3500);
    }

    function logout() {
        localStorage.removeItem('techstore_token');
        localStorage.removeItem('techstore_user');
        window.location.replace('login.html');
    }

    async function api(path, options = {}) {
        let res;
        try {
            res = await fetch(path, {
                ...options,
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
            });
        } catch (e) {
            throw new Error('Немає зв’язку із сервером. Спробуйте ще раз.');
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            logout();
            throw new Error('Сесія завершилась. Увійдіть знову.');
        }
        if (!res.ok) throw new Error(data.error || 'Помилка сервера (' + res.status + ')');
        return data;
    }

    // ---------- Профіль і статистика ----------
    function renderProfile() {
        if (!profile) return;
        const { user, stats } = profile;
        $('cab-user-name').textContent = user.name;
        $('cab-user-email').textContent = user.email;
        $('cab-avatar').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
        $('profile-name').value = user.name;
        $('profile-email').value = user.email;
        $('profile-since').value = day(user.created_at);

        $('stat-orders').textContent = stats.ordersCount;
        $('stat-active').textContent = stats.activeCount;
        $('stat-spent').textContent = money(stats.totalSpent);
        $('stat-reviews').textContent = stats.reviewsCount;

        const badge = $('menu-orders-count');
        badge.textContent = stats.activeCount;
        badge.hidden = stats.activeCount === 0;
    }

    async function loadProfile() {
        profile = await api('/api/account/profile');
        localStorage.setItem('techstore_user', profile.user.name);
        renderProfile();
    }

    // ---------- Замовлення ----------
    function makeSteps(status) {
        const current = FLOW.indexOf(status);
        const list = el('ol', { className: 'cab-steps', 'aria-label': 'Етапи замовлення' });
        FLOW.forEach((s, i) => {
            const li = el('li', { className: 'cab-step' + (i <= current ? ' done' : '') + (i === current ? ' current' : '') });
            if (i === current) li.setAttribute('aria-current', 'step');
            li.append(el('div', { className: 'cab-step-dot' }, icon(FLOW_ICONS[s])), STATUSES[s]);
            list.append(li);
        });
        return list;
    }

    function makeOrder(o) {
        const items = o.items || [];
        const card = el('article', { className: 'cab-order' });
        card.dataset.status = o.status;

        const body = el('div', { className: 'cab-order-body', id: 'order-body-' + o.id });

        const head = el('div', { className: 'cab-order-head', tabIndex: 0, role: 'button' },
            el('span', { className: 'cab-order-id', textContent: 'Замовлення №' + o.id }),
            el('span', { className: 'cab-badge', textContent: STATUSES[o.status] || o.status }),
            el('span', { className: 'cab-order-date', textContent: when(o.created_at) }),
            el('span', { className: 'cab-order-total', textContent: money(o.total) }),
            el('i', { className: 'fa-solid fa-chevron-down cab-chevron' }));
        head.querySelector('.cab-badge').dataset.status = o.status;
        head.setAttribute('aria-expanded', 'false');
        head.setAttribute('aria-controls', body.id);

        const toggle = () => {
            const open = card.classList.toggle('open');
            head.setAttribute('aria-expanded', String(open));
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });

        // Мініатюри товарів у згорнутому вигляді
        const thumbs = el('div', { className: 'cab-thumbs' });
        items.slice(0, 5).forEach((i) => thumbs.append(el('img', { src: safeImg(i.image_url), alt: i.title, loading: 'lazy' })));
        if (items.length > 5) thumbs.append(el('div', { className: 'cab-thumb-more', textContent: '+' + (items.length - 5) }));

        // Тіло замовлення
        if (o.status === 'cancelled') {
            body.append(el('div', { className: 'cab-cancelled-note', textContent: 'Це замовлення скасовано.' }));
        } else {
            body.append(makeSteps(o.status));
        }

        const list = el('ul', { className: 'cab-items' });
        items.forEach((i) => {
            const meta = [i.memory, i.color].filter(Boolean).join(' · ');
            list.append(el('li', { className: 'cab-item' },
                el('img', { src: safeImg(i.image_url), alt: '' }),
                el('div', { className: 'cab-item-info' },
                    el('div', { className: 'cab-item-title', textContent: i.title }),
                    el('div', { className: 'cab-item-meta', textContent: (meta ? meta + ' · ' : '') + i.quantity + ' шт. × ' + money(i.unit_price) })),
                el('div', { className: 'cab-item-sum', textContent: money(i.quantity * i.unit_price) })));
        });
        body.append(list);

        const field = (label, value) => el('div', {}, el('b', { textContent: label }), value);
        body.append(el('div', { className: 'cab-info' },
            field('Одержувач', o.full_name),
            field('Телефон', o.phone),
            field('Доставка', (DELIVERY[o.delivery_method] || o.delivery_method) + ', ' + o.city + ', ' + o.address),
            field('Оплата', PAYMENT[o.payment_method] || o.payment_method)));

        const actions = el('div', { className: 'cab-order-actions' });
        const again = el('button', { type: 'button', className: 'cab-btn ghost' }, icon('fa-rotate-right'), ' Повторити замовлення');
        again.addEventListener('click', () => reorder(o, again));
        actions.append(again);
        if (o.status === 'new') {
            const cancel = el('button', { type: 'button', className: 'cab-btn danger' }, icon('fa-ban'), ' Скасувати');
            cancel.addEventListener('click', () => cancelOrder(o, cancel));
            actions.append(cancel);
        }
        body.append(actions);

        card.append(head, thumbs, body);
        return card;
    }

    function renderOrders() {
        const filter = $('orders-filter').value;
        const list = orders.filter((o) => !filter || o.status === filter);
        const box = $('orders-list');

        if (!orders.length) {
            box.replaceChildren(el('div', { className: 'cab-empty' },
                el('i', { className: 'fa-solid fa-box-open' }),
                el('p', { textContent: 'Ви ще не робили замовлень.' }),
                el('a', { className: 'cab-btn', href: 'index.html' }, 'Перейти до покупок')));
            return;
        }
        if (!list.length) {
            box.replaceChildren(el('div', { className: 'cab-empty' },
                el('i', { className: 'fa-solid fa-filter-circle-xmark' }),
                el('p', { textContent: 'Замовлень з таким статусом немає.' })));
            return;
        }
        box.replaceChildren(...list.map(makeOrder));
        // Єдине замовлення розгортаємо одразу
        if (list.length === 1) {
            const only = box.querySelector('.cab-order');
            only.classList.add('open');
            only.querySelector('.cab-order-head').setAttribute('aria-expanded', 'true');
        }
    }

    async function loadOrders() {
        const btn = $('orders-refresh');
        btn.disabled = true;
        try {
            orders = await api('/api/account/orders');
            renderOrders();
        } catch (err) {
            $('orders-list').replaceChildren(el('div', { className: 'cab-error', textContent: err.message }));
        } finally {
            btn.disabled = false;
        }
    }

    async function cancelOrder(o, btn) {
        if (!confirm('Скасувати замовлення №' + o.id + '?')) return;
        btn.disabled = true;
        try {
            await api('/api/account/orders/' + o.id + '/cancel', { method: 'POST' });
            toast('Замовлення №' + o.id + ' скасовано');
            await Promise.all([loadOrders(), loadProfile()]);
        } catch (err) {
            toast(err.message, false);
            btn.disabled = false;
            // Статус міг змінитися на боці магазину: оновлюємо список
            loadOrders();
        }
    }

    // Додаємо товари замовлення назад у кошик (ціни беруться актуальні, але не нижчі за поточну ціну товару)
    async function reorder(o, btn) {
        btn.disabled = true;
        try {
            let products = [];
            try {
                const res = await fetch('/api/products');
                if (res.ok) products = await res.json();
            } catch (e) { /* без актуальних цін працюємо зі старими */ }
            const byId = new Map(products.map((p) => [String(p.id), p]));

            let cart = [];
            try { cart = JSON.parse(localStorage.getItem('techstore_cart')) || []; } catch (e) { cart = []; }

            let added = 0;
            let skipped = 0;
            (o.items || []).forEach((i) => {
                if (!i.product_id || (products.length && !byId.has(String(i.product_id)))) { skipped++; return; }
                const current = byId.get(String(i.product_id));
                const price = Math.max(Number(i.unit_price), current ? Number(current.price) : 0);
                const id = String(i.product_id);
                const key = `${id}_${i.color || 'def'}_${i.memory || 'def'}`;
                const existing = cart.find((c) => c.key === key);
                if (existing) {
                    existing.quantity += i.quantity;
                    existing.price = price;
                } else {
                    cart.push({
                        key, id, title: i.title, price,
                        imgSrc: safeImg(current ? current.image_url : i.image_url),
                        color: i.color || null, memory: i.memory || null, quantity: i.quantity
                    });
                }
                added++;
            });

            if (!added) {
                toast('Ці товари більше недоступні в каталозі', false);
                return;
            }
            localStorage.setItem('techstore_cart', JSON.stringify(cart));
            toast(skipped ? `Додано в кошик (${added}), недоступних товарів: ${skipped}` : 'Товари додано до кошика');
            setTimeout(() => { window.location.href = 'checkout.html'; }, 1200);
        } finally {
            btn.disabled = false;
        }
    }

    // ---------- Вкладки ----------
    function showTab(name) {
        if (!['orders', 'profile', 'security'].includes(name)) name = 'orders';
        ['orders', 'profile', 'security'].forEach((t) => { $('tab-' + t).hidden = t !== name; });
        document.querySelectorAll('.cab-menu-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
        $('cab-stats').hidden = name !== 'orders';
        try { history.replaceState(null, '', name === 'orders' ? location.pathname : '#' + name); } catch (e) {}
    }
    document.querySelectorAll('.cab-menu-btn[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

    // ---------- Форма профілю ----------
    function setMessage(id, text, ok) {
        const m = $(id);
        m.textContent = text || '';
        m.className = 'form-message' + (text ? (ok ? ' ok' : ' error') : '');
    }
    function setFieldError(inputId, text) {
        const input = $(inputId);
        $(inputId + '-error').textContent = text || '';
        input.classList.toggle('invalid', Boolean(text));
    }

    $('profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        setMessage('profile-message', '');
        const name = $('profile-name').value.trim().replace(/\s+/g, ' ');
        let problem = '';
        if (!name) problem = 'Вкажіть ім’я';
        else if (!NAME_RE.test(name)) problem = 'Ім’я може містити лише літери, пробіли, дефіс і апостроф (2–50 символів)';
        setFieldError('profile-name', problem);
        if (problem) { $('profile-name').focus(); return; }

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            const data = await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ name }) });
            profile.user = { ...profile.user, ...data.user };
            localStorage.setItem('techstore_user', data.user.name);
            renderProfile();
            setMessage('profile-message', 'Зміни збережено', true);
        } catch (err) {
            setMessage('profile-message', err.message, false);
        } finally {
            btn.disabled = false;
        }
    });

    // ---------- Форма пароля ----------
    function pwProblem(v) {
        if (!v) return 'Введіть новий пароль';
        if (v.length < 8) return 'Пароль має містити щонайменше 8 символів';
        if (v.length > 128) return 'Пароль занадто довгий (максимум 128 символів)';
        if (!/\p{L}/u.test(v)) return 'Пароль має містити хоча б одну літеру';
        if (!/\d/.test(v)) return 'Пароль має містити хоча б одну цифру';
        return '';
    }

    $('pw-new').addEventListener('input', () => {
        const v = $('pw-new').value;
        const state = { length: v.length >= 8, letter: /\p{L}/u.test(v), digit: /\d/.test(v) };
        document.querySelectorAll('#pw-rules li').forEach((li) => li.classList.toggle('ok', state[li.dataset.rule]));
    });

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

    $('password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        setMessage('password-message', '');
        const current = $('pw-current').value;
        const next = $('pw-new').value;
        const repeat = $('pw-repeat').value;

        const errors = {
            'pw-current': current ? '' : 'Введіть поточний пароль',
            'pw-new': pwProblem(next) || (next === current ? 'Новий пароль має відрізнятися від поточного' : ''),
            'pw-repeat': next && repeat !== next ? 'Паролі не збігаються' : ''
        };
        let first = null;
        for (const [id, text] of Object.entries(errors)) {
            setFieldError(id, text);
            if (text && !first) first = id;
        }
        if (first) { $(first).focus(); return; }

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
            e.target.reset();
            document.querySelectorAll('#pw-rules li').forEach((li) => li.classList.remove('ok'));
            setMessage('password-message', 'Пароль успішно змінено', true);
        } catch (err) {
            setMessage('password-message', err.message, false);
        } finally {
            btn.disabled = false;
        }
    });

    // ---------- Запуск ----------
    $('orders-filter').append(new Option('Усі статуси', ''));
    Object.entries(STATUSES).forEach(([value, label]) => $('orders-filter').append(new Option(label, value)));
    $('orders-filter').addEventListener('change', renderOrders);
    $('orders-refresh').addEventListener('click', () => { loadOrders(); loadProfile().catch(() => {}); });
    $('cab-logout').addEventListener('click', logout);

    showTab(location.hash.replace('#', ''));
    loadProfile().catch((err) => toast(err.message, false));
    loadOrders();
})();