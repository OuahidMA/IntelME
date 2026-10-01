import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider, useAuth } from "@/context/AuthContext"
import { ResumeProvider } from "@/context/ResumeContext"
import { DashboardLayout } from "@/layouts/DashboardLayout"
import Analysis from "@/pages/Analysis"
import Auth from "@/pages/Auth"
import Contact from "@/pages/Contact"
import Dashboard from "@/pages/Dashboard"
import Home from "@/pages/Home"
import JobMatch from "@/pages/JobMatch"
import Settings from "@/pages/Settings"

function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  }

  return children
}

function NotFound() {
  return (
    <div className="grid min-h-svh place-content-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-[-0.9px]">This page does not exist</h1>
      <p className="max-w-md text-muted-foreground">
        The link may be out of date, or the analysis it pointed at has been cleared.
      </p>
      <Button
        variant="outline"
        render={<Link to="/" />}
        className="mx-auto mt-2"
      >
        <ArrowLeft data-icon="inline-start" />
        Back to home
      </Button>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ResumeProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/contact" element={<Contact />} />
              <Route
                element={
                  <RequireAuth>
                    <DashboardLayout />
                  </RequireAuth>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/analysis" element={<Analysis />} />
                <Route path="/job-match" element={<JobMatch />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </ResumeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
