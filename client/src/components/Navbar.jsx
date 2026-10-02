import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { MenuIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"

/** Brand mark. The artwork carries its own canvas, so it replaces the old chip. */
export function IntelmeLogo({ className, alt = "", ...props }) {
  return (
    <img
      src="/logo-svg.svg"
      alt={alt}
      width={500}
      height={500}
      className={cn("size-9 rounded-lg object-cover", className)}
      {...props}
    />
  )
}

function Wordmark({ className }) {
  return (
    <span className={cn("text-[17px] font-semibold tracking-[-0.02em]", className)}>
      intelme
    </span>
  )
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { isAuthenticated } = useAuth()

  const accountTo = isAuthenticated ? "/dashboard" : "/auth"
  const accountLabel = isAuthenticated ? "Dashboard" : "Get Started"

  const isActive = (to) => {
    const [pathname, search] = to.split("?")
    if (pathname !== location.pathname) return false
    if (!search) return !location.search
    return location.search === `?${search}`
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/85 backdrop-blur-md">
      <div className="container-page flex h-18 items-center justify-between gap-4">
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="focus-warm flex shrink-0 items-center gap-2 rounded-md text-foreground outline-none"
        >
          <IntelmeLogo />
          <Wordmark />
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/contact"
            className={cn(
              "rounded-md px-2 text-sm transition-colors hover:text-foreground",
              isActive("/contact") ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Contact
          </Link>
          <Button
            size="lg"
            render={<Link to={accountTo} />}
            className="inset-button hidden sm:inline-flex"
          >
            {accountLabel}
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            className="sm:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <XIcon /> : <MenuIcon />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="max-h-[calc(100svh-4.5rem)] overflow-y-auto border-t border-border bg-background sm:hidden">
          <div className="container-page grid gap-4 py-6">
            <Button
              size="lg"
              render={<Link to={accountTo} />}
              onClick={() => setMobileOpen(false)}
              className="inset-button w-full"
            >
              {accountLabel}
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}

export default Navbar
