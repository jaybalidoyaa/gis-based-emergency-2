import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { authApi } from '@/services/api';
import { useAuthStore, getRoleHomePath } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { normalizePhPhone, passwordIssues } from '@/lib/validation';

export function RegisterPage() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    contactNumber: '',
    password: '',
    confirmPassword: '',
    address: '',
    consent: false,
    terms: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  function update(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    if (!normalizePhPhone(form.contactNumber)) {
      setError('Enter a valid Philippine mobile number (09XXXXXXXXX).');
      return;
    }
    const issues = passwordIssues(form.password);
    if (issues.length) {
      setError(`Password must include ${issues.join(', ')}.`);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!form.consent || !form.terms) {
      setError('Please accept the privacy notice and terms of use.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register(form);
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      toast.success('Account created');
      navigate(getRoleHomePath(res.data.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/logo.png" alt="Brigada Onse SVFAR" className="mx-auto h-16 w-16 object-contain" />
          <h1 className="mt-3 text-2xl font-bold">Citizen registration</h1>
          <p className="mt-1 text-sm text-ink-400">Create an account to send SOS requests</p>
        </div>
        <Card>
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-alert-500/40 bg-alert-500/10 px-4 py-3 text-sm text-alert-400" role="alert">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" name="name" autoComplete="name" required value={form.fullName} onChange={(e) => update('fullName', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => update('email', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactNumber">Mobile number</Label>
                <Input
                  id="contactNumber"
                  name="tel"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="09XXXXXXXXX"
                  required
                  value={form.contactNumber}
                  onChange={(e) => update('contactNumber', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address in Sun Valley</Label>
                <Input id="address" name="street-address" autoComplete="street-address" value={form.address} onChange={(e) => update('address', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                />
                <p className="text-xs text-ink-500">At least 10 characters, with upper, lower, number, and special character.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  name="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={form.confirmPassword}
                  onChange={(e) => update('confirmPassword', e.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-ink-300">
                <input type="checkbox" checked={form.consent} onChange={(e) => update('consent', e.target.checked)} className="mt-1" />
                I consent to Barangay Sun Valley BDRRMO processing my contact and location data for emergency response.
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-300">
                <input type="checkbox" checked={form.terms} onChange={(e) => update('terms', e.target.checked)} className="mt-1" />
                I accept the terms of use and understand that false emergency reports are prohibited.
              </label>
              <button type="button" className="text-xs text-gold-500" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide passwords' : 'Show passwords'}
              </button>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Creating account…' : 'Register'}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-400">
              Already registered?{' '}
              <Link to="/login" className="font-medium text-gold-500 hover:underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
