import { Route, Routes } from "react-router-dom";
import HrLayout from "./HrLayout";
import HrDashboard from "./HrDashboard";
import HrEmployees from "./HrEmployees";
import HrEmployeeDetail from "./HrEmployeeDetail";
import HrOrgChart from "./HrOrgChart";
import HrOnboarding from "./HrOnboarding";
import HrPayroll from "./HrPayroll";
import HrTimeOff from "./HrTimeOff";
import HrAttendance from "./HrAttendance";
import HrPtoBalances from "./HrPtoBalances";
import HrReports from "./HrReports";
import HrGrievances from "./HrGrievances";
import HrDocuments from "./HrDocuments";
import HrNotifications from "./HrNotifications";

export default function HrHome() {
  return (
    <Routes>
      <Route element={<HrLayout />}>
        <Route index element={<HrDashboard />} />
        <Route path="employees" element={<HrEmployees />} />
        <Route path="employees/:id" element={<HrEmployeeDetail />} />
        <Route path="org-chart" element={<HrOrgChart />} />
        <Route path="onboarding" element={<HrOnboarding />} />
        <Route path="payroll" element={<HrPayroll />} />
        <Route path="time-off" element={<HrTimeOff />} />
        <Route path="attendance" element={<HrAttendance />} />
        <Route path="pto-balances" element={<HrPtoBalances />} />
        <Route path="reports" element={<HrReports />} />
        <Route path="grievances" element={<HrGrievances />} />
        <Route path="documents" element={<HrDocuments />} />
        <Route path="notifications" element={<HrNotifications />} />
      </Route>
    </Routes>
  );
}
