document.addEventListener('DOMContentLoaded', () => {
    const orderItemsList = document.getElementById('order-items-list');
    const orderTotalPrice = document.getElementById('order-total-price');
    const checkoutForm = document.getElementById('checkout-form');
    const fullnameInput = document.getElementById('fullname');
    const phoneInput = document.getElementById('phone');
    const emailInput = document.getElementById('email');
    const cityInput = document.getElementById('city');
    const addressInput = document.getElementById('address');

    // Отримуємо збережені дані про користувача та кошик
    const cart = JSON.parse(localStorage.getItem('techstore_cart')) || [];
    const savedUser = localStorage.getItem('techstore_user');

    // Блок сповіщення про авторизацію
    const checkoutSection = document.querySelector('.checkout-section');
    if (!savedUser && checkoutSection) {
        const authNotice = document.createElement('div');
        authNotice.style.cssText = `
            background-color: #eef9f2;
            border: 1px solid #2ecc71;
            padding: 12px 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 14px;
        `;
        authNotice.innerHTML = `
            <span>Вже замовляли у нас? Увійдіть до кабінету для швидкого оформлення.</span>
            <a href="login.html" style="background: #2ecc71; color: white; padding: 6px 14px; text-decoration: none; border-radius: 6px; font-weight: 600;">Увійти</a>
        `;
        checkoutSection.parentNode.insertBefore(authNotice, checkoutSection);
    }

    // Заповнюємо ПІБ тільки якщо користувач авторизований
    if (fullnameInput) {
        if (savedUser) {
            fullnameInput.value = savedUser;
        } else {
            fullnameInput.value = '';
            fullnameInput.placeholder = "Ваше ПІБ";
        }
    }

    // Універсальна функція для спливаючих сповіщень
    function showNotification(message, isError = true) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background-color: ${isError ? '#e74c3c' : '#2ecc71'};
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                font-size: 14px;
                font-weight: 500;
                z-index: 10000;
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.3s ease;
            `;
            document.body.appendChild(toast);
        }

        toast.style.backgroundColor = isError ? '#e74c3c' : '#2ecc71';
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
        }, 3500);
    }

    // Рендер товарів у блок замовлення
    function renderOrderSummary() {
        if (!orderItemsList || !orderTotalPrice) return;

        orderItemsList.innerHTML = '';

        if (cart.length === 0) {
            orderItemsList.innerHTML = '<p class="cart-empty-msg" style="color:#888; padding: 10px 0;">Ваш кошик порожній</p>';
            orderTotalPrice.textContent = '0 ₴';
            return;
        }

        let totalSum = 0;

        cart.forEach(item => {
            const price = parseFloat(item.price) || 0;
            const quantity = parseInt(item.quantity) || 1;
            totalSum += price * quantity;

            let imgSrc = item.imgSrc || item.img || '';
            if (!imgSrc || imgSrc.includes('undefined')) {
                imgSrc = 'https://via.placeholder.com/60?text=No+Img';
            }

            const itemEl = document.createElement('div');
            itemEl.classList.add('order-item');
            itemEl.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 15px; padding-bottom: 12px; border-bottom: 1px solid #eee;';
            
            itemEl.innerHTML = `
                <img src="${imgSrc}" alt="${item.title}" style="width: 60px; height: 60px; object-fit: contain; border-radius: 6px; border: 1px solid #f0f0f0; background: #fff;">
                <div class="order-item-details" style="flex: 1;">
                    <div class="order-item-title" style="font-weight: 600; font-size: 14px; color: #333;">${item.title}</div>
                    <div class="order-item-qty" style="font-size: 12px; color: #666; margin-top: 2px;">
                        ${quantity} шт. × ${price.toLocaleString('uk-UA')} ₴
                    </div>
                </div>
                <div class="order-item-price" style="font-weight: 600; font-size: 14px; color: #2ecc71;">
                    ${(price * quantity).toLocaleString('uk-UA')} ₴
                </div>
            `;
            orderItemsList.appendChild(itemEl);
        });

        orderTotalPrice.textContent = `${totalSum.toLocaleString('uk-UA')} ₴`;
    }

    // Перевірка при відправці форми
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', (e) => {
            e.preventDefault();

            if (cart.length === 0) {
                showNotification('Кошик порожній! Додайте товари для оформлення.', true);
                return;
            }

            const fullName = fullnameInput ? fullnameInput.value.trim() : '';
            const phone = phoneInput ? phoneInput.value.trim() : '';
            const email = emailInput ? emailInput.value.trim() : '';
            const city = cityInput ? cityInput.value.trim() : '';
            const address = addressInput ? addressInput.value.trim() : '';

            // 1. Перевірка ПІБ (не повинно містити цифр і бути мінімум з 3 символів)
            const hasNumbersInName = /\d/.test(fullName);
            if (!fullName || fullName.length < 3 || hasNumbersInName) {
                showNotification('❌ Введіть коректне ПІБ (тільки букви, без цифр)!', true);
                if (fullnameInput) fullnameInput.focus();
                return;
            }

            // 2. Перевірка телефону (очищаємо від зайвих символів, перевіряємо довжину)
            const phoneDigits = phone.replace(/\D/g, '');
            if (!phone || phoneDigits.length < 10) {
                showNotification('❌ Введіть коректний номер телефону (мінімум 10 цифр)!', true);
                if (phoneInput) phoneInput.focus();
                return;
            }

            // 3. Перевірка Email (перевіряємо наявність символу "@")
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!email || !emailRegex.test(email)) {
                showNotification('❌ Введіть коректну електронну пошту (обов’язково з "@")!', true);
                if (emailInput) emailInput.focus();
                return;
            }

            // 4. Перевірка міста (без цифр)
            const hasNumbersInCity = /\d/.test(city);
            if (!city || city.length < 2 || hasNumbersInCity) {
                showNotification('❌ Вкажіть коректне місто доставки (без цифр)!', true);
                if (cityInput) cityInput.focus();
                return;
            }

            // 5. Перевірка адреси
            if (!address) {
                showNotification('❌ Вкажіть відділення або адресу доставки!', true);
                if (addressInput) addressInput.focus();
                return;
            }

            // Якщо всі перевірки пройдені успішно
            showNotification(`Дякуємо за замовлення, ${fullName}! Менеджер зв'яжеться з вами.`, false);

            localStorage.removeItem('techstore_cart');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
        });
    }

    renderOrderSummary();
});