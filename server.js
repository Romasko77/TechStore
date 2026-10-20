const express = require('express');
const cors = require('cors');
require('dotenv').config(); // Підключаємо завантаження змінних середовища з .env файлу

const app = express();
app.use(cors());
app.use(express.json());

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

// 1. Отримання повідомлення з сайту та відправка в Telegram
app.post('/api/message', async (req, res) => {
    const { userId, userName, text } = req.body;

    if (!userId || !text) {
        return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
    }

    // Формуємо текст повідомлення
    const messageToTelegram = `📩 *Нове повідомлення з сайту!*\n👤 *Користувач:* ${userName}\n🆔 *User ID:* \`${userId}\`\n💬 *Повідомлення:* ${text}`;

    try {
        const result = await telegramRequest('sendMessage', {
            chat_id: adminChatId,
            text: messageToTelegram,
            parse_mode: 'Markdown'
        });

        if (result.ok) {
            messageToUserMap.set(result.result.message_id, userId);
            res.json({ status: 'ok' });
        } else {
            throw new Error(result.description);
        }
    } catch (err) {
        console.error('Помилка надсилання в Telegram:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 2. Long-polling для отримання відповідей з Telegram
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

                // СПОСІБ 2: Відповідь через Reply (якщо є в пам'яті або в тексті)
                if (!targetUserId && msg.reply_to_message) {
                    const replyToId = msg.reply_to_message.message_id;
                    targetUserId = messageToUserMap.get(replyToId);

                    if (!targetUserId && msg.reply_to_message.text) {
                        const match = msg.reply_to_message.text.match(/ID:\s*`?([a-zA-Z0-9_]+)`?/i);
                        if (match) targetUserId = match[1];
                    }
                }

                // Збереження відповіді
                if (targetUserId) {
                    if (!pendingReplies.has(targetUserId)) {
                        pendingReplies.set(targetUserId, []);
                    }
                    pendingReplies.get(targetUserId).push(replyText);
                    console.log(`✅ [УСПІХ] Відповідь збережено для ${targetUserId}: ${replyText}`);
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