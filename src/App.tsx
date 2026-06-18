import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  MessageSquare,
  Kanban,
  Clock,
  BarChart3,
  Package,
  LogOut,
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
  return (
    <div className="flex h-dvh">
      <aside className="flex w-56 flex-col gap-1 border-r border-white/10 bg-black/30 p-3">
        <div className="mb-4 px-3 py-3">
          <img src={logoUrl} alt="Hermes" className="h-9 w-auto" />
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, disabled }) =>
            disabled ? (
              <span
                key={to}
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/30"
                title="Coming soon"
              >
                <Icon className="h-4 w-4" />
                {label}
                <span className="ml-auto text-[0.7rem] text-white/30">
                  soon
                </span>
              </span>
            ) : (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white",
                  ].join(" ")
                }
              >
                <Icon className="h-4 w-4" />
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
            className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/55 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        )}
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
