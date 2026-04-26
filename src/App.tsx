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
import PharmacyLayout from "./pages/pharmacy/PharmacyLayout.tsx";
import DispenseQueue from "./pages/pharmacy/DispenseQueue.tsx";
import Inventory from "./pages/pharmacy/Inventory.tsx";
import Scanner from "./pages/pharmacy/Scanner.tsx";
import PharmacyPatients from "./pages/pharmacy/Patients.tsx";
import RefillRequests from "./pages/pharmacy/RefillRequests.tsx";
import Adherence from "./pages/pharmacy/Adherence.tsx";
import CareHome from "./pages/care/CareHome.tsx";
import HrHome from "./pages/hr/HrHome.tsx";
import InsightsHome from "./pages/insights/InsightsHome.tsx";
import PatientsHome from "./pages/patients/PatientsHome.tsx";
import AdminHome from "./pages/admin/AdminHome.tsx";
import EstimatorHome from "./pages/estimator/EstimatorHome.tsx";

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

              {/* Pharmacy — nested sub-tabs */}
              <Route
                path="/pharmacy"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "pharmacy"]}>
                    <PharmacyLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DispenseQueue />} />
                <Route path="dispense" element={<DispenseQueue />} />
                <Route path="scanner" element={<Scanner />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="patients" element={<PharmacyPatients />} />
                <Route path="refills" element={<RefillRequests />} />
                <Route path="adherence" element={<Adherence />} />
              </Route>

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

              {/* Cost Estimator */}
              <Route
                path="/estimator/*"
                element={
                  <ProtectedRoute allowedRoles={["super_admin", "admin", "pharmacy", "clinical", "billing"]}>
                    <EstimatorHome />
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
