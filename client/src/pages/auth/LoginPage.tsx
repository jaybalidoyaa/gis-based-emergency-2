import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { authApi } from '@/services/api';
import { useAuthStore, getRoleHomePath } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

const SHOW_DEMO = import.meta.env.VITE_DEMO_ACCOUNTS === 'true';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(email, password);
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      toast.success(`Welcome back, ${res.data.user.fullName}`);
      navigate(getRoleHomePath(res.data.user.role));
    } catch (err) {
      console.error('[LoginPage] auth error:', err);
      setError('Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#080e16_0%,#0d1520_55%,#161f2c_100%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/logo.png" alt="Brigada Onse SVFAR" className="mx-auto h-20 w-20 object-contain" />
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.28em] text-gold-500">Brigada Onse SVFAR</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink-50">Dispatch System</h1>
          <p className="mt-2 text-sm text-ink-400">Ready to serve. Ready to respond.</p>
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
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="text-right">
                <Link to="/forgot-password" className="text-xs text-gold-500 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-400">
              Citizen account?{' '}
              <Link to="/register" className="font-medium text-gold-500 hover:underline">
                Register here
              </Link>
            </p>
            {SHOW_DEMO && (
              <div className="mt-6 space-y-1 rounded-md border border-navy-700 bg-navy-800 p-4 font-mono text-xs text-ink-400">
                <p className="font-sans font-medium text-ink-200">Demo accounts — Password123!</p>
                <p>dispatcher@sunvalley.gov.ph</p>
                <p>cruz@sunvalley.gov.ph</p>
                <p>citizen@demo.ph</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
