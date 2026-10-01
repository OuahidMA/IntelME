import { Link, Outlet, useLocation } from "react-router-dom"
import { ExternalLinkIcon, Settings } from "lucide-react"

import { AppSidebar } from "@/components/Sidebar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const titles = {
  "/dashboard": "Dashboard",
  "/analysis": "Analysis",
  "/job-match": "Job match",
  "/settings": "Settings",
}

export function DashboardLayout() {
  const { pathname } = useLocation()
  const title = titles[pathname] ?? "intelme"

  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <h1 className="text-sm font-medium tracking-[-0.01em]">{title}</h1>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              render={<Link to="/settings" />}
              aria-label="Account settings"
              title="Account settings"
              className="text-muted-foreground aria-expanded:bg-muted"
            >
              <Settings />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/" />}
              className="text-muted-foreground"
            >
              Back to site
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          </div>
        </header>

        <div className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default DashboardLayout
