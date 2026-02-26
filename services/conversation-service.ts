import { Redis } from '@upstash/redis';
import { IntentResult } from '../types';
import { logEvent } from '../lib/utils/logger';

// Define conversation states
type ConversationState = 
  | 'IDLE'
  | 'COLLECTING_INFO'
  | 'AWAITING_CONFIRMATION'
  | 'PROCESSING'
  | 'DONE';

interface ConversationContext {
  state: ConversationState;
  intent?: string;
  entities?: Record<string, any>;
  collectedData?: Record<string, any>;
  createdAt: number;
  lastActivity: number;
}

class ConversationService {
  private redis: Redis;
  private readonly CONVERSATION_TTL = 30 * 60; // 30 minutes in seconds

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Initialize a new conversation for a user
   */
  async initializeConversation(userId: string): Promise<void> {
    const context: ConversationContext = {
      state: 'IDLE',
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    await this.redis.setex(
      this.getConversationKey(userId),
      this.CONVERSATION_TTL,
      JSON.stringify(context)
    );

    logEvent('conversation_initialized', { userId });
  }

  /**
   * Get conversation context for a user
   */
  async getConversationContext(userId: string): Promise<ConversationContext | null> {
    const contextJson = await this.redis.get(this.getConversationKey(userId));
    
    if (!contextJson) {
      return null;
    }

    return JSON.parse(contextJson as string) as ConversationContext;
  }

  /**
   * Update conversation state
   */
  async updateConversationState(
    userId: string, 
    newState: ConversationState, 
    data?: Partial<ConversationContext>
  ): Promise<void> {
    let context = await this.getConversationContext(userId);

    if (!context) {
      // Initialize if doesn't exist
      await this.initializeConversation(userId);
      context = await this.getConversationContext(userId);
      
      if (!context) {
        throw new Error('Failed to initialize conversation');
      }
    }

    // Update the context with new state and any additional data
    context.state = newState;
    context.lastActivity = Date.now();

    if (data) {
      // Merge additional data
      Object.assign(context, data);
    }

    // Update in Redis with extended TTL
    await this.redis.setex(
      this.getConversationKey(userId),
      this.CONVERSATION_TTL,
      JSON.stringify(context)
    );

    logEvent('conversation_state_updated', {
      userId,
      newState,
      lastActivity: context.lastActivity
    });
  }

  /**
   * Process incoming message and update conversation state
   */
  async processMessage(userId: string, message: string, intentResult: IntentResult): Promise<ConversationContext> {
    let context = await this.getConversationContext(userId);

    if (!context) {
      // Initialize new conversation
      await this.initializeConversation(userId);
      context = {
        state: 'IDLE',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
    }

    // Update last activity
    context.lastActivity = Date.now();

    // Based on the intent, determine the next state
    switch (intentResult.intent) {
      case 'greeting':
        // For greetings, remain in IDLE or transition to a welcome state
        context.state = 'IDLE';
        break;

      case 'earnings_query':
        // For earnings queries, we might need to collect additional information
        if (context.state === 'IDLE') {
          context.state = 'PROCESSING';
          context.intent = intentResult.intent;
          context.entities = intentResult.entities;
        }
        break;

      case 'dispute_help':
        // For dispute help, we might need to collect more information
        if (context.state === 'IDLE') {
          // If we have enough entities, go to processing; otherwise collect info
          if (this.hasRequiredEntities(intentResult, 'dispute_help')) {
            context.state = 'PROCESSING';
            context.intent = intentResult.intent;
            context.entities = intentResult.entities;
          } else {
            context.state = 'COLLECTING_INFO';
            context.intent = intentResult.intent;
            context.entities = intentResult.entities;
            context.collectedData = {};
          }
        } else if (context.state === 'COLLECTING_INFO') {
          // If we're collecting info, update collected data
          context.collectedData = {
            ...(context.collectedData || {}),
            ...this.extractAdditionalEntities(message, context.intent!)
          };

          // Check if we have all required entities now
          if (this.hasAllRequiredEntities(context)) {
            context.state = 'AWAITING_CONFIRMATION';
          }
        } else if (context.state === 'AWAITING_CONFIRMATION') {
          // Process confirmation and move to processing
          context.state = 'PROCESSING';
        }
        break;

      default:
        // For unknown intents, remain in IDLE
        context.state = 'IDLE';
        break;
    }

    // Update in Redis
    await this.redis.setex(
      this.getConversationKey(userId),
      this.CONVERSATION_TTL,
      JSON.stringify(context)
    );

    logEvent('message_processed_in_conversation', {
      userId,
      intent: intentResult.intent,
      currentState: context.state,
      confidence: intentResult.confidence
    });

    return context;
  }

  /**
   * Check if required entities are present for an intent
   */
  private hasRequiredEntities(intentResult: IntentResult, intentType: string): boolean {
    // For now, we'll implement basic checks - in a real system, this would be more sophisticated
    switch (intentType) {
      case 'dispute_help':
        // For disputes, we typically need platform and issue_type
        return !!(intentResult.entities.platform && intentResult.entities.issue_type);
      default:
        return true;
    }
  }

  /**
   * Check if all required entities are collected
   */
  private hasAllRequiredEntities(context: ConversationContext): boolean {
    if (!context.intent || !context.entities) {
      return false;
    }

    switch (context.intent) {
      case 'dispute_help':
        // Check if we have platform and issue_type either in entities or collectedData
        const platform = context.entities.platform || context.collectedData?.platform;
        const issueType = context.entities.issue_type || context.collectedData?.issue_type;
        return !!(platform && issueType);
      default:
        return true;
    }
  }

  /**
   * Extract additional entities from user message
   */
  private extractAdditionalEntities(message: string, intent: string): Record<string, any> {
    // Basic entity extraction - in a real system, this would use NLP
    const entities: Record<string, any> = {};

    // For dispute help, look for keywords related to dates, amounts, etc.
    if (intent === 'dispute_help') {
      // Look for date patterns
      const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/;
      const dateMatch = message.match(dateRegex);
      if (dateMatch) {
        entities.date = dateMatch[0];
      }

      // Look for amount patterns
      const amountRegex = /[₹$]\s*(\d{1,3}(?:,?\d{3})*(?:\.\d{2})?)/;
      const amountMatch = message.match(amountRegex);
      if (amountMatch) {
        entities.amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      }
    }

    return entities;
  }

  /**
   * Reset conversation to IDLE state
   */
  async resetConversation(userId: string): Promise<void> {
    await this.updateConversationState(userId, 'IDLE', {
      intent: undefined,
      entities: undefined,
      collectedData: undefined
    });

    logEvent('conversation_reset', { userId });
  }

  /**
   * Get Redis key for conversation
   */
  private getConversationKey(userId: string): string {
    return `conversation:${userId}`;
  }

  /**
   * Clean up expired conversations (can be called periodically)
   */
  async cleanupExpiredConversations(): Promise<number> {
    // In Upstash Redis, expired keys are cleaned up automatically
    // This method could be used for additional housekeeping if needed
    logEvent('conversation_cleanup_run', {});
    return 0; // Return number of cleaned conversations
  }
}

// Singleton instance would be created with Redis dependency
let conversationService: ConversationService | null = null;

export function getConversationService(redis: Redis): ConversationService {
  if (!conversationService) {
    conversationService = new ConversationService(redis);
  }
  return conversationService;
}

export default ConversationService;