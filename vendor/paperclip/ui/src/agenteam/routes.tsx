// AgenTeam routes, mounted under /:companyPrefix by ui/src/App.tsx (P8 / P10).
import { Route } from "@/lib/router";
import {
  ArchivedPage,
  CapabilitiesPage,
  DepartmentRoutePage,
  LibraryPage,
  NewDepartmentPage,
  OrgRoutePage,
  ProjectsPage,
  RecordsPage,
  RoutinesPage,
  SettingsRoutePage,
  UsagePage,
  WorkbenchPage,
} from "./App";

export function agenteamRoutes() {
  return (
    <>
      <Route path="agenteam" element={<WorkbenchPage />} />
      <Route path="agenteam/projects" element={<ProjectsPage />} />
      <Route path="agenteam/library" element={<LibraryPage />} />
      <Route path="agenteam/departments/new" element={<NewDepartmentPage />} />
      <Route path="agenteam/departments/:departmentKey" element={<DepartmentRoutePage />} />
      <Route path="agenteam/departments/:departmentKey/:tab" element={<DepartmentRoutePage />} />
      <Route path="agenteam/routines" element={<RoutinesPage />} />
      <Route path="agenteam/capabilities" element={<CapabilitiesPage />} />
      <Route path="agenteam/capabilities/:tab" element={<CapabilitiesPage />} />
      <Route path="agenteam/usage" element={<UsagePage />} />
      <Route path="agenteam/usage/:tab" element={<UsagePage />} />
      <Route path="agenteam/records" element={<RecordsPage />} />
      <Route path="agenteam/records/:tab" element={<RecordsPage />} />
      <Route path="agenteam/records/:tab/*" element={<RecordsPage />} />
      <Route path="agenteam/org" element={<OrgRoutePage />} />
      <Route path="agenteam/settings" element={<SettingsRoutePage />} />
      <Route path="agenteam/archived" element={<ArchivedPage />} />
    </>
  );
}
