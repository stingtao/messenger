import React, { useState } from 'react';
import { MessageCircle, AlertCircle, Loader2 } from 'lucide-react';
import GoogleAd from './GoogleAd';

export default function Login() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    setError(null);

    try {
      window.location.href = '/api/auth/google/start';
    } catch (err) {
      console.error("Login Error:", err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred during login.');
      setIsLoading(false);
    } finally {
      if (window.location.pathname !== '/api/auth/google/start') setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06C755] flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-8 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-[#06C755] rounded-2xl flex items-center justify-center mb-6 shadow-lg">
          <MessageCircle className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to xxx 即時通訊</h1>
        <p className="text-gray-500 mb-8">Connect with friends and family anytime, anywhere.</p>
        
        {error && (
          <div className="w-full mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-left">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="w-full bg-white border-2 border-gray-200 text-gray-700 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin text-[#06C755]" />
          ) : (
            <span className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-blue-600">G</span>
          )}
          {isLoading ? 'Connecting...' : 'Log in with Google'}
        </button>

        <GoogleAd />
        
        <p className="mt-6 text-xs text-gray-400">
          Google will redirect back after authentication.
        </p>
      </div>
    </div>
  );
}
