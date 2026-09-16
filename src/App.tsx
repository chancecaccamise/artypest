import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { RequireSignIn } from '@/features/auth/RequireSignIn'
import { DIRECTORY_ROUTES } from '@/features/directory/config'
import { ActivityPage } from '@/pages/ActivityPage'
import { ConnectionMapPage } from '@/pages/ConnectionMapPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DirectoryDetailPage } from '@/pages/DirectoryDetailPage'
import { DirectoryListPage } from '@/pages/DirectoryListPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlatPage } from '@/pages/PlatPage'
import { OwnerReconcilePage } from '@/pages/OwnerReconcilePage'
import { ParcelImportPage } from '@/pages/ParcelImportPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SignInPage } from '@/pages/SignInPage'

/*
  One list page component and one detail page component drive all seven entity
  types. The per-type differences (columns, filters, field grid, identifier
  chips) live in src/features/directory/config.tsx, not in seven page files.

  Sign-in is the only page outside the guard. Everything inside it, including
  the not-found page, needs a signed-in account whenever a database is
  configured.
*/
export default function App() {
  return (
    <Routes>
      <Route path="sign-in" element={<SignInPage />} />

      <Route element={<RequireSignIn />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="activity" element={<ActivityPage />} />

          {DIRECTORY_ROUTES.map((route) => (
            <Route key={route.path} path={route.path}>
              <Route index element={<DirectoryListPage type={route.type} />} />
              <Route path=":id" element={<DirectoryDetailPage type={route.type} />} />
            </Route>
          ))}

          <Route path="map" element={<ConnectionMapPage />} />
          <Route path="map/:id" element={<ConnectionMapPage />} />
          <Route path="plat" element={<PlatPage />} />
          <Route path="plat/:id" element={<PlatPage />} />
          <Route path="parcels" element={<ParcelImportPage />} />
          <Route path="owners" element={<OwnerReconcilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:tab" element={<SettingsPage />} />

          <Route path="404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
