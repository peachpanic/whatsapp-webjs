


const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();

const client = new Client({
  authStrategy: new LocalAuth()
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

client.initialize();
