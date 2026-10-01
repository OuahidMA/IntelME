import { Link, useLocation, useNavigate } from "react-router-dom"
import { Briefcase, LayoutDashboard, LogOut, ScanText, Settings } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { IntelmeLogo } from "@/components/Navbar"
import { useAuth } from "@/context/AuthContext"

const navigation = [
  {
    title: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Analysis",
    to: "/analysis",
    icon: ScanText,
  },
  {
    title: "Job match",
    to: "/job-match",
    icon: Briefcase,
  },
  {
    title: "Settings",
    to: "/settings",
    icon: Settings,
  },
]

function NavMain() {
  const { pathname } = useLocation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarMenu>
        {navigation.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={pathname === item.to}
              render={<Link to={item.to} />}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavUser() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    logout()
    navigate("/", { replace: true })
  }

  if (!user) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Signed in as</SidebarGroupLabel>
      <div className="flex items-center gap-2 px-2 pb-2 group-data-[collapsible=icon]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
          {user.initials}
        </span>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-medium">{user.username}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </div>
      </div>

      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Log out" onClick={handleSignOut}>
            <LogOut />
            <span>Log out</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

export function AppSidebar({ ...props }) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <IntelmeLogo className="size-9 shrink-0" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] group-data-[collapsible=icon]:hidden">
            intelme
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <NavMain />
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

export default AppSidebar
