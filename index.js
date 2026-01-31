const { Client, NoAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const qrcode = require('qrcode-terminal');
const path = require('path');

const app = express();
app.use(express.json());

let qrCodeData = null;
let isClientReady = false;
let lastHeartbeat = Date.now();

const client = new Client({
  authStrategy: new NoAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
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

app.get('/reauthenticate', async (req, res) => {
  try {
    await client.logout();
    isClientReady = false;
    qrCodeData = null;

    //kill current client
    await client.destroy();

    //reinitialize client
    client.initialize();
    res.json({ success: true, message: "Logged out successfully. Please refresh /qr to get a new QR code." });
  } catch (error) {
    console.error("Error during reauthentication:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// hello 

client.on('qr', async (qr) => {
  try {
    qrCodeData = await QRCode.toDataURL(qr);
  } catch (err) {
    console.warn('Could not create data URL for QR code:', err.message);
    qrCodeData = null;
  }

  console.log('QR code generated and available at /qr endpoint');

});

client.once('ready', () => {
  console.log('WhatsApp bot is ready!');
  isClientReady = true;
  qrCodeData = null;
  lastHeartbeat = Date.now();
});


client.on('disconnected', (reason) => {
  console.log('WhatsApp client disconnected:', reason);
  isClientReady = false;
  qrCodeData = null;
  lastHeartbeat = Date.now();
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failed:', msg);
  isClientReady = false;
  lastHeartbeat = Date.now();
});

client.on('authenticated', (info) => {
  console.log('WhatsApp client authenticated');
  lastHeartbeat = Date.now();
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

function getClientInfo() {
  return new Promise(async (resolve, reject) => {
    try {
      const info = await client.info;
      resolve(info);
    } catch (error) {
      reject(error);
    }
  });
}


function getConnectionStatus() {
  const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
  const isConnected = (isClientReady || !!(client && client.info)) && timeSinceLastHeartbeat < 60000;

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

app.get('/info', async (req, res) => {
  try {
    const info = await getClientInfo();
    res.json({
      success: true,
      info
    });
  } catch (error) {
    console.error("Error in /info endpoint:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
})

app.get('/groups', async (req, res) => {
  try {

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

const PORT = process.env.PORT || 5005;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

client.initialize();
