# SAATHI (साथी) — AI Co-pilot for India's Gig Workers

This is the backend implementation for Saathi, an AI-powered WhatsApp assistant for India's 12-23M gig workers. It helps with income tracking, dispute resolution, welfare schemes, and credit access through voice-enabled interactions in Hindi and regional languages.

## Features

- WhatsApp-first interface using Baileys client
- Voice recognition and text-to-speech in Hindi and regional languages
- Income tracking via OCR on UPI screenshots
- Dispute resolution assistance for gig platforms
- Government scheme recommendations
- Credit and insurance facilitation

## Tech Stack

- **Backend**: Node.js with TypeScript
- **WhatsApp**: Baileys library
- **AI**: Groq for Whisper (ASR) and LLaMA 3.1 (LLM)
- **Database**: Supabase PostgreSQL
- **Cache**: Upstash Redis
- **Queue**: BullMQ
- **TTS**: Edge-TTS
- **OCR**: Tesseract.js

## Architecture

```
USER: WhatsApp → Web Dashboard (optional)
GATEWAY: Baileys Client (QR login, free) → FastAPI
ORCHESTRATION: Intent Router → 4 Sub-agents
AGENTS: Income | Dispute | Welfare | Credit/Insurance
DATA: Supabase PostgreSQL + Upstash Redis + Supabase Storage
AI: Groq Whisper (ASR) + Groq LLaMA 3.1 (LLM) + Edge-TTS (TTS)
OCR: Tesseract (screenshot income parsing)
```

## Setup

1. Create a Supabase project and Upstash Redis instance
2. Get a Groq API key
3. Copy `.env.example` to `.env` and fill in the values
4. Run the application

## License

MIT