import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PhiAcknowledgmentDialog from "@/components/auth/PhiAcknowledgmentDialog";

import Auth from "./pages/Auth.tsx";
import NotFound from "./pages/NotFound.tsx";
import DashboardHome from "./pages/DashboardHome.tsx";
import PharmacyHome from "./pages/pharmacy/PharmacyHome.tsx";
import CareHome from "./pages/care/CareHome.tsx";
import HrHome from "./pages/hr/HrHome.tsx";
import InsightsHome from "./pages/insights/InsightsHome.tsx";
import PatientsHome from "./pages/patients/PatientsHome.tsx";
import AdminHome from "./pages/admin/AdminHome.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <PhiAcknowledgmentDialog />
            <Routes>
              <Route path="/auth" element={<Auth />} />

              {/* Dashboard — any signed-in user */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <DashboardHome />
                  </ProtectedRoute>
                }
              />

              {/* Pharmacy */}
              <Route
                path="/pharmacy/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "pharmacy"]}>
                    <PharmacyHome />
                  </ProtectedRoute>
                }
              />

              {/* Care Connect */}
              <Route
                path="/care/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "clinical", "billing"]}>
                    <CareHome />
                  </ProtectedRoute>
                }
              />

              {/* HR */}
              <Route
                path="/hr/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "hr", "billing"]}>
                    <HrHome />
                  </ProtectedRoute>
                }
              />

              {/* Insights — old Index content lives here now */}
              <Route
                path="/insights/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "clinical"]}>
                    <InsightsHome />
                  </ProtectedRoute>
                }
              />

              {/* Patients */}
              <Route
                path="/patients/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "pharmacy", "clinical"]}>
                    <PatientsHome />
                  </ProtectedRoute>
                }
              />

              {/* Admin */}
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin"]}>
                    <AdminHome />
                  </ProtectedRoute>
                }
              />

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
