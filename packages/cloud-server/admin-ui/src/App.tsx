import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { LoginPage } from "@/pages/login";
import { OverviewPage } from "@/pages/overview";
import { UsersListPage } from "@/pages/users-list";
import { UserDetailPage } from "@/pages/user-detail";
import { ComputersListPage } from "@/pages/computers-list";
import { ComputerDetailPage } from "@/pages/computer-detail";
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
