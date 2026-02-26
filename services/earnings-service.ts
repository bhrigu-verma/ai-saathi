import { createClient } from '@supabase/supabase-js';
import { UserWithPII, EarningRecord } from '../types';
import { paiseToRupees } from '../lib/utils/currency';
import { logEvent } from '../lib/utils/logger';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

class EarningsService {
  /**
   * Get earnings summary for a user
   */
  async getUserEarnings(userId: string, days: number = 30) {
    try {
      const { data, error } = await supabase
        .from('income_events')
        .select('*')
        .eq('user_id', userId)
        .gte('transaction_date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('transaction_date', { ascending: false });

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      const earnings = data as EarningRecord[];
      
      // Calculate summary
      const summary = this.calculateEarningsSummary(earnings, days);
      
      logEvent('earnings_retrieved', {
        userId,
        days,
        recordCount: earnings.length,
        totalAmount: summary.total_paise
      });

      return {
        earnings,
        summary
      };
    } catch (error: any) {
      logEvent('earnings_retrieve_error', {
        userId,
        days,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate earnings summary
   */
  private calculateEarningsSummary(earnings: EarningRecord[], days: number) {
    const total_paise = earnings.reduce((sum, record) => sum + record.amount_paise, 0);
    const total_rupees = paiseToRupees(total_paise);
    
    // Group by platform
    const byPlatform: Record<string, { total_paise: number, count: number }> = {};
    for (const earning of earnings) {
      if (!byPlatform[earning.platform]) {
        byPlatform[earning.platform] = { total_paise: 0, count: 0 };
      }
      byPlatform[earning.platform].total_paise += earning.amount_paise;
      byPlatform[earning.platform].count++;
    }

    // Group by date
    const byDate: Record<string, number> = {};
    for (const earning of earnings) {
      const date = earning.transaction_date;
      byDate[date] = (byDate[date] || 0) + earning.amount_paise;
    }

    // Calculate average per day
    const avgPerDay = days > 0 ? total_paise / days : 0;

    return {
      total_paise,
      total_rupees,
      byPlatform,
      byDate,
      avgPerDay_paise: Math.round(avgPerDay),
      avgPerDay_rupees: paiseToRupees(Math.round(avgPerDay)),
      recordCount: earnings.length
    };
  }

  /**
   * Summarize earnings for voice response
   */
  async summarizeEarningsForVoice(userId: string, days: number = 1, language: string = 'hi') {
    try {
      const { summary } = await this.getUserEarnings(userId, days);
      const userName = await this.getUserName(userId);

      // Format the summary for voice response
      let summaryText = '';
      
      if (days === 1) {
        // Daily summary
        summaryText = `${userName} bhai, aaj ₹${summary.total_rupees.toFixed(0)} mile — `;
        
        const platformEntries = Object.entries(summary.byPlatform);
        if (platformEntries.length === 1) {
          summaryText += `${platformEntries[0][0]} se ₹${paiseToRupees(platformEntries[0][1].total_paise).toFixed(0)}`;
        } else if (platformEntries.length > 1) {
          const platformParts = platformEntries.map(([platform, data]) => 
            `${platform} se ₹${paiseToRupees(data.total_paise).toFixed(0)}`
          );
          summaryText += platformParts.join(', ');
        }
      } else {
        // Multi-day summary
        summaryText = `${userName} bhai, ye ${days} din me ₹${summary.total_rupees.toFixed(0)} kamaye — `;
        
        const platformEntries = Object.entries(summary.byPlatform);
        if (platformEntries.length === 1) {
          summaryText += `${platformEntries[0][0]} se ₹${paiseToRupees(platformEntries[0][1].total_paise).toFixed(0)}`;
        } else if (platformEntries.length > 1) {
          const platformParts = platformEntries.map(([platform, data]) => 
            `${platform} se ₹${paiseToRupees(data.total_paise).toFixed(0)}`
          );
          summaryText += platformParts.join(', ');
        }
      }

      logEvent('earnings_summarized_for_voice', {
        userId,
        days,
        summaryText
      });

      return summaryText;
    } catch (error: any) {
      logEvent('earnings_summarize_error', {
        userId,
        days,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Add an income event
   */
  async addIncomeEvent(userId: string, platform: string, amount_paise: number, source_type: string, upi_ref?: string) {
    try {
      const { data, error } = await supabase
        .from('income_events')
        .insert([{
          user_id: userId,
          platform,
          amount_paise,
          transaction_date: new Date().toISOString().split('T')[0],
          month_year: new Date().toISOString().slice(0, 7), // YYYY-MM
          source_type,
          upi_ref
        }])
        .select();

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      logEvent('income_event_added', {
        userId,
        platform,
        amount_paise,
        source_type,
        upi_ref
      });

      return data![0];
    } catch (error: any) {
      logEvent('income_event_add_error', {
        userId,
        platform,
        amount_paise,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get user name
   */
  private async getUserName(userId: string): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('name')
        .eq('id', userId)
        .single();

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return data?.name || 'Rajan';
    } catch (error: any) {
      logEvent('user_name_fetch_error', {
        userId,
        error: error.message
      });
      return 'Rajan';
    }
  }
}

// Singleton instance
let earningsService: EarningsService;

export function getEarningsService(): EarningsService {
  if (!earningsService) {
    earningsService = new EarningsService();
  }
  return earningsService;
}

export default EarningsService;