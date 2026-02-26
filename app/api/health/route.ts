import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { getGroqClient } from '../../../lib/ai/groq-client';

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET() {
  try {
    const startTime = Date.now();
    
    // Test Supabase connection
    const { data: healthCheckData, error: dbError } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    // Test Redis connection
    const redisStartTime = Date.now();
    await redis.set('health-check', 'ok');
    const redisValue = await redis.get('health-check');
    const redisLatency = Date.now() - redisStartTime;
    
    if (redisValue !== 'ok') {
      throw new Error('Redis test failed');
    }

    // Test Groq connection
    const groqStartTime = Date.now();
    const groqClient = getGroqClient();
    // Just test if client is properly configured
    const groqAvailable = !!process.env.GROQ_API_KEY;
    const groqLatency = Date.now() - groqStartTime;

    const totalLatency = Date.now() - startTime;

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      latency: {
        total: totalLatency,
        database: Date.now() - startTime, // Approximate
        redis: redisLatency,
        groq: groqLatency
      },
      services: {
        database: dbError ? 'unavailable' : 'available',
        redis: 'available',
        groq: groqAvailable ? 'available' : 'unavailable (no API key)',
        whatsapp: 'pending' // Baileys connection status would be checked separately
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}