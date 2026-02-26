import { NextRequest } from 'next/server';
import { Queue } from 'bullmq';
import { Redis } from '@upstash/redis';
import { WhatsAppMessage } from '../../../../lib/whatsapp/baileys-client';
import { logEvent } from '../../../../lib/utils/logger';

// Initialize Redis connection
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Initialize BullMQ queue for WhatsApp messages
const whatsappQueue = new Queue('whatsapp-messages', {
  connection: {
    url: process.env.UPSTASH_REDIS_REST_URL,
  }
});

export async function POST(request: NextRequest) {
  try {
    // Verify webhook request (implement according to your WhatsApp Business API setup)
    const signature = request.headers.get('X-Signature');
    
    // For Baileys client, we're handling messages internally, 
    // but this endpoint can still serve as a health check or for future webhook integration
    
    const body = await request.json();
    
    logEvent('whatsapp_webhook_received', {
      body: body,
      headers: Object.fromEntries(request.headers.entries())
    });

    // Add the message to the processing queue
    if (body.entry && body.entry[0] && body.entry[0].changes) {
      for (const change of body.entry[0].changes) {
        if (change.value?.messages) {
          for (const message of change.value.messages) {
            const whatsappMessage: WhatsAppMessage = {
              id: message.id,
              from: message.from,
              type: message.type,
              content: message[type] || message.text?.body || 'Unknown message',
              timestamp: parseInt(message.timestamp, 10),
            };

            // Add to processing queue
            await whatsappQueue.add('process-message', whatsappMessage, {
              jobId: message.id,
              removeOnComplete: true,
              removeOnFail: true
            });

            logEvent('whatsapp_message_queued', {
              messageId: message.id,
              sender: message.from,
              type: message.type
            });
          }
        }
      }
    }

    // Respond to acknowledge receipt
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    logEvent('whatsapp_webhook_error', {
      error: error.message,
      stack: error.stack
    });

    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

// GET handler for webhook verification (used during setup)
export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get('hub.mode');
    const token = request.nextUrl.searchParams.get('hub.verify_token');
    const challenge = request.nextUrl.searchParams.get('hub.challenge');

    // Verify token matches expected value
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logEvent('whatsapp_webhook_verified', { challenge });
      return new Response(challenge, { status: 200 });
    } else {
      logEvent('whatsapp_webhook_verification_failed', { mode, token });
      return new Response('Forbidden', { status: 403 });
    }
  } catch (error) {
    logEvent('whatsapp_webhook_verification_error', {
      error: error.message
    });
    return new Response('Internal server error', { status: 500 });
  }
}