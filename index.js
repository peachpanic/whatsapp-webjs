const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "render-bot-session",
    dataPath: "./sessions"
  })
});

client.on('qr', async (qr) => {
  const qrImage = await QRCode.toDataURL(qr);
  app.get('/qr', (req, res) => {
    res.send(`<img src="${qrImage}">`);
  });
  console.log("QR available at /qr endpoint");
});

client.on('ready', () => {
  console.log('WhatsApp bot is ready!');
});

// Function to get all group chat IDs
async function getGroupChats() {
  try {
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

// helath checking endpoint

app.get('/health', (req, res) => {
  if (client.info) {
    res.json({
      status: "ok",
      connected: true,
      user: client.info.wid.user
    });
  } else {
    res.json({
      status: "ok",
      connected: false
    });
  }
});

app.get('/groups', async (req, res) => {
  try {
    if (!client.info) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready. Please scan QR code first."
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
    await client.sendMessage(to, message);
    res.json({ success: true, to, message });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

client.initialize();

