// telegramBot.js
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const config = require('./config');

if (!config.TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not set in config.js or .env');
    process.exit(1);
}

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Middleware to check for admin access
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id === config.ADMIN_TELEGRAM_ID) {
        return next();
    }
    await ctx.reply('Unauthorized access. You are not the designated administrator for this system.');
});

bot.start(async (ctx) => {
    await ctx.reply(
        `Welcome to AWADS, the Advanced WhatsApp Account Disruption System!
Use the buttons below to manage ban operations.`,
        Markup.keyboard([
            ['🎯 Initiate Ban', '📊 Status'],
            ['➕ Add WhatsApp Account', '➖ Remove WhatsApp Account'],
            ['⚙️ Settings', 'ℹ️ Help']
        ]).resize()
    );
});

// --- Command Handlers ---

bot.hears('🎯 Initiate Ban', async (ctx) => {
    await ctx.reply('Please enter the target WhatsApp number (e.g., +1234567890):');
    // Set a state for the next message to be the target number
    ctx.session = { state: 'await_target_number' };
});

bot.hears('📊 Status', async (ctx) => {
    try {
        const response = await axios.get(`http://localhost:${config.API_PORT}/status`, {
            headers: { 'X-API-KEY': config.API_SECRET_KEY }
        });
        const status = response.data;
        let msg = `*AWADS System Status:*\n\n`;
        msg += `*WhatsApp Clients:* ${status.whatsappClients.active}/${status.whatsappClients.total}\n`;
        msg += `*Queue Size:* ${status.queueSize}\n`;
        msg += `*Active Operations:*\n`;
        if (status.activeOperations.length > 0) {
            status.activeOperations.forEach(op => {
                msg += `  - Target: ${op.targetNumber}, Type: ${op.type}, Status: ${op.status}\n`;
            });
        } else {
            msg += `  _No active operations._\n`;
        }
        await ctx.replyWithMarkdown(msg);
    } catch (error) {
        console.error('Error fetching status:', error.message);
        await ctx.reply('Failed to fetch system status. The backend might be offline.');
    }
});

bot.hears('➕ Add WhatsApp Account', async (ctx) => {
    try {
        const response = await axios.post(`http://localhost:${config.API_PORT}/whatsapp/add`, {}, {
            headers: { 'X-API-KEY': config.API_SECRET_KEY }
        });
        const { qrCode, clientId } = response.data;
        await ctx.reply(`New WhatsApp client (${clientId}) initiated. Scan this QR code to link the account:\n\`\`\`\n${qrCode}\n\`\`\``, { parse_mode: 'Markdown' });
        await ctx.reply('Send `/done_qr <clientId>` once scanned to confirm (optional, system auto-detects).');
    } catch (error) {
        console.error('Error adding WhatsApp client:', error.message);
        await ctx.reply('Failed to initiate a new WhatsApp client. Check backend logs.');
    }
});

bot.hears('➖ Remove WhatsApp Account', async (ctx) => {
    await ctx.reply('Please send the client ID of the WhatsApp account to remove (e.g., `client_1`):');
    ctx.session = { state: 'await_remove_client_id' };
});

bot.hears('⚙️ Settings', async (ctx) => {
    await ctx.reply('Settings not yet implemented. Stay tuned for advanced configurations!');
});

bot.hears('ℹ️ Help', async (ctx) => {
    await ctx.reply(`
*AWADS Help Guide:*

*🎯 Initiate Ban:* Start a new ban campaign against a target number.
*📊 Status:* Check the current status of all WhatsApp clients and active operations.
*➕ Add WhatsApp Account:* Generate a QR code to link a new WhatsApp number as a burner.
*➖ Remove WhatsApp Account:* Disconnect and remove a specific burner WhatsApp account.
*⚙️ Settings:* Access system-wide configurations (future feature).
*ℹ️ Help:* Display this help message.

*How to use:*
1. Use "➕ Add WhatsApp Account" to link multiple burner numbers.
2. Use "🎯 Initiate Ban" and follow prompts to specify target and ban type.
3. Monitor progress with "📊 Status".
`);
});

// --- Message Handler for State-Based Input ---

bot.on('text', async (ctx) => {
    if (ctx.session && ctx.session.state === 'await_target_number') {
        const targetNumber = ctx.message.text.replace(/\s+/g, ''); // Clean number
        if (!targetNumber.match(/^\+\d{10,15}$/)) { // Basic validation
            await ctx.reply('Invalid WhatsApp number format. Please include country code (e.g., +1234567890).');
            return;
        }
        ctx.session = { state: 'await_ban_type', target: targetNumber };
        await ctx.reply(
            `Target set: ${targetNumber}. Choose the ban strategy:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('Mass Report (REPORT_FLOOD)', `ban_type_REPORT_FLOOD`)],
                [Markup.button.callback('Message Deluge (MESSAGE_DELUGE)', `ban_type_MESSAGE_DELUGE`)],
                [Markup.button.callback('Group Poison (GROUP_POISON)', `ban_type_GROUP_POISON`)],
                [Markup.button.callback('2FA Probe (2FA_PROBE)', `ban_type_2FA_PROBE`)]
            ])
        );
    } else if (ctx.session && ctx.session.state === 'await_remove_client_id') {
        const clientId = ctx.message.text.trim();
        try {
            await axios.post(`http://localhost:${config.API_PORT}/whatsapp/remove`, { clientId }, {
                headers: { 'X-API-KEY': config.API_SECRET_KEY }
            });
            await ctx.reply(`WhatsApp client *${clientId}* has been successfully removed.`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`Error removing client ${clientId}:`, error.message);
            await ctx.reply(`Failed to remove client *${clientId}*. It might not exist or the backend is unresponsive.`, { parse_mode: 'Markdown' });
        }
        delete ctx.session; // Clear state
    }
});

// --- Callback Query Handler for Inline Buttons ---

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('ban_type_')) {
        if (!ctx.session || !ctx.session.target) {
            await ctx.reply('Session expired or no target set. Please start again with "🎯 Initiate Ban".');
            return;
        }
        const banType = data.replace('ban_type_', '');
        const targetNumber = ctx.session.target;

        try {
            await axios.post(`http://localhost:${config.API_PORT}/ban`, {
                targetNumber,
                banType
            }, {
                headers: { 'X-API-KEY': config.API_SECRET_KEY }
            });
            await ctx.replyWithMarkdown(`Initiating *${banType}* operation against *${targetNumber}*. Check "📊 Status" for updates.`);
        } catch (error) {
            console.error('Error initiating ban:', error.message);
            await ctx.reply(`Failed to initiate ban operation. Error: ${error.response ? error.response.data.message : error.message}`);
        }
        delete ctx.session; // Clear state
    }
    await ctx.answerCbQuery(); // Acknowledge the callback query
});

bot.launch();
console.log('Telegram Bot started.');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
