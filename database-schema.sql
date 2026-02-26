-- Complete Database Schema for SAATHI (साथी) — AI Co-pilot for India's Gig Workers

-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table with encrypted phone numbers
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number_encrypted TEXT UNIQUE NOT NULL,
    name VARCHAR(100), 
    city VARCHAR(100), 
    state VARCHAR(50),
    work_type VARCHAR(50), 
    platforms JSONB DEFAULT '{}',
    primary_language VARCHAR(20) DEFAULT 'hi',
    aa_consent BOOLEAN DEFAULT FALSE, 
    aa_consent_date TIMESTAMP,
    onboarding_step INTEGER DEFAULT 0, 
    onboarding_complete BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(), 
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Conversations table to track all interactions
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    direction VARCHAR(10) CHECK (direction IN ('inbound','outbound')),
    message_type VARCHAR(20), 
    content TEXT, 
    audio_url TEXT,
    intent_detected VARCHAR(50), 
    agent_used VARCHAR(50),
    processing_time_ms INTEGER, 
    created_at TIMESTAMP DEFAULT NOW()
);

-- Income events table (amounts stored in paise for precision)
CREATE TABLE income_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    platform VARCHAR(50), 
    amount_paise INTEGER NOT NULL,
    transaction_date DATE, 
    month_year VARCHAR(7),
    source_type VARCHAR(20), 
    upi_ref VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Dispute cases table
CREATE TABLE dispute_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    platform VARCHAR(50), 
    issue_type VARCHAR(50), 
    issue_description TEXT,
    letter_pdf_url TEXT, 
    status VARCHAR(30) DEFAULT 'open',
    created_at TIMESTAMP DEFAULT NOW(), 
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Credit applications table
CREATE TABLE credit_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    amount_requested_paise INTEGER, 
    nbfc_partner VARCHAR(50),
    status VARCHAR(30) DEFAULT 'submitted', 
    amount_approved_paise INTEGER,
    income_cert_url TEXT, 
    commission_earned_paise INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insurance enrollments table
CREATE TABLE insurance_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    scheme_name VARCHAR(100), 
    scheme_type VARCHAR(50),
    premium_paise INTEGER, 
    coverage_paise BIGINT,
    policy_number VARCHAR(100), 
    partner VARCHAR(50),
    commission_earned_paise INTEGER,
    enrolled_at TIMESTAMP DEFAULT NOW(), 
    renewal_due DATE
);

-- Revenue events table
CREATE TABLE revenue_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    event_type VARCHAR(50), 
    reference_id UUID,
    amount_paise INTEGER, 
    status VARCHAR(20) DEFAULT 'pending',
    settled_at TIMESTAMP, 
    created_at TIMESTAMP DEFAULT NOW()
);

-- Schemes table for government benefits
CREATE TABLE schemes (
    id UUID PRIMARY KEY,
    name VARCHAR(200), 
    name_hindi VARCHAR(200),
    scheme_code VARCHAR(50), 
    benefit_amount VARCHAR(100),
    eligibility_criteria JSONB, 
    application_url VARCHAR(500),
    documents_required TEXT[], 
    states_applicable TEXT[],
    work_types_eligible TEXT[], 
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for performance
CREATE INDEX idx_users_phone ON users(phone_number_encrypted);
CREATE INDEX idx_income_user_date ON income_events(user_id, transaction_date);
CREATE INDEX idx_revenue_status ON revenue_events(status, created_at);
CREATE INDEX idx_dispute_user_platform ON dispute_cases(user_id, platform);
CREATE INDEX idx_credit_user_status ON credit_applications(user_id, status);
CREATE INDEX idx_insurance_user_scheme ON insurance_enrollments(user_id, scheme_name);
CREATE INDEX idx_conversations_user_time ON conversations(user_id, created_at);