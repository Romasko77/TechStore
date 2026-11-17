const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config(); // Підключаємо завантаження змінних середовища з .env файлу

// Імпортуємо офіційну бібліотеку Google Gen AI
const { GoogleGenAI } = require('@google/genai');

// Імпортуємо Pool для роботи з PostgreSQL (Neon)
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1); // Render стоїть за проксі, потрібно для визначення IP
app.use(cors());
app.use(express.json());

// === ПІДКЛЮЧЕННЯ ДО БАЗИ ДАНИХ NEON (PostgreSQL) ===
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Визначення категорії за назвою (для товарів, у яких вона ще не задана)
function detectCategory(name) {
    const t = String(name || '').toLowerCase();
    if (t.includes('ноутбук')) return 'laptops';
    if (t.includes('відеокарта')) return 'gpu';
    if (t.includes('монітор')) return 'monitors';
    if (t.includes('клавіатура')) return 'keyboards';
    if (t.includes('миша') || t.includes('мишка')) return 'mice';
    if (t.includes('навушники') || t.includes('гарнітура')) return 'headphones';
    return 'other';
}

// Функція для автоматичного створення таблиць при запуску сервера
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                price NUMERIC(10, 2) NOT NULL,
                description TEXT,
                image_url TEXT
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                user_name VARCHAR(255),
                sender VARCHAR(50) NOT NULL, -- 'user', 'bot', 'manager'
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Зареєстровані користувачі (пароль зберігається лише у вигляді хешу)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Замовлення, склад замовлень і відгуки
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_name VARCHAR(150),
                full_name VARCHAR(150) NOT NULL,
                phone VARCHAR(40) NOT NULL,
                email VARCHAR(255) NOT NULL,
                city VARCHAR(100) NOT NULL,
                delivery_method VARCHAR(30) NOT NULL,
                address VARCHAR(300) NOT NULL,
                payment_method VARCHAR(30) NOT NULL,
                total NUMERIC(12, 2) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'new',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                title VARCHAR(255) NOT NULL,
                color VARCHAR(50),
                memory VARCHAR(50),
                unit_price NUMERIC(10, 2) NOT NULL,
                quantity INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                product_id VARCHAR(50) NOT NULL,
                author VARCHAR(100) NOT NULL,
                rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
        `);
        // Зв'язок замовлення з акаунтом (для гостей залишається порожнім)
        await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
        await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(50)');
        const missing = await pool.query('SELECT id, name FROM products WHERE category IS NULL');
        for (const row of missing.rows) {
            await pool.query('UPDATE products SET category = $1 WHERE id = $2', [detectCategory(row.name), row.id]);
        }
        console.log('✅ Таблиці успішно створено або перевірено в базі даних Neon!');
    } catch (err) {
        console.error('❌ Помилка створення таблиць у БД:', err.message);
    }
}

// Викликаємо функцію створення таблиць
initDB();

// === ІНІЦІАЛІЗАЦІЯ GEMINI AI ===
const ai = new GoogleGenAI();

// === РОЗДАЧА СТАТИЧНИХ ФАЙЛІВ ТА ГОЛОВНОЇ СТОРІНКИ ===
app.use((req, res, next) => {
    if (/^\/(server\.js|package(-lock)?\.json)$/i.test(req.path)) return res.status(404).end();
    next();
});
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === ЕНДПОІНТ ДЛЯ ОТРИМАННЯ ТОВАРІВ З БАЗИ ДАНИХ ===
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Помилка отримання товарів з БД:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// === АДМІН-ПАНЕЛЬ ===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_CATEGORIES = ['laptops', 'gpu', 'monitors', 'keyboards', 'mice', 'headphones'];
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, resetAt }

const signToken = (expires) => crypto.createHmac('sha256', ADMIN_PASSWORD).update(String(expires)).digest('hex');

function verifyAdminToken(token) {
    if (!ADMIN_PASSWORD || typeof token !== 'string') return false;
    const [expires, signature] = token.split('.');
    const exp = Number(expires);
    if (!signature || !Number.isFinite(exp) || exp < Date.now()) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(signToken(expires));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    if (!verifyAdminToken(header.startsWith('Bearer ') ? header.slice(7) : '')) {
        return res.status(401).json({ error: 'Потрібен вхід' });
    }
    next();
}

app.post('/api/admin/login', (req, res) => {
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Адмінку не налаштовано: додайте ADMIN_PASSWORD у Render' });
    const now = Date.now();
    const entry = loginAttempts.get(req.ip);
    if (entry && entry.resetAt > now && entry.count >= 5) {
        return res.status(429).json({ error: 'Забагато спроб. Спробуйте через 15 хвилин' });
    }
    const given = crypto.createHash('sha256').update(String(req.body?.password || '')).digest();
    const real = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(given, real)) {
        const e = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + 15 * 60 * 1000 };
        e.count += 1;
        loginAttempts.set(req.ip, e);
        return res.status(401).json({ error: 'Невірний пароль' });
    }
    loginAttempts.delete(req.ip);
    const expires = now + TOKEN_TTL_MS;
    res.json({ token: `${expires}.${signToken(expires)}` });
});

function parseProductInput(body) {
    const name = String(body?.name ?? '').trim();
    const description = String(body?.description ?? '').trim();
    const imageUrl = String(body?.image_url ?? '').trim();
    const category = String(body?.category ?? '');
    const rawPrice = String(body?.price ?? '').trim();
    const price = Number(rawPrice);
    if (!name || name.length > 255) return { error: 'Назва: від 1 до 255 символів' };
    if (rawPrice === '' || !Number.isFinite(price) || price < 0 || price > 99999999.99) return { error: 'Ціна має бути числом від 0 до 99999999.99' };
    if (!ADMIN_CATEGORIES.includes(category)) return { error: 'Оберіть категорію зі списку' };
    if (description.length > 5000) return { error: 'Опис занадто довгий (максимум 5000 символів)' };
    if (imageUrl && (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 2000)) return { error: 'Посилання на картинку має починатися з http:// або https://' };
    return { value: [name, Math.round(price * 100) / 100, description, imageUrl || null, category] };
}

function adminError(res, err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Товар з такою назвою вже існує' });
    console.error('Помилка адмін-панелі:', err.message);
    res.status(500).json({ error: 'Помилка сервера' });
}

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    const parsed = parseProductInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
        const result = await pool.query(
            'INSERT INTO products (name, price, description, image_url, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            parsed.value
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { adminError(res, err); }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некоректний id' });
    const parsed = parseProductInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
        const result = await pool.query(
            'UPDATE products SET name = $1, price = $2, description = $3, image_url = $4, category = $5 WHERE id = $6 RETURNING *',
            [...parsed.value, id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Товар не знайдено' });
        res.json(result.rows[0]);
    } catch (err) { adminError(res, err); }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некоректний id' });
    try {
        const result = await pool.query('DELETE FROM products WHERE id = $1', [id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Товар не знайдено' });
        res.json({ success: true });
    } catch (err) { adminError(res, err); }
});

// === НАЛАШТУВАННЯ TELEGRAM ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Сховище відповідності Telegram message_id -> userId
const messageToUserMap = new Map();

// Допоміжна функція відправки запитів до Telegram API
async function telegramRequest(method, data) {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return await response.json();
}

// Допоміжна функція для відправки сповіщень адміністратору в Telegram
async function sendToTelegramAdmin(userId, userName, text) {
    if (!adminChatId || !TELEGRAM_BOT_TOKEN) return;
    const alertMessage = `⚠️ *УВАГА! Потрібне втручання менеджера!*\n👤 *Користувач:* ${userName || 'Гість'}\n🆔 *User ID:* \`${userId}\`\n💬 *Запит клієнта:* ${text}\n\n_(Бот не зміг відповісти або спрацював запит менеджера)_`;
    
    await telegramRequest('sendMessage', {
        chat_id: adminChatId,
        text: alertMessage,
        parse_mode: 'Markdown'
    });
}

// Запасні моделі: якщо перша перевантажена (503) або не відповідає, пробуємо наступну.
// Останній варіант - легша модель, яка зазвичай менш завантажена. Список можна змінити
// без правки коду: змінна середовища GEMINI_FALLBACK_MODELS (через кому) на Render.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.5-flash,gemini-flash-lite-latest')
    .split(',').map(m => m.trim()).filter(Boolean);
const MODEL_TIMEOUT_MS = 8000;    // максимум очікування однієї спроби
const MODEL_ATTEMPTS = 2;         // спроб на одну модель при швидких тимчасових помилках (503, 429)
const RETRY_DELAY_MS = 1500;      // пауза між спробами
const TOTAL_BUDGET_MS = 24000;    // загальний ліміт часу на всі спроби (чат на сайті скасовує запит через 45 с)
const MIN_ATTEMPT_MS = 1500;      // менше за цей залишок часу нову спробу не починаємо
const AI_COOLDOWN_MS = 60000;     // після повного збою ШІ не чіпаємо цей час, щоб наступні повідомлення не чекали
let aiUnavailableUntil = 0;

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Тимчасова помилка (перевантаження, ліміти, мережа): має сенс повторити
function isTemporaryError(err) {
    const status = Number(err?.status ?? err?.code);
    const message = String(err?.message || '');
    return [429, 500, 502, 503, 504].includes(status)
        || /UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED|timeout|fetch failed|ECONNRESET/i.test(message);
}

async function generateWithRetry(ai, model, contents, config) {
    // Нещодавній повний збій: не змушуємо користувачів чекати, одразу віддаємо запасну відповідь
    if (Date.now() < aiUnavailableUntil) throw new Error('UNAVAILABLE: ШІ тимчасово недоступний (пауза після збоїв)');

    const models = [model, ...FALLBACK_MODELS.filter(m => m !== model)];
    const startedAt = Date.now();
    let lastError;
    outer:
    for (const m of models) {
        for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt++) {
            const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
            if (remaining < MIN_ATTEMPT_MS) break outer;
            try {
                const result = await withTimeout(
                    ai.models.generateContent({ model: m, contents, config }),
                    Math.min(MODEL_TIMEOUT_MS, remaining)
                );
                aiUnavailableUntil = 0;
                return result;
            } catch (err) {
                lastError = err;
                console.log(`⚠️ Модель ${m}, спроба ${attempt}/${MODEL_ATTEMPTS}: ${String(err.message).slice(0, 80)}`);
                // Не тимчасова помилка (наприклад, моделі немає) або модель "зависла": одразу наступна модель
                if (!isTemporaryError(err) || err.message === 'timeout') break;
                if (attempt < MODEL_ATTEMPTS) await sleep(RETRY_DELAY_MS);
            }
        }
    }
    if (!lastError || isTemporaryError(lastError)) {
        aiUnavailableUntil = Date.now() + AI_COOLDOWN_MS;
        console.log(`⏸️ ШІ недоступний: наступна спроба через ${AI_COOLDOWN_MS / 1000} с`);
    }
    throw lastError || new Error('timeout');
}

// 1. Отримання повідомлення з сайту (ОБРОБКА ЧЕРЕЗ GEMINI AI)
app.post('/api/message', async (req, res) => {
    const { userId, userName, text } = req.body;

    if (!userId || !text) {
        return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
    }

    try {
        // Зберігаємо повідомлення користувача в базу даних
        await pool.query(
            'INSERT INTO chat_messages (user_id, user_name, sender, message) VALUES ($1, $2, $3, $4)',
            [userId, userName || 'Гість', 'user', text]
        );

        // Виклик генерації з підтримкою авто-повтору (retry)
        const aiResponse = await generateWithRetry(ai, 'gemini-3.8-flash', text, {
            systemInstruction: `Ти — розумний і ввічливий бот-консультант інтернет-магазину комп'ютерної техніки "TechStore". 
            Твоє завдання — допомагати покупцям з вибором техніки, консультувати щодо характеристик, доставки, оплати та гарантії.
            Дотримуйся таких правил:
            1. Якщо питання стосується техніки, комп'ютерів, комплектуючих, характеристик, магазину, замовлень, доставки чи гарантії — відповідай корисно, ввічливо та чітко українською мовою.
            2. Якщо питання НЕ стосується тематики магазину (наприклад, політика, рецепти, погода, сторонні теми тощо), відповідай чітко і без зайвих слів цим текстом: "Вибачте, але це питання не стосується тематики нашого магазину TechStore."
            3. Якщо питання занадто складне, вимагає персональної допомоги або ти не знаєш на нього точної відповіді, напиши у тексті відповіді маркер "NEED_MANAGER".
            4. Пиши звичайним текстом без Markdown: без зірочок, решіток і символів списку. Відповідай коротко (до 5-6 речень).`
        });

        let botReply = aiResponse.text.trim();
        let finalMessageForUser = botReply;
        let needsManager = false;

        // Перевіряємо, чи повернув ШІ маркер необхідності менеджера
        if (botReply.includes("NEED_MANAGER")) {
            needsManager = true;
            finalMessageForUser = "Дякуємо за запитання! Ваше повідомлення передано менеджеру, і він зв'яжеться з вами найближчим часом.";
            await sendToTelegramAdmin(userId, userName, text);
        }

        // Зберігаємо відповідь бота в базу даних
        await pool.query(
            'INSERT INTO chat_messages (user_id, user_name, sender, message) VALUES ($1, $2, $3, $4)',
            [userId, userName || 'Гість', 'bot', finalMessageForUser]
        );

        // Дублюємо оригінальне повідомлення користувача в адмін-чат Telegram
        if (needsManager || !botReply.includes("не стосується тематики")) {
            const messageToTelegram = `📩 *Повідомлення з сайту (AI Бот)*\n👤 *Користувач:* ${userName || 'Гість'}\n🆔 *User ID:* \`${userId}\`\n💬 *Повідомлення:* ${text}\n🤖 *Відповідь бота:* ${finalMessageForUser}`;
            
            telegramRequest('sendMessage', {

                chat_id: adminChatId,

                text: messageToTelegram,

                parse_mode: 'Markdown'

            })
                .then(result => {
                    if (result && result.ok) messageToUserMap.set(result.result.message_id, userId);
                })
                .catch(e => console.error('Telegram:', e.message));
        }

        res.json({ success: true, reply: finalMessageForUser });

    } catch (err) {
        console.error('Помилка обробки повідомлення ШІ:', err.message);
        
        const fallbackReply = "Вибачте, бот зараз перевантажений. Ваше повідомлення передано менеджеру, він відповість найближчим часом.";
        
        res.status(500).json({ error: 'Internal Server Error', reply: fallbackReply });

        // Далі — у фоні, щоб клієнт не чекав
        pool.query(
            'INSERT INTO chat_messages (user_id, user_name, sender, message) VALUES ($1, $2, $3, $4)',
            [userId, userName || 'Гість', 'bot', fallbackReply]
        ).catch(e => console.error('Помилка збереження резервної відповіді:', e.message));

        sendToTelegramAdmin(userId, userName, text).catch(e => console.error('Telegram:', e.message));
    }
});

// 2. Long-polling для отримання відповідей з Telegram (коли менеджер відповідає вручну)
let lastUpdateId = 0;
async function pollTelegramUpdates() {
    try {
        const res = await telegramRequest('getUpdates', { offset: lastUpdateId + 1, timeout: 10 });
        if (res.ok && res.result.length > 0) {
            for (const update of res.result) {
                lastUpdateId = update.update_id;
                const msg = update.message;

                if (!msg || !msg.text) continue;

                let targetUserId = null;
                let replyText = msg.text;

                // СПОСІБ 1: Відповідь через команду /r user_123456 Текст відповіді
                if (msg.text.startsWith('/r ')) {
                    const parts = msg.text.split(' ');
                    if (parts.length >= 3) {
                        targetUserId = parts[1];
                        replyText = parts.slice(2).join(' ');
                    }
                }

                // СПОСІБ 2: Відповідь через Reply на повідомлення в Telegram
                if (!targetUserId && msg.reply_to_message) {
                    const replyToId = msg.reply_to_message.message_id;
                    targetUserId = messageToUserMap.get(replyToId);

                    if (!targetUserId && msg.reply_to_message.text) {
                        const match = msg.reply_to_message.text.match(/ID:\s*`?([a-zA-Z0-9_]+)`?/i);
                        if (match) targetUserId = match[1];
                    }
                }

                // Збереження відповіді менеджера в базу даних для клієнта
                if (targetUserId) {
                    const managerReplyFormatted = `Менеджер: ${replyText}`;
                    await pool.query(
                        'INSERT INTO chat_messages (user_id, user_name, sender, message) VALUES ($1, $2, $3, $4)',
                        [targetUserId, 'Клієнт', 'manager', managerReplyFormatted]
                    );
                    console.log(`✅ [УСПІХ] Відповідь менеджера збережено в БД для ${targetUserId}: ${replyText}`);
                } else if (msg.reply_to_message) {
                    console.log('⚠️ [ПОМИЛКА] Не вдалося визначити ID. Використайте команду: /r <userId> <текст>');
                }
            }
        }
    } catch (e) {
        console.error('Помилка полінгу:', e.message);
    } finally {
        setTimeout(pollTelegramUpdates, 1000);
    }
}

// 3. Ендпоінт для сайту — отримання нових відповідей з бази даних
app.get('/api/get-replies/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            'SELECT message FROM chat_messages WHERE user_id = $1 AND sender IN (\'bot\', \'manager\') ORDER BY id ASC',
            [userId]
        );
        
        const replies = result.rows.map(row => row.message);
        res.json({ replies });
    } catch (err) {
        console.error('Помилка отримання повідомлень з БД:', err.message);
        res.json({ replies: [] });
    }
});

// === АВТОРИЗАЦІЯ КОРИСТУВАЧІВ ===
const scryptAsync = require('util').promisify(crypto.scrypt);

// Ключ для підпису токенів входу. Краще задати SESSION_SECRET у Render (довгий випадковий рядок)
const SESSION_SECRET = process.env.SESSION_SECRET
    || crypto.createHash('sha256').update('techstore-session:' + (process.env.DATABASE_URL || 'dev')).digest('hex');
if (!process.env.SESSION_SECRET) console.warn('⚠️ SESSION_SECRET не задано: використовується запасний ключ. Додайте SESSION_SECRET у змінні середовища.');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // токен діє 30 днів

const AUTH_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const AUTH_NAME_RE = /^\p{L}[\p{L}\s'’-]{1,49}$/u;

function validateName(name) {
    if (!name) return 'Вкажіть ім’я';
    if (!AUTH_NAME_RE.test(name)) return 'Ім’я може містити лише літери, пробіли, дефіс і апостроф (2–50 символів)';
    return '';
}
function validateEmail(email) {
    if (!email) return 'Вкажіть електронну пошту';
    if (email.length > 255 || !AUTH_EMAIL_RE.test(email)) return 'Введіть коректну електронну пошту';
    return '';
}
function validatePassword(password) {
    if (!password) return 'Введіть пароль';
    if (password.length < 8) return 'Пароль має містити щонайменше 8 символів';
    if (password.length > 128) return 'Пароль занадто довгий (максимум 128 символів)';
    if (!/\p{L}/u.test(password)) return 'Пароль має містити хоча б одну літеру';
    if (!/\d/.test(password)) return 'Пароль має містити хоча б одну цифру';
    return '';
}

// Хешування пароля: scrypt із випадковою сіллю (вбудований у Node, без сторонніх бібліотек)
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scryptAsync(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(password, stored) {
    const [alg, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
    const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(keyHex, 'hex');
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
// Фіктивний хеш: щоб відповідь на неіснуючу пошту займала стільки ж часу, як і на хибний пароль
let dummyHashPromise = null;
function getDummyHash() {
    if (!dummyHashPromise) dummyHashPromise = hashPassword('dummy-password-for-timing-1');
    return dummyHashPromise;
}

function signSession(userId) {
    const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}
function verifySession(token) {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!Number.isInteger(data.uid) || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
        return data;
    } catch (e) {
        return null;
    }
}

async function loadUserFromRequest(req) {
    const header = req.headers.authorization || '';
    const data = verifySession(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!data) return null;
    const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [data.uid]);
    return result.rows[0] || null;
}
async function requireUser(req, res, next) {
    try {
        const user = await loadUserFromRequest(req);
        if (!user) return res.status(401).json({ error: 'Потрібно увійти в акаунт' });
        req.user = user;
        next();
    } catch (err) {
        console.error('Помилка перевірки сесії:', err.message);
        res.status(500).json({ error: 'Помилка сервера' });
    }
}

app.post('/api/auth/register', rateLimit('register', 5, 60 * 60 * 1000), async (req, res) => {
    const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const problem = validateName(name) || validateEmail(email) || validatePassword(password);
    if (problem) return res.status(400).json({ error: problem });

    try {
        const hash = await hashPassword(password);
        const result = await pool.query(
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
            [name, email, hash]
        );
        const user = result.rows[0];
        res.status(201).json({ token: signSession(user.id), user });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Користувач із такою поштою вже зареєстрований' });
        console.error('Помилка реєстрації:', err.message);
        res.status(500).json({ error: 'Не вдалося зареєструватися. Спробуйте ще раз' });
    }
});

app.post('/api/auth/login', rateLimit('login', 10, 15 * 60 * 1000), async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (validateEmail(email) || !password || password.length > 128) {
        return res.status(400).json({ error: 'Введіть пошту та пароль' });
    }
    try {
        const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
        const row = result.rows[0];
        const ok = await verifyPassword(password, row ? row.password_hash : await getDummyHash());
        if (!row || !ok) {
            // Однакова відповідь і для хибної пошти, і для хибного пароля
            return res.status(401).json({ error: 'Невірна пошта або пароль' });
        }
        res.json({ token: signSession(row.id), user: { id: row.id, name: row.name, email: row.email } });
    } catch (err) {
        console.error('Помилка входу:', err.message);
        res.status(500).json({ error: 'Не вдалося увійти. Спробуйте ще раз' });
    }
});

app.get('/api/auth/me', requireUser, (req, res) => {
    res.json({ user: req.user });
});

// === ЗАМОВЛЕННЯ ТА ВІДГУКИ ===
const ORDER_STATUSES = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
const DELIVERY_METHODS = ['nova-poshta', 'courier', 'pickup'];
const PAYMENT_METHODS = ['card', 'postpaid'];
const MAX_OPTION_SURCHARGE = 10000; // максимальна доплата за опції (пам'ять тощо), яку додає сайт до ціни
const round2 = (n) => Math.round(n * 100) / 100;

// Простий обмежувач частоти запитів за IP (зберігається в пам'яті сервера)
const rateBuckets = new Map();
function rateLimit(name, max, windowMs) {
    return (req, res, next) => {
        const key = `${name}:${req.ip}`;
        const now = Date.now();
        let bucket = rateBuckets.get(key);
        if (!bucket || bucket.resetAt < now) bucket = { count: 0, resetAt: now + windowMs };
        bucket.count += 1;
        rateBuckets.set(key, bucket);
        if (bucket.count > max) return res.status(429).json({ error: 'Забагато запитів. Спробуйте пізніше' });
        next();
    };
}
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) if (bucket.resetAt < now) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

// Перевірка складу замовлення: товари шукаємо в базі і не даємо занизити ціну
async function buildOrderItems(client, rawItems) {
    const items = [];
    for (const it of rawItems) {
        const quantity = Number(it?.quantity);
        const price = Number(it?.price);
        const title = String(it?.title ?? '').trim().slice(0, 255);
        if (!title || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isFinite(price) || price < 0) {
            return { error: 'Некоректний склад замовлення. Оновіть кошик' };
        }

        // Шукаємо товар у базі: за id, а якщо id не числовий (картки "Популярні товари") - за назвою
        let product = null;
        const idStr = String(it?.id ?? '');
        if (/^\d{1,9}$/.test(idStr)) {
            product = (await client.query('SELECT id, name, price FROM products WHERE id = $1', [Number(idStr)])).rows[0];
        }
        if (!product) {
            product = (await client.query('SELECT id, name, price FROM products WHERE name = $1 LIMIT 1', [title])).rows[0];
        }
        if (product) {
            const base = Number(product.price);
            if (price < base || price > base + MAX_OPTION_SURCHARGE) {
                return { error: `Ціна товару «${product.name}» змінилася. Оновіть кошик` };
            }
        }

        items.push({
            productId: product ? product.id : null,
            title: product ? product.name : title,
            color: it?.color ? String(it.color).slice(0, 50) : null,
            memory: it?.memory ? String(it.memory).slice(0, 50) : null,
            unitPrice: round2(price),
            quantity
        });
    }
    return { items };
}

// Створення замовлення
app.post('/api/orders', rateLimit('orders', 10, 60 * 60 * 1000), async (req, res) => {
    const b = req.body || {};
    const fullName = String(b.fullName ?? '').trim();
    const phone = String(b.phone ?? '').trim();
    const email = String(b.email ?? '').trim();
    const city = String(b.city ?? '').trim();
    const address = String(b.address ?? '').trim();
    const deliveryMethod = String(b.deliveryMethod ?? '');
    const paymentMethod = String(b.paymentMethod ?? '');
    const userName = b.userName ? String(b.userName).trim().slice(0, 150) : null;
    const rawItems = Array.isArray(b.items) ? b.items : [];

    const phoneDigits = phone.replace(/\D/g, '');
    if (fullName.length < 3 || fullName.length > 150 || /\d/.test(fullName)) return res.status(400).json({ error: 'Введіть коректне ПІБ (без цифр)' });
    if (phoneDigits.length < 10 || phoneDigits.length > 15 || phone.length > 40) return res.status(400).json({ error: 'Введіть коректний номер телефону' });
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Введіть коректну електронну пошту' });
    if (city.length < 2 || city.length > 100 || /\d/.test(city)) return res.status(400).json({ error: 'Вкажіть коректне місто доставки' });
    if (!address || address.length > 300) return res.status(400).json({ error: 'Вкажіть відділення або адресу доставки' });
    if (!DELIVERY_METHODS.includes(deliveryMethod)) return res.status(400).json({ error: 'Оберіть спосіб доставки' });
    if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: 'Оберіть спосіб оплати' });
    if (!rawItems.length || rawItems.length > 50) return res.status(400).json({ error: 'Кошик порожній' });

    let account = null;
    try { account = await loadUserFromRequest(req); } catch (e) { /* гість */ }

    const client = await pool.connect();
    try {
        const built = await buildOrderItems(client, rawItems);
        if (built.error) return res.status(400).json({ error: built.error });

        const total = round2(built.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));

        await client.query('BEGIN');
        const orderResult = await client.query(
            `INSERT INTO orders (user_id, user_name, full_name, phone, email, city, delivery_method, address, payment_method, total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [account ? account.id : null, account ? account.name : userName, fullName, phone, email, city, deliveryMethod, address, paymentMethod, total]
        );
        const orderId = orderResult.rows[0].id;
        for (const i of built.items) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, title, color, memory, unit_price, quantity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [orderId, i.productId, i.title, i.color, i.memory, i.unitPrice, i.quantity]
            );
        }
        await client.query('COMMIT');

        res.status(201).json({ success: true, orderId, total });

        // Сповіщення менеджеру в Telegram (у фоні, звичайним текстом)
        if (adminChatId && TELEGRAM_BOT_TOKEN) {
            const lines = built.items.map(i => `• ${i.title}${i.memory ? ' (' + i.memory + ')' : ''} × ${i.quantity} = ${round2(i.unitPrice * i.quantity)} ₴`);
            const text = `🛒 Нове замовлення №${orderId}\n👤 ${fullName}\n📞 ${phone}\n✉️ ${email}\n📍 ${city}, ${address}\n🚚 ${deliveryMethod} / 💳 ${paymentMethod}\n\n${lines.join('\n')}\n\nРазом: ${total} ₴`;
            telegramRequest('sendMessage', { chat_id: adminChatId, text }).catch(e => console.error('Telegram:', e.message));
        }
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Помилка створення замовлення:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Не вдалося оформити замовлення. Спробуйте ще раз' });
    } finally {
        client.release();
    }
});

// Відгуки до товару
app.get('/api/reviews/:productId', async (req, res) => {
    const productId = String(req.params.productId);
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(productId)) return res.status(400).json({ error: 'Некоректний id товару' });
    try {
        const result = await pool.query(
            'SELECT id, author, rating, text, created_at FROM reviews WHERE product_id = $1 ORDER BY id DESC LIMIT 100',
            [productId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Помилка отримання відгуків:', err.message);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.post('/api/reviews', rateLimit('reviews', 8, 60 * 60 * 1000), requireUser, async (req, res) => {
    const productId = String(req.body?.productId ?? '');
    const author = req.user.name; // автор береться з акаунта, а не з запиту
    const text = String(req.body?.text ?? '').trim();
    const rating = Number(req.body?.rating);
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(productId)) return res.status(400).json({ error: 'Некоректний id товару' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Оцінка має бути від 1 до 5' });
    if (!text || text.length > 1000) return res.status(400).json({ error: 'Текст відгуку: від 1 до 1000 символів' });
    try {
        const result = await pool.query(
            'INSERT INTO reviews (product_id, author, rating, text) VALUES ($1, $2, $3, $4) RETURNING id, author, rating, text, created_at',
            [productId, author, rating, text]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Помилка збереження відгуку:', err.message);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Адмін: замовлення та відгуки (потрібен той самий вхід, що й для товарів) ---
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : null;
    try {
        const result = await pool.query(
            `SELECT o.*,
                    COALESCE(json_agg(json_build_object(
                        'product_id', i.product_id, 'title', i.title, 'color', i.color,
                        'memory', i.memory, 'unit_price', i.unit_price, 'quantity', i.quantity
                    ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
             FROM orders o
             LEFT JOIN order_items i ON i.order_id = o.id
             WHERE ($1::text IS NULL OR o.status = $1)
             GROUP BY o.id
             ORDER BY o.id DESC
             LIMIT 200`,
            [status]
        );
        res.json(result.rows);
    } catch (err) { adminError(res, err); }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? '');
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некоректний id' });
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Некоректний статус' });
    try {
        const result = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status', [status, id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Замовлення не знайдено' });
        res.json(result.rows[0]);
    } catch (err) { adminError(res, err); }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некоректний id' });
    try {
        const result = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Замовлення не знайдено' });
        res.json({ success: true });
    } catch (err) { adminError(res, err); }
});

app.get('/api/admin/reviews', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, product_id, author, rating, text, created_at FROM reviews ORDER BY id DESC LIMIT 200');
        res.json(result.rows);
    } catch (err) { adminError(res, err); }
});

app.delete('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некоректний id' });
    try {
        const result = await pool.query('DELETE FROM reviews WHERE id = $1', [id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Відгук не знайдено' });
        res.json({ success: true });
    } catch (err) { adminError(res, err); }
});

// === ОСОБИСТИЙ КАБІНЕТ ===
// Профіль і статистика
app.get('/api/account/profile', requireUser, async (req, res) => {
    try {
        const [userRow, stats, reviews] = await Promise.all([
            pool.query('SELECT id, name, email, created_at FROM users WHERE id = $1', [req.user.id]),
            pool.query(
                `SELECT COUNT(*)::int AS orders_count,
                        COUNT(*) FILTER (WHERE status = 'new' OR status = 'processing' OR status = 'shipped')::int AS active_count,
                        COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0) AS total_spent
                 FROM orders WHERE user_id = $1`,
                [req.user.id]
            ),
            pool.query('SELECT COUNT(*)::int AS n FROM reviews WHERE author = $1', [req.user.name])
        ]);
        res.json({
            user: userRow.rows[0],
            stats: {
                ordersCount: stats.rows[0].orders_count,
                activeCount: stats.rows[0].active_count,
                totalSpent: Number(stats.rows[0].total_spent),
                reviewsCount: reviews.rows[0].n
            }
        });
    } catch (err) {
        console.error('Помилка профілю:', err.message);
        res.status(500).json({ error: 'Не вдалося завантажити профіль' });
    }
});

// Замовлення поточного користувача (разом зі складом і картинкою товару)
app.get('/api/account/orders', requireUser, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT o.id, o.full_name, o.phone, o.email, o.city, o.delivery_method, o.address,
                    o.payment_method, o.total, o.status, o.created_at,
                    COALESCE(json_agg(json_build_object(
                        'product_id', i.product_id, 'title', i.title, 'color', i.color,
                        'memory', i.memory, 'unit_price', i.unit_price, 'quantity', i.quantity,
                        'image_url', p.image_url
                    ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
             FROM orders o
             LEFT JOIN order_items i ON i.order_id = o.id
             LEFT JOIN products p ON p.id = i.product_id
             WHERE o.user_id = $1
             GROUP BY o.id
             ORDER BY o.id DESC
             LIMIT 100`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Помилка отримання замовлень користувача:', err.message);
        res.status(500).json({ error: 'Не вдалося завантажити замовлення' });
    }
});

// Скасування замовлення: лише власного і лише поки воно «Нове»
app.post('/api/account/orders/:id/cancel', requireUser, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некоректний id' });
    try {
        const result = await pool.query(
            `UPDATE orders SET status = 'cancelled'
             WHERE id = $1 AND user_id = $2 AND status = 'new'
             RETURNING id, status`,
            [id, req.user.id]
        );
        if (!result.rows.length) {
            const exists = await pool.query('SELECT status FROM orders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
            if (!exists.rows.length) return res.status(404).json({ error: 'Замовлення не знайдено' });
            return res.status(409).json({ error: 'Це замовлення вже в обробці, скасувати його можна лише через менеджера' });
        }
        res.json(result.rows[0]);
        if (adminChatId && TELEGRAM_BOT_TOKEN) {
            telegramRequest('sendMessage', {
                chat_id: adminChatId,
                text: `❌ Клієнт ${req.user.name} скасував замовлення №${id}`
            }).catch(e => console.error('Telegram:', e.message));
        }
    } catch (err) {
        console.error('Помилка скасування замовлення:', err.message);
        res.status(500).json({ error: 'Не вдалося скасувати замовлення' });
    }
});

// Зміна імені
app.patch('/api/account/profile', rateLimit('profile', 20, 60 * 60 * 1000), requireUser, async (req, res) => {
    const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
    const problem = validateName(name);
    if (problem) return res.status(400).json({ error: problem });
    try {
        const result = await pool.query('UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email', [name, req.user.id]);
        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Помилка оновлення профілю:', err.message);
        res.status(500).json({ error: 'Не вдалося зберегти зміни' });
    }
});

// Зміна пароля
app.post('/api/account/password', rateLimit('password', 8, 60 * 60 * 1000), requireUser, async (req, res) => {
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');
    if (!current) return res.status(400).json({ error: 'Введіть поточний пароль' });
    const problem = validatePassword(next);
    if (problem) return res.status(400).json({ error: problem });
    if (current === next) return res.status(400).json({ error: 'Новий пароль має відрізнятися від поточного' });
    try {
        const row = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
        if (!row || !(await verifyPassword(current, row.password_hash))) {
            return res.status(403).json({ error: 'Поточний пароль введено невірно' });
        }
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Помилка зміни пароля:', err.message);
        res.status(500).json({ error: 'Не вдалося змінити пароль' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер успішно запущено на порту ${PORT}`);
    pollTelegramUpdates();
});