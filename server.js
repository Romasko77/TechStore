const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config(); // Підключаємо завантаження змінних середовища з .env файлу

// Імпортуємо офіційну бібліотеку Google Gen AI
const { GoogleGenAI } = require('@google/genai');

// Імпортуємо Pool для роботи з PostgreSQL (Neon)
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// === ПІДКЛЮЧЕННЯ ДО БАЗИ ДАНИХ NEON (PostgreSQL) ===
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

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