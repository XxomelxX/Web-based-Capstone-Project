'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Lock, ArrowLeft, KeyRound } from 'lucide-react';

type Step = 'email' | 'code';

export default function ForgotPasswordClient() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to send code.');
        return;
      }

      setSuccess(data.message || 'A code has been sent to your email.');
      setStep('code');
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!code.trim()) {
      setError('Please enter the code.');
      return;
    }

    if (!newPassword) {
      setError('Please enter a new password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to reset password.');
        return;
      }

      setSuccess('Password reset successfully! Redirecting to login...');
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Heading */}
      <h2
        className="text-4xl font-bold text-[#1a3a2a] text-center mb-2 tracking-widest"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {step === 'email' ? 'FORGOT PASSWORD' : 'RESET PASSWORD'}
      </h2>
      <p className="text-sm text-gray-500 text-center mb-8">
        {step === 'email'
          ? 'Enter your email to receive a reset code.'
          : `We sent a 6-digit code to ${email}`}
      </p>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-600">
          {success}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={handleRequestCode} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <Mail className="h-5 w-5 text-[#1a3a2a]/60" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=""
                required
                className="block w-full rounded-full bg-[#6b9e8e]/40 border-none py-3 pl-12 pr-4 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#1a3a2a]/30"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#6b9e8e] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#5a8a7a] disabled:opacity-60"
          >
            {loading ? 'Sending...' : 'Send Reset Code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              6-Digit Code
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <KeyRound className="h-5 w-5 text-[#1a3a2a]/60" />
              </div>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                required
                className="block w-full rounded-full bg-[#6b9e8e]/40 border-none py-3 pl-12 pr-4 text-center text-lg tracking-[0.3em] text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#1a3a2a]/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <Lock className="h-5 w-5 text-[#1a3a2a]/60" />
              </div>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder=""
                required
                className="block w-full rounded-full bg-[#6b9e8e]/40 border-none py-3 pl-12 pr-4 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#1a3a2a]/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <Lock className="h-5 w-5 text-[#1a3a2a]/60" />
              </div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder=""
                required
                className="block w-full rounded-full bg-[#6b9e8e]/40 border-none py-3 pl-12 pr-4 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#1a3a2a]/30"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#6b9e8e] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#5a8a7a] disabled:opacity-60"
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <button
            type="button"
            onClick={() => { setStep('email'); setCode(''); setNewPassword(''); setConfirmPassword(''); setError(''); setSuccess(''); }}
            className="w-full rounded-full border border-[#6b9e8e]/40 bg-white px-4 py-3 text-sm font-medium text-[#1a3a2a] transition hover:bg-[#6b9e8e]/10"
          >
            Back to Email
          </button>
        </form>
      )}

      {/* Back to login */}
      <div className="mt-6 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm text-[#1a3a2a] hover:underline transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Login
        </Link>
      </div>
    </div>
  );
}
