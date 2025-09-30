const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let client;
let qrImageData = null;
let clientState = 'INITIALIZING'; 

function createClient() {
  // Clean up existing client first
  if (client) {
    try {
      client.removeAllListeners(); // Remove all event listeners
      client.destroy();
    } catch (error) {
      console.error('Error cleaning up existing client:', error);
    }
  }

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: "render-bot-session",
      dataPath: "./sessions"
    })
  });

  client.on('qr', async (qr) => {
    try {
      qrImageData = await QRCode.toDataURL(qr);
      clientState = 'QR_READY';
      console.log("New QR code generated and available at /qr endpoint");
    } catch (error) {
      console.error("Error generating QR code:", error);
    }
  });

  client.on('ready', () => {
    console.log('WhatsApp bot is ready!');
    clientState = 'AUTHENTICATED';
    // Clear QR code data when authenticated - no longer needed
    qrImageData = null;
  });

  client.on('authenticated', () => {
    console.log('WhatsApp client authenticated');
    clientState = 'AUTHENTICATED';
    // Clear QR code data when authenticated
    qrImageData = null;
  });

  client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
    clientState = 'DISCONNECTED';
    qrImageData = null; // Clear QR code on auth failure
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp client disconnected:', reason);
    clientState = 'DISCONNECTED';
    qrImageData = null; // Clear QR code on disconnect
  });

  return client;
}

// Initialize client only once
createClient();

app.get('/qr', (req, res) => {
  if (qrImageData) {
    res.send(`
      <html>
        <body style="text-align: center; font-family: Arial;">
          <h2>Scan QR Code with WhatsApp</h2>
          <img src="${qrImageData}" style="border: 1px solid #ccc; padding: 10px;">
          <p>State: ${clientState}</p>
          <p><a href="/qr">Refresh</a></p>
        </body>
      </html>
    `);
  } else if (clientState === 'AUTHENTICATED') {
    res.send(`
      <html>
        <body style="text-align: center; font-family: Arial;">
          <h2>✅ WhatsApp is Connected!</h2>
          <p>State: ${clientState}</p>
          <p>User: ${client.info?.wid?.user || 'Unknown'}</p>
          <p><a href="/health">Check Health</a> | <a href="/groups">View Groups</a></p>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <body style="text-align: center; font-family: Arial;">
          <h2>⏳ ${clientState === 'INITIALIZING' ? 'Initializing...' : 'Waiting for QR Code...'}</h2>
          <p>State: ${clientState}</p>
          <p><a href="/qr">Refresh</a> | <a href="#" onclick="fetch('/reauth', {method: 'POST'}).then(() => location.reload())">Force Re-authenticate</a></p>
        </body>
      </html>
    `);
  }
});

app.post('/reauth', async (req, res) => {
  try {
    console.log('Force re-authentication requested');
    
    // Clean up current client properly
    if (client) {
      client.removeAllListeners(); // Remove all event listeners to prevent memory leaks
      await client.destroy();
    }
    
    // Reset state and clear QR data
    clientState = 'INITIALIZING';
    qrImageData = null;

    // Create new client and initialize
    createClient();
    client.initialize();
    
    res.json({
      success: true,
      message: 'Re-authentication initiated. Check /qr for new QR code.',
      state: clientState
    });
  } catch (error) {
    console.error('Error during re-authentication:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => {
  const healthData = {
    status: "ok",
    state: clientState,
    connected: clientState === 'AUTHENTICATED',
    timestamp: new Date().toISOString(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    }
  };

  if (client && client.info) {
    healthData.user = client.info.wid.user;
    healthData.pushname = client.info.pushname;
  }

  res.json(healthData);
});

// Function to check if client is ready
function isClientReady() {
  return client && clientState === 'AUTHENTICATED' && client.info;
}

async function getGroupChats() {
  try {
    if (!isClientReady()) {
      throw new Error('WhatsApp client is not authenticated');
    }

    const chats = await client.getChats();
    const groupChats = chats.filter(chat => chat.isGroup);
    return groupChats.map(chat => ({
      id: chat.id._serialized,
      name: chat.name,
      participantCount: chat.participants.length,
      description: chat.description || null,
      isReadOnly: chat.isReadOnly,
      createdAt: chat.createdAt ? new Date(chat.createdAt * 1000).toISOString() : null
    }));
  } catch (error) {
    console.error("Error getting group chats:", error);
    throw error;
  }
}

app.get('/groups', async (req, res) => {
  try {
    if (!isClientReady()) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready. Please scan QR code first.",
        state: clientState,
        reauth_url: "/reauth"
      });
    }

    const groupChats = await getGroupChats();
    res.json({
      success: true,
      count: groupChats.length,
      groups: groupChats,
      state: clientState
    });
  } catch (error) {
    console.error("Error in /groups endpoint:", error);
    
    // Handle connection errors and update state
    if (error.message.includes('Evaluation failed') || error.message.includes('Cannot read properties')) {
      clientState = 'DISCONNECTED'; // Update state
      qrImageData = null; // Clear QR data
      return res.status(500).json({
        success: false,
        error: "Connection lost. Please re-authenticate.",
        state: clientState,
        reauth_url: "/reauth"
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      state: clientState
    });
  }
});

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  
  try {
    if (!isClientReady()) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready. Please scan QR code first.",
        state: clientState,
        reauth_url: "/reauth"
      });
    }

    await client.sendMessage(to, message);
    res.json({ 
      success: true, 
      to, 
      message,
      state: clientState,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Error sending message:", err);
    

    if (err.message.includes('Evaluation failed') || 
        err.message.includes('Cannot read properties') ||
        err.message.includes('Session closed')) {
      
      clientState = 'DISCONNECTED';
      qrImageData = null; 
      return res.status(500).json({ 
        success: false, 
        error: "Session disconnected. Please re-authenticate.",
        state: clientState,
        reauth_url: "/reauth"
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: err.message,
      state: clientState
    });
  }
});


process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  if (client) {
    client.removeAllListeners();
    await client.destroy();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  if (client) {
    client.removeAllListeners();
    await client.destroy();
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Initialize client only once at startup
client.initialize();