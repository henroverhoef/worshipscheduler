import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'

export default function Layout() {
  const { isLeader, session } = useAuth()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/icons/icon.svg" alt="" width={28} height={28} />
          <span>Worship Sets</span>
        </NavLink>
        {isLeader && (
          <nav className="tabs">
            <NavLink to="/" end>Sets</NavLink>
            <NavLink to="/library">Library</NavLink>
            <NavLink to="/leaders">Leaders</NavLink>
          </nav>
        )}
        <div className="topbar-end">
          {session ? (
            <button className="btn ghost small" onClick={signOut}>Sign out</button>
          ) : (
            <NavLink to="/login" className="btn ghost small">Leader sign in</NavLink>
          )}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
