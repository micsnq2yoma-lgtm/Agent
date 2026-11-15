// Agentself routes, mounted under /:companyPrefix by ui/src/App.tsx (P8 / P10).
import { Route } from "@/lib/router";
import {
  ArchivedPage,
  CapabilitiesPage,
  DepartmentRoutePage,
  NewDepartmentPage,
  OrgRoutePage,
  ProjectsPage,
  RecordsPage,
  RoutinesPage,
  SettingsRoutePage,
  UsagePage,
  WorkbenchPage,
} from "./App";

export function agentselfRoutes() {
  return (
    <>
      <Route path="agentself" element={<WorkbenchPage />} />
      <Route path="agentself/projects" element={<ProjectsPage />} />
      <Route path="agentself/departments/new" element={<NewDepartmentPage />} />
      <Route path="agentself/departments/:departmentKey" element={<DepartmentRoutePage />} />
      <Route path="agentself/departments/:departmentKey/:tab" element={<DepartmentRoutePage />} />
      <Route path="agentself/routines" element={<RoutinesPage />} />
      <Route path="agentself/capabilities" element={<CapabilitiesPage />} />
      <Route path="agentself/capabilities/:tab" element={<CapabilitiesPage />} />
      <Route path="agentself/usage" element={<UsagePage />} />
      <Route path="agentself/usage/:tab" element={<UsagePage />} />
      <Route path="agentself/records" element={<RecordsPage />} />
      <Route path="agentself/records/:tab" element={<RecordsPage />} />
      <Route path="agentself/records/:tab/*" element={<RecordsPage />} />
      <Route path="agentself/org" element={<OrgRoutePage />} />
      <Route path="agentself/settings" element={<SettingsRoutePage />} />
      <Route path="agentself/archived" element={<ArchivedPage />} />
    </>
  );
}
