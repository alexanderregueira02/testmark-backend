const express = require('express');
const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const twilio = require('twilio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── HEALTH CHECK ──────────────────────────────
app.get('/', (req, res) => res.send('Test Mark Backend is running!'));

// ── SEND EMAIL ────────────────────────────────
app.post('/send-email', async (req, res) => {
  const { gmailUser, gmailPass, to, subject, body } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });
    await transporter.sendMail({
      from: gmailUser, to, subject,
      text: body, html: body.replace(/\n/g, '<br>')
    });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── SEND SMS ──────────────────────────────────
app.post('/send-sms', async (req, res) => {
  const { twilioSid, twilioToken, twilioFrom, to, message } = req.body;
  try {
    const client = twilio(twilioSid, twilioToken);
    await client.messages.create({ body: message, from: twilioFrom, to });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── FETCH EMAILS ──────────────────────────────
app.post('/fetch-emails', async (req, res) => {
  const { gmailUser, gmailPass } = req.body;
  const emails = [];
  try {
    const imap = new Imap({
      user: gmailUser, password: gmailPass,
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });
    await new Promise((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) return reject(err);
          const total = box.messages.total;
          if (total === 0) { imap.end(); return resolve(); }
          const start = Math.max(1, total - 9);
          const f = imap.seq.fetch(`${start}:${total}`, { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)', 'TEXT'], struct: true });
          f.on('message', (msg) => {
            let header = '', text = '';
            msg.on('body', (stream, info) => {
              let buf = '';
              stream.on('data', c => buf += c.toString());
              stream.once('end', () => {
                if (info.which.includes('HEADER')) header = buf;
                else text = buf;
              });
            });
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(header + '\r\n\r\n' + text);
                emails.push({
                  from: parsed.from?.text || 'Unknown',
                  subject: parsed.subject || '(no subject)',
                  preview: (parsed.text || '').substring(0, 120),
                  date: parsed.date ? new Date(parsed.date).toLocaleDateString() : ''
                });
              } catch(e) {}
            });
          });
          f.once('end', () => { imap.end(); resolve(); });
          f.once('error', reject);
        });
      });
      imap.once('error', reject);
      imap.connect();
    });
    res.json(emails.reverse());
  } catch (e) {
    res.json([{ from: 'Error', subject: e.message, preview: 'Check credentials', date: '' }]);
  }
});

// ── CAPTURE LEAD (from website forms) ─────────
app.post('/capture-lead', async (req, res) => {
  try {
    const { name, email, phone, type, budget, message, property, source, gmailUser, gmailPass } = req.body;
    
    // Log the lead
    console.log('NEW LEAD:', { name, email, phone, type, budget, property, source });
    
    // Send notification email to Danielle if Gmail configured
    if (gmailUser && gmailPass && email) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass }
      });
      
      // Notify Danielle
      await transporter.sendMail({
        from: gmailUser,
        to: gmailUser,
        subject: `🔔 New Lead: ${name} — ${type || 'Website Inquiry'}`,
        html: `
          <h2 style="color:#111;">New Lead from miamilusorealty.com</h2>
          <table style="font-family:Arial;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:6px;color:#666;"><b>Name:</b></td><td style="padding:6px;">${name}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Email:</b></td><td style="padding:6px;">${email}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Phone:</b></td><td style="padding:6px;">${phone || 'Not provided'}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Type:</b></td><td style="padding:6px;">${type || 'Not specified'}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Budget:</b></td><td style="padding:6px;">${budget || 'Not specified'}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Property:</b></td><td style="padding:6px;">${property || 'General inquiry'}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Source:</b></td><td style="padding:6px;">${source || 'Website'}</td></tr>
            <tr><td style="padding:6px;color:#666;"><b>Message:</b></td><td style="padding:6px;">${message || 'No message'}</td></tr>
          </table>
          <p style="margin-top:16px;color:#666;font-size:13px;">This lead has been automatically added to Test Mark's CRM.</p>
        `
      });

      // Send welcome email to lead
      await transporter.sendMail({
        from: gmailUser,
        to: email,
        subject: 'Thank you for your interest — Miami Luso Realty',
        html: `
          <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;">
            <h2 style="color:#111;">Thank you, ${name.split(' ')[0]}!</h2>
            <p style="color:#555;line-height:1.8;">We received your inquiry and Danielle Lisboa Martins will contact you personally within 24 hours.</p>
            ${property ? `<p style="color:#555;line-height:1.8;">Property of interest: <strong>${property}</strong></p>` : ''}
            <p style="color:#555;line-height:1.8;">In the meantime, explore our full portfolio at <a href="https://miamilusorealty.com" style="color:#333;">miamilusorealty.com</a></p>
            <p style="color:#888;font-size:12px;margin-top:24px;">Miami Luso Realty · Danielle Lisboa Martins · Attorney & International Broker</p>
          </div>
        `
      });
    }
    
    res.json({ success: true, message: 'Lead captured and notifications sent' });
  } catch (e) {
    console.error('Lead capture error:', e);
    res.json({ success: false, error: e.message });
  }
});


// ── AI CHAT ENDPOINT ──────────────────────────
app.post('/chat', async (req, res) => {
  const { messages, system } = req.body;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: system,
        messages: messages
      })
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Test Mark Backend running on port ${PORT}`));
