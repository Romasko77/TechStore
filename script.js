document.addEventListener('DOMContentLoaded', () => {
    // Елементи кошика
    const cartModal = document.getElementById('cart-modal');
    const openCartBtn = document.getElementById('open-cart-btn');
    const closeCartBtn = document.getElementById('close-cart-btn');
    const cartItemsContainer = document.getElementById('cart-items-container');
    const cartTotalPrice = document.getElementById('cart-total-price');
    const cartCount = document.getElementById('cart-count');
    const checkoutBtn = document.querySelector('.checkout-btn');

    // Елементи модального вікна товару
    const productModal = document.getElementById('product-modal');
    const closeProductModalBtn = document.getElementById('close-product-modal');
    const modalImg = document.getElementById('modal-product-img');
    const modalTitle = document.getElementById('modal-product-title');
    const modalSpecs = document.getElementById('modal-product-specs');
    const modalPrice = document.getElementById('modal-product-price');
    const modalAddToCartBtn = document.getElementById('modal-add-to-cart-btn');

    // Опції, характеристики та схожі товари
    const modalColorGroup = document.getElementById('modal-color-group');
    const modalColorList = document.getElementById('modal-color-list');
    const modalMemoryGroup = document.getElementById('modal-memory-group');
    const modalMemoryList = document.getElementById('modal-memory-list');
    const modalTechSpecs = document.getElementById('modal-tech-specs');
    const modalSimilarProducts = document.getElementById('modal-similar-products');

    // Фільтри та сортування
    const categoryCheckboxes = document.querySelectorAll('.category-checkbox');
    const priceMinInput = document.getElementById('price-min');
    const priceMaxInput = document.getElementById('price-max');
    const applyFiltersBtn = document.getElementById('apply-filters-btn');
    const sortSelect = document.getElementById('sort-select');
    const productGrid = document.getElementById('product-grid');
    const noProductsMsg = document.getElementById('no-products');

    // Пошук
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    // Обране
    const wishlistCount = document.getElementById('wishlist-count');

    // Авторизація та Вихід
    const userNameDisplay = document.getElementById('user-name-display');
    const userBtn = document.getElementById('user-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const activeUser = localStorage.getItem('techstore_user');

    if (activeUser) {
        if (userNameDisplay) userNameDisplay.textContent = activeUser;
        if (userBtn) userBtn.href = '#';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
    } else {
        if (userNameDisplay) userNameDisplay.textContent = 'Увійти';
        if (userBtn) userBtn.href = 'login.html';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('techstore_user');
            showNotification('Ви успішно вийшли з облікового запису');
            setTimeout(() => window.location.reload(), 1000);
        });
    }

    // Стан кошика, обраного та відгуків
    let cart = JSON.parse(localStorage.getItem('techstore_cart')) || [];
    let wishlist = JSON.parse(localStorage.getItem('techstore_wishlist')) || [];
    let reviewsData = JSON.parse(localStorage.getItem('techstore_reviews')) || {};
    let activeCardForCart = null;
    let currentRating = 5;

    // Опції та характеристики за категоріями
    const categoryOptions = {
        laptops: {
            colors: [{ name: 'Чорний', hex: '#000' }, { name: 'Сріблястий', hex: '#c0c0c0' }],
            memories: [
                { text: '512 ГБ SSD', priceOffset: 0 },
                { text: '1 ТБ SSD', priceOffset: 3000 },
                { text: '2 ТБ SSD', priceOffset: 7000 }
            ],
            techSpecs: [
                { key: 'Гарантія', val: '24 місяці' },
                { key: 'ОС', val: 'Windows 11 Home' },
                { key: 'Матеріал корпусу', val: 'Алюміній / Пластик' }
            ]
        },
        gpu: {
            colors: [{ name: 'Чорний', hex: '#222' }],
            memories: [
                { text: '8 ГБ', priceOffset: 0 },
                { text: '12 ГБ', priceOffset: 4000 },
                { text: '16 ГБ', priceOffset: 8500 }
            ],
            techSpecs: [
                { key: 'Інтерфейс', val: 'PCI-Express 4.0' },
                { key: 'Охолодження', val: 'Активне (3 вентилятори)' }
            ]
        },
        monitors: {
            colors: [{ name: 'Чорний', hex: '#111' }, { name: 'Білий', hex: '#fff' }],
            memories: [],
            techSpecs: [
                { key: 'Частота оновлення', val: '165 Гц' },
                { key: 'Тип матриці', val: 'IPS / VA' }
            ]
        },
        default: {
            colors: [{ name: 'Чорний', hex: '#000' }, { name: 'Білий', hex: '#fff' }],
            memories: [],
            techSpecs: [
                { key: 'Гарантія', val: '12 місяців' },
                { key: 'Країна виробник', val: 'Китай' }
            ]
        }
    };

    function getCardImageSrc(card) {
        const imgEl = card.querySelector('img');
        if (!imgEl) return '';
        return imgEl.getAttribute('src') || imgEl.src || '';
    }

    // 1. ВІДКРИТТЯ КАРТКИ ТОВАРУ У МОДАЛЬНОМУ ВІКНІ
    function openProductModal(card) {
        if (!productModal) return;
        
        activeCardForCart = card;
        const id = card.dataset.id;
        const category = card.dataset.category || 'default';
        const titleEl = card.querySelector('.product-title');
        const specsEl = card.querySelector('.product-specs');
        const priceEl = card.querySelector('.price');

        const basePrice = parseFloat(card.dataset.price) || parseFloat(priceEl?.textContent.replace(/\s/g, '').replace('₴', '')) || 0;

        if (modalTitle && titleEl) modalTitle.textContent = titleEl.textContent;
        if (modalSpecs) modalSpecs.textContent = specsEl ? specsEl.textContent : '';
        if (modalImg) modalImg.src = getCardImageSrc(card);

        const options = categoryOptions[category] || categoryOptions.default;

        function updateTotalPrice(additionalPrice = 0) {
            const finalPrice = basePrice + additionalPrice;
            if (modalPrice) {
                modalPrice.textContent = `${finalPrice.toLocaleString('uk-UA')} ₴`;
            }
        }

        updateTotalPrice(0);

        if (modalColorList) {
            modalColorList.innerHTML = '';
            if (options.colors && options.colors.length > 0) {
                if (modalColorGroup) modalColorGroup.style.display = 'block';
                options.colors.forEach((color, idx) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = `option-btn ${idx === 0 ? 'active' : ''}`;
                    btn.innerHTML = `<span class="color-dot" style="background:${color.hex}"></span> ${color.name}`;
                    btn.onclick = () => {
                        modalColorList.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                    };
                    modalColorList.appendChild(btn);
                });
            } else if (modalColorGroup) {
                modalColorGroup.style.display = 'none';
            }
        }

        if (modalMemoryList) {
            modalMemoryList.innerHTML = '';
            if (options.memories && options.memories.length > 0) {
                if (modalMemoryGroup) modalMemoryGroup.style.display = 'block';
                options.memories.forEach((mem, idx) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = `option-btn ${idx === 0 ? 'active' : ''}`;
                    btn.textContent = mem.text;
                    
                    if (idx === 0) updateTotalPrice(mem.priceOffset);

                    btn.onclick = () => {
                        modalMemoryList.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        updateTotalPrice(mem.priceOffset);
                    };
                    modalMemoryList.appendChild(btn);
                });
            } else if (modalMemoryGroup) {
                modalMemoryGroup.style.display = 'none';
            }
        }

        if (modalTechSpecs) {
            modalTechSpecs.innerHTML = '';
            if (options.techSpecs) {
                options.techSpecs.forEach(spec => {
                    const li = document.createElement('li');
                    li.innerHTML = `<span>${spec.key}</span> <strong>${spec.val}</strong>`;
                    modalTechSpecs.appendChild(li);
                });
            }
        }

        renderSimilarProducts(category, id);
        renderReviews(id);

        productModal.classList.add('active');
    }

    function renderSimilarProducts(category, currentId) {
        if (!modalSimilarProducts) return;
        modalSimilarProducts.innerHTML = '';
        const allCards = Array.from(document.querySelectorAll('.product-card'));
        
        let similars = allCards.filter(c => c.dataset.category === category && c.dataset.id !== currentId);
        if (similars.length < 3) {
            similars = allCards.filter(c => c.dataset.id !== currentId);
        }

        similars.slice(0, 4).forEach(simCard => {
            const title = simCard.querySelector('.product-title')?.textContent || '';
            const price = simCard.querySelector('.price')?.textContent || '';
            const img = getCardImageSrc(simCard);

            const div = document.createElement('div');
            div.className = 'similar-card';
            div.innerHTML = `
                <img src="${img}" alt="${title}">
                <h5>${title}</h5>
                <div class="similar-price">${price}</div>
            `;
            div.onclick = () => openProductModal(simCard);
            modalSimilarProducts.appendChild(div);
        });
    }

    document.addEventListener('click', (e) => {
        const card = e.target.closest('.product-card');
        if (!card) return;

        if (e.target.closest('.add-to-cart-btn') || e.target.closest('.buy-btn')) {
            addToCartFromCard(card);
            return;
        }

        if (e.target.closest('.like-btn')) return;

        openProductModal(card);
    });

    if (closeProductModalBtn) {
        closeProductModalBtn.addEventListener('click', () => productModal.classList.remove('active'));
    }

    if (productModal) {
        productModal.addEventListener('click', (e) => {
            if (e.target === productModal) productModal.classList.remove('active');
        });
    }

    if (modalAddToCartBtn) {
        modalAddToCartBtn.addEventListener('click', () => {
            if (activeCardForCart) {
                addToCartFromCard(activeCardForCart);
                productModal.classList.remove('active');
            }
        });
    }

    // ВІДГУКИ ДО ТОВАРІВ
    function renderReviews(productId) {
        let reviewsContainer = document.getElementById('modal-reviews-section');
        
        if (!reviewsContainer) {
            reviewsContainer = document.createElement('div');
            reviewsContainer.id = 'modal-reviews-section';
            reviewsContainer.style.cssText = `
                margin-top: 25px; 
                border-top: 1px solid #eee; 
                padding: 15px; 
                background: #fff; 
                border-radius: 8px;
            `;
            const targetContainer = productModal.querySelector('.modal-content') 
                || productModal.querySelector('.modal-body') 
                || productModal;
            targetContainer.appendChild(reviewsContainer);
        }

        const productReviews = reviewsData[productId] || [
            { name: 'Олександр', rating: 5, text: 'Чудовий товар, відповідає всім характеристикам!', date: '10.09.2026' }
        ];

        let html = `
            <h4 style="font-size:16px; margin-bottom:12px;">Відгуки покупців (${productReviews.length})</h4>
            <div id="reviews-list" style="max-height: 180px; overflow-y: auto; margin-bottom: 15px; padding-right: 5px;">
        `;

        productReviews.forEach(r => {
            const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
            html += `
                <div style="background:#f9f9f9; padding:8px 12px; border-radius:6px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#555;">
                        <strong>${r.name}</strong>
                        <span style="color:#f39c12;">${stars}</span>
                        <span style="color:#999; font-size:11px;">${r.date}</span>
                    </div>
                    <p style="font-size:13px; margin:4px 0 0 0; color:#333;">${r.text}</p>
                </div>
            `;
        });

        html += `
            </div>
            <div style="background:#f1f2f6; padding:12px; border-radius:8px;">
                <h5 style="margin:0 0 8px 0; font-size:14px;">Залишити відгук</h5>
                <div style="display:flex; gap:5px; margin-bottom:8px; cursor:pointer;" id="star-rating-select">
                    <span data-star="1" style="font-size:18px; color:#f39c12;">★</span>
                    <span data-star="2" style="font-size:18px; color:#f39c12;">★</span>
                    <span data-star="3" style="font-size:18px; color:#f39c12;">★</span>
                    <span data-star="4" style="font-size:18px; color:#f39c12;">★</span>
                    <span data-star="5" style="font-size:18px; color:#f39c12;">★</span>
                </div>
                <input type="text" id="review-user-name" placeholder="Ваше ім'я" value="${activeUser || ''}" style="width:100%; padding:6px; margin-bottom:6px; border:1px solid #ccc; border-radius:4px; font-size:12px; box-sizing:border-box;">
                <textarea id="review-user-text" placeholder="Напишіть свій відгук..." style="width:100%; padding:6px; height:50px; border:1px solid #ccc; border-radius:4px; font-size:12px; resize:none; box-sizing:border-box;"></textarea>
                <button id="submit-review-btn" style="margin-top:6px; background:#2ecc71; color:white; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; font-size:12px; width:100%;">Надіслати відгук</button>
            </div>
        `;

        reviewsContainer.innerHTML = html;

        currentRating = 5;
        const starSpans = reviewsContainer.querySelectorAll('#star-rating-select span');
        starSpans.forEach(span => {
            span.addEventListener('click', (e) => {
                currentRating = parseInt(e.target.dataset.star);
                starSpans.forEach((s, idx) => {
                    s.style.color = idx < currentRating ? '#f39c12' : '#ccc';
                });
            });
        });

        const submitBtn = document.getElementById('submit-review-btn');
        if (submitBtn) {
            submitBtn.onclick = () => {
                const nameInput = document.getElementById('review-user-name').value.trim();
                const textInput = document.getElementById('review-user-text').value.trim();

                if (!nameInput || !textInput) {
                    showNotification('Будь ласка, заповніть всі поля!');
                    return;
                }

                const today = new Date();
                const dateStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;

                const newReview = {
                    name: nameInput,
                    rating: currentRating,
                    text: textInput,
                    date: dateStr
                };

                if (!reviewsData[productId]) {
                    reviewsData[productId] = [...productReviews];
                }

                reviewsData[productId].unshift(newReview);
                localStorage.setItem('techstore_reviews', JSON.stringify(reviewsData));
                renderReviews(productId);
                showNotification('Дякуємо за ваш відгук!');
            };
        }
    }

    // 2. ФІЛЬТРАЦІЯ ТА СОРТУВАННЯ
    function filterAndSortProducts() {
        if (!productGrid) return;

        const selectedCategories = Array.from(categoryCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        const minPrice = parseFloat(priceMinInput?.value) || 0;
        const maxPrice = parseFloat(priceMaxInput?.value) || Infinity;

        const cards = Array.from(productGrid.querySelectorAll('.product-card'));
        let visibleCount = 0;

        cards.forEach(card => {
            const category = card.dataset.category;
            const price = parseFloat(card.dataset.price);

            const matchCategory = selectedCategories.length === 0 || selectedCategories.includes(category);
            const matchPrice = price >= minPrice && price <= maxPrice;

            if (matchCategory && matchPrice) {
                card.style.display = 'flex';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });

        if (noProductsMsg) {
            noProductsMsg.style.display = visibleCount === 0 ? 'block' : 'none';
        }

        const sortValue = sortSelect?.value;
        if (sortValue && sortValue !== 'default') {
            const visibleCards = cards.filter(card => card.style.display !== 'none');
            visibleCards.sort((a, b) => {
                const priceA = parseFloat(a.dataset.price);
                const priceB = parseFloat(b.dataset.price);
                return sortValue === 'price-asc' ? priceA - priceB : priceB - priceA;
            });

            visibleCards.forEach(card => productGrid.appendChild(card));
        }
    }

    categoryCheckboxes.forEach(cb => cb.addEventListener('change', filterAndSortProducts));
    if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', filterAndSortProducts);
    if (sortSelect) sortSelect.addEventListener('change', filterAndSortProducts);

    // 3. ПОШУК
    if (searchInput && searchResults) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            searchResults.innerHTML = '';

            if (query.length === 0) {
                searchResults.style.display = 'none';
                return;
            }

            const cards = Array.from(document.querySelectorAll('.product-card'));
            const matches = cards.filter(card => {
                const title = card.querySelector('.product-title')?.textContent.toLowerCase() || '';
                return title.includes(query);
            });

            if (matches.length > 0) {
                matches.forEach(card => {
                    const id = card.dataset.id;
                    const title = card.querySelector('.product-title')?.textContent || '';
                    const price = card.querySelector('.price')?.textContent || '';
                    const img = getCardImageSrc(card);

                    const itemHTML = `
                        <div class="search-item" data-id="${id}" style="display:flex; align-items:center; gap:10px; padding:8px; cursor:pointer; border-bottom:1px solid #eee;">
                            <img src="${img}" style="width:35px; height:35px; object-fit:contain;">
                            <div style="flex:1;">
                                <div style="font-size:13px; font-weight:600; color:#333;">${title}</div>
                                <div style="font-size:12px; color:#2ecc71;">${price}</div>
                            </div>
                        </div>
                    `;
                    searchResults.insertAdjacentHTML('beforeend', itemHTML);
                });

                searchResults.querySelectorAll('.search-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const targetCard = document.querySelector(`.product-card[data-id="${item.dataset.id}"]`);
                        if (targetCard) openProductModal(targetCard);
                        searchResults.style.display = 'none';
                        searchInput.value = '';
                    });
                });

                searchResults.style.display = 'block';
            } else {
                searchResults.innerHTML = '<div style="padding:10px; font-size:13px; color:#888;">Нічого не знайдено</div>';
                searchResults.style.display = 'block';
            }
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });
    }

    // 4. КОШИК
    if (openCartBtn) {
        openCartBtn.addEventListener('click', () => {
            renderCart();
            cartModal.classList.add('active');
        });
    }

    if (closeCartBtn) {
        closeCartBtn.addEventListener('click', () => cartModal.classList.remove('active'));
    }

    if (cartModal) {
        cartModal.addEventListener('click', (e) => {
            if (e.target === cartModal) cartModal.classList.remove('active');
        });
    }

    function addToCartFromCard(card) {
        const id = card.dataset.id;
        const title = card.querySelector('.product-title')?.textContent || '';
        const imgSrc = getCardImageSrc(card);

        let selectedColor = null;
        let selectedMemory = null;
        let price = parseFloat(card.dataset.price) || parseFloat(card.querySelector('.price')?.textContent.replace(/\s/g, '').replace('₴', '')) || 0;

        if (productModal && productModal.classList.contains('active')) {
            const activeColorBtn = document.querySelector('#modal-color-list .option-btn.active');
            if (activeColorBtn) selectedColor = activeColorBtn.textContent.trim();

            const activeMemoryBtn = document.querySelector('#modal-memory-list .option-btn.active');
            if (activeMemoryBtn) selectedMemory = activeMemoryBtn.textContent.trim();

            if (modalPrice) {
                const modalPriceNum = parseFloat(modalPrice.textContent.replace(/\s/g, '').replace('₴', ''));
                if (!isNaN(modalPriceNum)) price = modalPriceNum;
            }
        }

        const itemKey = `${id}_${selectedColor || 'def'}_${selectedMemory || 'def'}`;
        const existingItem = cart.find(item => item.key === itemKey);

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cart.push({
                key: itemKey,
                id: id,
                title: title,
                price: price,
                imgSrc: imgSrc,
                color: selectedColor,
                memory: selectedMemory,
                quantity: 1
            });
        }

        saveCart();
        updateCartCount();
        showNotification('Товар додано до кошика!');
    }

    function saveCart() {
        localStorage.setItem('techstore_cart', JSON.stringify(cart));
    }

    function updateCartCount() {
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        if (cartCount) cartCount.textContent = totalItems;
    }

    function renderCart() {
        if (!cartItemsContainer) return;
        cartItemsContainer.innerHTML = '';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p style="text-align:center; padding: 20px; color:#888;">Ваш кошик порожній</p>';
            if (cartTotalPrice) cartTotalPrice.textContent = '0 ₴';
            return;
        }

        let total = 0;

        cart.forEach((item, index) => {
            if (!item.key) {
                item.key = `${item.id}_${item.color || 'def'}_${item.memory || 'def'}`;
            }

            total += item.price * item.quantity;

            const details = [];
            if (item.color) details.push(`Колір: ${item.color}`);
            if (item.memory) details.push(`Пам'ять: ${item.memory}`);
            const detailsText = details.join(' | ');

            const cartItemHTML = `
                <div class="cart-item" data-id="${item.id}" data-key="${item.key}" data-index="${index}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eee;">
                    <div class="cart-item-info" style="display:flex; align-items:center; cursor:pointer; flex:1;">
                        <img src="${item.imgSrc}" alt="${item.title}" style="width: 50px; height: 50px; object-fit: contain;" onerror="this.onerror=null; this.src='https://via.placeholder.com/50?text=No+Img';">
                        <div style="margin-left: 10px;">
                            <h4 style="font-size: 14px; margin:0;" class="cart-item-title">${item.title}</h4>
                            ${detailsText ? `<div style="font-size: 11px; color: #666; margin-top: 2px;">${detailsText}</div>` : ''}
                            <span style="color:#2ecc71; font-weight:600; font-size:13px;">${item.price.toLocaleString('uk-UA')} ₴</span>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="decrease-btn" style="padding: 2px 8px; cursor:pointer;">-</button>
                        <span>${item.quantity}</span>
                        <button class="increase-btn" style="padding: 2px 8px; cursor:pointer;">+</button>
                        <button class="remove-btn" style="color:red; background:none; border:none; margin-left:8px; cursor:pointer; font-size: 16px;">🗑</button>
                    </div>
                </div>
            `;
            cartItemsContainer.insertAdjacentHTML('beforeend', cartItemHTML);
        });

        if (cartTotalPrice) cartTotalPrice.textContent = `${total.toLocaleString('uk-UA')} ₴`;
    }

    if (cartItemsContainer) {
        cartItemsContainer.addEventListener('click', (e) => {
            const itemElement = e.target.closest('.cart-item');
            if (!itemElement) return;

            const index = parseInt(itemElement.dataset.index);

            if (e.target.closest('.cart-item-info')) {
                const id = itemElement.dataset.id;
                const originalCard = document.querySelector(`.product-card[data-id="${id}"]`);
                if (originalCard) {
                    if (cartModal) cartModal.classList.remove('active');
                    openProductModal(originalCard);
                }
            } else if (e.target.closest('.increase-btn')) {
                if (cart[index]) {
                    cart[index].quantity++;
                    saveCart();
                    renderCart();
                    updateCartCount();
                }
            } else if (e.target.closest('.decrease-btn')) {
                if (cart[index]) {
                    if (cart[index].quantity > 1) {
                        cart[index].quantity--;
                    } else {
                        cart.splice(index, 1);
                    }
                    saveCart();
                    renderCart();
                    updateCartCount();
                }
            } else if (e.target.closest('.remove-btn')) {
                if (cart[index] !== undefined) {
                    cart.splice(index, 1);
                    saveCart();
                    renderCart();
                    updateCartCount();
                }
            }
        });
    }

    // 5. КАСТОМНІ СПОВІЩЕННЯ ТА ОФОРМЛЕННЯ
    function showNotification(message) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background-color: #2ecc71;
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

        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
        }, 3000);
    }

    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            if (cart.length === 0) {
                showNotification('Ваш кошик порожній! Додайте товари перед оформленням.');
                return;
            }
            window.location.href = 'checkout.html';
        });
    }

    // 6. ОБРАНЕ (ЛАЙКИ)
    function updateWishlistCount() {
        if (wishlistCount) wishlistCount.textContent = wishlist.length;
    }

    document.querySelectorAll('.like-btn').forEach(btn => {
        const card = btn.closest('.product-card');
        const cardId = card.dataset.id;

        const existingItem = wishlist.find(item => String(item.id) === String(cardId));
        if (existingItem) {
            btn.classList.add('active');
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-heart';
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();

            if (wishlist.find(item => String(item.id) === String(cardId))) {
                wishlist = wishlist.filter(item => String(item.id) !== String(cardId));
                btn.classList.remove('active');
                const icon = btn.querySelector('i');
                if (icon) icon.className = 'fa-regular fa-heart';
            } else {
                const newItem = {
                    id: cardId,
                    title: card.querySelector('.product-title')?.textContent || '',
                    price: parseFloat(card.querySelector('.price')?.textContent.replace(/[^\d]/g, '')) || 0,
                    img: card.querySelector('img')?.src || ''
                };
                wishlist.push(newItem);
                btn.classList.add('active');
                const icon = btn.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-heart';
            }

            localStorage.setItem('techstore_wishlist', JSON.stringify(wishlist));
            updateWishlistCount();
        });
    });

    // 7. Повноцінний чат із сервером Node.js, автовідповідями та сповіщенням про менеджера
    function initBotAssistant() {
        if (document.getElementById('tech-bot-widget')) return;

        // Генерація унікального ID користувача
        let currentUserId = localStorage.getItem('chat_user_id');
        if (!currentUserId) {
            currentUserId = 'user_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chat_user_id', currentUserId);
        }

        const botContainer = document.createElement('div');
        botContainer.id = 'tech-bot-widget';
        botContainer.innerHTML = `
            <button id="tech-bot-toggle" style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #2ecc71;
                color: white;
                border: none;
                border-radius: 50%;
                width: 55px;
                height: 55px;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
            ">💬</button>

            <div id="tech-bot-window" style="
                position: fixed;
                bottom: 85px;
                right: 20px;
                width: 320px;
                height: 420px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                display: none;
                flex-direction: column;
                z-index: 9999;
                overflow: hidden;
                font-family: sans-serif;
            ">
                <div style="background: #2ecc71; color: white; padding: 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                    <span>Бот-Консультант TechStore</span>
                    <button id="tech-bot-close" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer;">✕</button>
                </div>
                
                <div id="tech-bot-messages" style="flex: 1; padding: 10px; overflow-y: auto; font-size: 13px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="background: #f1f2f6; color: #333; padding: 8px 12px; border-radius: 8px; max-width: 80%; align-self: flex-start;">
                        Вітаю! 👋 Я онлайн-помічник TechStore. Чим можу допомогти?
                    </div>
                </div>

                <div style="padding: 10px; border-top: 1px solid #eee; display: flex; gap: 5px;">
                    <input type="text" id="tech-bot-input" placeholder="Запитайте щось..." style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; outline: none;">
                    <button id="tech-bot-send" style="background: #2ecc71; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">➤</button>
                </div>
            </div>
        `;

        document.body.appendChild(botContainer);

        const toggleBtn = document.getElementById('tech-bot-toggle');
        const closeBtn = document.getElementById('tech-bot-close');
        const botWindow = document.getElementById('tech-bot-window');
        const sendBtn = document.getElementById('tech-bot-send');
        const input = document.getElementById('tech-bot-input');
        const messages = document.getElementById('tech-bot-messages');

        if (toggleBtn && botWindow) {
            toggleBtn.addEventListener('click', () => {
                botWindow.style.display = (botWindow.style.display === 'none' || botWindow.style.display === '') ? 'flex' : 'none';
            });
        }

        if (closeBtn && botWindow) {
            closeBtn.addEventListener('click', () => {
                botWindow.style.display = 'none';
            });
        }

        function addMessage(text, isUser = false) {
            if (!messages) return;
            const msgDiv = document.createElement('div');
            msgDiv.style.cssText = `
                padding: 8px 12px;
                border-radius: 8px;
                max-width: 80%;
                word-wrap: break-word;
                ${isUser ? 'background: #2ecc71; color: white; align-self: flex-end;' : 'background: #f1f2f6; color: #333; align-self: flex-start;'}
            `;
            msgDiv.textContent = text;
            messages.appendChild(msgDiv);
            messages.scrollTop = messages.scrollHeight;
        }

        // База даних сталих відповідей на ключові слова
        const autoAnswers = {
            'привіт': 'Вітаю! 👋 Чим можу допомогти з вибором техніки TechStore?',
            'добрий день': 'Доброго дня! Раді бачити вас у TechStore. Чим можемо допомогти?',
            'гарантія': '🛡️ На всі товари в TechStore надається офіційна гарантія від виробника від 12 до 36 місяців!',
            'доставка': '🚚 Доставка здійснюється Новою Поштою по всій Україні протягом 1-3 днів. Також є самовивіз.',
            'оплата': '💳 Ви можете оплатити замовлення банківською картою на сайті, Google Pay, Apple Pay або готівкою при отриманні.',
            'кредит': '💰 У нас є вигідна розстрочка та кредит від провідних банків (ПриватБанк, Монобанк) до 10 місяців під 0%!',
            'розстрочка': '💳 Ви можете оформити товар у розстрочку до 10 місяців без переплат через наш сайт.',
            'контакти': '📞 Наш телефон: 0 800 330 000. Працюємо щодня з 9:00 до 20:00.'
        };

        // Відправка повідомлення на локальний Node.js сервер
        async function sendMessageToServer(userMessage) {
            let userName = 'Анонімний користувач';
            try {
                userName = localStorage.getItem('techstore_user') || 'Анонімний користувач';
            } catch (e) {}

            try {
               await fetch('/api/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: currentUserId,
                        userName: userName,
                        text: userMessage
                    })
                });
            } catch (err) {
                console.error('Помилка надсилання на сервер:', err);
            }
        }

        // Періодична перевірка відповідей від Telegram через ваш сервер
        async function checkReplies() {
            try {
                const response = await fetch(`http://localhost:3000/api/get-replies/${currentUserId}`);
                const data = await response.json();

                if (data.replies && data.replies.length > 0) {
                    data.replies.forEach(replyText => {
                        addMessage(replyText, false);
                    });
                }
            } catch (e) {
                // Сервер може бути тимчасово недоступний
            }
        }

        function handleSend() {
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;

            // Відображаємо повідомлення користувача в чаті
            addMessage(text, true);
            input.value = '';

            const lowerText = text.toLowerCase();
            let matched = false;

            // Перевіряємо, чи є ключові слова в повідомленні користувача
            for (let key in autoAnswers) {
                if (lowerText.includes(key)) {
                    matched = true;
                    // Імітуємо швидку відповідь бота через 400 мс
                    setTimeout(() => {
                        addMessage(autoAnswers[key], false);
                    }, 400);
                    break;
                }
            }

            // Якщо ключового слова немає — відправляємо менеджеру в Telegram
            // Та одразу виводимо користувачу підтвердження у віджеті чату
            if (!matched) {
                sendMessageToServer(text);

                setTimeout(() => {
                    addMessage("💬 Дякуємо за запитання! Ваше повідомлення передано менеджеру, і він зв'яжеться з вами найближчим часом.", false);
                }, 800);
            }
        }

        if (sendBtn) sendBtn.addEventListener('click', handleSend);
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleSend();
            });
        }

        // Перевіряємо наявність нових відповідей кожні 3 секунди
        setInterval(checkReplies, 3000);
    }

    // Ініціалізація додаткових функцій
    updateCartCount();
    updateWishlistCount();
    initBotAssistant();
});