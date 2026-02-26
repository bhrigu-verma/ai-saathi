import { createClient } from '@supabase/supabase-js';
import { UserWithPII } from '../types';
import { logEvent } from '../lib/utils/logger';
import { getGroqClient } from '../lib/ai/groq-client';
import * as fs from 'fs/promises';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Load dispute templates
const disputeTemplates = require('../data/dispute-templates.json');

class DisputeService {
  /**
   * Create a dispute case
   */
  async createDisputeCase(userId: string, platform: string, issue_type: string, description: string) {
    try {
      // Get user information
      const user = await this.getUserInfo(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get dispute template
      const template = this.getDisputeTemplate(platform, issue_type);
      if (!template) {
        throw new Error(`No template found for platform ${platform} and issue ${issue_type}`);
      }

      // Fill template with user information
      const filledTemplate = this.fillDisputeTemplate(template.template, {
        name: user.name || 'Gig Worker',
        date: new Date().toLocaleDateString('en-IN'),
        amount: '', // Will be filled later if needed
        description
      });

      // Generate formal complaint using Groq
      const complaint = await this.generateComplaintWithLLM(filledTemplate, user, platform, issue_type, description);

      // Generate PDF
      const pdfPath = await this.generateDisputePDF(complaint, user, platform, issue_type);

      // Save dispute case to database
      const { data, error } = await supabase
        .from('dispute_cases')
        .insert([{
          user_id: userId,
          platform,
          issue_type,
          issue_description: description,
          letter_pdf_url: pdfPath, // This would be the path in storage
          status: 'open'
        }])
        .select();

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      logEvent('dispute_case_created', {
        userId,
        platform,
        issue_type,
        caseId: data![0].id
      });

      return data![0];
    } catch (error: any) {
      logEvent('dispute_case_create_error', {
        userId,
        platform,
        issue_type,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get dispute template
   */
  private getDisputeTemplate(platform: string, issue_type: string) {
    const platformTemplates = disputeTemplates[platform.toLowerCase()];
    if (!platformTemplates) {
      return null;
    }

    return platformTemplates[issue_type];
  }

  /**
   * Fill dispute template with user information
   */
  private fillDisputeTemplate(template: string, params: { name: string, date: string, amount: string, description: string }) {
    let filledTemplate = template;

    // Replace placeholders
    filledTemplate = filledTemplate.replace(/\{name\}/g, params.name);
    filledTemplate = filledTemplate.replace(/\{date\}/g, params.date);
    filledTemplate = filledTemplate.replace(/\{amount\}/g, params.amount);
    filledTemplate = filledTemplate.replace(/\{description\}/g, params.description);

    return filledTemplate;
  }

  /**
   * Generate complaint using LLM
   */
  private async generateComplaintWithLLM(
    template: string,
    user: UserWithPII,
    platform: string,
    issue_type: string,
    description: string
  ): Promise<string> {
    try {
      const groqClient = getGroqClient();

      const prompt = `
        Write a formal complaint for an Indian gig worker.
        Name: ${user.name || 'Gig Worker'} | Platform: ${platform} | Issue: ${issue_type}
        Description: ${description} | Date: ${new Date().toLocaleDateString('en-IN')}

        Requirements: professional + firm, cite specific dates/amounts, reference platform ToS,
        request specific action, include [PHONE] placeholder, max 200 words.
        Language: hi. Output ONLY the complaint text.

        Template to follow: ${template}
      `;

      const response = await groqClient.chatCompletion([
        {
          role: 'user',
          content: prompt
        }
      ], {
        model: process.env.GROQ_LLM_MODEL || 'llama-3.1-70b-versatile',
        maxTokens: 300
      });

      const complaint = response.choices[0]?.message?.content?.trim();
      if (!complaint) {
        throw new Error('Failed to generate complaint');
      }

      logEvent('complaint_generated_with_llm', {
        platform,
        issue_type,
        length: complaint.length
      });

      return complaint;
    } catch (error: any) {
      logEvent('complaint_generation_error', {
        platform,
        issue_type,
        error: error.message
      });

      // Fallback to using the template directly
      return template;
    }
  }

  /**
   * Generate dispute PDF - simplified approach using HTML to PDF
   */
  private async generateDisputePDF(complaint: string, user: UserWithPII, platform: string, issue_type: string): Promise<string> {
    try {
      // Create simple HTML content for the PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Dispute Letter</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 20px; }
            .content { margin: 30px 0; line-height: 1.6; }
            .signature { margin-top: 50px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>साथी - आपका डिजिटल साथी</h1>
            <h2>Official Dispute Letter</h2>
          </div>
          
          <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-IN')}</p>
          <p><strong>To:</strong> ${platform} Customer Support</p>
          <p><strong>From:</strong> ${user.name || 'Gig Worker'}, ${user.city || ''}</p>
          <p><strong>Subject:</strong> Dispute regarding ${issue_type}</p>
          
          <div class="content">
            <p>${complaint.replace(/\n/g, '<br>')}</p>
          </div>
          
          <div class="signature">
            <p><strong>Signature:</strong> _________________________</p>
            <p><strong>Name:</strong> ${user.name || 'Gig Worker'}</p>
            <p><strong>Phone:</strong> [PHONE]</p>
          </div>
        </body>
        </html>
      `;

      // Create temporary file
      const fileName = `dispute_letter_${user.id}_${Date.now()}.html`;
      const filePath = `/tmp/${fileName}`;

      // Write HTML to temporary file
      await fs.writeFile(filePath, htmlContent, 'utf8');

      logEvent('dispute_html_generated', {
        userId: user.id,
        platform,
        issue_type,
        filePath
      });

      // Note: In a real implementation, we would convert this HTML to PDF
      // For now, we're returning the HTML file path as a placeholder
      // The actual PDF conversion would happen when sending via WhatsApp
      
      return filePath;
    } catch (error: any) {
      logEvent('dispute_html_generation_error', {
        userId: user.id,
        platform,
        issue_type,
        error: error.message
      });
      throw error;
    }
  }



  /**
   * Get user information
   */
  private async getUserInfo(userId: string): Promise<UserWithPII | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return data as UserWithPII;
    } catch (error: any) {
      logEvent('user_info_fetch_error', {
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Update dispute case status
   */
  async updateDisputeStatus(caseId: string, status: string) {
    try {
      const { data, error } = await supabase
        .from('dispute_cases')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', caseId)
        .select();

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      logEvent('dispute_status_updated', {
        caseId,
        status
      });

      return data![0];
    } catch (error: any) {
      logEvent('dispute_status_update_error', {
        caseId,
        status,
        error: error.message
      });
      throw error;
    }
  }
}

// Singleton instance
let disputeService: DisputeService;

export function getDisputeService(): DisputeService {
  if (!disputeService) {
    disputeService = new DisputeService();
  }
  return disputeService;
}

export default DisputeService;