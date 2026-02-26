import { getGroqClient } from './groq-client';
import { logEvent } from '../utils/logger';
import { IntentResult } from '../../types';

class IntentClassifier {
  private groqClient = getGroqClient();
  
  // Fallback responses for when classification fails
  private fallbackResponses = {
    'greeting': "Namaste! Main Saathi hoon. Thodi technical problem hai — thodi der mein try karein. 🙏",
    'earnings_query': "Income dekhne mein problem aa rahi hai. UPI screenshot bhejo.",
    'dispute_help': "Platform ka naam aur kya hua — detail mein batao.",
    'unknown': "Thoda aur detail mein batao — income, account ya koi aur cheez?"
  };

  /**
   * Classify user intent from their message
   */
  async classifyIntent(userMessage: string, detectedLanguage: string = 'hi', platforms: string[] = []): Promise<IntentResult> {
    try {
      // Prepare the prompt for intent classification
      const prompt = `
        You are Saathi, AI assistant for Indian gig workers (Zomato/Swiggy/Blinkit/Rapido/Urban Company).
        Message: ${userMessage} | Language: ${detectedLanguage} | Platforms: ${platforms.join(',')}

        Classify intent (one of): earnings_query | dispute_help | insurance_query |
        scheme_query | loan_query | greeting | unknown

        Extract entities: platform, time_period, amount (rupees), issue_type

        Return JSON ONLY:
        {"intent":"string","confidence":0.0,"entities":{"platform":"?","time_period":"?","amount":0,"issue_type":"?"}}
      `;

      // Make request to Groq LLM
      const response = await this.groqClient.chatCompletion([
        {
          role: 'user',
          content: prompt
        }
      ]);

      // Extract the response content
      const responseContent = response.choices[0]?.message?.content;

      if (!responseContent) {
        throw new Error('Empty response from LLM');
      }

      // Parse the JSON response
      let parsedResponse: IntentResult;
      try {
        // Extract JSON from response if it's wrapped in markdown
        const jsonMatch = responseContent.match(/```json\n?([\s\S]*?)\n?```|```([\s\S]*?)```|({[\s\S]*})/);
        const jsonString = jsonMatch?.[1] || jsonMatch?.[2] || jsonMatch?.[3] || responseContent;
        
        parsedResponse = JSON.parse(jsonString.trim());
      } catch (parseError) {
        logEvent('intent_classification_parse_error', {
          message: userMessage,
          response: responseContent,
          error: parseError.message
        });

        // Return fallback response for unknown intent
        return {
          intent: 'unknown',
          confidence: 0.5,
          entities: {}
        };
      }

      logEvent('intent_classified', {
        message: userMessage,
        intent: parsedResponse.intent,
        confidence: parsedResponse.confidence
      });

      return parsedResponse;
    } catch (error) {
      logEvent('intent_classification_error', {
        message: userMessage,
        error: error.message
      });

      // Return a default response if classification fails
      return {
        intent: 'unknown',
        confidence: 0.3,
        entities: {}
      };
    }
  }

  /**
   * Get fallback response for a specific intent
   */
  getFallbackResponse(intent: string): string {
    return this.fallbackResponses[intent as keyof typeof this.fallbackResponses] || 
           this.fallbackResponses.unknown;
  }

  /**
   * Validate if the intent result is properly formatted
   */
  validateIntentResult(result: any): result is IntentResult {
    return (
      typeof result === 'object' &&
      typeof result.intent === 'string' &&
      typeof result.confidence === 'number' &&
      result.confidence >= 0 && result.confidence <= 1 &&
      typeof result.entities === 'object'
    );
  }
}

// Singleton instance
let intentClassifier: IntentClassifier;

export function getIntentClassifier(): IntentClassifier {
  if (!intentClassifier) {
    intentClassifier = new IntentClassifier();
  }
  return intentClassifier;
}

export default IntentClassifier;