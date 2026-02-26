import makeWASocket, { 
  WASocket, 
  WAMessage, 
  proto, 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion,
  MessageUpsertType,
  ParticipantAction,
  BaileysEventMap,
  GroupMetadata
} from '@whiskeysockets/baileys';
import { Redis } from '@upstash/redis';
import { Queue, Worker } from 'bullmq';
import { logEvent } from '../utils/logger';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Types for WhatsApp messages
export interface WhatsAppMessage {
  id: string;
  from: string; // Phone number
  type: 'text' | 'image' | 'audio' | 'document' | 'button' | 'interactive';
  content: string;
  timestamp: number;
  audioUrl?: string;
  imageUrl?: string;
  documentUrl?: string;
}

export interface WhatsAppContact {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
  participants: WhatsAppContact[];
}

class BaileysClient {
  private socket: WASocket | undefined;
  private redis: Redis;
  private messageQueue: Queue;
  private isInitialized = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(redis: Redis) {
    this.redis = redis;
    this.messageQueue = new Queue('whatsapp-messages', {
      connection: {
        url: process.env.UPSTASH_REDIS_REST_URL,
      }
    });
  }

  /**
   * Initialize the WhatsApp client with Baileys
   */
  async initialize(): Promise<void> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('./whatsapp_session');
      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ['Saathi', 'Chrome', '1.0.0'] // Custom browser identity
      });

      // Set up event handlers
      this.setupEventHandlers(saveCreds);

      this.isInitialized = true;
      logEvent('whatsapp_client_initialized', { success: true });

      // Start processing queued messages
      this.startMessageProcessor();
    } catch (error) {
      logEvent('whatsapp_client_init_error', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Set up event handlers for the WhatsApp socket
   */
  private setupEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;

    // Handle received messages
    this.socket.ev.on('messages.upsert', async ({ messages, type }: { messages: WAMessage[], type: MessageUpsertType }) => {
      logEvent('whatsapp_messages_upsert', { count: messages.length, type });

      for (const message of messages) {
        if (message.key.fromMe) continue; // Skip outgoing messages

        try {
          await this.handleIncomingMessage(message);
        } catch (error) {
          logEvent('whatsapp_handle_message_error', {
            messageId: message.key.id,
            error: error.message
          });
        }
      }
    });

    // Handle connection updates
    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        logEvent('whatsapp_connection_closed', {
          shouldReconnect,
          reason: lastDisconnect?.error
        });

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          setTimeout(() => {
            this.reconnectAttempts++;
            logEvent('whatsapp_reconnecting', { attempt: this.reconnectAttempts });
            this.initialize().catch(err => {
              logEvent('whatsapp_reconnect_failed', { error: err.message });
            });
          }, 5000); // Wait 5 seconds before reconnecting
        } else {
          logEvent('whatsapp_max_reconnect_attempts', { attempts: this.reconnectAttempts });
        }
      } else if (connection === 'open') {
        this.reconnectAttempts = 0;
        logEvent('whatsapp_connection_open', { success: true });
      }
    });

    // Handle credential updates
    this.socket.ev.on('creds.update', saveCreds);
  }

  /**
   * Handle incoming WhatsApp message
   */
  private async handleIncomingMessage(message: WAMessage): Promise<void> {
    if (!message.message) return;

    const senderId = message.key.remoteJid?.replace('@s.whatsapp.net', '') || '';
    const messageId = message.key.id || '';

    // Determine message type and extract content
    let messageType: WhatsAppMessage['type'] = 'text';
    let content = '';
    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    let documentUrl: string | undefined;

    // Process different message types
    if (message.message.conversation) {
      content = message.message.conversation;
      messageType = 'text';
    } else if (message.message.extendedTextMessage?.text) {
      content = message.message.extendedTextMessage.text;
      messageType = 'text';
    } else if (message.message.imageMessage) {
      messageType = 'image';
      imageUrl = await this.downloadMedia(message, 'image');
      content = message.message.imageMessage.caption || 'Image message';
    } else if (message.message.audioMessage) {
      messageType = 'audio';
      audioUrl = await this.downloadMedia(message, 'audio');
      content = 'Audio message';
    } else if (message.message.documentMessage) {
      messageType = 'document';
      documentUrl = await this.downloadMedia(message, 'document');
      content = message.message.documentMessage.fileName || 'Document message';
    } else if (message.message.videoMessage) {
      messageType = 'document'; // Treat video as document
      documentUrl = await this.downloadMedia(message, 'video');
      content = message.message.videoMessage.caption || 'Video message';
    } else {
      // Unsupported message type
      logEvent('whatsapp_unsupported_message_type', {
        messageId,
        messageType: Object.keys(message.message)[0]
      });
      return;
    }

    // Create WhatsApp message object
    const whatsappMessage: WhatsAppMessage = {
      id: messageId,
      from: senderId,
      type: messageType,
      content,
      timestamp: message.messageTimestamp ? Number(message.messageTimestamp) : Date.now(),
      audioUrl,
      imageUrl,
      documentUrl
    };

    // Add message to queue for processing
    await this.messageQueue.add('process-message', whatsappMessage, {
      jobId: messageId,
      removeOnComplete: true,
      removeOnFail: true
    });

    logEvent('whatsapp_message_queued', {
      messageId,
      sender: senderId,
      type: messageType
    });
  }

  /**
   * Download media from WhatsApp message
   */
  private async downloadMedia(message: WAMessage, mediaType: 'image' | 'audio' | 'document' | 'video'): Promise<string> {
    if (!this.socket) throw new Error('Socket not initialized');

    let stream;
    if (mediaType === 'image' && message.message?.imageMessage) {
      stream = await this.socket.downloadMediaMessage(message);
    } else if (mediaType === 'audio' && message.message?.audioMessage) {
      stream = await this.socket.downloadMediaMessage(message);
    } else if ((mediaType === 'document' || mediaType === 'video') && message.message?.documentMessage) {
      stream = await this.socket.downloadMediaMessage(message);
    } else if (mediaType === 'video' && message.message?.videoMessage) {
      stream = await this.socket.downloadMediaMessage(message);
    } else {
      throw new Error(`Unsupported media type: ${mediaType}`);
    }

    // Create temporary file
    const fileName = `${Date.now()}_${message.key.id}.${getMediaTypeExtension(mediaType)}`;
    const filePath = path.join('/tmp', fileName);

    // Write stream to file
    const writeStream = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    return filePath;
  }

  /**
   * Start the message processor worker
   */
  private startMessageProcessor(): void {
    const worker = new Worker('whatsapp-messages', async (job) => {
      if (job.name === 'process-message') {
        const message: WhatsAppMessage = job.data;
        
        logEvent('processing_whatsapp_message', {
          messageId: message.id,
          sender: message.from,
          type: message.type
        });

        // Here you would normally process the message through your intent classifier
        // For now, we'll just log it
        await this.processMessage(message);
      }
    }, {
      connection: {
        url: process.env.UPSTASH_REDIS_REST_URL,
      }
    });

    worker.on('completed', (job) => {
      logEvent('whatsapp_message_processed', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
      logEvent('whatsapp_message_processing_failed', {
        jobId: job?.id,
        error: err.message
      });
    });
  }

  /**
   * Process a WhatsApp message
   */
  private async processMessage(message: WhatsAppMessage): Promise<void> {
    // This is where the message would be processed by the intent classifier
    // For now, we'll just log the message
    logEvent('message_processed', {
      messageId: message.id,
      from: message.from,
      type: message.type,
      content: message.content
    });
  }

  /**
   * Send a text message to a WhatsApp contact
   */
  async sendText(to: string, text: string): Promise<boolean> {
    if (!this.socket) {
      logEvent('whatsapp_send_error', { error: 'Socket not initialized' });
      return false;
    }

    try {
      const result = await this.socket.sendMessage(`${to}@s.whatsapp.net`, {
        text
      });

      logEvent('whatsapp_message_sent', {
        to,
        messageId: result.key.id,
        type: 'text'
      });

      return true;
    } catch (error) {
      logEvent('whatsapp_send_text_error', {
        to,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Send a voice message to a WhatsApp contact
   */
  async sendVoice(to: string, audioPath: string): Promise<boolean> {
    if (!this.socket) {
      logEvent('whatsapp_send_error', { error: 'Socket not initialized' });
      return false;
    }

    try {
      const result = await this.socket.sendMessage(`${to}@s.whatsapp.net`, {
        audio: { url: audioPath },
        mimetype: 'audio/mp4',
        ptt: true // Push-to-talk (voice message)
      });

      logEvent('whatsapp_voice_sent', {
        to,
        messageId: result.key.id,
        type: 'voice',
        audioPath
      });

      return true;
    } catch (error) {
      logEvent('whatsapp_send_voice_error', {
        to,
        audioPath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Send a document to a WhatsApp contact
   */
  async sendDocument(to: string, documentPath: string, filename: string): Promise<boolean> {
    if (!this.socket) {
      logEvent('whatsapp_send_error', { error: 'Socket not initialized' });
      return false;
    }

    try {
      const result = await this.socket.sendMessage(`${to}@s.whatsapp.net`, {
        document: { url: documentPath },
        mimetype: 'application/pdf',
        fileName: filename
      });

      logEvent('whatsapp_document_sent', {
        to,
        messageId: result.key.id,
        type: 'document',
        documentPath
      });

      return true;
    } catch (error) {
      logEvent('whatsapp_send_document_error', {
        to,
        documentPath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Send interactive buttons to a WhatsApp contact
   */
  async sendButtons(to: string, title: string, buttons: Array<{id: string, text: string}>): Promise<boolean> {
    if (!this.socket) {
      logEvent('whatsapp_send_error', { error: 'Socket not initialized' });
      return false;
    }

    try {
      const dynamicButtons = buttons.map((btn, idx) => ({
        buttonId: `button_${idx}`,
        buttonText: { displayText: btn.text },
        type: 1
      }));

      const result = await this.socket.sendMessage(`${to}@s.whatsapp.net`, {
        templateButtons: dynamicButtons,
        text: title
      });

      logEvent('whatsapp_buttons_sent', {
        to,
        messageId: result.key.id,
        type: 'buttons',
        buttonCount: buttons.length
      });

      return true;
    } catch (error) {
      logEvent('whatsapp_send_buttons_error', {
        to,
        buttonCount: buttons.length,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get contact information
   */
  async getContact(jid: string): Promise<WhatsAppContact | null> {
    if (!this.socket) return null;

    try {
      const contacts = await this.socket.contacts[jid];
      if (contacts) {
        return {
          id: jid,
          name: contacts.name || contacts.notify || contacts.vname,
          notify: contacts.notify,
          verifiedName: contacts.verifiedName
        };
      }
      return null;
    } catch (error) {
      logEvent('whatsapp_get_contact_error', {
        jid,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get group information
   */
  async getGroup(groupId: string): Promise<WhatsAppGroup | null> {
    if (!this.socket) return null;

    try {
      const groupMetadata = await this.socket.groupMetadata(groupId) as GroupMetadata;
      if (groupMetadata) {
        return {
          id: groupId,
          name: groupMetadata.subject,
          participants: groupMetadata.participants.map(p => ({
            id: p.id,
            name: p.name || p.displayName || p.id
          }))
        };
      }
      return null;
    } catch (error) {
      logEvent('whatsapp_get_group_error', {
        groupId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.isInitialized && !!this.socket;
  }

  /**
   * Close the WhatsApp connection
   */
  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
    }
  }
}

/**
 * Helper function to get file extension based on media type
 */
function getMediaTypeExtension(mediaType: 'image' | 'audio' | 'document' | 'video'): string {
  switch (mediaType) {
    case 'image': return 'jpg';
    case 'audio': return 'mp4';
    case 'document': return 'pdf';
    case 'video': return 'mp4';
    default: return 'bin';
  }
}

// Export singleton instance
let baileysClient: BaileysClient;

export function getBaileysClient(redis: Redis): BaileysClient {
  if (!baileysClient) {
    baileysClient = new BaileysClient(redis);
  }
  return baileysClient;
}

export type { WhatsAppMessage, WhatsAppContact, WhatsAppGroup };