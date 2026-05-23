import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AiUsageDetailPage } from "@/pages/ai-usage-detail";
import { AiUsagePage } from "@/pages/ai-usage";
import { LoginPage } from "@/pages/login";
import { OverviewPage } from "@/pages/overview";
import { UsersListPage } from "@/pages/users-list";
import { UserDetailPage } from "@/pages/user-detail";
import { ComputersListPage } from "@/pages/computers-list";
import { ComputerDetailPage } from "@/pages/computer-detail";
import { FeedbackPage } from "@/pages/feedback";
import { ReleasesPage } from "@/pages/releases";
import { NotFoundPage } from "@/pages/not-found";

export const App = () => (
  <ThemeProvider>
    <TooltipProvider delayDuration={200}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="users" element={<UsersListPage />} />
            <Route path="users/:userId" element={<UserDetailPage />} />
            <Route path="computers" element={<ComputersListPage />} />
            <Route path="computers/:computerId" element={<ComputerDetailPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="ai-usage" element={<AiUsagePage />} />
            <Route path="ai-usage/:usageId" element={<AiUsageDetailPage />} />
            <Route path="releases" element={<ReleasesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </TooltipProvider>
  </ThemeProvider>
);
