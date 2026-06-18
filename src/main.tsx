import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import App from "./App";
import HealthPage from "./pages/HealthPage";
import ChatPage from "./pages/ChatPage";
import CronPage from "./pages/CronPage";
import UsagePage from "./pages/UsagePage";
import KanbanPage from "./pages/KanbanPage";
import SkillsPage from "./pages/SkillsPage";
import { SessionsProvider } from "./state/SessionsProvider";
import AuthGate from "./state/AuthGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <SessionsProvider>
          <Routes>
            <Route element={<App />}>
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/scheduled" element={<CronPage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/kanban" element={<KanbanPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/health" element={<HealthPage />} />
            </Route>
          </Routes>
        </SessionsProvider>
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
);
