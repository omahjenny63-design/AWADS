// whatsappClient.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class WhatsAppClientManager {
    constructor(clientId, sendMessageCallback, updateStatusCallback) {
        this.clientId = clientId;
        this.sendMessageCallback = sendMessageCallback; // Callback to send Telegram messages
        this.updateStatusCallback = updateStatusCallback; // Callback to update status in main orchestrator
        this.qrCode = null;
        this.client = null;
        this.status = 'idle'; // idle, qr_ready, authenticating, ready, busy, error
        this.initializeClient();
    }

    initializeClient() {
        const sessionPath = path.join(config.WHATSAPP_SESSION_PATH, `client-${this.clientId}`);
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        const proxy = config.PROXY_LIST[this.clientId % config.PROXY_LIST.length]; // Rotate proxies
        const clientOptions = {
            authStrategy: new LocalAuth({ clientId: `client-${this.clientId}`, dataPath: config.WHATSAPP_SESSION_PATH }),
            puppeteer: {
                headless: true, // Run in headless mode for production
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process', // This might save some RAM for some environments
                    '--disable-gpu',
                    ...(proxy ? [`--proxy-server=${proxy}`] : [])
                ]
            }
        };

        this.client = new Client(clientOptions);

        this.client.on('qr', (qr) => {
            console.log(`Client ${this.clientId} QR RECEIVED`, qr);
            qrcode.generate(qr, { small: true });
            this.qrCode = qr;
            this.status = 'qr_ready';
            this.updateStatusCallback(this.clientId, 'qr_ready', qr);
        });

        this.client.on('ready', () => {
            console.log(`Client ${this.clientId} is READY!`);
            this.status = 'ready';
            this.qrCode = null; // Clear QR once ready
            this.updateStatusCallback(this.clientId, 'ready');
            this.sendMessageCallback(`WhatsApp client *${this.clientId}* is now *READY* and operational!`);
        });

        this.client.on('authenticated', (session) => {
            console.log(`Client ${this.clientId} AUTHENTICATED`);
            this.status = 'authenticating'; // Intermediate state
            this.updateStatusCallback(this.clientId, 'authenticating');
        });

        this.client.on('auth_failure', msg => {
            console.error(`Client ${this.clientId} AUTHENTICATION FAILURE`, msg);
            this.status = 'error';
            this.updateStatusCallback(this.clientId, 'error', `Auth failed: ${msg}`);
            this.sendMessageCallback(`WhatsApp client *${this.clientId}* *FAILED* to authenticate: ${msg}. Please re-add.`);
            this.destroy(); // Destroy client on auth failure to allow re-initialization
        });

        this.client.on('disconnected', (reason) => {
            console.log(`Client ${this.clientId} DISCONNECTED`, reason);
            this.status = 'disconnected';
            this.updateStatusCallback(this.clientId, 'disconnected', reason);
            this.sendMessageCallback(`WhatsApp client *${this.clientId}* *DISCONNECTED*: ${reason}.`);
            this.destroy(); // Destroy client on disconnect
        });

        this.client.on('message', message => {
            // Optional: Handle incoming messages if needed for dynamic interaction
            // For a ban bot, we generally don't need to process incoming messages.
        });

        this.client.initialize().catch(e => {
            console.error(`Client ${this.clientId} initialization error:`, e);
            this.status = 'error';
            this.updateStatusCallback(this.clientId, 'error', `Init error: ${e.message}`);
        });
    }

    async destroy() {
        if (this.client) {
            try {
                await this.client.destroy();
                console.log(`Client ${this.clientId} destroyed.`);
                this.status = 'destroyed';
                this.updateStatusCallback(this.clientId, 'destroyed');
            } catch (e) {
                console.error(`Error destroying client ${this.clientId}:`, e);
            }
        }
    }

    async getStatus() {
        return {
            id: this.clientId,
            status: this.status,
            qrCode: this.qrCode
        };
    }

    async sendMessage(targetNumber, message) {
        if (this.status !== 'ready') {
            throw new Error(`Client ${this.clientId} is not ready to send messages. Status: ${this.status}`);
        }
        await this.client.sendMessage(targetNumber, message);
        console.log(`Client ${this.clientId} sent message to ${targetNumber}`);
    }

    // Placeholder for actual reporting logic (simulated)
    async sendReport(targetNumber, reportType) {
        if (this.status !== 'ready') {
            throw new Error(`Client ${this.clientId} is not ready to report. Status: ${this.status}`);
        }
        // In a real scenario, this would involve complex interaction with WhatsApp Web UI
        // or finding a specific vulnerability. For now, we simulate success.
        console.log(`Client ${this.clientId} *SIMULATED* report of type '${reportType}' against ${targetNumber}`);
        // A more advanced implementation might try to navigate to the contact info page and click 'Report'
        // This is highly dependent on whatsapp-web.js capabilities and WhatsApp Web UI.
        // Example (conceptual, not directly supported by whatsapp-web.js's current API for reporting):
        // await this.client.getPage()._client.send('Page.navigate', { url: `https://web.whatsapp.com/send?phone=${targetNumber}&text=&app_absent=0` });
        // await this.client.evaluate(() => {
        //     // Complex DOM manipulation to find and click report button
        // });
        return true;
    }

    // Placeholder for adding to group (simulated)
    async addTargetToGroup(targetNumber, groupSubject = `Spam Group ${Date.now()}`) {
        if (this.status !== 'ready') {
            throw new Error(`Client ${this.clientId} is not ready to create/add to group. Status: ${this.status}`);
        }
        try {
            const group = await this.client.createGroup(groupSubject, [targetNumber]);
            console.log(`Client ${this.clientId} created group '${groupSubject}' and added ${targetNumber}. Group ID: ${group.id._serialized}`);
            return group.id._serialized;
        } catch (e) {
            console.error(`Client ${this.clientId} failed to add ${targetNumber} to group:`, e);
            throw new Error(`Failed to add target to group: ${e.message}`);
        }
    }
}

module.exports = WhatsAppClientManager;
