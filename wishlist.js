document.addEventListener('DOMContentLoaded', () => {
    const wishlistGrid = document.getElementById('wishlist-grid');
    const noWishlistMsg = document.getElementById('no-wishlist');

    let wishlist = JSON.parse(localStorage.getItem('techstore_wishlist')) || [];
    let cart = JSON.parse(localStorage.getItem('techstore_cart')) || [];

    function saveWishlist() {
        localStorage.setItem('techstore_wishlist', JSON.stringify(wishlist));
    }

    function saveCart() {
        localStorage.setItem('techstore_cart', JSON.stringify(cart));
    }

    function renderWishlist() {
        wishlistGrid.innerHTML = '';

        if (wishlist.length === 0) {
            noWishlistMsg.style.display = 'block';
            return;
        }

        noWishlistMsg.style.display = 'none';

        wishlist.forEach(item => {
            const card = document.createElement('div');
            card.classList.add('product-card');
            card.setAttribute('data-id', item.id);

            card.innerHTML = `
                <button class="remove-wishlist-btn" data-id="${item.id}" title="Видалити з обраного">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <img src="${item.img}" alt="${item.title}">
                <h3 class="product-title">${item.title}</h3>
                <p class="product-specs">${item.specs || ''}</p>
                <div class="product-price-block">
                    <span class="price">${item.price.toLocaleString()} ₴</span>
                    <button class="buy-btn add-to-cart-from-wishlist"><i class="fa-solid fa-cart-shopping"></i></button>
                </div>
            `;

            wishlistGrid.appendChild(card);
        });
    }

    // Видалення з обраного або додавання в кошик
    wishlistGrid.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-wishlist-btn');
        const cartBtn = e.target.closest('.add-to-cart-from-wishlist');

        if (removeBtn) {
            const id = removeBtn.getAttribute('data-id');
            wishlist = wishlist.filter(item => item.id !== id);
            saveWishlist();
            renderWishlist();
        }

        if (cartBtn) {
            const card = cartBtn.closest('.product-card');
            const id = card.getAttribute('data-id');
            const item = wishlist.find(i => i.id === id);

            if (item) {
                const existingItem = cart.find(c => c.id === id);
                if (existingItem) {
                    existingItem.quantity += 1;
                } else {
                    cart.push({ id: item.id, title: item.title, price: item.price, img: item.img, quantity: 1 });
                }
                saveCart();
                alert('Товар додано в кошик!');
            }
        }
    });

    renderWishlist();
});