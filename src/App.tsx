import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import Library from './pages/Library'
import EventEdit from './pages/EventEdit'
import Leaders from './pages/Leaders'
import SharedEvent from './pages/SharedEvent'
import type { ReactNode } from 'react'

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
        <Route path="/leaders" element={<LeaderOnly><Leaders /></LeaderOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
