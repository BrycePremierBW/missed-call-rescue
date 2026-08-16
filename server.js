require('dotenv').config();
const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// 1. Initial Call Handler: Forwards the call to the business owner
app.post('/voice/incoming', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const callerNumber = req.body.From;

  // Forward call to the owner and track the call completion status
  const dial = twiml.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER,
    action: `/voice/status-callback?CallerNumber=${encodeURIComponent(callerNumber)}`,
    timeout: 20, // Rings for ~4-5 rings before dropping to missed status
  });

  dial.number(process.env.OWNER_PHONE_NUMBER);

  res.type('text/xml');
  res.send(twiml.toString());
});

// 2. Status Callback: Fires when the forward ends (completed, busy, no-answer)
app.post('/voice/status-callback', async (req, res) => {
  const dialStatus = req.body.DialCallStatus; // 'completed', 'busy', 'no-answer', 'failed', 'canceled'
  const callerNumber = req.query.CallerNumber || req.body.From;

  console.log(`Call finished with status: ${dialStatus} from ${callerNumber}`);

  // If the owner did NOT pick up:
  if (['no-answer', 'busy', 'failed', 'canceled'].includes(dialStatus)) {
    try {
      // 1. Send SMS to the Lead
      await client.messages.create({
        body: `Hi, this is ${process.env.BUSINESS_NAME}. Sorry we missed your call—we're currently on a job! What type of service are you looking for today?`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callerNumber,
      });

      // 2. Alert the Owner
      await client.messages.create({
        body: `[LEAD ALERT] Missed call from ${callerNumber}. Automated rescue text has been sent.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.OWNER_PHONE_NUMBER,
      });

      console.log(`Rescue text sent to ${callerNumber}`);
    } catch (err) {
      console.error('Error sending auto-response:', err);
    }
  }

  const twiml = new twilio.twiml.VoiceResponse();
  res.type('text/xml');
  res.send(twiml.toString());
});

// 3. SMS Reply Handler: Forwards lead text replies directly to the business owner
app.post('/sms/incoming', async (req, res) => {
  const fromNumber = req.body.From;
  const incomingMessage = req.body.Body;

  // Forward incoming lead text to owner
  try {
    await client.messages.create({
      body: `[LEAD REPLY - ${fromNumber}]: "${incomingMessage}"`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.OWNER_PHONE_NUMBER,
    });
  } catch (err) {
    console.error('Error forwarding lead SMS:', err);
  }

  const twiml = new twilio.twiml.MessagingResponse();
  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rescue system running on port ${PORT}`));
