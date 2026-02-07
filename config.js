// config.js
require('dotenv').config();

module.exports = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    ADMIN_TELEGRAM_ID: process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID) : null,
    API_PORT: process.env.API_PORT || 3000,
    API_SECRET_KEY: process.env.API_SECRET_KEY || 'YOUR_STRONG_SECRET_KEY_HERE', // For API authentication
    WHATSAPP_WORKERS_COUNT: process.env.WHATSAPP_WORKERS_COUNT ? parseInt(process.env.WHATSAPP_WORKERS_COUNT) : 5, // Number of burner accounts
    WHATSAPP_SESSION_PATH: './.wwebjs_auth', // Directory for WhatsApp session files
    REPORT_TYPES: [ // Diversify report types for better efficacy
        'spam',
        'hate_speech',
        'illegal_content',
        'self_harm',
        'other'
    ],
    MESSAGE_TYPES: [ // Diversify message types for spamming
        'text',
        'image',
        'video',
        'audio',
        'sticker'
    ],
    // Proxy configuration (crucial for multiple accounts)
    PROXY_LIST: [
        'http://user:pass@ip:port',
        'http://user:pass@ip2:port2',
        // Add more proxies as needed. Rotate these.
    ],
    BAN_ATTEMPT_INTERVAL_MIN: 10000, // Minimum delay between actions (e.g., 10 seconds)
    BAN_ATTEMPT_INTERVAL_MAX: 30000, // Maximum delay between actions (e.g., 30 seconds)
    MASS_REPORT_COUNT: 50, // Number of reports to send per campaign
    MESSAGE_FLOOD_COUNT: 100, // Number of messages to send per campaign
    GROUP_INVITE_COUNT: 10 // Number of spam groups to invite target to
};
