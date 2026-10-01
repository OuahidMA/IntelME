import { useState } from "react"
import { Eye, EyeOff, LoaderCircle, User } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { ShineBorder } from "@/components/ui/shine-border"
import { cn } from "@/lib/utils"

/**
 * SeraUI — Login (Preview).
 * https://seraui.com/docs/login
 *
 * Re-themed onto intelme's tokens so the card sits on the cream surface
 * instead of punching a white hole in it, and wired to the real `login` call.
 * Structure, the three-up provider row, the "Or continue with" divider, the
 * password reveal and the cross-link to sign-up are the component as published.
 */

const SOCIAL_NOTICE = "Social sign-in is not connected yet."
const RESET_NOTICE = "Password reset is not available yet."

function AppleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.09997 22C7.78997 22.05 6.79997 20.68 5.95997 19.47C4.24997 17 2.93997 12.45 4.69997 9.39C5.56997 7.87 7.12997 6.91 8.81997 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"
      />
    </svg>
  )
}

function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function XIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const providers = [
  { key: "apple", label: "Sign in with Apple", icon: <AppleIcon className="size-6" /> },
  { key: "google", label: "Sign in with Google", icon: <GoogleIcon className="size-5" /> },
  { key: "x", label: "Sign in with X", icon: <XIcon className="size-5" /> },
]

export default function Login({ onSubmit, isLoading = false, onSwitchToSignup }) {
  const [values, setValues] = useState({ email: "", password: "" })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)

    const nextErrors = {}
    if (!values.email.trim()) nextErrors.email = "Enter your email or username."
    if (!values.password) nextErrors.password = "Enter your password."

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    try {
      await onSubmit(values)
    } catch (error) {
      setFormError(error.message)
    }
  }

  return (
    <div className="relative w-full">
      <div className="signin-card relative w-full space-y-6 rounded-xl border border-border bg-card p-6 ring-1 ring-foreground/10">
        <ShineBorder
          borderWidth={1}
          duration={14}
          shineColor={["#4f463c", "#e0a15a", "#8aa2bd"]}
        />

        <div className="space-y-3 text-center">
          <div className="inline-flex rounded-lg border border-border bg-muted p-2 text-muted-foreground">
            <User className="size-5" />
          </div>
          <div>
            <h2 className="signin-title text-2xl font-semibold tracking-[-0.9px] text-foreground">
              Welcome back
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials to sign in
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {providers.map((provider) => (
            <button
              key={provider.key}
              type="button"
              disabled
              title={SOCIAL_NOTICE}
              aria-label={provider.label}
              className="flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card disabled:hover:text-foreground/70"
            >
              {provider.icon}
            </button>
          ))}
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertTitle>Could not log you in</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <label
              htmlFor="login-email"
              className="text-sm font-medium leading-none text-foreground"
            >
              Email or username
            </label>
            <Input
              id="login-email"
              name="email"
              type="text"
              autoComplete="username"
              value={values.email}
              onChange={update("email")}
              placeholder="name@example.com"
              aria-invalid={Boolean(errors.email)}
              className="h-9 py-2"
            />
            {errors.email && (
              <p role="alert" className="text-xs text-destructive">
                {errors.email}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="login-password"
              className="text-sm font-medium leading-none text-foreground"
            >
              Password
            </label>
            <div className="relative">
              <Input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={values.password}
                onChange={update("password")}
                placeholder="Enter your password"
                aria-invalid={Boolean(errors.password)}
                className="h-9 py-2 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {errors.password && (
              <p role="alert" className="text-xs text-destructive">
                {errors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              "signin-button inset-button h-9 w-full rounded-lg bg-primary px-4 py-2",
              "text-sm font-medium text-primary-foreground",
              "hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <LoaderCircle className="size-4 animate-spin" />
                Signing in…
              </span>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={onSwitchToSignup}
              className="link-hover font-medium text-foreground"
            >
              Sign up
            </button>
          </p>
          <button
            type="button"
            disabled
            title={RESET_NOTICE}
            className="cursor-not-allowed text-sm font-medium text-muted-foreground opacity-60"
          >
            Forgot your password?
          </button>
        </div>
      </div>
    </div>
  )
}
