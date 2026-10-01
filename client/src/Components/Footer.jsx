import { Link, useLocation, useNavigate } from "react-router-dom"

import { IntelmeLogo } from "@/components/Navbar"
import { scrollToSection } from "@/lib/sectionScroll"

const links = [
  { label: "Upload resume", to: "/dashboard" },
  { label: "Analysis", to: "/analysis" },
  { label: "Job match", to: "/job-match" },
  { label: "Get started", to: "/auth" },
  { label: "How it works", to: "/#how-it-works", section: "how-it-works" },
]

export function Footer() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // React Router swaps the hash without scrolling, so section links do it here.
  function handleClick(event, link) {
    if (!link.section) return

    event.preventDefault()

    if (pathname === "/") {
      scrollToSection(link.section)
    } else {
      navigate(link.to)
    }
  }

  return (
    <footer className="border-t border-border bg-background">
      <div className="container-page grid justify-items-center gap-10 py-16 text-center">
        <aside>
          <Link
            to="/"
            className="focus-warm inline-flex items-center gap-2 rounded-md text-foreground outline-none"
          >
            <IntelmeLogo className="size-11" />
            <span className="text-xl font-semibold tracking-[-0.02em]">intelme</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            Resume analysis web app that showcases the strenghts and weaknesses of your resume, as well as how it matches a job description.
          </p>
        </aside>

        <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {links.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              onClick={(event) => handleClick(event, link)}
              className="link-hover text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="container-page">
        <div className="flex flex-col items-center justify-center gap-3 border-t border-border py-6 text-center sm:flex-row sm:text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} intelme. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
