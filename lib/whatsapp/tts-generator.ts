import * as edgeTTS from 'edge-tts';
import { Readable } from 'stream';
import { logEvent } from '../utils/logger';
import { createWriteStream } from 'fs';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Define voice mapping for different Indian languages
const VOICE_MAPPING: Record<string, string> = {
  'hi': 'hi-IN-SwaraNeural', // Hindi
  'ta': 'ta-IN-PallaviNeural', // Tamil
  'te': 'te-IN-ShrutiNeural', // Telugu
  'kn': 'kn-IN-SapnaNeural', // Kannada
  'mr': 'mr-IN-AarohiNeural', // Marathi
  'bn': 'bn-IN-TanishaaNeural', // Bengali
  'gu': 'gu-IN-DhwaniNeural', // Gujarati
  'pa': 'pa-IN-Wavenet-A', // Punjabi
  'en': 'en-IN-NeerjaNeural' // English (India accent)
};

class TtsGenerator {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Generate speech from text using Edge TTS
   */
  async generateSpeech(text: string, language: string = 'hi'): Promise<string> {
    try {
      // Select voice based on language
      const voice = VOICE_MAPPING[language] || VOICE_MAPPING['hi'];
      
      // Create a temporary file to store the audio
      const tempDir = '/tmp';
      const fileName = `saathi_tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
      const filePath = path.join(tempDir, fileName);

      // Create communication object with Edge TTS
      const tts = edgeTTS.Communicate(text, voice);
      
      // Write the audio to a file
      const writableStream = createWriteStream(filePath);
      await new Promise((resolve, reject) => {
        tts.pipe(writableStream);
        writableStream.on('finish', resolve);
        writableStream.on('error', reject);
      });

      logEvent('tts_generation_success', {
        textLength: text.length,
        language,
        voice,
        filePath
      });

      return filePath;
    } catch (error) {
      logEvent('tts_generation_error', {
        text,
        language,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Upload audio file to Supabase storage
   */
  async uploadToStorage(filePath: string, userId: string): Promise<string> {
    try {
      // Generate a unique filename for the audio
      const fileName = `audio/${userId}/${path.basename(filePath)}`;
      
      // Read the file
      const fileBuffer = await fs.readFile(filePath);
      
      // Upload to Supabase storage
      const { data, error } = await this.supabase
        .storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'saathi-media')
        .upload(fileName, fileBuffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'audio/mp4'
        });
      
      if (error) {
        throw error;
      }
      
      // Get public URL
      const { data: publicData } = this.supabase
        .storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'saathi-media')
        .getPublicUrl(fileName);
      
      logEvent('audio_upload_success', {
        filePath,
        fileName,
        publicUrl: publicData.publicUrl
      });
      
      return publicData.publicUrl;
    } catch (error) {
      logEvent('audio_upload_error', {
        filePath,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Generate speech and upload to storage in one step
   */
  async generateAndUpload(text: string, language: string, userId: string): Promise<string> {
    let tempFilePath: string | null = null;
    
    try {
      // Generate speech
      tempFilePath = await this.generateSpeech(text, language);
      
      // Upload to storage
      const publicUrl = await this.uploadToStorage(tempFilePath, userId);
      
      // Schedule cleanup of temporary file
      this.scheduleCleanup(tempFilePath);
      
      return publicUrl;
    } catch (error) {
      // Clean up temp file if something went wrong
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
        } catch (cleanupError) {
          logEvent('temp_file_cleanup_error', {
            filePath: tempFilePath,
            error: cleanupError.message
          });
        }
      }
      
      throw error;
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
   * Schedule cleanup of temporary files after a specified time (in hours)
   */
  private scheduleCleanup(filePath: string, hours: number = 24): void {
    setTimeout(async () => {
      await this.cleanupTempFile(filePath);
    }, hours * 60 * 60 * 1000);
  }
}

// Singleton instance
let ttsGenerator: TtsGenerator;

export function getTtsGenerator(supabase: SupabaseClient): TtsGenerator {
  if (!ttsGenerator) {
    ttsGenerator = new TtsGenerator(supabase);
  }
  return ttsGenerator;
}

export default TtsGenerator;