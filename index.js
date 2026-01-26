const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());

let qrCodeData = null;
let isClientReady = false;
let lastHeartbeat = Date.now();

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "render-bot-session",
  }),
  puppeteer: {
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security'
    ]
  }
});



app.get('/qr', (req, res) => {
  if (qrCodeData) {
    res.send(`<img src="${qrCodeData}">`);
  } else if (isClientReady) {
    res.json({ message: "Already authenticated" });
  } else {
    res.status(404).json({ error: "QR code not available" });
  }
});

client.on('qr', async (qr) => {
  try {
    qrCodeData = await QRCode.toDataURL(qr);
    console.log("QR code generated and available at /qr endpoint");
  } catch (error) {
    console.error("Error generating QR code:", error);
  }
});

// hello 

client.on('ready', () => {
  console.log('WhatsApp bot is ready!');
  isClientReady = true;
  qrCodeData = null; // Clear QR code data when ready
  lastHeartbeat = Date.now();
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp client disconnected:', reason);
  isClientReady = false;
  qrCodeData = null;
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failed:', msg);
  isClientReady = false;
});


setInterval(async () => {
  if (isClientReady) {
    try {
      await client.getState();
      lastHeartbeat = Date.now();
    } catch (error) {
      console.error("Heartbeat failed:", error);
      isClientReady = false;
    }
  }
}, 30000); // Check every 30 seconds

function getGroupChats() {
  return new Promise(async (resolve, reject) => {
    try {
      const chats = await client.getChats();
      const groupChats = chats.filter(chat => chat.isGroup);
      const groupData = groupChats.map(group => ({
        id: group.id._serialized,
        name: group.name,
        participants: group.participants.map(p => p.id._serialized)
      }));
      resolve(groupData);
    } catch (error) {
      reject(error);
    }
  });
}


function getConnectionStatus() {
  const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
  const isConnected = isClientReady && timeSinceLastHeartbeat < 60000; // 1 minute threshold
  
  return {
    connected: isConnected,
    ready: isClientReady,
    lastHeartbeat: new Date(lastHeartbeat).toISOString(),
    timeSinceLastHeartbeat
  };
}

app.get('/health', async (req, res) => {
  const connectionStatus = getConnectionStatus();
  
  if (connectionStatus.connected && client.info) {
    res.json({
      status: "ok",
      connected: true,
      user: client.info.wid.user,
      ...connectionStatus
    });
  } else if (!connectionStatus.connected) {
    res.status(503).json({
      status: "disconnected",
      connected: false,
      error: "WhatsApp client is not connected or responsive",
      ...connectionStatus
    });
  } else {
    res.status(503).json({
      status: "not_ready",
      connected: false,
      error: "WhatsApp client is not ready",
      ...connectionStatus
    });
  }
});

app.get('/groups', async (req, res) => {
  try {
    const connectionStatus = getConnectionStatus();
    if (!connectionStatus.connected) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp client is not connected or ready. Please check /health endpoint.",
        connectionStatus
      });
    }

    const groupChats = await getGroupChats();
    res.json({
      success: true,
      count: groupChats.length,
      groups: groupChats
    });
  } catch (error) {
    console.error("Error in /groups endpoint:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  try {
    const connectionStatus = getConnectionStatus();
    if (!connectionStatus.connected) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp client is not connected or ready",
        connectionStatus
      });
    }

    await client.sendMessage(to, message);
    res.json({ success: true, to, message });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  try {
    await client.destroy();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

const PORT = process.env.PORT || 5003;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

client.initialize();
