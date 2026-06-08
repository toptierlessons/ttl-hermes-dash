import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  MessageSquare,
  Kanban,
  Clock,
  BarChart3,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Activity;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/scheduled", label: "Scheduled", icon: Clock },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/health", label: "Health", icon: Activity },
  { to: "/board", label: "Board", icon: Kanban, disabled: true },
];

export default function App() {
  return (
    <div className="flex h-dvh">
      <aside className="flex w-56 flex-col gap-1 border-r border-white/10 bg-black/30 p-3">
        <div className="px-2 py-3 text-lg font-semibold tracking-tight">
          Hermes
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
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
