const express = require('express');
const cors = require('cors');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const twilio = require('twilio');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/fetch-emails', (req, res) => {
  const { gmailUser, gmailPass } = req.body;
  const imap = new Imap({ user: gmailUser, password: gmailPass, host: 'imap.gmail.com', port: 993, tls: true });
  let emails = [];
  imap.once('ready', () => {
    imap.openBox('INBOX', true, () => {
      imap.search(['ALL'], (err, results) => {
        if (err || !results.length) { imap.end(); return res.json([]); }
        const fetch = imap.fetch(results.slice(-10), { bodies: '' });
        fetch.on('message', msg => {
          msg.on('body', stream => {
            simpleParser(stream, (err, parsed) => {
              if (!err) emails.push({ from: parsed.from?.text || '', subject: parsed.subject || '', preview: (parsed.text || '').slice(0, 100), date: parsed.date?.toLocaleDateString() || '' });
            });
          });
        });
        fetch.once('end', () => { imap.end(); });
      });
    });
  });
  imap.once('end', () => res.json(emails));
  imap.once('error', () => res.json([]));
  imap.connect();
});

app.post('/send-email', (req, res) => {
  const { gmailUser, gmailPass, to, subject, body } = req.body;
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
  transporter.sendMail({ from: gmailUser, to, subject, text: body }, (err) => {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

app.post('/send-sms', (req, res) => {
  const { twilioSid, twilioToken, twilioFrom, to, message } = req.body;
  const client = twilio(twilioSid, twilioToken);
  client.messages.create({ body: message, from: twilioFrom, to })
    .then(() => res.json({ success: true }))
    .catch(() => res.json({ success: false }));
});

app.listen(3000, () => console.log('Test Mark backend running'));
