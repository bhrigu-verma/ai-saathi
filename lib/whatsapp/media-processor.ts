import { logEvent } from '../utils/logger';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { Groq } from 'groq';

const execAsync = promisify(exec);

class MediaProcessor {
  private groq: Groq;

  constructor() {
    if (process.env.GROQ_API_KEY) {
      this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    } else {
      logEvent('missing_api_key', { provider: 'groq', error: 'GROQ_API_KEY not set' });
    }
  }

  /**
   * Process voice message using Groq Whisper for ASR
   */
  async processVoiceMessage(audioPath: string, language: string = 'hi'): Promise<string> {
    try {
      // First, convert audio to proper format if needed
      const convertedAudioPath = await this.convertAudioToMp3(audioPath);
      
      // Use Groq Whisper for speech recognition
      if (!this.groq) {
        throw new Error('Groq client not initialized - missing API key');
      }

      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(convertedAudioPath),
        model: process.env.GROQ_ASR_MODEL || 'whisper-large-v3-turbo',
        language: language,
      });

      logEvent('voice_transcription_success', {
        audioPath,
        language,
        duration: transcription.text.length
      });

      // Clean up temporary audio file
      await this.cleanupTempFile(convertedAudioPath);

      return transcription.text;
    } catch (error) {
      logEvent('voice_transcription_error', {
        audioPath,
        language,
        error: error.message
      });

      // Retry with fallback language if Hindi failed
      if (language === 'hi') {
        try {
          return await this.processVoiceMessage(audioPath, 'en');
        } catch (fallbackError) {
          logEvent('voice_transcription_fallback_failed', {
            audioPath,
            error: fallbackError.message
          });
        }
      }

      throw error;
    }
  }

  /**
   * Convert audio to MP3 format using ffmpeg
   */
  private async convertAudioToMp3(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace(/\.[^/.]+$/, '.mp3');
    
    try {
      await execAsync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -b:a 32k "${outputPath}"`);
      logEvent('audio_conversion_success', { inputPath, outputPath });
      return outputPath;
    } catch (error) {
      logEvent('audio_conversion_error', { inputPath, error: error.message });
      
      // If conversion fails, try to return original file
      return inputPath;
    }
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      logEvent('temp_file_deleted', { filePath });
    } catch (error) {
      logEvent('temp_file_delete_error', { filePath, error: error.message });
    }
  }

  /**
   * Delete temporary files after a specified time (in hours)
   */
  async scheduleCleanup(filePath: string, hours: number = 24): Promise<void> {
    setTimeout(async () => {
      await this.cleanupTempFile(filePath);
    }, hours * 60 * 60 * 1000);
  }
}

// Singleton instance
let mediaProcessor: MediaProcessor;

export function getMediaProcessor(): MediaProcessor {
  if (!mediaProcessor) {
    mediaProcessor = new MediaProcessor();
  }
  return mediaProcessor;
}

export default MediaProcessor;