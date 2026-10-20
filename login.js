document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const googleBtn = document.getElementById('google-login-btn');

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const name = email.split('@')[0];
            
            localStorage.setItem('techstore_user', name);
            window.location.href = 'index.html';
        });
    }

    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            // Можна замінити на запит ім'я або залишити дефолтний логін користувача
            const userName = prompt("Введіть ваше ім'я для входу через Google:", "");
            if (userName) {
                localStorage.setItem('techstore_user', userName);
                window.location.href = 'index.html';
            }
        });
    }
});