import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import Library from './pages/Library'
import EventEdit from './pages/EventEdit'
import CoLeaders from './pages/CoLeaders'
import Invite from './pages/Invite'
import Admin from './pages/Admin'
import SharedEvent from './pages/SharedEvent'
import type { ReactNode } from 'react'

function AdminOnly({ children }: { children: ReactNode }) {
  const { loading, isAdmin } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function LeaderOnly({ children }: { children: ReactNode }) {
  const { loading, session, isLeader } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!session || !isLeader) return <Navigate to="/" replace />
  return <>{children}</>
}

// Remount the editor per URL so "Duplicate" (/sets/new?copy=…) never keeps the original set's state.
function EditorRoute() {
  const location = useLocation()
  return <LeaderOnly><EventEdit key={location.pathname + location.search} /></LeaderOnly>
}

export default function App() {
  return (
    <Routes>
      <Route path="/s/:shareId" element={<SharedEvent />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/library" element={<LeaderOnly><Library /></LeaderOnly>} />
        <Route path="/sets/new" element={<EditorRoute />} />
        <Route path="/sets/:id" element={<EditorRoute />} />
        <Route path="/co-leaders" element={<LeaderOnly><CoLeaders /></LeaderOnly>} />
        <Route path="/leaders" element={<Navigate to="/co-leaders" replace />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/overview" element={<AdminOnly><Admin /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
