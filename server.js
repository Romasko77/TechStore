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

// Запасні моделі: якщо перша перевантажена (503) або не відповідає, пробуємо наступну
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const MODEL_TIMEOUT_MS = 12000; // максимум очікування однієї моделі

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

async function generateWithRetry(ai, model, contents, config) {
    const models = [model, ...FALLBACK_MODELS.filter(m => m !== model)];
    let lastError;
    for (const m of models) {
        try {
            return await withTimeout(ai.models.generateContent({ model: m, contents, config }), MODEL_TIMEOUT_MS);
        } catch (err) {
            lastError = err;
            console.log(`⚠️ Модель ${m} не відповіла (${String(err.message).slice(0, 80)}). Пробуємо наступну...`);
        }
    }
    throw lastError;
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
        
        const fallbackReply = "Вибачте, наразі сталася технічна помилка. Ваше повідомлення передано менеджеру.";
        
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер успішно запущено на порту ${PORT}`);
    pollTelegramUpdates();
});