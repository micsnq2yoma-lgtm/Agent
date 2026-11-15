// Agentself routes, mounted under /:companyPrefix by ui/src/App.tsx (P8).
import { Route } from "@/lib/router";
import {
  ArchivedPage,
  CapabilitiesPage,
  NewDepartmentPage,
  ProjectsPage,
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
      <Route path="agentself/departments/:departmentKey" element={<WorkbenchPage />} />
      <Route path="agentself/routines" element={<RoutinesPage />} />
      <Route path="agentself/capabilities" element={<CapabilitiesPage />} />
      <Route path="agentself/usage" element={<UsagePage />} />
      <Route path="agentself/settings" element={<SettingsRoutePage />} />
      <Route path="agentself/archived" element={<ArchivedPage />} />
    </>
  );
}
