import Tesseract from 'tesseract.js';
import { logEvent } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

// Regular expression to match Indian Rupee amounts
const AMOUNT_RE = /(?:Rs\.?|₹|INR)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi;

// Keywords for identifying gig economy platforms
const GIG_PLATFORMS = [
  "ZOMATO", "SWIGGY", "OLA", "RAPIDO", "BLINKIT", "URBAN", 
  "UBER", "FAIR", "PRICE", "DELIVERY", "PARTNER", "EARNINGS",
  "TRIP", "RIDE", "ORDER", "COMPLETED", "SUCCESS", "PAID",
  "UPI", "TRANSACTION", "BALANCE", "WALLET", "CREDIT"
];

interface OcrResult {
  text: string;
  platform: string;
  amount: number; // in paise
  confidence: number;
}

class TesseractProcessor {
  /**
   * Extract income information from an image using OCR
   */
  async extractIncome(imagePath: string): Promise<OcrResult[]> {
    try {
      logEvent('ocr_start', { imagePath });

      // Perform OCR on the image
      const result = await Tesseract.recognize(
        imagePath,
        'eng+hin', // Support both English and Hindi
        {
          logger: (progress) => {
            logEvent('ocr_progress', { 
              imagePath, 
              progress: progress.progress 
            });
          },
        }
      );

      const ocrText = result.data.text;
      logEvent('ocr_complete', { imagePath, textLength: ocrText.length });

      // Find all amounts in the text
      const amounts = this.extractAmounts(ocrText);
      
      // Identify platform from the text
      const platform = this.identifyPlatform(ocrText);

      // Create results array
      const results: OcrResult[] = amounts.map(amount => ({
        text: ocrText,
        platform: platform.toLowerCase(),
        amount: Math.round(amount * 100), // Convert to paise
        confidence: result.data.confidence
      }));

      logEvent('ocr_extraction_complete', {
        imagePath,
        resultsCount: results.length,
        platform,
        amounts
      });

      return results;
    } catch (error) {
      logEvent('ocr_error', {
        imagePath,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Extract amounts from OCR text
   */
  private extractAmounts(text: string): number[] {
    const matches = [...text.matchAll(AMOUNT_RE)];
    const amounts: number[] = [];

    for (const match of matches) {
      const amountStr = match[1].replace(/,/g, ''); // Remove commas
      const amount = parseFloat(amountStr);
      
      if (!isNaN(amount) && amount > 0) {
        amounts.push(amount);
      }
    }

    return amounts;
  }

  /**
   * Identify the platform from the OCR text
   */
  private identifyPlatform(text: string): string {
    const upperText = text.toUpperCase();
    
    // Look for exact platform matches first
    for (const platform of ['ZOMATO', 'SWIGGY', 'OLA', 'RAPIDO', 'BLINKIT', 'URBAN']) {
      if (upperText.includes(platform)) {
        return platform;
      }
    }
    
    // Look for partial matches
    for (const platform of GIG_PLATFORMS) {
      if (upperText.includes(platform)) {
        return 'gig-platform';
      }
    }
    
    // Default to unknown if no match found
    return 'unknown';
  }

  /**
   * Clean up temporary image files
   */
  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      logEvent('temp_image_deleted', { filePath });
    } catch (error) {
      logEvent('temp_image_delete_error', { 
        filePath, 
        error: error.message 
      });
    }
  }

  /**
   * Schedule cleanup of temporary files after a specified time (in hours)
   */
  scheduleCleanup(filePath: string, hours: number = 24): void {
    setTimeout(async () => {
      await this.cleanupTempFile(filePath);
    }, hours * 60 * 60 * 1000);
  }
}

// Singleton instance
let tesseractProcessor: TesseractProcessor;

export function getTesseractProcessor(): TesseractProcessor {
  if (!tesseractProcessor) {
    tesseractProcessor = new TesseractProcessor();
  }
  return tesseractProcessor;
}

export default TesseractProcessor;