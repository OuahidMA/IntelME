import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { IntelmeLogo } from "@/components/Navbar"
import SeraLogin from "@/components/SeraUI-login"
import SeraSignin3 from "@/components/SeraUI-signup"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/context/AuthContext"

export default function Auth() {
  const { isAuthenticated, isLoading, login, register } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState("login")

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleLogin({ email, password }) {
    await login({ identifier: email, password })
    navigate("/dashboard", { replace: true })
  }

  async function handleRegister({ username, email, password }) {
    await register({ username, email, password })
    navigate("/dashboard", { replace: true })
  }

  return (
    <div className="relative grid min-h-svh place-items-center px-4 py-12">
      <div
        className="hero-wash pointer-events-none absolute inset-x-0 top-0 h-[30rem]"
        aria-hidden="true"
      />

      <div className="relative grid w-full max-w-md gap-6">
        <div className="grid justify-items-center gap-3 text-center">
          <h1>
            <Link
              to="/"
              className="flex items-center gap-2 rounded-md outline-none"
            >
              <IntelmeLogo className="size-11" />
              <span className="text-xl font-semibold tracking-[-0.02em]">intelme</span>
            </Link>
          </h1>

          <p className="text-muted-foreground">
            Upload a resume, read its analysis and score it against real postings.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="gap-5">
          <TabsList className="w-full">
            <TabsTrigger value="login">Log in</TabsTrigger>
            <TabsTrigger value="register">Sign up</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <SeraLogin
              onSubmit={handleLogin}
              isLoading={isLoading}
              onSwitchToSignup={() => setTab("register")}
            />
          </TabsContent>

          <TabsContent value="register">
            <SeraSignin3
              onSubmit={handleRegister}
              isLoading={isLoading}
              onSwitchToLogin={() => setTab("login")}
            />
          </TabsContent>
        </Tabs>

        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/" />}
          className="mx-auto text-muted-foreground"
        >
          <ArrowLeft data-icon="inline-start" />
          Back to home
        </Button>
      </div>
    </div>
  )
}
