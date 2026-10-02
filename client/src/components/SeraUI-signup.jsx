import { useState } from "react"
import { Eye, EyeOff, LoaderCircle, Lock, Mail, User } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { ShineBorder } from "@/components/ui/shine-border"
import { cn } from "@/lib/utils"

/**
 * SeraUI — Signin 3 (Glitch Effect).
 * https://seraui.com/docs/signin
 *
 * Re-themed onto intelme's tokens so the card sits on the cream surface
 * instead of punching a white hole in it, and wired to the real `register`
 * call. Structure, icon treatment, password reveal, the "Or continue with"
 * divider and the cross-link back to login are the component as published.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

const SOCIAL_NOTICE = "Social sign-up is not connected yet."

function TwitterIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function LinkedInIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  visible,
  onToggleVisibility,
  placeholder,
  autoComplete,
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
          <Lock className="size-4" />
        </div>
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          className="h-9 pr-10 pl-9"
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function SocialButton({ icon, label }) {
  return (
    <button
      type="button"
      disabled
      title={SOCIAL_NOTICE}
      className="flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card disabled:hover:text-foreground/70"
    >
      {icon}
      <span className="ml-2">{label}</span>
    </button>
  )
}

export default function Signin3({ onSubmit, isLoading = false, onSwitchToLogin }) {
  const [values, setValues] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  function validate() {
    const nextErrors = {}

    if (!values.username.trim()) {
      nextErrors.username = "Pick a username."
    } else if (values.username.trim().length < 3) {
      nextErrors.username = "Use at least 3 characters."
    }

    if (!values.email.trim()) {
      nextErrors.email = "Enter your email."
    } else if (!EMAIL_PATTERN.test(values.email.trim())) {
      nextErrors.email = "That does not look like a valid email."
    }

    if (!values.password) {
      nextErrors.password = "Choose a password."
    } else if (values.password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    }

    if (values.confirmPassword !== values.password) {
      nextErrors.confirmPassword = "The two passwords do not match."
    }

    return nextErrors
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)

    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    try {
      await onSubmit(values)
    } catch (error) {
      setFormError(error.message)
    }
  }

  return (
    <div className="w-full">
      <div className="signin-card relative rounded-xl border border-border bg-card p-6 ring-1 ring-foreground/10">
        <ShineBorder
          borderWidth={1}
          duration={14}
          shineColor={["#4f463c", "#e0a15a", "#8aa2bd"]}
        />

        <div className="mb-6 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <User className="size-5" />
          </div>
          <h2 className="signin-title mb-2 text-2xl font-semibold tracking-[-0.9px] text-foreground">
            Create account
          </h2>
          <p className="text-sm text-muted-foreground">
            Enter your details to get started
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertTitle>Could not create your account</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <label
              htmlFor="signup-username"
              className="text-sm font-medium text-foreground"
            >
              Username
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                <User className="size-4" />
              </div>
              <Input
                id="signup-username"
                name="username"
                autoComplete="username"
                value={values.username}
                onChange={update("username")}
                aria-invalid={Boolean(errors.username)}
                className="h-9 pl-9"
              />
            </div>
            {errors.username && (
              <p role="alert" className="text-xs text-destructive">
                {errors.username}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="signup-email"
              className="text-sm font-medium text-foreground"
            >
              Email
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                <Mail className="size-4" />
              </div>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={update("email")}
                placeholder="name@example.com"
                aria-invalid={Boolean(errors.email)}
                className="h-9 pl-9"
              />
            </div>
            {errors.email && (
              <p role="alert" className="text-xs text-destructive">
                {errors.email}
              </p>
            )}
          </div>

          <PasswordField
            id="signup-password"
            label="Password"
            autoComplete="new-password"
            value={values.password}
            onChange={update("password")}
            error={errors.password}
            visible={showPassword}
            onToggleVisibility={() => setShowPassword((shown) => !shown)}
            placeholder="Create a password"
          />

          <PasswordField
            id="signup-confirm-password"
            label="Confirm password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={update("confirmPassword")}
            error={errors.confirmPassword}
            visible={showConfirm}
            onToggleVisibility={() => setShowConfirm((shown) => !shown)}
            placeholder="Type it again"
          />

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
                Creating account…
              </span>
            ) : (
              "Create account"
            )}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SocialButton icon={<TwitterIcon className="size-4" />} label="Twitter" />
          <SocialButton
            icon={<LinkedInIcon className="size-4" />}
            label="LinkedIn"
          />
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="link-hover font-medium text-foreground"
            >
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
