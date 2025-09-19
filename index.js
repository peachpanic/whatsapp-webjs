// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// Create WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth() // stores session data
});

// Show QR in logs
client.on('qr', qr => {
    console.log('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('whtsapp client ready na');
});

// Endpoint to send messages
app.post('/send', async (req, res) => {
    const { chatId, message } = req.body;

    if (!chatId || !message) {
        return res.status(400).json({ error: 'chatId and message are required' });
    }

    try {
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Start Express
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Initialize WhatsApp
client.initialize();
