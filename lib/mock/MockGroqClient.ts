import { logEvent } from '../utils/logger';

class MockGroqClient {
  private fallbackResponses: Record<string, string> = {
    'greeting': "Namaste! Main Saathi hoon. Thodi technical problem hai — thodi der mein try karein. 🙏",
    'earnings_query': "Income dekhne mein problem aa rahi hai. UPI screenshot bhejo.",
    'dispute_help': "Platform ka naam aur kya hua — detail mein batao.",
    'unknown': "Thoda aur detail mein batao — income, account ya koi aur cheez?"
  };

  /**
   * Mock chat completion
   */
  async chatCompletion(messages: Array<{role: string, content: string}>, options: {
    model?: string,
    temperature?: number,
    maxTokens?: number
  } = {}): Promise<any> {
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage.content.toLowerCase();

    logEvent('mock_groq_chat_completion', {
      content: lastMessage.content,
      model: options.model
    });

    // Simulate different responses based on content
    let responseContent = '';

    if (content.includes('kitna') || content.includes('income') || content.includes('paisa')) {
      // Mock earnings response
      responseContent = JSON.stringify({
        intent: 'earnings_query',
        confidence: 0.9,
        entities: { platform: 'zomato', time_period: 'today', amount: 847 }
      });
    } else if (content.includes('account') || content.includes('band') || content.includes('problem')) {
      // Mock dispute response
      responseContent = JSON.stringify({
        intent: 'dispute_help',
        confidence: 0.85,
        entities: { platform: 'zomato', issue_type: 'account_suspended' }
      });
    } else if (content.includes('namaste') || content.includes('hello')) {
      // Mock greeting response
      responseContent = JSON.stringify({
        intent: 'greeting',
        confidence: 0.95,
        entities: {}
      });
    } else {
      // Default unknown response
      responseContent = JSON.stringify({
        intent: 'unknown',
        confidence: 0.6,
        entities: {}
      });
    }

    // Simulate API delay
    await this.delay(500);

    return {
      choices: [{
        message: {
          content: responseContent
        }
      }],
      usage: {
        total_tokens: 42
      }
    };
  }

  /**
   * Mock audio transcription
   */
  async transcribeAudio(audioPath: string, language?: string): Promise<string> {
    logEvent('mock_groq_transcription', {
      audioPath,
      language: language || 'hi'
    });

    // Simulate different transcriptions based on the audio file name
    if (audioPath.includes('income')) {
      return 'Aaj mera income kitna hua?';
    } else if (audioPath.includes('problem')) {
      return 'Mera account band ho gaya hai';
    } else if (audioPath.includes('hello')) {
      return 'Namaste, kaise hain aap?';
    } else {
      return 'Ye kya hua? Thoda aur bataiye';
    }
  }

  /**
   * Delay helper function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get fallback response for a specific intent
   */
  getFallbackResponse(intent: string): string {
    return this.fallbackResponses[intent as keyof typeof this.fallbackResponses] ||
           this.fallbackResponses.unknown;
  }
}

// Singleton instance
let mockGroqClient: MockGroqClient;

export function getMockGroqClient(): MockGroqClient {
  if (!mockGroqClient) {
    mockGroqClient = new MockGroqClient();
  }
  return mockGroqClient;
}

export default MockGroqClient;