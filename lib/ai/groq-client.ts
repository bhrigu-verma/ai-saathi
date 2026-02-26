import { Groq } from 'groq';
import { logEvent } from '../utils/logger';

class GroqClient {
  private groq: Groq;
  private rateLimitQueue: Array<{resolve: Function, reject: Function, request: () => Promise<any>}> = [];
  private isProcessingQueue = false;

  constructor() {
    if (!process.env.GROQ_API_KEY) {
      logEvent('missing_api_key', { provider: 'groq', error: 'GROQ_API_KEY not set' });
      throw new Error('GROQ_API_KEY is required');
    }
    
    this.groq = new Groq({ 
      apiKey: process.env.GROQ_API_KEY,
      dangerouslyAllowBrowser: true // Note: Only for development/testing
    });
  }

  /**
   * Make a request to the Groq LLM with rate limiting and retry logic
   */
  async chatCompletion(messages: Array<{role: string, content: string}>, options: {
    model?: string,
    temperature?: number,
    maxTokens?: number
  } = {}): Promise<any> {
    const model = options.model || process.env.GROQ_LLM_MODEL || 'llama-3.1-70b-versatile';
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 500;

    return this.makeRequestWithRetry(async () => {
      const response = await this.groq.chat.completions.create({
        messages,
        model,
        temperature,
        max_tokens: maxTokens
      });

      logEvent('groq_request_success', {
        model,
        tokens_used: response.usage?.total_tokens,
        response_length: response.choices[0]?.message?.content?.length
      });

      return response;
    });
  }

  /**
   * Make a request with retry logic for handling rate limits
   */
  private async makeRequestWithRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    const maxRetries = 3;
    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await requestFn();
      } catch (error: any) {
        lastError = error;
        
        logEvent('groq_request_error', {
          attempt: i + 1,
          maxRetries,
          error: error.message,
          statusCode: error.status
        });

        // If it's a rate limit error, wait exponentially longer
        if (error.status === 429) {
          const delay = Math.pow(2, i) * 1000; // Exponential backoff: 1s, 2s, 4s
          await this.delay(delay);
        } else if (error.status >= 500) {
          // Server errors also warrant a retry with backoff
          const delay = Math.pow(2, i) * 1000;
          await this.delay(delay);
        } else {
          // For other errors, don't retry
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * Delay helper function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Transcribe audio using Groq Whisper
   */
  async transcribeAudio(audioPath: string, language?: string): Promise<string> {
    return this.makeRequestWithRetry(async () => {
      const transcription = await this.groq.audio.transcriptions.create({
        file: await this.getFileBuffer(audioPath),
        model: process.env.GROQ_ASR_MODEL || 'whisper-large-v3-turbo',
        language: language || 'hi', // Default to Hindi for Indian context
      });

      logEvent('groq_asr_success', {
        model: process.env.GROQ_ASR_MODEL || 'whisper-large-v3-turbo',
        language: language || 'hi',
        text_length: transcription.text.length
      });

      return transcription.text;
    });
  }

  /**
   * Helper to get file buffer for audio transcription
   */
  private async getFileBuffer(path: string): Promise<File> {
    // In a Node.js environment, we need to read the file differently
    // This implementation would work in a browser environment
    // For Node.js, we'd need to use node-fetch or similar to create a Blob/File
    const fs = await import('fs');
    const buffer = fs.readFileSync(path);
    
    // Create a File-like object for Node.js since Groq SDK expects a File/Blob
    return {
      arrayBuffer: async () => buffer.buffer,
      slice: (start?: number, end?: number) => Buffer.from(buffer.subarray(start, end)),
      stream: () => {
        // Implementation would depend on specific requirements
        throw new Error("Not implemented for Node.js environment");
      },
      text: async () => buffer.toString('utf8'),
      size: buffer.length,
      type: 'audio/mpeg', // Default type, could be detected from file
      name: path.split('/').pop() || 'audio.mp3',
      lastModified: Date.now()
    } as any as File;
  }
}

// Singleton instance
let groqClient: GroqClient;

export function getGroqClient(): GroqClient {
  if (!groqClient) {
    groqClient = new GroqClient();
  }
  return groqClient;
}

export default GroqClient;