import { CheckSquare, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useState, type SyntheticEvent } from 'react';

import { Button } from '../shared/ui/button';
import { Card, CardContent } from '../shared/ui/layout';
import { Field, Input } from '../shared/ui/form-controls';
import { getContainer } from '../infrastructure/di/container';
import { isErr } from '../domain/shared/result';

type Mode = 'sign-in' | 'sign-up' | 'magic-link';

/**
 * Acceso.
 *
 * Solo aparece cuando hay Supabase configurado. En modo local la app entra directa,
 * porque pedir credenciales para guardar datos que nunca salen del dispositivo seria
 * un tramite sin ninguna contrapartida.
 */
export const LoginPage = () => {
  const container = getContainer();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'magic-link') {
        const result = await container.auth.signInWithMagicLink(email);
        if (isErr(result)) setError(result.error.message);
        else toast.success('Te mandamos un enlace. Revisa el correo.');
        return;
      }

      const result =
        mode === 'sign-in'
          ? await container.auth.signInWithPassword(email, password)
          : await container.auth.signUpWithPassword(email, password);

      if (isErr(result)) {
        setError(result.error.message);
        return;
      }

      // En registro con confirmacion de correo activada no hay sesion todavia.
      if (mode === 'sign-up' && result.value === null) {
        toast.success('Cuenta creada. Confirma tu correo para entrar.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pb-safe pt-safe flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-raised">
            <CheckSquare className="size-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Checklist Personal</h1>
            <p className="mt-1 text-sm text-balance text-ink-soft">
              Tus tareas, sincronizadas entre el telefono y la computadora.
            </p>
          </div>
        </div>

        <Card>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Correo" htmlFor="email" required>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@correo.com"
                  autoComplete="email"
                  required
                  autoFocus
                />
              </Field>

              {mode !== 'magic-link' && (
                <Field
                  label="Contraseña"
                  htmlFor="password"
                  required
                  hint={mode === 'sign-up' ? 'Minimo 6 caracteres.' : undefined}
                >
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                    minLength={6}
                    required
                  />
                </Field>
              )}

              {error !== null && (
                <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" block loading={isSubmitting}>
                {mode === 'sign-in'
                  ? 'Entrar'
                  : mode === 'sign-up'
                    ? 'Crear cuenta'
                    : 'Enviarme el enlace'}
              </Button>
            </form>

            <div className="mt-4 space-y-2 border-t border-line pt-4 text-center text-sm">
              {mode !== 'magic-link' && (
                <button
                  type="button"
                  onClick={() => setMode('magic-link')}
                  className="inline-flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-400"
                >
                  <Mail className="size-3.5" />
                  Entrar con un enlace por correo
                </button>
              )}

              <p className="text-ink-soft">
                {mode === 'sign-in' ? (
                  <>
                    ¿No tienes cuenta?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('sign-up')}
                      className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Crear una
                    </button>
                  </>
                ) : (
                  <>
                    ¿Ya tienes cuenta?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('sign-in')}
                      className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Entrar
                    </button>
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
