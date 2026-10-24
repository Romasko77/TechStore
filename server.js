const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config(); // Підключаємо завантаження змінних середовища з .env файлу

// Імпортуємо офіційну бібліотеку Google Gen AI
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

// === ІНІЦІАЛІЗАЦІЯ GEMINI AI ===
// Автоматично використовує GEMINI_API_KEY з файлу .env
const ai = new GoogleGenAI();

// === РОЗДАЧА СТАТИЧНИХ ФАЙЛІВ ТА ГОЛОВНОЇ СТОРІНКИ ===
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === НАЛАШТУВАННЯ TELEGRAM (змінні беруться з .env) ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Сховище відповідей для клієнтів (userId -> array of replies)
const pendingReplies = new Map();

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

// Допоміжна функція для відправки сповіщень адміністратору в Telegram, коли потрібен менеджер
async function sendToTelegramAdmin(userId, userName, text) {
    if (!adminChatId || !TELEGRAM_BOT_TOKEN) return;
    const alertMessage = `⚠️ *УВАГА! Потрібне втручання менеджера!*\n👤 *Користувач:* ${userName || 'Гість'}\n🆔 *User ID:* \`${userId}\`\n💬 *Запит клієнта:* ${text}\n\n_(Бот не зміг відповісти або спрацював запит менеджера)_`;
    
    await telegramRequest('sendMessage', {
        chat_id: adminChatId,
        text: alertMessage,
        parse_mode: 'Markdown'
    });
}

// Допоміжна функція для автоматичного повтору запиту при помилці 503 / High Demand
async function generateWithRetry(ai, model, contents, config, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await ai.models.generateContent({ model, contents, config });
        } catch (err) {
            const isUnavailable = err.message && (err.message.includes('503') || err.message.includes('UNAVAILABLE') || err.message.includes('high demand'));
            if (isUnavailable && i < retries - 1) {
                console.log(`⚠️ Сервери Google перевантажені (503). Спроба ${i + 1} з ${retries}. Чекаємо ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw err;
        }
    }
}

// 1. Отримання повідомлення з сайту (ОБРОБКА ЧЕРЕЗ GEMINI AI)
app.post('/api/message', async (req, res) => {
    const { userId, userName, text } = req.body;

    if (!userId || !text) {
        return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
    }

    try {
        // Виклик генерації з підтримкою авто-повтору (retry)
        const aiResponse = await generateWithRetry(ai, 'gemini-3.8-flash', text, {
            systemInstruction: `Ти — розумний і ввічливий бот-консультант інтернет-магазину комп'ютерної техніки "TechStore". 
            Твоє завдання — допомагати покупцям з вибором техніки, консультувати щодо характеристик, доставки, оплати та гарантії.
            Дотримуйся таких правил:
            1. Якщо питання стосується техніки, комп'ютерів, комплектуючих, характеристик, магазину, замовлень, доставки чи гарантії — відповідай корисно, ввічливо та чітко українською мовою.
            2. Якщо питання НЕ стосується тематики магазину (наприклад, політика, рецепти, погода, сторонні теми тощо), відповідай чітко і без зайвих слів цим текстом: "Вибачте, але це питання не стосується тематики нашого магазину TechStore."
            3. Якщо питання занадто складне, вимагає персональної допомоги або ти не знаєш на нього точної відповіді, напиши у тексті відповіді маркер "NEED_MANAGER".`
        });

        let botReply = aiResponse.text.trim();
        let finalMessageForUser = botReply;
        let needsManager = false;

        // Перевіряємо, чи повернув ШІ маркер необхідності менеджера
        if (botReply.includes("NEED_MANAGER")) {
            needsManager = true;
            finalMessageForUser = "Дякуємо за запитання! Ваше повідомлення передано менеджеру, і він зв'яжеться з вами найближчим часом.";
            
            // Відправляємо сповіщення адміністратору в Telegram
            await sendToTelegramAdmin(userId, userName, text);
        }

        // Зберігаємо відповідь бота у масив для відправки у віджет користувача
        if (!pendingReplies.has(userId)) {
            pendingReplies.set(userId, []);
        }
        pendingReplies.get(userId).push(finalMessageForUser);

        // Дублюємо оригінальне повідомлення користувача в адмін-чат Telegram
        if (needsManager || !botReply.includes("не стосується тематики")) {
            const messageToTelegram = `📩 *Повідомлення з сайту (AI Бот)*\n👤 *Користувач:* ${userName || 'Гість'}\n🆔 *User ID:* \`${userId}\`\n💬 *Повідомлення:* ${text}\n🤖 *Відповідь бота:* ${finalMessageForUser}`;
            
            const result = await telegramRequest('sendMessage', {
                chat_id: adminChatId,
                text: messageToTelegram,
                parse_mode: 'Markdown'
            });

            if (result.ok) {
                messageToUserMap.set(result.result.message_id, userId);
            }
        }

        res.json({ success: true, reply: finalMessageForUser });

    } catch (err) {
        console.error('Помилка обробки повідомлення ШІ:', err.message);
        
        // Резервний варіант, якщо всі спроби вичерпано або сталася інша критична помилка
        const fallbackReply = "Вибачте, наразі сталася технічна помилка. Ваше повідомлення передано менеджеру.";
        if (!pendingReplies.has(userId)) {
            pendingReplies.set(userId, []);
        }
        pendingReplies.get(userId).push(fallbackReply);
        await sendToTelegramAdmin(userId, userName, text);

        res.status(500).json({ error: 'Internal Server Error' });
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

                // Збереження відповіді менеджера для клієнта
                if (targetUserId) {
                    if (!pendingReplies.has(targetUserId)) {
                        pendingReplies.set(targetUserId, []);
                    }
                    pendingReplies.get(targetUserId).push(`Менеджер: ${replyText}`);
                    console.log(`✅ [УСПІХ] Відповідь менеджера збережено для ${targetUserId}: ${replyText}`);
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

// 3. Ендпоінт для сайту — отримання нових відповідей
app.get('/api/get-replies/:userId', (req, res) => {
    const { userId } = req.params;
    const replies = pendingReplies.get(userId) || [];
    pendingReplies.set(userId, []); // очищаємо масив після відправки
    res.json({ replies });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер успішно запущено на порту ${PORT}`);
    pollTelegramUpdates();
});