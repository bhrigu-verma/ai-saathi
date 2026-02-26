export interface UserWithPII {
  id: string;
  phone_number_encrypted: string;
  name?: string;
  city?: string;
  state?: string;
  work_type?: string;
  platforms: Record<string, boolean>;
  primary_language: string;
  aa_consent: boolean;
  aa_consent_date?: Date;
  onboarding_step: number;
  onboarding_complete: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  entities: {
    platform?: string;
    time_period?: string;
    amount?: number;
    issue_type?: string;
  };
}

export interface EarningRecord {
  id: string;
  user_id: string;
  platform: string;
  amount_paise: number;
  transaction_date: Date;
  month_year: string;
  source_type: string;
  upi_ref?: string;
  created_at: Date;
}