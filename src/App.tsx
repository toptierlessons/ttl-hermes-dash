import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  MessageSquare,
  Kanban,
  Clock,
  BarChart3,
  Package,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import logoUrl from "../assets/logo.svg";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Activity;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/scheduled", label: "Scheduled", icon: Clock },
  { to: "/kanban", label: "Kanban", icon: Kanban },
  { to: "/skills", label: "Skills", icon: Package },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/health", label: "Health", icon: Activity },
];

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex h-dvh">
      {/* Backdrop (mobile only, when the drawer is open) */}
      {menuOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      {/* Sidebar: static on desktop, off-canvas drawer below lg */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 border-r border-white/10 bg-[#0d1014] p-3",
          "transition-transform duration-200 ease-out will-change-transform",
          "lg:static lg:z-auto lg:w-60 lg:max-w-none lg:translate-x-0 lg:bg-black/30",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="mb-3 flex items-center justify-between px-2 py-2">
          <img src={logoUrl} alt="Hermes" className="h-9 w-auto" />
          <button
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="grid h-10 w-10 place-items-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, disabled }) =>
            disabled ? (
              <span
                key={to}
                className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-lg px-3 text-[0.95rem] text-white/30"
                title="Coming soon"
              >
                <Icon className="h-5 w-5" />
                {label}
                <span className="ml-auto text-xs text-white/30">soon</span>
              </span>
            ) : (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[0.95rem] transition-colors",
                    isActive
                      ? "bg-white/10 font-medium text-white"
                      : "text-white/65 hover:bg-white/5 hover:text-white",
                  ].join(" ")
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </NavLink>
            ),
          )}
        </nav>

        {window.__HERMES_AUTH_REQUIRED__ && (
          <button
            onClick={async () => {
              await api.logout();
              window.location.reload();
            }}
            className="mt-auto flex min-h-11 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-white/55 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        )}
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b border-white/10 bg-[#0d1014] px-2 py-2 lg:hidden">
          <button
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src={logoUrl} alt="Hermes" className="h-7 w-auto" />
        </header>

        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
