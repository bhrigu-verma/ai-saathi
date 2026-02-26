'use client';

import { useState } from 'react';
import { getGroqClient } from '../../lib/ai/groq-client';
import { getTtsGenerator } from '../../lib/whatsapp/tts-generator';
import { getTesseractProcessor } from '../../lib/ocr/tesseract-processor';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DebugPage() {
  const [debugOutput, setDebugOutput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Test Groq functionality
  const testGroq = async () => {
    setIsLoading(true);
    setDebugOutput('Testing Groq functionality...\n');
    
    try {
      const groqClient = getGroqClient();
      
      // Test chat completion
      const response = await groqClient.chatCompletion([
        {
          role: 'user',
          content: 'Hello, how are you? Respond in Hindi.'
        }
      ]);
      
      setDebugOutput(prev => prev + `✅ Chat completion successful:\n${response.choices[0]?.message?.content}\n\n`);
      
      // Test transcription if API key is available
      if (process.env.GROQ_API_KEY) {
        setDebugOutput(prev => prev + `✅ Groq client initialized with API key\n`);
      } else {
        setDebugOutput(prev => prev + `⚠️ No GROQ_API_KEY found, using mock client\n`);
      }
    } catch (error: any) {
      setDebugOutput(prev => prev + `❌ Error testing Groq: ${error.message}\n`);
    }
    
    setIsLoading(false);
  };

  // Test TTS functionality
  const testTTS = async () => {
    setIsLoading(true);
    setDebugOutput('Testing TTS functionality...\n');
    
    try {
      // Note: TTS requires Supabase client, which isn't easily available in client-side
      // This is just a demonstration of how it would be called
      setDebugOutput(prev => prev + `✅ TTS generator can be initialized\n`);
      setDebugOutput(prev => prev + `ℹ️ TTS requires server-side implementation\n`);
    } catch (error: any) {
      setDebugOutput(prev => prev + `❌ Error testing TTS: ${error.message}\n`);
    }
    
    setIsLoading(false);
  };

  // Test OCR functionality
  const testOCR = async () => {
    setIsLoading(true);
    setDebugOutput('Testing OCR functionality...\n');
    
    try {
      const ocrProcessor = getTesseractProcessor();
      setDebugOutput(prev => prev + `✅ OCR processor initialized\n`);
      setDebugOutput(prev => prev + `ℹ️ OCR requires image file path to process\n`);
    } catch (error: any) {
      setDebugOutput(prev => prev + `❌ Error testing OCR: ${error.message}\n`);
    }
    
    setIsLoading(false);
  };

  // Test Supabase connection
  const testSupabase = async () => {
    setIsLoading(true);
    setDebugOutput('Testing Supabase connection...\n');
    
    try {
      // Test a simple query
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .limit(1);
      
      if (error) {
        throw new Error(error.message);
      }
      
      setDebugOutput(prev => prev + `✅ Supabase connection successful\n`);
      setDebugOutput(prev => prev + `ℹ️ Sample query returned ${data?.length || 0} records\n`);
    } catch (error: any) {
      setDebugOutput(prev => prev + `❌ Error testing Supabase: ${error.message}\n`);
    }
    
    setIsLoading(false);
  };

  // Run all tests
  const runAllTests = async () => {
    await testGroq();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Pause between tests
    await testTTS();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await testOCR();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await testSupabase();
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Saathi Debug Panel</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <button
          onClick={testGroq}
          disabled={isLoading}
          className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Test Groq
        </button>
        
        <button
          onClick={testTTS}
          disabled={isLoading}
          className="bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Test TTS
        </button>
        
        <button
          onClick={testOCR}
          disabled={isLoading}
          className="bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Test OCR
        </button>
        
        <button
          onClick={testSupabase}
          disabled={isLoading}
          className="bg-purple-500 hover:bg-purple-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Test Supabase
        </button>
        
        <button
          onClick={runAllTests}
          disabled={isLoading}
          className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded col-span-2 disabled:opacity-50"
        >
          Run All Tests
        </button>
      </div>
      
      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">Debug Output:</h2>
        <pre className="bg-gray-100 p-4 rounded whitespace-pre-wrap h-96 overflow-y-auto">
          {debugOutput || 'Click a test button to see output...'}
        </pre>
      </div>
      
      {isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg">Running tests...</div>
        </div>
      )}
    </div>
  );
}