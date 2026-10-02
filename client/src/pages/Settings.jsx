import { useState } from "react"
import { Check, LoaderCircle, Trash2, TriangleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { useResume } from "@/context/ResumeContext"

/* The same rules the server enforces, so a typo is caught before a round-trip. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 72
const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 80

/** A labelled input with its error underneath, used by both forms below. */
function TextField({ id, label, hint, error, className, ...props }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={Boolean(error)}
        className="mt-2 h-9"
        {...props}
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/** A one-line confirmation, shown after a write succeeds. */
function SavedNote({ children }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="size-3.5" />
      {children}
    </p>
  )
}

/**
 * Name and email.
 *
 * Only the fields that actually changed are sent — the server refuses an empty
 * patch, and rewriting the row with the values it already holds would be a
 * pointless write. The session the server returns replaces the one in context,
 * so the name in the sidebar changes at the same moment the button stops
 * spinning, with no second request to get there.
 */
function AccountForm() {
  const { user, updateProfile, isUpdating } = useAuth()
  // Seeded from the session and owned by the form from here on. Nothing else in
  // the app rewrites these two fields while the page is open, and the save
  // itself sends back the same values the form already holds — so there is
  // nothing to resynchronise.
  const [values, setValues] = useState({ name: user.username, email: user.email })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [isSaved, setIsSaved] = useState(false)

  const trimmedName = values.name.trim()
  const trimmedEmail = values.email.trim()
  const isDirty = trimmedName !== user.username || trimmedEmail.toLowerCase() !== user.email

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      setErrors((current) => ({ ...current, [field]: undefined }))
      setFormError(null)
      setIsSaved(false)
    }
  }

  function validate() {
    const nextErrors = {}

    if (trimmedName.length < MIN_NAME_LENGTH) {
      nextErrors.name = `Use at least ${MIN_NAME_LENGTH} characters.`
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      nextErrors.name = `Keep it to ${MAX_NAME_LENGTH} characters or fewer.`
    }

    if (!trimmedEmail) {
      nextErrors.email = "Enter your email."
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = "That does not look like a valid email."
    }

    return nextErrors
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    setIsSaved(false)

    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const patch = {}
    if (trimmedName !== user.username) patch.name = trimmedName
    if (trimmedEmail.toLowerCase() !== user.email) patch.email = trimmedEmail

    try {
      await updateProfile(patch)
      setIsSaved(true)
    } catch (error) {
      // The server answers a duplicate email with 409 and a taken-email with a
      // 400, both carrying per-field messages. They land on the fields.
      setErrors(error?.details ?? {})
      setFormError(error?.message ?? "Your details could not be saved.")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>
          The name and email your account is stored under. Your email is also how
          you sign in.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertTitle>Could not save your details</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <TextField
            id="settings-name"
            label="Name"
            autoComplete="name"
            value={values.name}
            onChange={update("name")}
            error={errors.name}
          />

          <TextField
            id="settings-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={update("email")}
            error={errors.email}
            hint="This is the email you sign in with. It is not shared anywhere."
          />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={!isDirty || isUpdating}
              className="inset-button w-fit"
            >
              {isUpdating ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            {isSaved && <SavedNote>Details updated.</SavedNote>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Password.
 *
 * The current password is required by the server before it will hash anything
 * new, so a walk-up to an unlocked laptop cannot replace someone's password. The
 * new one is hashed with bcrypt server-side; the plaintext is never sent
 * anywhere but that request, and never written down.
 */
function PasswordForm() {
  const { changePassword, isChangingPassword } = useAuth()
  const [values, setValues] = useState({ current: "", next: "", confirm: "" })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [isSaved, setIsSaved] = useState(false)

  function update(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      setErrors((current) => ({ ...current, [field]: undefined }))
      setFormError(null)
      setIsSaved(false)
    }
  }

  function validate() {
    const nextErrors = {}

    if (!values.current) {
      nextErrors.current = "Enter your current password."
    }
    if (!values.next) {
      nextErrors.next = "Choose a new password."
    } else if (values.next.length < MIN_PASSWORD_LENGTH) {
      nextErrors.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    } else if (values.next.length > MAX_PASSWORD_LENGTH) {
      nextErrors.next = `Keep it to ${MAX_PASSWORD_LENGTH} characters or fewer.`
    }
    if (values.confirm !== values.next) {
      nextErrors.confirm = "The two passwords do not match."
    }

    return nextErrors
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    setIsSaved(false)

    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    try {
      await changePassword({ currentPassword: values.current, newPassword: values.next })
      // The old password is no longer valid, so it is cleared rather than left
      // sitting in a field.
      setValues({ current: "", next: "", confirm: "" })
      setIsSaved(true)
    } catch (error) {
      setErrors(
        error?.details?.newPassword ? { next: error.details.newPassword } : {},
      )
      setFormError(error?.message ?? "Your password could not be changed.")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing it re-hashes the new password and stores that. You stay signed
          in on this device.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertTitle>Could not change your password</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <TextField
            id="settings-current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={values.current}
            onChange={update("current")}
            error={errors.current}
          />

          <TextField
            id="settings-new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={values.next}
            onChange={update("next")}
            error={errors.next}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />

          <TextField
            id="settings-confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={values.confirm}
            onChange={update("confirm")}
            error={errors.confirm}
          />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={isChangingPassword}
              className="inset-button w-fit"
            >
              {isChangingPassword ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Updating…
                </>
              ) : (
                "Update password"
              )}
            </Button>
            {isSaved && <SavedNote>Password updated.</SavedNote>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB"
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Local data.
 *
 * The server holds a name, an email and a password hash — that is all. Every
 * version, analysis and job match is in this browser, under this account's id,
 * and there is no copy anywhere else to revoke it from. So this is the only
 * control that can erase a CV: it is deliberately separate from deleting the
 * account, because wanting the CV gone is not the same as wanting the login gone.
 */
function LocalDataCard() {
  const { user, isAuthenticated } = useAuth()
  const { versions, history, localStorageUsed, clearLocalData } = useResume()

  const [isClearing, setIsClearing] = useState(false)

  if (!isAuthenticated) return null

  const hasData = versions.length > 0 || history.length > 0

  async function handleClear() {
    setIsClearing(true)
    try {
      clearLocalData()
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data in this browser</CardTitle>
        <CardDescription>
          Nothing about your CV is on our servers — this browser holds it, and this is
          the only place it can be erased from.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li>
            {versions.length === 0
              ? "no resume versions"
              : `${versions.length} resume ${versions.length === 1 ? "version" : "versions"}, with the analysis for each`}
          </li>
          <li>
            {history.length === 0
              ? "no saved job matches"
              : `${history.length} saved job ${history.length === 1 ? "match" : "matches"}`}
          </li>
          <li>about {formatBytes(localStorageUsed)} of browser storage used</li>
        </ul>

        <Button
          variant="outline"
          onClick={handleClear}
          disabled={!hasData || isClearing}
          className="w-fit"
        >
          {isClearing ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Clearing…
            </>
          ) : (
            <>
              <Trash2 data-icon="inline-start" />
              Clear my resume data
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground">
          This does not sign you out. Clearing the browser data for{" "}
          {user?.email} only — your account and password are untouched.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Account deletion.
 *
 * This removes the account: a name, an email and a password hash. There is no
 * cascade on the server, because no CV was ever stored there, and the copy this
 * browser holds is destroyed alongside it — leaving CV data behind under an
 * account id that no longer resolves is the one outcome that would contradict
 * what the user was just told. Confirming by email is the one step this page
 * cannot skip on its own: the request is irreversible, and a stray click should
 * not be enough.
 */
function DangerZone() {
  const { user, deleteAccount, isDeleting } = useAuth()

  const [isOpen, setIsOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [deleteError, setDeleteError] = useState(null)

  const canDelete = confirmation.trim().toLowerCase() === user.email.toLowerCase()

  function openDialog() {
    setConfirmation("")
    setDeleteError(null)
    setIsOpen(true)
  }

  async function handleDelete() {
    setDeleteError(null)
    try {
      await deleteAccount()
      // No navigate() here on purpose: the context has just signed the user out,
      // so the route guard sends them to the sign-in page on the next render. A
      // redirect from this function would race with that one.
      setIsOpen(false)
    } catch (error) {
      // The dialog stays open on purpose: the account is still there, and the
      // user needs to read why before deciding what to do next.
      setDeleteError(error?.message ?? "Your account could not be deleted.")
    }
  }

  return (
    <Card className="border-destructive/30 ring-destructive/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <TriangleAlert className="size-4" />
          Delete account
        </CardTitle>
        <CardDescription>
          This removes your account, and the resume data this browser holds for it.
          It cannot be undone.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li>your name, email and password — the only things we store</li>
          <li>every resume version, analysis and job match saved in this browser</li>
        </ul>

        <Button
          variant="destructive"
          onClick={openDialog}
          className="w-fit"
        >
          <Trash2 data-icon="inline-start" />
          Delete my account
        </Button>

        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                Your account is removed from the database, and the resume versions,
                analyses and job matches this browser is holding for it are erased with
                it. There is no way to get any of it back.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {deleteError && (
              <Alert variant="destructive">
                <AlertTitle>Could not delete your account</AlertTitle>
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}

            <TextField
              id="settings-delete-confirmation"
              label={<>Type <span className="font-medium text-foreground">{user.email}</span> to confirm</>}
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />

            <AlertDialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isDeleting}
              >
                Keep my account
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={!canDelete || isDeleting}
              >
                {isDeleting ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 data-icon="inline-start" />
                    Delete everything
                  </>
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

export default function Settings() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.9px]">Account settings</h2>
        <p className="text-muted-foreground">
          The details you sign in with, your password, the data this browser is holding
          for you, and — if you want it gone — the account itself.
        </p>
      </div>

      <AccountForm />
      <PasswordForm />
      <LocalDataCard />
      <DangerZone />
    </div>
  )
}
